import { createId as defaultCreateId, measureText, shapeBox, translateShape, unionBox } from '../geometry';
import { INK, type Shape, type StrokeStyle } from '../types';

/**
 * Automatic layout for node-and-arrow diagrams (flowcharts, architecture, org charts, trees,
 * state machines). A model describes structure only; this decides every coordinate, so the
 * result is aligned, evenly spaced and consistently styled, and the model writes far fewer tokens.
 *
 * The output is ordinary board shapes (rectangles, text, lines, arrows) that stay editable.
 */

export type DiagramNode = {
    id: string;
    /** Use \n for a line break. */
    label: string;
    /** Layer (row, or column for `direction: 'right'`) by name. Layers appear in the order first used. */
    layer?: string;
    color?: string;
    shape?: 'box' | 'ellipse';
};

export type DiagramEdge = {
    from: string;
    to: string;
    label?: string;
    style?: StrokeStyle;
};

export type DiagramInput = {
    /** `down`: layers stack top to bottom (default). `right`: layers run left to right. */
    direction?: 'down' | 'right';
    nodes: DiagramNode[];
    edges?: DiagramEdge[];
    /** Top-left corner of the diagram. Defaults to `origin` from the options. */
    x?: number;
    y?: number;
};

export type DiagramOptions = {
    createId?: () => string;
    /** Where the diagram goes when the input gives no x/y. */
    origin?: { x: number; y: number };
};

export type DiagramResult = {
    shapes: Shape[];
    /** Diagram node id → id of the box shape drawn for it, so later edits can find it. */
    nodes: Record<string, string>;
};

export const DIAGRAM_STYLE = {
    fontSize: 20,
    edgeLabelSize: 14,
    layerLabelSize: 16,
    padX: 28,
    padY: 18,
    minWidth: 128,
    strokeWidth: 2,
    /** Colors per layer, picked to read well with a translucent fill in light and dark themes. */
    palette: ['#1971c2', '#2f9e44', '#f08c00', '#7048e8', '#0c8599', '#e03131'],
    layerColor: '#adb5bd',
} as const;

type Pt = { x: number; y: number };

/** Assign a rank (layer index) to every node, and find edges that point back against the flow. */
function rankNodes(nodes: DiagramNode[], edges: DiagramEdge[]): { rank: Map<string, number>; layerNames: string[] } {
    const rank = new Map<string, number>();
    const layered = nodes.some((n) => n.layer);
    if (layered) {
        const names: string[] = [];
        for (const n of nodes) if (n.layer && !names.includes(n.layer)) names.push(n.layer);
        for (const n of nodes) rank.set(n.id, names.indexOf(n.layer ?? names[0]));
        return { rank, layerNames: names };
    }

    // Longest path from the sources, ignoring edges that close a cycle (found by DFS in input order).
    const out = new Map<string, DiagramEdge[]>(nodes.map((n) => [n.id, []]));
    for (const e of edges) out.get(e.from)?.push(e);
    const state = new Map<string, 0 | 1 | 2>();
    const back = new Set<DiagramEdge>();
    const visit = (id: string) => {
        state.set(id, 1);
        for (const e of out.get(id) ?? []) {
            const s = state.get(e.to) ?? 0;
            if (s === 1) back.add(e);
            else if (s === 0) visit(e.to);
        }
        state.set(id, 2);
    };
    for (const n of nodes) if (!state.get(n.id)) visit(n.id);

    const forward = edges.filter((e) => !back.has(e) && e.from !== e.to);
    const indegree = new Map(nodes.map((n) => [n.id, 0]));
    for (const e of forward) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    const queue = nodes.filter((n) => !indegree.get(n.id)).map((n) => n.id);
    for (const id of queue) rank.set(id, 0);
    while (queue.length) {
        const id = queue.shift()!;
        for (const e of forward) {
            if (e.from !== id) continue;
            rank.set(e.to, Math.max(rank.get(e.to) ?? 0, (rank.get(id) ?? 0) + 1));
            indegree.set(e.to, indegree.get(e.to)! - 1);
            if (!indegree.get(e.to)) queue.push(e.to);
        }
    }
    for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);
    return { rank, layerNames: [] };
}

/** Order nodes inside each layer to reduce crossings (barycenter heuristic, a few sweeps). */
function orderLayers(ids: string[], links: [string, string][], rank: Map<string, number>): string[][] {
    const count = Math.max(0, ...ids.map((id) => rank.get(id)!)) + 1;
    const layers: string[][] = Array.from({ length: count }, () => []);
    for (const id of ids) layers[rank.get(id)!].push(id);

    const neighbors = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const [a, b] of links) {
        neighbors.get(a)!.push(b);
        neighbors.get(b)!.push(a);
    }
    const sweep = (r: number, ref: number) => {
        const pos = new Map(layers[ref].map((id, i) => [id, i]));
        const keyed = layers[r].map((id, i) => {
            const near = neighbors.get(id)!.filter((m) => pos.has(m)).map((m) => pos.get(m)!);
            return { id, key: near.length ? near.reduce((a, b) => a + b, 0) / near.length : i, i };
        });
        keyed.sort((a, b) => a.key - b.key || a.i - b.i);
        layers[r] = keyed.map((k) => k.id);
    };
    for (let iter = 0; iter < 6; iter++) {
        for (let r = 1; r < count; r++) sweep(r, r - 1);
        for (let r = count - 2; r >= 0; r--) sweep(r, r + 1);
    }
    return layers;
}

/**
 * Place centers across the flow. Starts from evenly spaced, centered layers, then pulls each item
 * toward the mean of its neighbors in the adjacent layer (children under parents, parents over
 * children) while keeping order and spacing: the push-right and push-left solutions are both
 * feasible, and so is their average. `space(a, b)` is the minimum distance between two neighbors.
 */
function placeAcross(layers: string[][], neighbors: Map<string, string[]>, rank: Map<string, number>, space: (a: string, b: string) => number) {
    const pos = new Map<string, number>();
    const spanOf = (ids: string[]) => ids.slice(1).reduce((sum, id, i) => sum + space(ids[i], id), 0);
    const widest = Math.max(...layers.map(spanOf));
    for (const ids of layers) {
        let at = (widest - spanOf(ids)) / 2;
        ids.forEach((id, i) => {
            if (i) at += space(ids[i - 1], id);
            pos.set(id, at);
        });
    }

    const relax = (r: number, ref: number) => {
        const ids = layers[r];
        const want = ids.map((id) => {
            const near = neighbors.get(id)!.filter((m) => rank.get(m) === ref).map((m) => pos.get(m)!);
            return near.length ? near.reduce((a, b) => a + b, 0) / near.length : pos.get(id)!;
        });
        const right: number[] = [];
        want.forEach((w, i) => (right[i] = i ? Math.max(w, right[i - 1] + space(ids[i - 1], ids[i])) : w));
        const left: number[] = [];
        for (let i = want.length - 1; i >= 0; i--) left[i] = i < want.length - 1 ? Math.min(want[i], left[i + 1] - space(ids[i], ids[i + 1])) : want[i];
        ids.forEach((id, i) => pos.set(id, (right[i] + left[i]) / 2));
    };
    // End on the upward pass, so each parent sits centered over its children.
    for (let iter = 0; iter < 6; iter++) {
        for (let r = 1; r < layers.length; r++) relax(r, r - 1);
        for (let r = layers.length - 2; r >= 0; r--) relax(r, r + 1);
    }
    return pos;
}

export function layoutDiagram(input: DiagramInput, options: DiagramOptions = {}): DiagramResult {
    const createId = options.createId ?? defaultCreateId;
    const S = DIAGRAM_STYLE;
    const down = (input.direction ?? 'down') === 'down';
    const nodes = input.nodes;
    const edges = (input.edges ?? []).filter((e) => e.from !== e.to);

    const { rank, layerNames } = rankNodes(nodes, edges);
    const r = (id: string) => rank.get(id)!;
    // Edges between layers, all pointing down the flow. An edge one layer against the flow is laid
    // out reversed like any other and gets its arrowhead at its real end when drawn. Longer ones
    // (a flowchart's "try again") loop around the outside instead; see below.
    type Link = { edge: DiagramEdge; from: string; to: string; reversed: boolean };
    const loops = edges.filter((e) => r(e.from) - r(e.to) >= 2);
    const links: Link[] = edges
        .filter((e) => r(e.to) !== r(e.from) && !loops.includes(e))
        .map((e) => (r(e.to) > r(e.from) ? { edge: e, from: e.from, to: e.to, reversed: false } : { edge: e, from: e.to, to: e.from, reversed: true }));
    const sideways = edges.filter((e) => r(e.to) === r(e.from));

    // Links that skip layers get a narrow placeholder ("channel") in every layer they cross, so
    // ordering and placement keep a free lane for them and they never run through a box.
    const channels = new Map<Link, string[]>();
    const ties: [string, string][] = [];
    const allIds = nodes.map((n) => n.id);
    links.forEach((l, i) => {
        const chain: string[] = [];
        for (let k = r(l.from) + 1; k < r(l.to); k++) {
            const id = `\u0000${i}:${k}`;
            rank.set(id, k);
            chain.push(id);
            allIds.push(id);
        }
        channels.set(l, chain);
        const hops = [l.from, ...chain, l.to];
        for (let k = 1; k < hops.length; k++) ties.push([hops[k - 1], hops[k]]);
    });
    const isChannel = (id: string) => id.startsWith('\u0000');
    const layers = orderLayers(allIds, ties, rank);

    // One box size for the whole diagram, wide enough for the longest label.
    const sizes = new Map(nodes.map((n) => [n.id, measureText(n.label, S.fontSize)]));
    const W = Math.max(S.minWidth, ...[...sizes.values()].map((s) => Math.ceil(s.w) + 2 * S.padX));
    const H = Math.max(...[...sizes.values()].map((s) => Math.ceil(s.h))) + 2 * S.padY;
    const labelled = edges.some((e) => e.label);

    // Work in (u, v): v runs along the flow (layer after layer), u across it.
    const M = down ? H : W; // node size along the flow
    const C = down ? W : H; // node size across the flow
    const gapMain = (down ? 88 : 104) + (labelled ? 16 : 0);
    const gapCross = down ? 48 : 32;
    const toXY = (u: number, v: number): Pt => (down ? { x: u, y: v } : { x: v, y: u });

    const neighbors = new Map<string, string[]>(allIds.map((id) => [id, []]));
    for (const [a, b] of ties) {
        neighbors.get(a)!.push(b);
        neighbors.get(b)!.push(a);
    }
    const half = (id: string) => (isChannel(id) ? 0 : C / 2);
    const space = (a: string, b: string) => half(a) + half(b) + (isChannel(a) || isChannel(b) ? 20 : gapCross);
    const mid = placeAcross(layers, neighbors, rank, space);
    const lo = (id: string) => mid.get(id)! - C / 2;
    const minU = Math.min(...nodes.map((n) => lo(n.id)));
    const maxU = Math.max(...nodes.map((n) => lo(n.id) + C));

    // Same-layer edges that cannot be a short straight arrow detour over their layer. Each layer gets
    // room above it for its detours, so they never squeeze against the arrows coming in from above.
    const pairKey = (e: DiagramEdge) => [e.from, e.to].sort().join('\u0001');
    const detourOf = new Map<DiagramEdge, number>();
    const detourCount = new Map<number, number>();
    for (const e of sideways) {
        const a = mid.get(e.from)!;
        const b = mid.get(e.to)!;
        const rk = r(e.from);
        const between = layers[rk].some((id) => !isChannel(id) && id !== e.from && id !== e.to && mid.get(id)! > Math.min(a, b) && mid.get(id)! < Math.max(a, b));
        const twins = sideways.filter((f) => pairKey(f) === pairKey(e)).length;
        const labelFits = !e.label || measureText(e.label, S.edgeLabelSize).w + 12 <= gapCross;
        if (between || twins > 1 || !labelFits) {
            const k = detourCount.get(rk) ?? 0;
            detourOf.set(e, k);
            detourCount.set(rk, k + 1);
        }
    }
    const extra = (rk: number) => {
        const n = detourCount.get(rk) ?? 0;
        return n ? 14 + n * 16 : 0;
    };
    const layerV = (rk: number) => {
        let v = rk * (M + gapMain);
        for (let k = 0; k <= rk; k++) v += extra(k);
        return v;
    };

    // Room for layer names: a column on the left (down) or a row on top (right).
    const layerLabels = layerNames.map((name) => measureText(name, S.layerLabelSize));
    const labelRoom = layerNames.length
        ? down
            ? Math.max(...layerLabels.map((s) => s.w)) + 40
            : Math.max(...layerLabels.map((s) => s.h)) + 28
        : 0;
    const bandPad = 18;

    const out: { band: Shape[]; edge: Shape[]; node: Shape[] } = { band: [], edge: [], node: [] };
    const nodeIds: Record<string, string> = {};
    const base = { strokeWidth: S.strokeWidth, strokeStyle: 'solid' as StrokeStyle };

    const text = (x: number, y: number, value: string, fontSize: number, color: string = INK): Shape => ({
        id: createId(),
        type: 'text',
        x,
        y,
        text: value,
        fontSize,
        color,
        ...base,
        ...measureText(value, fontSize),
    });
    const line = (a: Pt, b: Pt, style: StrokeStyle): Shape => ({ id: createId(), type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: INK, ...base, strokeStyle: style });
    const arrow = (a: Pt, b: Pt, style: StrokeStyle): Shape => ({ id: createId(), type: 'arrow', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: INK, ...base, strokeStyle: style });
    // Edge labels are placed last, once every box and line is known, where they collide with nothing.
    type LabelRequest = { text: string; segs: [Pt, Pt][]; prefer: number };
    const labelRequests: LabelRequest[] = [];
    const pairs = (pts: Pt[]): [Pt, Pt][] => pts.slice(1).map((b, i) => [pts[i], b]);
    /** Label an edge; `prefer` is the segment it should sit beside if there is room there. */
    const edgeLabel = (label: string | undefined, segs: [Pt, Pt][], prefer = segs.length - 1) => {
        if (label && segs.length) labelRequests.push({ text: label, segs, prefer });
    };
    type UV = { u: number; v: number };
    const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
    /**
     * Draw a path given as (u, v) corners as one arrow that turns through them, or curves through
     * them when `curved`. The ends are pulled back from the boxes (2 at the start, 4 at the arrowhead).
     * Returns the corners in board coordinates.
     */
    const path = (points: UV[], style: StrokeStyle, label?: string, curved = false) => {
        const pts = points.filter((p, i) => i === 0 || !same(p.u, points[i - 1].u) || !same(p.v, points[i - 1].v));
        const corners = pts.filter((p, i) => {
            if (i === 0 || i === pts.length - 1) return true;
            const a = pts[i - 1];
            const b = pts[i + 1];
            return !((same(a.u, p.u) && same(p.u, b.u)) || (same(a.v, p.v) && same(p.v, b.v)));
        });
        // Along the segment only: a rounding difference across it must not tilt the line.
        const pull = (p: UV, toward: UV, by: number): UV => {
            const du = toward.u - p.u;
            const dv = toward.v - p.v;
            return Math.abs(du) > Math.abs(dv) ? { u: p.u + Math.sign(du) * by, v: p.v } : { u: p.u, v: p.v + Math.sign(dv) * by };
        };
        // Line up corners that differ only by rounding, so every segment is exactly straight.
        for (let i = 1; i < corners.length; i++) {
            if (same(corners[i].u, corners[i - 1].u)) corners[i] = { ...corners[i], u: corners[i - 1].u };
            if (same(corners[i].v, corners[i - 1].v)) corners[i] = { ...corners[i], v: corners[i - 1].v };
        }
        const n = corners.length;
        corners[0] = pull(corners[0], corners[1], 2);
        corners[n - 1] = pull(corners[n - 1], corners[n - 2], 4);
        const xy = corners.map((c) => toXY(c.u, c.v));
        const via = xy.slice(1, -1).map((p): [number, number] => [p.x, p.y]);
        out.edge.push({
            ...arrow(xy[0], xy[n - 1], style),
            ...(via.length ? { via } : {}),
            ...(curved && via.length ? { curved: true } : {}),
        });
        edgeLabel(label, pairs(xy));
        return xy;
    };

    // ---- layer bands ----
    layerNames.forEach((name, rk) => {
        const p = toXY(minU - labelRoom - bandPad, layerV(rk) - bandPad - extra(rk));
        const len = maxU - minU + labelRoom + 2 * bandPad;
        const w = down ? len : M + 2 * bandPad + extra(rk);
        const h = down ? M + 2 * bandPad + extra(rk) : len;
        out.band.push({ id: createId(), type: 'rect', x: p.x, y: p.y, w, h, fill: 'semi', color: S.layerColor, strokeWidth: 1, strokeStyle: 'dashed' });
        const size = layerLabels[rk];
        out.band.push(text(down ? p.x + 20 : p.x + (w - size.w) / 2, down ? p.y + (h - size.h) / 2 : p.y + 16, name, S.layerLabelSize, '#868e96'));
    });

    // ---- edges ----
    const bottom = (id: string) => layerV(r(id)) + M;
    const top = (id: string) => layerV(r(id));
    // The free gap above layer t: from the bottom of layer t - 1 to the top of t's detour room.
    const gapTop = (t: number) => layerV(t - 1) + M;
    const gapEnd = (t: number) => layerV(t) - extra(t);
    const gapMid = (t: number) => (gapTop(t) + gapEnd(t)) / 2;
    const styleOf = (l: Link) => l.edge.style ?? (l.reversed ? 'dashed' : 'solid');

    // Buses: where the links between two adjacent layers form a complete group (one parent and its
    // children, several sources into one target, or every source to every target) and those boxes
    // have nothing else on that side, draw a trunk, one shared line and short arrows.
    const bused = new Set<Link>();
    for (let t = 1; t < layers.length; t++) {
        const gap = links.filter((l) => !l.reversed && r(l.from) === t - 1 && r(l.to) === t);
        const seen = new Set<Link>();
        for (const first of gap) {
            if (seen.has(first)) continue;
            const group = new Set<Link>([first]);
            for (let grew = true; grew; ) {
                grew = false;
                for (const l of gap) {
                    if (group.has(l)) continue;
                    if ([...group].some((g) => g.from === l.from || g.to === l.to)) {
                        group.add(l);
                        grew = true;
                    }
                }
            }
            group.forEach((l) => seen.add(l));
            const items = [...group];
            const from = [...new Set(items.map((l) => l.from))];
            const to = [...new Set(items.map((l) => l.to))];
            const complete = items.length >= 2 && items.length === from.length * to.length;
            const alone = links.every((l) => group.has(l) || (!from.includes(l.from) && !to.includes(l.to)));
            if (!complete || !alone) continue;

            const style = items.every((l) => l.edge.style === items[0].edge.style) ? (items[0].edge.style ?? 'solid') : 'solid';
            const bus = gapMid(t);
            const centers = [...from, ...to].map((id) => mid.get(id)!);
            for (const id of from) out.edge.push(line(toXY(mid.get(id)!, bottom(id) + 2), toXY(mid.get(id)!, bus), style));
            if (Math.max(...centers) - Math.min(...centers) > 1) {
                out.edge.push(line(toXY(Math.min(...centers), bus), toXY(Math.max(...centers), bus), style));
            }
            for (const id of to) out.edge.push(arrow(toXY(mid.get(id)!, bus), toXY(mid.get(id)!, top(id) - 4), style));
            // Labels go on the branch that belongs to exactly one edge.
            for (const l of items) {
                if (from.length === 1) edgeLabel(l.edge.label, [[toXY(mid.get(l.to)!, bus), toXY(mid.get(l.to)!, top(l.to) - 4)]]);
                else if (to.length === 1) edgeLabel(l.edge.label, [[toXY(mid.get(l.from)!, bottom(l.from) + 2), toXY(mid.get(l.from)!, bus)]]);
                bused.add(l);
            }
        }
    }

    // Everything else gets its own port on the box side, spread and ordered by where the link heads.
    const rest = links.filter((l) => !bused.has(l));
    const firstHop = (l: Link) => mid.get(channels.get(l)![0] ?? l.to)!;
    const lastHop = (l: Link) => mid.get(channels.get(l)!.at(-1) ?? l.from)!;
    const ports = new Map<Link, { out: number; in: number }>();
    for (const n of nodes) {
        const outs = rest.filter((l) => l.from === n.id).sort((a, b) => firstHop(a) - firstHop(b));
        outs.forEach((l, k) => ports.set(l, { out: lo(n.id) + (C * (k + 1)) / (outs.length + 1), in: 0 }));
    }
    for (const n of nodes) {
        const ins = rest.filter((l) => l.to === n.id).sort((a, b) => lastHop(a) - lastHop(b));
        ins.forEach((l, k) => (ports.get(l)!.in = lo(n.id) + (C * (k + 1)) / (ins.length + 1)));
    }
    const fits = (rk: number, id: string, u: number) => {
        const row = layers[rk];
        const i = row.indexOf(id);
        const prev = row[i - 1];
        const next = row[i + 1];
        return (!prev || u - mid.get(prev)! >= space(prev, id)) && (!next || mid.get(next)! - u >= space(id, next));
    };
    for (const l of rest) {
        const p = ports.get(l)!;
        const chain = channels.get(l)!;
        const lonely = rest.filter((f) => f.from === l.from).length === 1 && rest.filter((f) => f.to === l.to).length === 1;
        if (!chain.length) {
            // Straighten one-to-one links whose boxes overlap across the flow.
            if (lonely && Math.abs(mid.get(l.from)! - mid.get(l.to)!) < C / 2) p.out = p.in = (mid.get(l.from)! + mid.get(l.to)!) / 2;
            continue;
        }
        // Run the channels straight down from the port when the layers have room, and land straight
        // on the target when it is the only link arriving there.
        let straight = true;
        for (const ch of chain) {
            if (straight && fits(r(ch), ch, p.out)) mid.set(ch, p.out);
            else straight = false;
        }
        const alone = rest.filter((f) => f.to === l.to).length === 1;
        if (straight && alone && p.out > lo(l.to) + 12 && p.out < lo(l.to) + C - 12) p.in = p.out;
    }

    // Remove small jogs: when a link would step sideways by only a little just before a box (or just
    // after it), slide one of its ports to line up, if that port stays on the box and clear of the
    // box's other ports. A short sideways step reads as a glitch and crowds the lines next to it.
    const JOG = 32;
    const portClear = (id: string, side: 'out' | 'in', u: number, except: Link) =>
        u >= lo(id) + 6 &&
        u <= lo(id) + C - 6 &&
        rest.every((f) => f === except || (side === 'out' ? f.from !== id : f.to !== id) || Math.abs(ports.get(f)![side] - u) >= 12);
    for (const l of rest) {
        const p = ports.get(l)!;
        const chain = channels.get(l)!;
        const before = chain.length ? mid.get(chain[chain.length - 1])! : p.out;
        const step = Math.abs(p.in - before);
        if (step < 0.5 || step > JOG) continue;
        if (portClear(l.to, 'in', before, l)) p.in = before;
        else if (!chain.length && portClear(l.from, 'out', p.in, l)) p.out = p.in;
    }

    // Where a link turns in a gap it gets its own lane there, so parallel turns never share a line.
    const hopsOf = (l: Link) => [ports.get(l)!.out, ...channels.get(l)!.map((ch) => mid.get(ch)!), ports.get(l)!.in];

    // Two links that turn in the same gap, one entering it at nearly the height (or column) where
    // the other leaves, would run side by side a few units apart whichever turns first. Slide one of
    // those ends along its box to open a clear gap.
    const SEPARATE = 12;
    const turnsIn = (l: Link) => {
        const hops = hopsOf(l);
        return hops.slice(1).flatMap((u, k) => (same(u, hops[k]) ? [] : [{ t: r(l.from) + 1 + k, enter: hops[k], leave: u, k }]));
    };
    for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const a of rest) {
            for (const b of rest) {
                if (a === b) continue;
                for (const ta of turnsIn(a)) {
                    const tb = turnsIn(b).find((x) => x.t === ta.t);
                    if (!tb || Math.abs(ta.enter - tb.leave) >= SEPARATE - 2) continue;
                    const away = (u: number) => u + Math.sign(u - ta.enter || 1) * SEPARATE;
                    // b runs straight on from here (through channels) to its box: move that whole run.
                    const hopsB = hopsOf(b);
                    const chainB = channels.get(b)!;
                    const run = hopsB.slice(tb.k + 1);
                    const target = away(tb.leave);
                    const straightOn = run.every((u) => same(u, tb.leave));
                    const fitsRun =
                        straightOn &&
                        chainB.slice(tb.k).every((ch) => fits(r(ch), ch, target)) &&
                        portClear(b.to, 'in', target, b);
                    if (fitsRun) {
                        chainB.slice(tb.k).forEach((ch) => mid.set(ch, target));
                        ports.get(b)!.in = target;
                        moved = true;
                    } else if (ta.k === 0) {
                        const u = ta.enter + Math.sign(ta.enter - tb.leave || 1) * SEPARATE;
                        if (portClear(a.from, 'out', u, a)) {
                            ports.get(a)!.out = u;
                            moved = true;
                        }
                    }
                }
            }
        }
        if (!moved) break;
    }
    const turning = new Map<number, Link[]>();
    for (const l of rest) {
        const hops = hopsOf(l);
        hops.slice(1).forEach((u, k) => {
            if (same(u, hops[k])) return;
            const t = r(l.from) + 1 + k;
            (turning.get(t) ?? turning.set(t, []).get(t)!).push(l);
        });
    }
    // Lane order within a gap: by where the links come from, then fixed up so that no link's stub
    // into the gap runs alongside another link's stub out of it. A link that enters at u and one that
    // leaves at nearly the same u must turn in that order, or their stubs overlap a few units apart.
    const lanes = new Map<number, Link[]>();
    const across = (l: Link, t: number) => {
        const hops = hopsOf(l);
        const k = t - r(l.from) - 1;
        return { enter: hops[k], leave: hops[k + 1] };
    };
    for (const [t, list] of turning) {
        const order = [...list].sort((a, b) => ports.get(a)!.out - ports.get(b)!.out);
        for (let pass = 0; pass < order.length; pass++) {
            let swapped = false;
            for (let i = 0; i < order.length; i++) {
                for (let j = i + 1; j < order.length; j++) {
                    // order[i] turns first; it must not leave where order[j] still enters.
                    if (Math.abs(across(order[i], t).leave - across(order[j], t).enter) < 10) {
                        [order[i], order[j]] = [order[j], order[i]];
                        swapped = true;
                    }
                }
            }
            if (!swapped) break;
        }
        lanes.set(t, order);
    }
    const lane = (l: Link, t: number) => {
        const list = lanes.get(t) ?? [];
        const first = gapTop(t) + 14;
        const last = gapEnd(t) - 26;
        const k = list.indexOf(l);
        return list.length === 1 ? (first + last) / 2 : first + ((last - first) * k) / (list.length - 1);
    };
    for (const l of rest) {
        const hops = hopsOf(l);
        const points: UV[] = [{ u: hops[0], v: bottom(l.from) }];
        hops.slice(1).forEach((u, k) => {
            const t = r(l.from) + 1 + k;
            const prev = hops[k];
            if (!same(u, prev)) points.push({ u: prev, v: lane(l, t) }, { u, v: lane(l, t) });
            points.push({ u, v: t === r(l.to) ? top(l.to) : layerV(t) + M });
        });
        path(l.reversed ? points.reverse() : points, styleOf(l), l.edge.label);
    }

    // Same-layer edges: a straight arrow between neighbors, or the detour planned above.
    for (const e of sideways) {
        const a = mid.get(e.from)!;
        const b = mid.get(e.to)!;
        const rk = r(e.from);
        const rightward = b > a;
        const style = e.style ?? 'solid';
        const k = detourOf.get(e);
        if (k === undefined) {
            const v = layerV(rk) + M / 2;
            path([{ u: rightward ? a + C / 2 : a - C / 2, v }, { u: rightward ? b - C / 2 : b + C / 2, v }], style, e.label);
            continue;
        }
        const over = layerV(rk) - 16 - k * 16;
        // Alternate the inset so detours between the same pair of boxes do not share their legs.
        const inset = C / 4 + (k % 2) * 14;
        const from = a + (rightward ? inset : -inset);
        const to = b + (rightward ? -inset : inset);
        const xy = path([{ u: from, v: layerV(rk) }, { u: from, v: over }, { u: to, v: over }, { u: to, v: layerV(rk) }], style);
        // Beside the stretch above the row.
        edgeLabel(e.label, pairs(xy), 1);
    }

    // Long cycles loop around the far side, each in its own lane. A box at the end of its row is
    // left or entered from the side; otherwise from its top or bottom, so the loop runs along the gap
    // next to the row instead of through it.
    const lastInRow = (id: string) => {
        const row = layers[r(id)].filter((m) => !isChannel(m));
        return row[row.length - 1] === id;
    };
    loops.forEach((e, k) => {
        const outer = maxU + 32 + k * 20;
        const style = e.style ?? 'dashed';
        const points: UV[] = [];
        if (lastInRow(e.from)) points.push({ u: lo(e.from) + C, v: layerV(r(e.from)) + M / 2 }, { u: outer, v: layerV(r(e.from)) + M / 2 });
        else {
            const u = mid.get(e.from)! + C / 4;
            const v = layerV(r(e.from)) - extra(r(e.from)) - 12 - k * 8;
            points.push({ u, v: layerV(r(e.from)) }, { u, v }, { u: outer, v });
        }
        if (lastInRow(e.to)) points.push({ u: outer, v: layerV(r(e.to)) + M / 2 }, { u: lo(e.to) + C, v: layerV(r(e.to)) + M / 2 });
        else {
            const u = mid.get(e.to)! + C / 4;
            const v = layerV(r(e.to)) + M + 12 + k * 8;
            points.push({ u: outer, v }, { u, v }, { u, v: layerV(r(e.to)) + M });
        }
        const segs = pairs(path(points, style));
        // Beside the long run around the side.
        const lengths = segs.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
        edgeLabel(e.label, segs, lengths.indexOf(Math.max(...lengths)));
    });

    // ---- nodes ----
    for (const n of nodes) {
        const p = toXY(lo(n.id), layerV(r(n.id)));
        const color = n.color ?? S.palette[(layerNames.length ? r(n.id) : 0) % S.palette.length];
        const id = createId();
        nodeIds[n.id] = id;
        out.node.push({ id, type: n.shape === 'ellipse' ? 'ellipse' : 'rect', x: p.x, y: p.y, w: W, h: H, fill: 'semi', color, ...base });
        const size = sizes.get(n.id)!;
        out.node.push(text(p.x + (W - size.w) / 2, p.y + (H - size.h) / 2, n.label, S.fontSize));
    }

    placeLabels(labelRequests, out, (x, y, value) => text(x, y, value, S.edgeLabelSize, '#495057'));

    // Move everything so the diagram's top-left corner lands at the requested point.
    const all = [...out.band, ...out.edge, ...out.node];
    const bounds = unionBox(all.map(shapeBox))!;
    const target = { x: input.x ?? options.origin?.x ?? 0, y: input.y ?? options.origin?.y ?? 0 };
    return { shapes: all.map((s) => translateShape(s, target.x - bounds.x, target.y - bounds.y)), nodes: nodeIds };
}

type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether segment ab passes through rectangle r (Liang–Barsky clipping). */
function crossesRect(a: Pt, b: Pt, r: Rect): boolean {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edges: [number, number][] = [
        [-dx, a.x - r.x],
        [dx, r.x + r.w - a.x],
        [-dy, a.y - r.y],
        [dy, r.y + r.h - a.y],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return false;
        } else if (p < 0) t0 = Math.max(t0, q / p);
        else t1 = Math.min(t1, q / p);
    }
    return t1 > t0;
}

/**
 * Put each edge label beside its edge where it overlaps no box, no other label and no other line.
 * Candidates run along the preferred segment first (its middle, then either side of it), then the
 * edge's other segments, each on both sides; the first clean one wins, else the least crowded.
 */
function placeLabels(
    requests: { text: string; segs: [Pt, Pt][]; prefer: number }[],
    out: { band: Shape[]; edge: Shape[]; node: Shape[] },
    make: (x: number, y: number, value: string) => Shape,
) {
    const boxes: Rect[] = out.node.filter((s) => s.type === 'rect' || s.type === 'ellipse').map(shapeBox);
    const bandLabels: Rect[] = out.band.filter((s) => s.type === 'text').map(shapeBox);
    const lines = out.edge.flatMap((s) => {
        if (s.type !== 'line' && s.type !== 'arrow') return [];
        const pts: Pt[] = [{ x: s.x1, y: s.y1 }, ...(s.via ?? []).map(([x, y]) => ({ x, y })), { x: s.x2, y: s.y2 }];
        return pts.slice(1).map((b, i): [Pt, Pt] => [pts[i], b]);
    });
    const placed: Rect[] = [];
    const sameSeg = (p: [Pt, Pt], q: [Pt, Pt]) => same2(p[0], q[0]) && same2(p[1], q[1]);
    for (const req of requests) {
        const size = measureText(req.text, DIAGRAM_STYLE.edgeLabelSize);
        const order = [req.prefer, ...req.segs.map((_, i) => i).filter((i) => i !== req.prefer).reverse()];
        const best: { rect: Rect | null; cost: number } = { rect: null, cost: Infinity };
        let rank = 0;
        for (const k of order) {
            const [a, b] = req.segs[k];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
            const along = vertical ? size.h : size.w;
            for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
                // Keep the label within its segment.
                if (len < along + 8 && t !== 0.5) continue;
                const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
                const spots: Rect[] = vertical
                    ? [
                        { x: p.x + 8, y: p.y - size.h / 2, ...size },
                        { x: p.x - 8 - size.w, y: p.y - size.h / 2, ...size },
                    ]
                    : [
                        { x: p.x - size.w / 2, y: p.y - size.h - 6, ...size },
                        { x: p.x - size.w / 2, y: p.y + 6, ...size },
                    ];
                for (const r of spots) {
                    const pad = { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 };
                    let cost = rank++ * 0.001 + (k === req.prefer ? 0 : 0.5) + (len < along + 8 ? 0.5 : 0);
                    for (const box of boxes) if (overlaps(pad, box)) cost += 10;
                    for (const other of [...placed, ...bandLabels]) if (overlaps(pad, other)) cost += 5;
                    for (const seg of lines) if (!sameSeg(seg, req.segs[k]) && crossesRect(seg[0], seg[1], pad)) cost += 3;
                    if (cost < best.cost) {
                        best.rect = r;
                        best.cost = cost;
                    }
                }
            }
            if (best.cost < 1) break;
        }
        if (!best.rect) continue;
        placed.push(best.rect);
        out.edge.push(make(best.rect.x, best.rect.y, req.text));
    }
}

const same2 = (p: Pt, q: Pt) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
