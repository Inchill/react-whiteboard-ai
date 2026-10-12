/**
 * SVG path data → absolute segments → evenly spaced points.
 * Supports every path command: M L H V C S Q T A Z, absolute and relative.
 */

export type Pt = { x: number; y: number };

type Segment =
    | { kind: 'line'; from: Pt; to: Pt }
    | { kind: 'cubic'; from: Pt; c1: Pt; c2: Pt; to: Pt }
    | { kind: 'quad'; from: Pt; c: Pt; to: Pt }
    | { kind: 'arc'; from: Pt; to: Pt; rx: number; ry: number; rotation: number; large: boolean; sweep: boolean };

/** One continuous pen stroke: everything from an M up to the next M. */
export type Subpath = { segments: Segment[]; closed: boolean };

export class PathSyntaxError extends Error {}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenize(d: string): (string | number)[] {
    const tokens: (string | number)[] = [];
    const re = /([MLHVCSQTAZmlhvcsqtaz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([\s,]+)|(.)/g;
    for (let m = re.exec(d); m; m = re.exec(d)) {
        if (m[1]) tokens.push(m[1]);
        else if (m[2]) tokens.push(Number(m[2]));
        else if (m[4]) throw new PathSyntaxError(`unexpected "${m[4]}" at position ${m.index}`);
    }
    return tokens;
}

/** Arc flags may be written without separators ("a5 5 0 0110 10"); split them out. */
function readFlag(tokens: (string | number)[], i: number): [number, number] {
    const t = tokens[i];
    if (t === 0 || t === 1) return [t, i + 1];
    throw new PathSyntaxError('arc flags must be 0 or 1, separated by spaces');
}

export function parsePath(d: string): Subpath[] {
    const tokens = tokenize(d);
    const subpaths: Subpath[] = [];
    let current: Subpath | null = null;
    let pos: Pt = { x: 0, y: 0 };
    let start: Pt = { x: 0, y: 0 };
    let lastCubic: Pt | null = null;
    let lastQuad: Pt | null = null;
    let cmd = '';
    let i = 0;

    const num = () => {
        const t = tokens[i];
        if (typeof t !== 'number') throw new PathSyntaxError(`command ${cmd} needs ${ARGS[cmd.toUpperCase()]} numbers`);
        i++;
        return t;
    };
    const push = (s: Segment) => {
        if (!current) {
            current = { segments: [], closed: false };
            subpaths.push(current);
        }
        current.segments.push(s);
    };

    if (tokens.length && tokens[0] !== 'M' && tokens[0] !== 'm') throw new PathSyntaxError('a path must start with M');
    while (i < tokens.length) {
        if (typeof tokens[i] === 'string') cmd = tokens[i++] as string;
        // Only commands that take numbers repeat implicitly; a stray number after Z would never be read.
        else if (cmd.toUpperCase() === 'Z') throw new PathSyntaxError('numbers after Z need a command letter');
        const upper = cmd.toUpperCase();
        const rel = cmd !== upper;
        const ox = rel ? pos.x : 0;
        const oy = rel ? pos.y : 0;
        let nextCubic: Pt | null = null;
        let nextQuad: Pt | null = null;

        switch (upper) {
            case 'M': {
                pos = { x: ox + num(), y: oy + num() };
                start = pos;
                current = null;
                // Extra coordinate pairs after M are implicit L commands.
                cmd = rel ? 'l' : 'L';
                break;
            }
            case 'L': {
                const to = { x: ox + num(), y: oy + num() };
                push({ kind: 'line', from: pos, to });
                pos = to;
                break;
            }
            case 'H': {
                const to = { x: ox + num(), y: pos.y };
                push({ kind: 'line', from: pos, to });
                pos = to;
                break;
            }
            case 'V': {
                const to = { x: pos.x, y: oy + num() };
                push({ kind: 'line', from: pos, to });
                pos = to;
                break;
            }
            case 'C':
            case 'S': {
                const c1: Pt =
                    upper === 'C'
                        ? { x: ox + num(), y: oy + num() }
                        : lastCubic
                            ? { x: 2 * pos.x - lastCubic.x, y: 2 * pos.y - lastCubic.y }
                            : pos;
                const c2 = { x: ox + num(), y: oy + num() };
                const to = { x: ox + num(), y: oy + num() };
                push({ kind: 'cubic', from: pos, c1, c2, to });
                nextCubic = c2;
                pos = to;
                break;
            }
            case 'Q':
            case 'T': {
                const c: Pt =
                    upper === 'Q'
                        ? { x: ox + num(), y: oy + num() }
                        : lastQuad
                            ? { x: 2 * pos.x - lastQuad.x, y: 2 * pos.y - lastQuad.y }
                            : pos;
                const to = { x: ox + num(), y: oy + num() };
                push({ kind: 'quad', from: pos, c, to });
                nextQuad = c;
                pos = to;
                break;
            }
            case 'A': {
                const rx = Math.abs(num());
                const ry = Math.abs(num());
                const rotation = num();
                let large: number;
                let sweep: number;
                [large, i] = readFlag(tokens, i);
                [sweep, i] = readFlag(tokens, i);
                const to = { x: ox + num(), y: oy + num() };
                push({ kind: 'arc', from: pos, to, rx, ry, rotation, large: large === 1, sweep: sweep === 1 });
                pos = to;
                break;
            }
            case 'Z': {
                if (current) {
                    const open: Subpath = current;
                    if (Math.hypot(pos.x - start.x, pos.y - start.y) > 1e-6) open.segments.push({ kind: 'line', from: pos, to: start });
                    open.closed = true;
                }
                pos = start;
                current = null;
                break;
            }
            default:
                throw new PathSyntaxError(`unknown command "${cmd}"`);
        }
        lastCubic = nextCubic;
        lastQuad = nextQuad;
    }
    return subpaths.filter((s) => s.segments.length);
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Endpoint arc → a point function, following SVG 1.1 implementation notes F.6.5. */
function arcPoint(s: Extract<Segment, { kind: 'arc' }>): ((t: number) => Pt) | null {
    let { rx, ry } = s;
    if (rx < 1e-9 || ry < 1e-9) return null; // degenerate: a straight line
    const phi = (s.rotation * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (s.from.x - s.to.x) / 2;
    const dy = (s.from.y - s.to.y) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (scale > 1) {
        rx *= Math.sqrt(scale);
        ry *= Math.sqrt(scale);
    }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const k = (s.large === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cx1 = (k * rx * y1) / ry;
    const cy1 = (-k * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (s.from.x + s.to.x) / 2;
    const cy = sin * cx1 + cos * cy1 + (s.from.y + s.to.y) / 2;
    const angle = (ux: number, uy: number, vx: number, vy: number) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!s.sweep && delta > 0) delta -= 2 * Math.PI;
    if (s.sweep && delta < 0) delta += 2 * Math.PI;
    return (t) => {
        const a = theta + delta * t;
        const ex = rx * Math.cos(a);
        const ey = ry * Math.sin(a);
        return { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy };
    };
}

function pointAt(s: Segment): (t: number) => Pt {
    switch (s.kind) {
        case 'line':
            return (t) => lerp(s.from, s.to, t);
        case 'quad':
            return (t) => lerp(lerp(s.from, s.c, t), lerp(s.c, s.to, t), t);
        case 'cubic':
            return (t) => {
                const a = lerp(s.from, s.c1, t);
                const b = lerp(s.c1, s.c2, t);
                const c = lerp(s.c2, s.to, t);
                return lerp(lerp(a, b, t), lerp(b, c, t), t);
            };
        case 'arc':
            return arcPoint(s) ?? ((t) => lerp(s.from, s.to, t));
    }
}

/**
 * Points along a subpath about `step` apart (in the same units as the path), including both ends.
 * Each segment is measured on a fine polyline first, then resampled by arc length.
 */
export function samplePath(sub: Subpath, step: number): Pt[] {
    const fine: Pt[] = [];
    for (const seg of sub.segments) {
        const at = pointAt(seg);
        const n = seg.kind === 'line' ? 1 : 48;
        // End each segment exactly on its end point, so floating-point error never opens a gap.
        for (let k = fine.length ? 1 : 0; k <= n; k++) fine.push(k === n ? seg.to : at(k / n));
    }
    if (fine.length < 2) return fine;
    const out: Pt[] = [fine[0]];
    let carried = 0;
    for (let k = 1; k < fine.length; k++) {
        const a = fine[k - 1];
        const b = fine[k];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let d = step - carried;
        while (d <= len) {
            out.push(lerp(a, b, d / len));
            d += step;
        }
        carried = len - (d - step);
    }
    const last = fine[fine.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last.x - tail.x, last.y - tail.y) > step * 0.25) out.push(last);
    else out[out.length - 1] = last;
    return out;
}
