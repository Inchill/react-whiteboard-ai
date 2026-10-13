import { describe, expect, it } from 'vitest';
import { layoutScore, measureLayout } from '../eval/metrics';
import type { Shape } from '../src/types';

const style = { color: 'ink', strokeWidth: 2, strokeStyle: 'solid' as const };
let n = 0;
const arrow = (x1: number, y1: number, x2: number, y2: number, via?: [number, number][]): Shape => ({
    id: `a${++n}`,
    type: 'arrow',
    x1,
    y1,
    x2,
    y2,
    ...(via ? { via } : {}),
    ...style,
});
const box = (x: number, y: number, w = 100, h = 40): Shape => ({ id: `b${++n}`, type: 'rect', x, y, w, h, fill: 'semi', ...style });
const label = (x: number, y: number, text = '是'): Shape => ({ id: `t${++n}`, type: 'text', x, y, text, fontSize: 14, w: 14 * text.length, h: 18, ...style });

describe('measureLayout', () => {
    it('counts crossings, but not lines that only touch', () => {
        const m = measureLayout([arrow(0, 50, 100, 50), arrow(50, 0, 50, 100), arrow(100, 50, 100, 100)]);
        expect(m.crossings).toBe(1);
    });

    it('follows elbow arrows through their via points', () => {
        const elbow = arrow(0, 0, 100, 100, [
            [50, 0],
            [50, 100],
        ]);
        expect(measureLayout([elbow, arrow(0, 50, 100, 50)]).crossings).toBe(1);
        expect(measureLayout([elbow]).bendsPerEdge).toBe(2);
    });

    it('finds lines through boxes, overlapping labels and lines running too close', () => {
        const m = measureLayout([
            box(0, 0),
            arrow(-20, 20, 120, 20),
            label(200, 0),
            label(205, 5),
            arrow(0, 100, 200, 100),
            arrow(0, 104, 200, 104),
        ]);
        expect(m.edgeThroughBox).toBe(1);
        expect(m.labelOverlaps).toBe(1);
        expect(m.closeParallels).toBe(1);
        expect(layoutScore(m)).toBe(100 - 10 - 6 - 4);
    });

    it('treats a dashed band that holds boxes as a band, not a box', () => {
        const band: Shape = { id: 'band', type: 'rect', x: -20, y: -20, w: 300, h: 100, fill: 'semi', color: '#adb5bd', strokeWidth: 1, strokeStyle: 'dashed' };
        const m = measureLayout([band, box(0, 0), box(150, 0), arrow(100, 20, 150, 20)]);
        expect(m.nodes).toBe(2);
        expect(m.edgeThroughBox).toBe(0);
    });
});
