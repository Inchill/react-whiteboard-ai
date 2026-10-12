import { describe, expect, it } from 'vitest';
import { executeToolCalls, parseOperation, parsePath, PathSyntaxError, samplePath, sketchToShapes } from '../src';
import type { Shape } from '../src/types';

type Pen = Extract<Shape, { points: unknown }>;
const ends = (d: string) => {
    const sub = parsePath(d)[0];
    const pts = samplePath(sub, 1);
    return { first: pts[0], last: pts[pts.length - 1], closed: sub.closed, count: pts.length };
};

describe('parsePath', () => {
    it('reads absolute and relative commands, H/V and implicit lines after M', () => {
        expect(ends('M10 10 L20 10 H40 V30').last).toEqual({ x: 40, y: 30 });
        expect(ends('m10 10 l10 0 h20 v20').last).toEqual({ x: 40, y: 30 });
        expect(ends('M0 0 10 0 10 10').last).toEqual({ x: 10, y: 10 });
        expect(ends('M0,0L1e1,0').last).toEqual({ x: 10, y: 0 });
    });

    it('starts a new stroke at every M and marks closed ones', () => {
        const subs = parsePath('M0 0 L10 0 L10 10 Z M50 50 L60 60');
        expect(subs).toHaveLength(2);
        expect(subs[0].closed).toBe(true);
        expect(subs[1].closed).toBe(false);
        // Z adds the closing segment back to the start.
        const pts = samplePath(subs[0], 1);
        expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
    });

    it('draws curves through their end points, including smooth and arc commands', () => {
        expect(ends('M0 0 C0 10 10 10 10 0').last).toEqual({ x: 10, y: 0 });
        expect(ends('M0 0 C0 10 10 10 10 0 S20 -10 20 0').last).toEqual({ x: 20, y: 0 });
        expect(ends('M0 0 Q5 10 10 0 T20 0').last).toEqual({ x: 20, y: 0 });
        const arc = ends('M0 50 A50 50 0 0 1 100 50');
        expect(arc.last).toEqual({ x: 100, y: 50 });
        // A half circle of radius 50 is about 157 long.
        expect(arc.count).toBeGreaterThan(150);
        expect(arc.count).toBeLessThan(165);
        // A full circle written as two relative arcs comes back to where it started.
        const circle = ends('M40 50 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0');
        expect(circle.last.x).toBeCloseTo(40);
        expect(circle.last.y).toBeCloseTo(50);
    });

    it('reports malformed path data', () => {
        expect(() => parsePath('L10 10')).toThrow(PathSyntaxError);
        expect(() => parsePath('M10 10 C1 2 3')).toThrow('command C needs 6 numbers');
        expect(() => parsePath('M10 10 K5 5')).toThrow(PathSyntaxError);
        expect(() => parsePath('M0 0 A5 5 0 2 1 10 10')).toThrow('arc flags');
    });
});

describe('samplePath', () => {
    it('spaces points evenly along the path', () => {
        const pts = samplePath(parsePath('M0 0 L30 0 L30 30')[0], 3);
        const gaps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
        for (const g of gaps.slice(0, -1)) expect(g).toBeCloseTo(3, 1);
        expect(pts).toHaveLength(21);
    });
});

describe('sketchToShapes', () => {
    const face = { strokes: [{ d: 'M20 50 A30 30 0 1 0 80 50 A30 30 0 1 0 20 50 Z' }, { d: 'M40 45 L40 47 M60 45 L60 47', color: '#e64980', width: 4 }] };

    it('turns each continuous line into a pressure pen stroke, scaled into place', () => {
        const shapes = sketchToShapes({ ...face, x: 100, y: 200, size: 200 }) as Pen[];
        expect(shapes).toHaveLength(3);
        expect(shapes.every((s) => s.type === 'pen' && s.pressure && s.points.every((p) => p.length === 3))).toBe(true);
        expect(shapes[1]).toMatchObject({ color: '#e64980', strokeWidth: 4 });
        // 100-unit box scaled to 200: the circle spans x 140..260, y 240..360 (plus the wobble).
        const xs = shapes[0].points.map((p) => p[0]);
        const ys = shapes[0].points.map((p) => p[1]);
        expect(Math.min(...xs)).toBeGreaterThan(137);
        expect(Math.max(...xs)).toBeLessThan(263);
        expect(Math.min(...ys)).toBeGreaterThan(237);
        expect(Math.max(...ys)).toBeLessThan(363);
    });

    it('varies pressure and stays within a reasonable range', () => {
        const [circle] = sketchToShapes(face) as Pen[];
        const pressures = circle.points.map((p) => p[2] as number);
        expect(Math.min(...pressures)).toBeGreaterThanOrEqual(0.2);
        expect(Math.max(...pressures)).toBeLessThanOrEqual(0.9);
        expect(new Set(pressures).size).toBeGreaterThan(5);
    });

    it('draws the same input the same way, and a closed line overlaps where it meets', () => {
        const a = sketchToShapes(face, { createId: () => 'x' });
        const b = sketchToShapes(face, { createId: () => 'x' });
        expect(a).toEqual(b);
        const [circle] = a as Pen[];
        const plain = samplePath(parsePath(face.strokes[0].d)[0], 3 / 2.4);
        expect(circle.points.length).toBeGreaterThan(0);
        // More points than the bare outline: the stroke carries on past its start.
        const bare = sketchToShapes({ strokes: [{ d: 'M20 50 A30 30 0 1 0 80 50 A30 30 0 1 0 20 50' }] }) as Pen[];
        expect(circle.points.length).toBeGreaterThan(bare[0].points.length);
        expect(plain.length).toBeGreaterThan(0);
    });
});

describe('draw_sketch tool', () => {
    const plan = { subject: 'test', parts: [{ name: 'all', x: 0, y: 0, w: 100, h: 100 }] };

    it('validates strokes and reports bad path data with its position', () => {
        const r = parseOperation('draw_sketch', {
            ...plan,
            strokes: [{ part: 'all', d: 'M0 0 L10 10' }, { part: 'all', d: 'Z9' }, { part: 'all', d: 'M0 0 C1 2 3' }, { part: 'all', d: 'M0 0', width: 99 }],
            size: 5,
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors).toEqual([
            'input.size: expected a number between 40 and 2000',
            'input.strokes[1].d: is not valid SVG path data: a path must start with M',
            'input.strokes[2].d: is not valid SVG path data: command C needs 6 numbers',
            'input.strokes[3].d: draws nothing',
            'input.strokes[3].width: expected a number between 1 and 16',
        ]);
    });

    it('requires a plan: a subject, parts, and a part for every stroke', () => {
        const r = parseOperation('draw_sketch', { strokes: [{ d: 'M0 0 L10 10' }] });
        expect(r).toMatchObject({
            ok: false,
            errors: ['input.subject: is required', 'input.parts: expected an array', 'input.strokes[0].part: is required'],
        });
    });

    it('checks that the plan and the strokes agree', () => {
        const r = parseOperation('draw_sketch', {
            subject: 'a cat',
            parts: [
                { name: 'head', x: 30, y: 10, w: 40, h: 35 },
                { name: 'body', x: 25, y: 40, w: 50, h: 55 },
                { name: 'tail', x: 70, y: 60, w: 25, h: 30 },
                { name: 'head', x: 0, y: 0, w: 10, h: 10 },
                { name: 'moon', x: 90, y: -20, w: 30, h: 30 },
            ],
            strokes: [
                // Slight overshoot is fine.
                { part: 'head', d: 'M30 28 A20 17 0 1 1 72 28 A20 17 0 1 1 30 28 Z' },
                // A tail drawn across the face is not.
                { part: 'tail', d: 'M75 80 C90 60 60 20 40 25' },
                { part: 'whiskers', d: 'M30 30 L20 28' },
            ],
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors).toEqual([
            'input.parts[3].name: "head" is used by another part; give each part its own name',
            'input.parts[4]: "moon" (x 90–120, y -20–10) is outside the 100 × 100 drawing box',
            'input.strokes[1].d: reaches (40, 25), outside part "tail" (x 70–95, y 60–90). Keep each stroke in its part, or fix the part\'s box if the plan was wrong.',
            'input.strokes[2].part: "whiskers" is not one of the parts: head, body, tail, moon',
            'input.parts[1]: "body" has no strokes; draw it or remove it from parts',
            'input.parts[4]: "moon" has no strokes; draw it or remove it from parts',
        ]);
    });

    it('places the drawing beside existing content', () => {
        const existing: Shape = { id: 'old', type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: 'none', color: 'ink', strokeWidth: 2, strokeStyle: 'solid' };
        const input = { ...plan, strokes: [{ part: 'all', d: 'M0 0 L100 0' }] };
        const { shapes, results } = executeToolCalls([existing], [{ name: 'draw_sketch', input }]);
        expect(results[0].ok).toBe(true);
        const pen = shapes[1] as Pen;
        expect(pen.points[0][0]).toBeCloseTo(180, 0);
    });
});
