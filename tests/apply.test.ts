import { describe, expect, it } from 'vitest';
import { applyOperations, executeToolCalls, formatToolResult } from '../src';
import type { Shape } from '../src/types';

const ids = () => {
    let n = 0;
    return () => `new${++n}`;
};

const rect: Shape = { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 50, fill: 'none', color: 'ink', strokeWidth: 4, strokeStyle: 'solid' };
const pen: Shape = { id: 'p', type: 'pen', points: [[0, 0, 0.5], [10, 10, 0.6]], color: 'ink', strokeWidth: 4, strokeStyle: 'solid', pressure: true };
const text: Shape = { id: 't', type: 'text', x: 0, y: 0, text: 'a', fontSize: 24, w: 14, h: 30, color: 'ink', strokeWidth: 4, strokeStyle: 'solid' };

describe('applyOperations', () => {
    it('adds shapes with defaults and fresh ids, without mutating the input', () => {
        const before = [rect];
        const { shapes, results } = applyOperations(
            before,
            [{ op: 'add_shapes', shapes: [{ type: 'ellipse', x: 0, y: 100, w: 40, h: 40 }, { type: 'text', x: 0, y: 0, text: 'AB' }] }],
            { createId: ids() },
        );
        expect(before).toEqual([rect]);
        expect(results[0].created).toEqual(['new1', 'new2']);
        expect(shapes[1]).toEqual({
            id: 'new1', type: 'ellipse', x: 0, y: 100, w: 40, h: 40, fill: 'none', color: 'ink', strokeWidth: 2, strokeStyle: 'solid',
        });
        // Text gets measured so the board can hit-test and select it.
        expect(shapes[2]).toMatchObject({ type: 'text', fontSize: 20, h: 25 });
        expect((shapes[2] as Extract<Shape, { type: 'text' }>).w).toBeGreaterThan(0);
    });

    it('updates by type, moves freehand strokes and re-measures text', () => {
        const { shapes, results } = applyOperations([rect, pen, text], [
            {
                op: 'update_shapes',
                updates: [
                    { id: 'r', w: 200, fill: 'solid', color: '#e03131' },
                    { id: 'p', dx: 5, dy: -5 },
                    { id: 't', text: 'a much longer line', fontSize: 48 },
                ],
            },
        ]);
        expect(results[0]).toMatchObject({ updated: ['r', 'p', 't'], errors: [] });
        expect(shapes[0]).toMatchObject({ w: 200, fill: 'solid', color: '#e03131' });
        expect(shapes[1]).toMatchObject({ points: [[5, -5, 0.5], [15, 5, 0.6]] });
        expect(shapes[2]).toMatchObject({ fontSize: 48, h: 60 });
        expect((shapes[2] as Extract<Shape, { type: 'text' }>).w).toBeGreaterThan(text.w);
    });

    it('reports fields that do not fit the shape and unknown ids, applying the rest', () => {
        const { shapes, results } = applyOperations([rect, pen], [
            { op: 'update_shapes', updates: [{ id: 'p', fill: 'solid' }, { id: 'zzz', dx: 1 }, { id: 'r', dx: 10 }] },
        ]);
        expect(results[0].errors).toEqual(['updates[0]: fill cannot be set on a pen', 'updates[1]: no shape with id "zzz"']);
        expect(results[0].updated).toEqual(['r']);
        expect(shapes[0]).toMatchObject({ x: 10 });
        expect(shapes[1]).toBe(pen);
    });

    it('deletes known ids and reports unknown ones', () => {
        const { shapes, results } = applyOperations([rect, pen], [{ op: 'delete_shapes', ids: ['p', 'nope', 'p'] }]);
        expect(shapes).toEqual([rect]);
        expect(results[0]).toMatchObject({ deleted: ['p'], errors: ['ids[1]: no shape with id "nope"'] });
    });

    it('returns the same array when nothing changed', () => {
        const before = [rect];
        expect(applyOperations(before, [{ op: 'delete_shapes', ids: ['nope'] }]).shapes).toBe(before);
    });

    it('lets later operations see earlier results', () => {
        const { shapes } = applyOperations([], [
            { op: 'add_shapes', shapes: [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }] },
            { op: 'update_shapes', updates: [{ id: 'new1', dx: 5 }] },
        ], { createId: ids() });
        expect(shapes[0]).toMatchObject({ id: 'new1', x: 5 });
    });
});

describe('executeToolCalls', () => {
    it('validates, applies valid calls and reports invalid ones', () => {
        const { shapes, results } = executeToolCalls(
            [rect],
            [
                { id: 'c1', name: 'add_shapes', input: { shapes: [{ type: 'arrow', x1: 0, y1: 0, x2: 50, y2: 0 }] } },
                { id: 'c2', name: 'add_shapes', input: { shapes: [{ type: 'circle' }] } },
                { id: 'c3', name: 'delete_shapes', input: { ids: ['r'] } },
            ],
            { createId: ids() },
        );
        expect(shapes.map((s) => s.id)).toEqual(['new1']);
        expect(results.map((r) => [r.id, r.ok])).toEqual([['c1', true], ['c2', false], ['c3', true]]);
        expect(formatToolResult(results[0])).toBe('created new1');
        expect(formatToolResult(results[1])).toContain('errors:\n- input.shapes[0].type');
        expect(formatToolResult(results[2])).toBe('deleted r');
    });
});

describe('keeping new content clear of the board', () => {
    type Rect = Extract<Shape, { w: number; fill: unknown }>;
    const box = (id: string, x: number, y: number, w = 100, h = 50): Rect => ({ ...(rect as Rect), id, x, y, w, h });
    const overlapsAny = (r: Rect, others: Rect[]) => others.some((b) => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);

    it('moves a standalone add_shapes group that lands on existing shapes, as one piece', () => {
        const board = [box('a', 0, 0), box('b', 200, 0)];
        const { shapes, results } = applyOperations(board, [
            { op: 'add_shapes', shapes: [{ type: 'rect', x: 150, y: 10, w: 100, h: 50 }, { type: 'rect', x: 150, y: 80, w: 100, h: 50 }] },
        ], { createId: ids() });
        const [n1, n2] = shapes.slice(2) as Rect[];
        expect(overlapsAny(n1, board)).toBe(false);
        expect(overlapsAny(n2, board)).toBe(false);
        // Relative layout inside the group is kept.
        expect(n2.x - n1.x).toBe(0);
        expect(n2.y - n1.y).toBe(70);
        expect(results[0].notes?.[0]).toMatch(/do not overlap/);
    });

    it('leaves annotations where the model put them', () => {
        const board = [box('a', 0, 0, 200, 100)];
        const { shapes, results } = applyOperations(board, [
            { op: 'add_shapes', shapes: [{ type: 'text', x: 20, y: 20, text: 'label' }, { type: 'arrow', x1: 300, y1: 50, x2: 205, y2: 50 }] },
        ], { createId: ids() });
        expect(shapes[1]).toMatchObject({ x: 20, y: 20 });
        expect(results[0].notes).toBeUndefined();
    });

    it('moves a diagram placed by the model on top of existing content', () => {
        const board = [box('a', 0, 0, 300, 200)];
        const { shapes, results } = applyOperations(board, [
            { op: 'add_diagram', diagram: { x: 50, y: 50, nodes: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], edges: [{ from: 'x', to: 'y' }] } },
        ], { createId: ids() });
        const added = shapes.slice(1).filter((s): s is Rect => s.type === 'rect');
        expect(added.every((s) => !overlapsAny(s, board))).toBe(true);
        expect(results[0].notes?.[0]).toMatch(/do not overlap/);
    });

    it('does not touch content placed in free space', () => {
        const board = [box('a', 0, 0)];
        const { shapes, results } = applyOperations(board, [{ op: 'add_shapes', shapes: [{ type: 'rect', x: 400, y: 0, w: 50, h: 50 }] }], { createId: ids() });
        expect(shapes[1]).toMatchObject({ x: 400, y: 0 });
        expect(results[0].notes).toBeUndefined();
    });
});
