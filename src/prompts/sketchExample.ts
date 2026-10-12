import type { SketchInput } from '../sketch/sketch';

/**
 * A worked draw_sketch call shown to the model: a small bird on a branch. Plain enough that it
 * does not steer every drawing toward birds, but it shows the method: the subject first, then a
 * box per part, then strokes that stay in their part and meet the parts around them.
 */
export const SKETCH_EXAMPLE: SketchInput = {
    subject: 'a round little bird perched on a branch, side view facing right, wing folded',
    parts: [
        { name: 'head', on: 'body', x: 52, y: 14, w: 32, h: 32 },
        { name: 'beak', on: 'head', x: 82, y: 26, w: 11, h: 10 },
        { name: 'eye', x: 69, y: 24, w: 4, h: 4 },
        { name: 'body', x: 18, y: 36, w: 62, h: 46 },
        { name: 'wing', x: 32, y: 48, w: 26, h: 18 },
        { name: 'tail', on: 'body', x: 6, y: 44, w: 16, h: 20 },
        { name: 'legs', on: 'body', x: 40, y: 78, w: 22, h: 10 },
        { name: 'branch', x: 6, y: 84, w: 88, h: 8 },
    ],
    strokes: [
        { part: 'head', d: 'M52 30 A16 16 0 1 1 84 30 A16 16 0 1 1 52 30 Z', width: 4 },
        { part: 'beak', d: 'M83 27 L92 31 L82 35', color: '#f08c00' },
        { part: 'eye', d: 'M69 26 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0' },
        {
            part: 'body',
            points: [[55, 40], [38, 38], [24, 46], [20, 61], [26, 74], [40, 81], [56, 80], [70, 74], [78, 61], [78, 46]],
            width: 4,
        },
        { part: 'wing', points: [[34, 56], [42, 50], [52, 52], [58, 60], [48, 65], [38, 63]], closed: true },
        { part: 'tail', points: [[21, 52], [12, 48], [6, 44], [9, 53], [14, 58], [20, 62]] },
        { part: 'legs', d: 'M46 80 L44 87 M56 80 L58 87', color: '#f08c00' },
        { part: 'branch', points: [[6, 88], [30, 86.5], [60, 89], [94, 87]], color: '#8d6e63', width: 4 },
    ],
};
