import { describe, expect, it } from 'vitest';
import { parseOperation } from '../src';

describe('parseOperation', () => {
    it('accepts valid shapes and drops nothing the model set', () => {
        const r = parseOperation('add_shapes', {
            shapes: [
                { type: 'rect', x: 0, y: 0, w: 100, h: 50, fill: 'semi', color: '#1971c2' },
                { type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0 },
                { type: 'text', x: 0, y: 0, text: '你好' },
            ],
        });
        expect(r).toEqual({
            ok: true,
            value: {
                op: 'add_shapes',
                shapes: [
                    { type: 'rect', x: 0, y: 0, w: 100, h: 50, fill: 'semi', color: '#1971c2' },
                    { type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0 },
                    { type: 'text', x: 0, y: 0, text: '你好' },
                ],
            },
        });
    });

    it('reports every problem with a path', () => {
        const r = parseOperation('add_shapes', {
            shapes: [
                { type: 'rect', x: 0, y: 'a', w: 0, h: 10, color: 'blue' },
                { type: 'star', x: 0, y: 0 },
                { type: 'line', x1: 5, y1: 5, x2: 5, y2: 5 },
                { type: 'text', x: 0, y: 0, text: '  ', radius: 3 },
            ],
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors).toEqual([
            'input.shapes[0].y: expected a finite number',
            'input.shapes[0].w: expected a number between 1 and 1000000',
            'input.shapes[0].color: expected "ink" or a hex color like "#e03131"',
            'input.shapes[1].type: expected one of "rect", "ellipse", "triangle", "line", "arrow", "text"',
            'input.shapes[2]: start and end points are the same',
            'input.shapes[3].radius: is not a known field',
            'input.shapes[3].text: expected a non-empty string',
        ]);
    });

    it('rejects unknown tools, non-objects, empty and oversized arrays', () => {
        expect(parseOperation('draw_unicorn', {})).toEqual({ ok: false, errors: ['unknown tool "draw_unicorn"'] });
        expect(parseOperation('delete_shapes', 'x')).toEqual({ ok: false, errors: ['input: expected an object'] });
        expect(parseOperation('delete_shapes', { ids: [] })).toEqual({ ok: false, errors: ['input.ids: must not be empty'] });
        const many = Array.from({ length: 201 }, (_, i) => `id${i}`);
        expect(parseOperation('delete_shapes', { ids: many }).ok).toBe(false);
        expect(parseOperation('delete_shapes', { ids: ['a', 3] })).toEqual({ ok: false, errors: ['input.ids[1]: expected a shape id'] });
    });

    it('validates updates', () => {
        expect(parseOperation('update_shapes', { updates: [{ id: 'a', dx: 10 }] })).toEqual({
            ok: true,
            value: { op: 'update_shapes', updates: [{ id: 'a', dx: 10 }] },
        });
        const r = parseOperation('update_shapes', { updates: [{ id: 'a' }, { dx: 1 }, { id: 'b', strokeWidth: 999 }] });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors).toEqual([
            'input.updates[0]: has no changes besides id',
            'input.updates[1].id: expected a shape id',
            'input.updates[2].strokeWidth: expected a number between 1 and 64',
        ]);
    });

    it('rejects non-finite numbers', () => {
        const r = parseOperation('update_shapes', { updates: [{ id: 'a', dx: Infinity, dy: NaN }] });
        expect(r.ok).toBe(false);
    });
});
