import { parsePath, samplePath, type Pt } from './path';
import type { SketchInput, SketchPart } from './sketch';

/**
 * Joining attached parts. A part drawn `on` another (a head on the body, a tail on the body) should
 * touch it. Models often leave a small gap; rather than reject the drawing and have the model redraw
 * everything, a small gap is closed by moving the attached part, together with whatever hangs off it.
 * Only a large gap, which means the plan itself is wrong, is an error (see the draw_sketch validator).
 */

/** As fractions of the drawing box's longer side. */
export const JOIN = {
    /** Closer than this counts as touching. */
    touch: 0.04,
    /** A gap up to this is closed automatically; a larger one is rejected. */
    maxGap: 0.15,
} as const;

export type PartMove = { part: string; on: string; dx: number; dy: number };

export const sketchExtent = (input: Pick<SketchInput, 'width' | 'height'>) => Math.max(input.width ?? 100, input.height ?? 100);

/** Points along each part's strokes, about 1% of the drawing box apart. Strokes without a part are skipped. */
export function sampleParts(input: SketchInput): Map<string, Pt[]> {
    const step = sketchExtent(input) / 100;
    const out = new Map<string, Pt[]>();
    for (const stroke of input.strokes) {
        if (stroke.part === undefined) continue;
        const points = out.get(stroke.part) ?? [];
        for (const sub of parsePath(stroke.d)) points.push(...samplePath(sub, step));
        out.set(stroke.part, points);
    }
    return out;
}

/** The closest pair of points between two point sets. */
export function nearest(a: Pt[], b: Pt[]): { d: number; from: Pt; to: Pt } | null {
    let best: { d: number; from: Pt; to: Pt } | null = null;
    for (const p of a) {
        for (const q of b) {
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (!best || d < best.d) best = { d, from: p, to: q };
        }
    }
    return best;
}

/** Parts in an order where each comes after the part it is on. Parts caught in a loop are left out. */
function baseFirst(parts: SketchPart[]): SketchPart[] {
    const byName = new Map(parts.map((p) => [p.name, p]));
    const done = new Set<string>();
    const order: SketchPart[] = [];
    const visit = (p: SketchPart, path: Set<string>) => {
        if (done.has(p.name) || path.has(p.name)) return;
        path.add(p.name);
        const base = p.on === undefined ? undefined : byName.get(p.on);
        if (base) visit(base, path);
        path.delete(p.name);
        if (base && !done.has(base.name)) return; // a loop
        done.add(p.name);
        order.push(p);
    };
    for (const p of parts) visit(p, new Set());
    return order;
}

/** The part each detail (a part without `on`, such as an eye) sits in: the smallest other part whose box holds its center. */
function holders(parts: SketchPart[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of parts) {
        if (p.on !== undefined) continue;
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        let best: SketchPart | undefined;
        for (const q of parts) {
            if (q === p || q.w * q.h <= p.w * p.h) continue;
            if (cx < q.x || cx > q.x + q.w || cy < q.y || cy > q.y + q.h) continue;
            if (!best || q.w * q.h < best.w * best.h) best = q;
        }
        if (best) out.set(p.name, best.name);
    }
    return out;
}

/**
 * How far to move each part so that every attached part touches the part it is on. A part moves
 * with everything attached to it or sitting in it (a head takes its ears and eyes along). Gaps
 * larger than `JOIN.maxGap` are left alone.
 */
export function joinOffsets(input: SketchInput): { moves: PartMove[]; offsets: Map<string, Pt> } {
    const parts = input.parts ?? [];
    const offsets = new Map<string, Pt>();
    const moves: PartMove[] = [];
    if (!parts.some((p) => p.on !== undefined)) return { moves, offsets };

    const extent = sketchExtent(input);
    const points = sampleParts(input);
    const heldBy = holders(parts);
    // Who moves along with a part: what is on it or in it, and so on down.
    const children = new Map<string, string[]>();
    for (const p of parts) {
        const parent = p.on ?? heldBy.get(p.name);
        if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), p.name]);
    }
    const shift = (name: string, dx: number, dy: number, seen = new Set<string>()) => {
        if (seen.has(name)) return;
        seen.add(name);
        const o = offsets.get(name) ?? { x: 0, y: 0 };
        offsets.set(name, { x: o.x + dx, y: o.y + dy });
        for (const c of children.get(name) ?? []) shift(c, dx, dy, seen);
    };
    const at = (name: string) => {
        const o = offsets.get(name) ?? { x: 0, y: 0 };
        return (points.get(name) ?? []).map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
    };

    for (const part of baseFirst(parts)) {
        if (part.on === undefined) continue;
        const gap = nearest(at(part.name), at(part.on));
        if (!gap || gap.d <= JOIN.touch * extent || gap.d > JOIN.maxGap * extent) continue;
        // Move until the closest points overlap slightly, as a hand-drawn join would.
        const k = (gap.d + 0.01 * extent) / gap.d;
        const dx = (gap.to.x - gap.from.x) * k;
        const dy = (gap.to.y - gap.from.y) * k;
        shift(part.name, dx, dy);
        moves.push({ part: part.name, on: part.on, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 });
    }
    return { moves, offsets };
}

/** The moves `sketchToShapes` makes to join attached parts, for telling the model what changed. */
export const joinParts = (input: SketchInput): PartMove[] => joinOffsets(input).moves;
