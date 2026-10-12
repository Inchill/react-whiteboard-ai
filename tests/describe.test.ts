import { describe, expect, it } from 'vitest';
import { describeBoard } from '../src';
import type { Shape } from '../src/types';

const rect: Shape = { id: 'r', type: 'rect', x: 10.4, y: 20.6, w: -50, h: 30, fill: 'semi', color: 'ink', strokeWidth: 4, strokeStyle: 'solid' };
const arrow: Shape = { id: 'a', type: 'arrow', x1: 100, y1: 50, x2: 0, y2: 0, color: '#e03131', strokeWidth: 2, strokeStyle: 'solid' };
const pen: Shape = { id: 'p', type: 'pen', points: [[0, 0, 0.5], [30, 40, 0.5], [10, 80, 0.5]], color: 'ink', strokeWidth: 4, strokeStyle: 'solid', pressure: true };
const text: Shape = { id: 't', type: 'text', x: 0, y: 200, text: 'Hi', fontSize: 24, w: 30, h: 30, color: 'ink', strokeWidth: 4, strokeStyle: 'solid' };

describe('describeBoard', () => {
    it('describes an empty board', () => {
        expect(describeBoard([])).toEqual({ bounds: null, count: 0, shapes: [] });
    });

    it('normalizes and rounds boxes', () => {
        const [s] = describeBoard([rect]).shapes;
        expect(s).toEqual({ id: 'r', type: 'rect', x: -40, y: 21, w: 50, h: 30, color: 'ink', fill: 'semi' });
    });

    it('keeps arrow direction, text content and summarizes strokes', () => {
        const { shapes, bounds } = describeBoard([arrow, pen, text]);
        expect(shapes[0]).toMatchObject({ x1: 100, y1: 50, x2: 0, y2: 0, x: 0, y: 0, w: 100, h: 50 });
        expect(shapes[1]).toEqual({ id: 'p', type: 'pen', x: 0, y: 0, w: 30, h: 80, color: 'ink', points: 3 });
        expect(shapes[1]).not.toHaveProperty('fill');
        expect(shapes[2]).toMatchObject({ text: 'Hi', fontSize: 24 });
        expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 230 });
    });

    it('keeps only the most recent shapes but reports full bounds', () => {
        const d = describeBoard([rect, arrow, pen], { maxShapes: 2 });
        expect(d.shapes.map((s) => s.id)).toEqual(['a', 'p']);
        expect(d.omitted).toBe(1);
        expect(d.count).toBe(3);
        expect(d.bounds?.x).toBe(-40);
    });
});
