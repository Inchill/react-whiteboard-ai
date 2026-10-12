import { createId as defaultCreateId } from '../geometry';
import { INK, type Shape } from '../types';
import { parsePath, samplePath, type Pt } from './path';

/**
 * Line drawings from SVG path data, turned into the board's own pressure pen strokes and given a
 * hand-drawn feel: pressure that swells and fades, a slight wobble, and closed shapes that overlap
 * where they meet instead of closing perfectly. The result is indistinguishable from drawing with
 * the pen tool, so it can be erased, moved and recolored like anything else.
 */

export type SketchStroke = {
    /** SVG path data in the sketch's own coordinates, e.g. "M10 50 C 20 10, 80 10, 90 50". */
    d: string;
    /** Name of the part this stroke draws, from `parts`. */
    part?: string;
    /** "ink" (default) or a hex color. */
    color?: string;
    /** Pen width on the board. Default 3. */
    width?: number;
};

/** A planned region of the drawing, in the sketch's own coordinates. */
export type SketchPart = {
    name: string;
    /** The part this one grows from (a tail on the body). The tool checks that their strokes touch. */
    on?: string;
    x: number;
    y: number;
    w: number;
    h: number;
};

export type SketchInput = {
    /** What is drawn and how it is posed, in a few words. The plan before any coordinates. */
    subject?: string;
    /** Where each part goes. The draw_sketch tool requires them; they are not drawn. */
    parts?: SketchPart[];
    /** Size of the coordinate box the paths are written in. Default 100 × 100, y grows down. */
    width?: number;
    height?: number;
    strokes: SketchStroke[];
    /** Longest side of the drawing on the board. Default 240. */
    size?: number;
    /** Top-left corner on the board. Defaults to `origin` from the options. */
    x?: number;
    y?: number;
};

export type SketchOptions = {
    createId?: () => string;
    origin?: { x: number; y: number };
    /** Seed for the hand-drawn variation, so the same input can be redrawn identically. */
    seed?: number;
};

export const SKETCH_DEFAULTS = { box: 100, size: 240, width: 3, step: 3 } as const;

/** Small deterministic random generator (mulberry32). */
function random(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Hash a string to a seed so each drawing varies but the same drawing is stable. */
function hash(text: string) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
}

/**
 * Give an evenly sampled polyline a hand-drawn feel and pressure values.
 * `scale` is board units per sketch unit, used to keep the wobble the same size on screen.
 */
export function humanize(points: Pt[], closed: boolean, rand: () => number): [number, number, number][] {
    if (points.length < 2) return points.map((p) => [p.x, p.y, 0.5]);
    let pts = points;

    // A hand rarely closes a loop exactly: carry on a little past the start.
    if (closed && pts.length > 8) {
        const overlap = Math.min(pts.length - 1, 2 + Math.floor(rand() * 3));
        pts = [...pts, ...pts.slice(1, overlap + 1)];
    }

    // Arc length at each point.
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = along[along.length - 1] || 1;

    // Wobble: two slow waves across the stroke direction, a fraction of a unit tall.
    const amp = Math.min(1.1, 0.25 + total / 400);
    const [f1, f2] = [40 + rand() * 30, 13 + rand() * 8];
    const [p1, p2] = [rand() * Math.PI * 2, rand() * Math.PI * 2];
    // Pressure: heavier through the middle of a stroke, with a slow drift.
    const [pf, pp] = [60 + rand() * 60, rand() * Math.PI * 2];

    return pts.map((p, i) => {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const s = along[i];
        const t = s / total;
        const off = amp * (0.65 * Math.sin(s / f1 + p1) + 0.35 * Math.sin(s / f2 + p2)) * Math.sin(Math.PI * Math.min(1, t * 6, (1 - t) * 6) / 2);
        const pressure = 0.45 + 0.12 * Math.sin(Math.PI * t) + 0.06 * Math.sin(s / pf + pp);
        return [round(p.x + (-dy / len) * off), round(p.y + (dx / len) * off), round(Math.min(0.9, Math.max(0.2, pressure)))];
    });
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Turn a sketch into pen strokes on the board. Throws PathSyntaxError for invalid path data. */
export function sketchToShapes(input: SketchInput, options: SketchOptions = {}): Shape[] {
    const createId = options.createId ?? defaultCreateId;
    const boxW = input.width ?? SKETCH_DEFAULTS.box;
    const boxH = input.height ?? SKETCH_DEFAULTS.box;
    const k = (input.size ?? SKETCH_DEFAULTS.size) / Math.max(boxW, boxH);
    const ox = input.x ?? options.origin?.x ?? 0;
    const oy = input.y ?? options.origin?.y ?? 0;
    const rand = random(options.seed ?? hash(input.strokes.map((s) => s.d).join('|')));

    const shapes: Shape[] = [];
    for (const stroke of input.strokes) {
        for (const sub of parsePath(stroke.d)) {
            // Sample in board units so the point spacing does not depend on the sketch's scale.
            const scaled = { ...sub, segments: sub.segments.map((seg) => scaleSegment(seg, k, ox, oy)) };
            const points = samplePath(scaled, SKETCH_DEFAULTS.step);
            if (!points.length) continue;
            shapes.push({
                id: createId(),
                type: 'pen',
                points: humanize(points, sub.closed, rand),
                pressure: true,
                color: stroke.color ?? INK,
                strokeWidth: stroke.width ?? SKETCH_DEFAULTS.width,
                strokeStyle: 'solid',
            });
        }
    }
    return shapes;
}

type AnySegment = ReturnType<typeof parsePath>[number]['segments'][number];

function scaleSegment(seg: AnySegment, k: number, ox: number, oy: number): AnySegment {
    const p = (q: Pt): Pt => ({ x: ox + q.x * k, y: oy + q.y * k });
    switch (seg.kind) {
        case 'line':
            return { ...seg, from: p(seg.from), to: p(seg.to) };
        case 'quad':
            return { ...seg, from: p(seg.from), c: p(seg.c), to: p(seg.to) };
        case 'cubic':
            return { ...seg, from: p(seg.from), c1: p(seg.c1), c2: p(seg.c2), to: p(seg.to) };
        case 'arc':
            return { ...seg, from: p(seg.from), to: p(seg.to), rx: seg.rx * k, ry: seg.ry * k };
    }
}
