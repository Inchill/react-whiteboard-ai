import { act, createRef } from 'react';
import { render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { createWhiteboardAgent, useWhiteboardAI } from '../src';

describe('createWhiteboardAgent with a real <Whiteboard />', () => {
    it('applies one model turn as a single undo step', () => {
        const ref = createRef<WhiteboardHandle>();
        render(<Whiteboard ref={ref} storageKey={null} locale="en" />);
        const ai = createWhiteboardAgent(ref);

        let results: ReturnType<typeof ai.execute> = [];
        act(() => {
            results = ai.execute([
                { name: 'add_shapes', input: { shapes: [{ type: 'rect', x: 0, y: 0, w: 100, h: 60 }, { type: 'text', x: 10, y: 10, text: 'Login' }] } },
                { name: 'add_shapes', input: { shapes: [{ type: 'arrow', x1: 100, y1: 30, x2: 200, y2: 30 }] } },
            ]);
        });
        expect(results.every((r) => r.ok)).toBe(true);
        expect(ai.describe()?.shapes.map((s) => s.type)).toEqual(['rect', 'text', 'arrow']);

        act(() => ref.current!.undo());
        expect(ref.current!.getShapes()).toEqual([]);
        act(() => ref.current!.redo());
        expect(ref.current!.getShapes()).toHaveLength(3);
    });

    it('does not record an undo step when nothing changed', () => {
        const ref = createRef<WhiteboardHandle>();
        render(<Whiteboard ref={ref} storageKey={null} locale="en" />);
        const ai = createWhiteboardAgent(ref);
        act(() => {
            ai.execute([{ name: 'add_shapes', input: { shapes: [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }] } }]);
        });
        act(() => {
            ai.execute([{ name: 'delete_shapes', input: { ids: ['missing'] } }]);
        });
        act(() => ref.current!.undo());
        expect(ref.current!.getShapes()).toEqual([]);
    });

    it('reports when the board is not mounted', () => {
        const ai = createWhiteboardAgent(() => null);
        expect(ai.describe()).toBeNull();
        expect(ai.execute([{ name: 'delete_shapes', input: { ids: ['a'] } }])[0].errors).toEqual(['whiteboard is not mounted']);
    });

    it('useWhiteboardAI returns a stable agent', () => {
        const ref = createRef<WhiteboardHandle>();
        const { result, rerender } = renderHook(() => useWhiteboardAI(ref));
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });
});
