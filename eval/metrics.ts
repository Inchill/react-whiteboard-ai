import { DIAGRAM_STYLE } from '../src/layout/diagram';
import type { Shape } from '../src/types';

/**
  * Layout quality of a drawn diagram, from its shapes alone, so it works for diagrams laid out by
  * `add_diagram` and for ones a model placed by hand. Lower is better for every count.
  */
export type LayoutMetrics = {
    /** Boxes (rects and ellipses that are not layer bands). */
    nodes: number;
    /** Lines and arrows. */
    edges: number;
    /** Two segments of different edges crossing in their interiors. */
    crossings: number;
    /** A segment running through the inside of a box. */
    edgeThroughBox: number;
    /** Edge labels overlapping another label, a box, or a segment. */
    labelOverlaps: number;
    /** Parallel segments of different edges closer than 8 units over more than 10 units. */
    closeParallels: number;
    /** Turns per edge, on average. */
    bendsPerEdge: number;
    /** Total edge length divided by the number of edges. */
    edgeLength: number;
    /** Width and height of everything drawn. */
    width: number;
    height: number;
};

type Pt = { x: number; y: number };
type Seg = { a: Pt; b: Pt; edge: number };
type Rect = { x: number; y: number; w: number; h: number };

const EPS = 0.5;

function segmentsOf(shape: Extract<Shape, { type: 'line' | 'arrow' }>, edge: number): Seg[] {
    const pts: Pt[] = [{ x: shape.x1, y: shape.y1 }, ...(shape.via ?? []).map(([x, y]) => ({ x, y })), { x: shape.x2, y: shape.y2 }];
    return pts.slice(1).map((b, i) => ({ a: pts[i], b, edge }));
}

/** Where two segments cross strictly inside both (touching ends, as at a bus junction, does not count). */
function crossesInside(s: Seg, t: Seg): boolean {
    const d = (t.b.y - t.a.y) * (s.b.x - s.a.x) - (t.b.x - t.a.x) * (s.b.y - s.a.y);
    if (Math.abs(d) < 1e-9) return false; // parallel or collinear: see closeParallels
    const ua = ((t.b.x - t.a.x) * (s.a.y - t.a.y) - (t.b.y - t.a.y) * (s.a.x - t.a.x)) / d;
    const ub = ((s.b.x - s.a.x) * (s.a.y - t.a.y) - (s.b.y - s.a.y) * (s.a.x - t.a.x)) / d;
    const lenS = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const lenT = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
    const inS = ua * lenS > EPS && (1 - ua) * lenS > EPS;
    const inT = ub * lenT > EPS && (1 - ub) * lenT > EPS;
    return inS && inT;
}

/** Whether a segment passes through the inside of a rectangle shrunk by `inset`. */
function segmentHitsRect(s: Seg, r: Rect, inset: number): boolean {
    const x0 = r.x + inset;
    const y0 = r.y + inset;
    const x1 = r.x + r.w - inset;
    const y1 = r.y + r.h - inset;
    if (x1 <= x0 || y1 <= y0) return false;
    // Liang–Barsky clipping.
    let t0 = 0;
    let t1 = 1;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    for (const [p, q] of [
        [-dx, s.a.x - x0],
        [dx, x1 - s.a.x],
        [-dy, s.a.y - y0],
        [dy, y1 - s.a.y],
    ]) {
        if (p === 0) {
            if (q < 0) return false;
        } else {
            const t = q / p;
            if (p < 0) t0 = Math.max(t0, t);
            else t1 = Math.min(t1, t);
        }
    }
    return t1 - t0 > 1e-6;
}

const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Two axis-parallel segments of different edges that run alongside each other too closely. */
function tooClose(s: Seg, t: Seg): boolean {
    const horizontal = (g: Seg) => Math.abs(g.a.y - g.b.y) < EPS;
    const vertical = (g: Seg) => Math.abs(g.a.x - g.b.x) < EPS;
    let gap: number;
    let overlap: number;
    if (horizontal(s) && horizontal(t)) {
        gap = Math.abs(s.a.y - t.a.y);
        overlap = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
    } else if (vertical(s) && vertical(t)) {
        gap = Math.abs(s.a.x - t.a.x);
        overlap = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
    } else return false;
    return gap < 8 && overlap > 10;
}

/**
  * Measure a diagram. Boxes are rects and ellipses except layer bands (thin dashed rects that hold
  * other boxes); edge labels are text in the edge label size that does not sit inside a box.
  */
export function measureLayout(shapes: Shape[]): LayoutMetrics {
    const lines = shapes.filter((s): s is Extract<Shape, { type: 'line' | 'arrow' }> => s.type === 'line' || s.type === 'arrow');
    const boxShapes = shapes.filter((s): s is Extract<Shape, { type: 'rect' | 'ellipse' | 'triangle' }> => s.type === 'rect' || s.type === 'ellipse' || s.type === 'triangle');
    const rect = (s: { x: number; y: number; w: number; h: number }): Rect => ({ x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) });
    const contains = (o: Rect, i: Rect) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
    const isBand = (s: (typeof boxShapes)[number]) =>
        s.strokeStyle === 'dashed' && s.strokeWidth <= 1 && boxShapes.some((o) => o !== s && contains(rect(s), rect(o)));
    const boxes = boxShapes.filter((s) => !isBand(s)).map(rect);
    const texts = shapes.filter((s): s is Extract<Shape, { type: 'text' }> => s.type === 'text');
    const labels = texts
        .filter((t) => t.fontSize === DIAGRAM_STYLE.edgeLabelSize && !boxes.some((b) => contains(b, rect(t))))
        .map(rect);

    const segs = lines.flatMap((l, i) => segmentsOf(l, i));
    let crossings = 0;
    let closeParallels = 0;
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            if (segs[i].edge === segs[j].edge) continue;
            if (crossesInside(segs[i], segs[j])) crossings++;
            else if (tooClose(segs[i], segs[j])) closeParallels++;
        }
    }
    let edgeThroughBox = 0;
    for (const s of segs) for (const b of boxes) if (segmentHitsRect(s, b, 2)) edgeThroughBox++;

    let labelOverlaps = 0;
    labels.forEach((l, i) => {
        for (const other of labels.slice(i + 1)) if (rectsOverlap(l, other)) labelOverlaps++;
        for (const b of boxes) if (rectsOverlap(l, b)) labelOverlaps++;
        for (const s of segs) if (segmentHitsRect(s, l, 1)) labelOverlaps++;
    });

    const all = [...boxes, ...texts.map(rect), ...segs.flatMap((s) => [{ x: s.a.x, y: s.a.y, w: 0, h: 0 }, { x: s.b.x, y: s.b.y, w: 0, h: 0 }])];
    const minX = Math.min(...all.map((r) => r.x));
    const minY = Math.min(...all.map((r) => r.y));
    const maxX = Math.max(...all.map((r) => r.x + r.w));
    const maxY = Math.max(...all.map((r) => r.y + r.h));
    const length = segs.reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0);
    const bends = lines.reduce((sum, l) => sum + (l.via?.length ?? 0), 0);
    const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
    return {
        nodes: boxes.length,
        edges: lines.length,
        crossings,
        edgeThroughBox,
        labelOverlaps,
        closeParallels,
        bendsPerEdge: lines.length ? round(bends / lines.length, 2) : 0,
        edgeLength: lines.length ? round(length / lines.length) : 0,
        width: all.length ? round(maxX - minX) : 0,
        height: all.length ? round(maxY - minY) : 0,
    };
}

/**
  * One number to compare layouts by: 100 minus penalties. Defects that make a diagram hard to read
  * cost most; a few extra turns cost little.
  */
export function layoutScore(m: LayoutMetrics): number {
    const penalty = 8 * m.crossings + 10 * m.edgeThroughBox + 6 * m.labelOverlaps + 4 * m.closeParallels + 5 * Math.max(0, m.bendsPerEdge - 2);
    return Math.max(0, Math.round(100 - penalty));
}
