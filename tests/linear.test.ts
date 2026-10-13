import { describe, expect, it } from 'vitest';
import { describeBoard, executeToolCalls, parseOperation } from '../src';
import type { Shape } from '../src/types';

const elbow: Shape = {
    id: 'a',
    type: 'arrow',
    x1: 0,
    y1: 0,
    via: [
        [50, 0],
        [50, 80],
    ],
    x2: 100,
    y2: 80,
    color: 'ink',
    strokeWidth: 2,
    strokeStyle: 'solid',
};

describe('lines that turn or curve', () => {
    it('validates via points and curved', () => {
        const ok = parseOperation('add_shapes', {
            shapes: [
                { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 80, via: [[50, 0], [50, 80]] },
                { type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, via: [[50, 40]], curved: true },
            ],
        });
        expect(ok.ok).toBe(true);
        const bad = parseOperation('add_shapes', {
            shapes: [
                { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, via: [] },
                { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, curved: true },
                { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, via: [[1, 'x']] },
                { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, via: [[50, 40]], curved: 'yes' },
            ],
        });
        expect(bad).toMatchObject({
            ok: false,
            errors: [
                'input.shapes[0].via: expected at least one [x, y] point',
                'input.shapes[1].curved: needs via points to bend through',
                'input.shapes[2].via[0]: expected [x, y] with two numbers',
                'input.shapes[3].curved: expected true or false',
            ],
        });
    });

    it('adds an elbow arrow as one shape', () => {
        const { shapes } = executeToolCalls(
            [],
            [{ name: 'add_shapes', input: { shapes: [{ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 80, via: [[50, 0], [50, 80]] }] } }],
        );
        expect(shapes).toHaveLength(1);
        expect(shapes[0]).toMatchObject({ type: 'arrow', via: [[50, 0], [50, 80]] });
        expect(shapes[0]).not.toHaveProperty('curved');
    });

    it('moves via points with the line, and straightens or curves it on request', () => {
        const run = (update: object) => executeToolCalls([elbow], [{ name: 'update_shapes', input: { updates: [{ id: 'a', ...update }] } }]);
        expect(run({ dx: 10, dy: 5 }).shapes[0]).toMatchObject({ x1: 10, y1: 5, via: [[60, 5], [60, 85]], x2: 110, y2: 85 });
        expect(run({ curved: true }).shapes[0]).toMatchObject({ via: elbow.via, curved: true });
        const straight = run({ via: [] }).shapes[0];
        expect(straight).not.toHaveProperty('via');
        expect(straight).not.toHaveProperty('curved');
        const plain: Shape = { id: 'b', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, color: 'ink', strokeWidth: 2, strokeStyle: 'solid' };
        const onStraight = executeToolCalls([plain], [{ name: 'update_shapes', input: { updates: [{ id: 'b', curved: true }] } }]);
        expect(onStraight.results[0].errors[0]).toContain('curved needs via points');
    });

    it('describes the points between start and end', () => {
        const [summary] = describeBoard([{ ...elbow, via: [[50.4, 0], [49.6, 80]], curved: true }]).shapes;
        expect(summary).toMatchObject({ x: 0, y: 0, w: 100, h: 80, via: [[50, 0], [50, 80]], curved: true });
    });
});
