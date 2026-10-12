/**
 * A smooth line through given points, as SVG path data. Models place points along an outline far
 * more reliably than they place Bézier control points, which is where kinks, hooks and gaps come
 * from. This is centripetal Catmull-Rom, which passes through every point and, unlike the uniform
 * kind, never loops or overshoots between unevenly spaced points.
 */

type P = [number, number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (p: P) => `${r2(p[0])} ${r2(p[1])}`;

/** Control points of the cubic from p1 to p2, given the points around them. */
function controls(p0: P, p1: P, p2: P, p3: P): [P, P] {
    // Centripetal: knot spacing is the square root of the distance.
    const t1 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5);
    const t2 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5);
    const t3 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5);
    if (t2 < 1e-9) return [p1, p2];
    const c1: P =
        t1 < 1e-9
            ? p1
            : [0, 1].map((i) => (t1 * t1 * p2[i] - t2 * t2 * p0[i] + (2 * t1 * t1 + 3 * t1 * t2 + t2 * t2) * p1[i]) / (3 * t1 * (t1 + t2))) as P;
    const c2: P =
        t3 < 1e-9
            ? p2
            : [0, 1].map((i) => (t3 * t3 * p1[i] - t2 * t2 * p3[i] + (2 * t3 * t3 + 3 * t3 * t2 + t2 * t2) * p2[i]) / (3 * t3 * (t3 + t2))) as P;
    return [c1, c2];
}

/** SVG path data for a smooth line through `points`, or a closed loop back to the first point. */
export function smoothPath(points: P[], closed = false): string {
    const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    if (closed && pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 2) return pts.length ? `M${fmt(pts[0])}` : '';
    if (pts.length === 2) return `M${fmt(pts[0])} L${fmt(pts[1])}`;
    const n = pts.length;
    // Open ends: mirror the neighbour, so the line leaves the first point heading toward the second.
    const at = (i: number): P => {
        if (closed) return pts[(i + n) % n];
        if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
        if (i >= n) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
        return pts[i];
    };
    let d = `M${fmt(pts[0])}`;
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
        const [c1, c2] = controls(at(i - 1), at(i), at(i + 1), at(i + 2));
        d += ` C${fmt(c1)} ${fmt(c2)} ${fmt(at(i + 1))}`;
    }
    return closed ? `${d} Z` : d;
}
