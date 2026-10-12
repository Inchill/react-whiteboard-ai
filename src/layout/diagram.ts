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
function orderLayers(nodes: DiagramNode[], edges: DiagramEdge[], rank: Map<string, number>): string[][] {
    const count = Math.max(0, ...rank.values()) + 1;
    const layers: string[][] = Array.from({ length: count }, () => []);
    for (const n of nodes) layers[rank.get(n.id)!].push(n.id);

    const neighbors = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
        neighbors.get(e.from)?.push(e.to);
        neighbors.get(e.to)?.push(e.from);
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
    for (let iter = 0; iter < 4; iter++) {
        for (let r = 1; r < count; r++) sweep(r, r - 1);
        for (let r = count - 2; r >= 0; r--) sweep(r, r + 1);
    }
    return layers;
}

/**
 * Place node centers across the flow. Starts from evenly spaced, centered layers, then pulls each
 * node toward the mean of its neighbors in the adjacent layer (children under parents, parents over
 * children) while keeping order and spacing: the push-right and push-left solutions are both
 * feasible, and so is their average.
 */
function placeAcross(layers: string[][], neighbors: Map<string, string[]>, rank: Map<string, number>, step: number): Map<string, number> {
    const pos = new Map<string, number>();
    const widest = Math.max(...layers.map((l) => l.length));
    layers.forEach((ids) => ids.forEach((id, i) => pos.set(id, (i - (ids.length - 1) / 2) * step + ((widest - 1) / 2) * step)));

    const relax = (r: number, ref: number) => {
        const ids = layers[r];
        const want = ids.map((id) => {
            const near = neighbors.get(id)!.filter((m) => rank.get(m) === ref).map((m) => pos.get(m)!);
            return near.length ? near.reduce((a, b) => a + b, 0) / near.length : pos.get(id)!;
        });
        const right: number[] = [];
        want.forEach((w, i) => (right[i] = i ? Math.max(w, right[i - 1] + step) : w));
        const left: number[] = [];
        for (let i = want.length - 1; i >= 0; i--) left[i] = i < want.length - 1 ? Math.min(want[i], left[i + 1] - step) : want[i];
        ids.forEach((id, i) => pos.set(id, (right[i] + left[i]) / 2));
    };
    // End on the upward pass, so each parent sits centered over its children.
    for (let iter = 0; iter < 4; iter++) {
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
    const layers = orderLayers(nodes, edges, rank);
    const r = (id: string) => rank.get(id)!;

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
    const layerV = (rk: number) => rk * (M + gapMain);

    const neighbors = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
        neighbors.get(e.from)!.push(e.to);
        neighbors.get(e.to)!.push(e.from);
    }
    const mid = placeAcross(layers, neighbors, rank, C + gapCross);
    const lo = (id: string) => mid.get(id)! - C / 2;
    const minU = Math.min(...nodes.map((n) => lo(n.id)));
    const maxU = Math.max(...nodes.map((n) => lo(n.id) + C));

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
    const edgeLabel = (label: string | undefined, at: Pt, along: 'u' | 'v') => {
        if (!label) return;
        const size = measureText(label, S.edgeLabelSize);
        // Beside a segment that runs along the flow, above one that runs across it.
        const runsVertically = down ? along === 'v' : along === 'u';
        const x = runsVertically ? at.x + 8 : at.x - size.w / 2;
        const y = runsVertically ? at.y - size.h / 2 : at.y - size.h - 6;
        out.edge.push(text(x, y, label, S.edgeLabelSize, '#495057'));
    };

    // ---- layer bands ----
    layerNames.forEach((name, rk) => {
        const p = toXY(minU - labelRoom - bandPad, layerV(rk) - bandPad);
        const len = maxU - minU + labelRoom + 2 * bandPad;
        const w = down ? len : M + 2 * bandPad;
        const h = down ? M + 2 * bandPad : len;
        out.band.push({ id: createId(), type: 'rect', x: p.x, y: p.y, w, h, fill: 'semi', color: S.layerColor, strokeWidth: 1, strokeStyle: 'dashed' });
        const size = layerLabels[rk];
        out.band.push(text(down ? p.x + 20 : p.x + (w - size.w) / 2, down ? p.y + (h - size.h) / 2 : p.y + 16, name, S.layerLabelSize, '#868e96'));
    });

    // ---- edges ----
    const forward = edges.filter((e) => r(e.to) > r(e.from));
    const sideways = edges.filter((e) => r(e.to) === r(e.from));
    const backward = edges.filter((e) => r(e.to) < r(e.from));
    const bottom = (id: string) => layerV(r(id)) + M + 2;
    const top = (id: string) => layerV(r(id)) - 4;
    const gapMid = (targetRank: number) => layerV(targetRank) - gapMain / 2;

    // Buses: where the links between two adjacent layers form a complete group (one parent and its
    // children, several sources into one target, or every source to every target), draw a trunk, one
    // shared line and short arrows instead of a tangle of separate elbows.
    const bused = new Set<DiagramEdge>();
    for (let t = 1; t < layers.length; t++) {
        const gap = forward.filter((e) => r(e.from) === t - 1 && r(e.to) === t);
        const seen = new Set<DiagramEdge>();
        for (const first of gap) {
            if (seen.has(first)) continue;
            // Connected component of this gap's bipartite graph.
            const group = new Set<DiagramEdge>([first]);
            for (let grew = true; grew; ) {
                grew = false;
                for (const e of gap) {
                    if (group.has(e)) continue;
                    if ([...group].some((g) => g.from === e.from || g.to === e.to)) {
                        group.add(e);
                        grew = true;
                    }
                }
            }
            group.forEach((e) => seen.add(e));
            const from = [...new Set([...group].map((e) => e.from))];
            const to = [...new Set([...group].map((e) => e.to))];
            if (group.size < 2 || group.size !== from.length * to.length) continue;

            const items = [...group];
            const style = items.every((e) => e.style === items[0].style) ? (items[0].style ?? 'solid') : 'solid';
            const bus = gapMid(t);
            const centers = [...from, ...to].map((id) => mid.get(id)!);
            for (const id of from) out.edge.push(line(toXY(mid.get(id)!, bottom(id)), toXY(mid.get(id)!, bus), style));
            if (Math.max(...centers) - Math.min(...centers) > 1) {
                out.edge.push(line(toXY(Math.min(...centers), bus), toXY(Math.max(...centers), bus), style));
            }
            for (const id of to) out.edge.push(arrow(toXY(mid.get(id)!, bus), toXY(mid.get(id)!, top(id)), style));
            // Labels go on the branch that belongs to exactly one edge.
            for (const e of items) {
                if (from.length === 1) edgeLabel(e.label, toXY(mid.get(e.to)!, (bus + top(e.to)) / 2), 'v');
                else if (to.length === 1) edgeLabel(e.label, toXY(mid.get(e.from)!, (bottom(e.from) + bus) / 2), 'v');
                bused.add(e);
            }
        }
    }

    // Everything else: spread several edges across a box side, ordered to avoid crossings.
    const rest = forward.filter((e) => !bused.has(e));
    const ports = new Map<DiagramEdge, { out: number; in: number }>();
    for (const n of nodes) {
        const outs = rest.filter((e) => e.from === n.id).sort((a, b) => mid.get(a.to)! - mid.get(b.to)!);
        outs.forEach((e, k) => ports.set(e, { out: lo(n.id) + (C * (k + 1)) / (outs.length + 1), in: 0 }));
    }
    for (const n of nodes) {
        const ins = rest.filter((e) => e.to === n.id).sort((a, b) => mid.get(a.from)! - mid.get(b.from)!);
        ins.forEach((e, k) => (ports.get(e)!.in = lo(n.id) + (C * (k + 1)) / (ins.length + 1)));
    }
    for (const e of rest) {
        const p = ports.get(e)!;
        const single = rest.filter((f) => f.from === e.from).length === 1 && rest.filter((f) => f.to === e.to).length === 1;
        // Straighten one-to-one links whose boxes overlap across the flow.
        if (single && Math.abs(mid.get(e.from)! - mid.get(e.to)!) < C / 2) p.out = p.in = (mid.get(e.from)! + mid.get(e.to)!) / 2;
        if (Math.abs(p.out - p.in) < 1) p.in = p.out;
    }
    // Bent edges share the gap above their target layer; each source gets its own lane.
    const lanes = new Map<DiagramEdge, number>();
    for (let t = 1; t < layers.length; t++) {
        const bent = rest.filter((e) => r(e.to) === t && ports.get(e)!.out !== ports.get(e)!.in);
        const sources = [...new Set(bent.map((e) => e.from))].sort((a, b) => mid.get(a)! - mid.get(b)!);
        const first = layerV(t) - gapMain + 14;
        const last = layerV(t) - 30;
        for (const e of bent) {
            const k = sources.indexOf(e.from);
            lanes.set(e, sources.length === 1 ? (first + last) / 2 : first + ((last - first) * k) / (sources.length - 1));
        }
    }
    for (const e of rest) {
        const p = ports.get(e)!;
        const style = e.style ?? 'solid';
        if (p.out === p.in) {
            out.edge.push(arrow(toXY(p.out, bottom(e.from)), toXY(p.in, top(e.to)), style));
            edgeLabel(e.label, toXY(p.out, (bottom(e.from) + top(e.to)) / 2), 'v');
        } else {
            const lane = lanes.get(e)!;
            out.edge.push(line(toXY(p.out, bottom(e.from)), toXY(p.out, lane), style));
            out.edge.push(line(toXY(p.out, lane), toXY(p.in, lane), style));
            out.edge.push(arrow(toXY(p.in, lane), toXY(p.in, top(e.to)), style));
            edgeLabel(e.label, toXY(p.in, (lane + top(e.to)) / 2), 'v');
        }
    }

    for (const e of sideways) {
        const a = lo(e.from);
        const b = lo(e.to);
        const rightward = b > a;
        const v = layerV(r(e.from)) + M / 2;
        out.edge.push(arrow(toXY(rightward ? a + C + 2 : a - 2, v), toXY(rightward ? b - 4 : b + C + 4, v), e.style ?? 'solid'));
        edgeLabel(e.label, toXY((a + b + C) / 2, v), 'u');
    }

    // Edges against the flow loop around the far side of the diagram, each in its own lane.
    backward.forEach((e, k) => {
        const lane = maxU + 32 + k * 20;
        const style = e.style ?? 'dashed';
        const va = layerV(r(e.from)) + M / 2;
        const vb = layerV(r(e.to)) + M / 2;
        out.edge.push(line(toXY(lo(e.from) + C + 2, va), toXY(lane, va), style));
        out.edge.push(line(toXY(lane, va), toXY(lane, vb), style));
        out.edge.push(arrow(toXY(lane, vb), toXY(lo(e.to) + C + 4, vb), style));
        edgeLabel(e.label, toXY(lane, (va + vb) / 2), 'v');
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

    // Move everything so the diagram's top-left corner lands at the requested point.
    const all = [...out.band, ...out.edge, ...out.node];
    const bounds = unionBox(all.map(shapeBox))!;
    const target = { x: input.x ?? options.origin?.x ?? 0, y: input.y ?? options.origin?.y ?? 0 };
    return { shapes: all.map((s) => translateShape(s, target.x - bounds.x, target.y - bounds.y)), nodes: nodeIds };
}
