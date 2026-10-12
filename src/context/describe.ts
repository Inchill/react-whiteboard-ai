import { round, shapeBox, unionBox, type Box } from '../geometry';
import type { FillStyle, Shape } from '../types';

/** One shape as the model sees it: ids, geometry and text, without raw stroke points. */
export type ShapeSummary = {
    id: string;
    type: Shape['type'];
    /** Bounding box, rounded to whole world units. */
    x: number;
    y: number;
    w: number;
    h: number;
    color: string;
    /** Lines and arrows: exact end points (the box alone loses direction). */
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    fill?: FillStyle;
    text?: string;
    fontSize?: number;
    /** Freehand strokes: number of sampled points, a rough hint of how much was drawn. */
    points?: number;
};

export type BoardDescription = {
    /** Bounding box of everything on the board, or null when empty. */
    bounds: Box | null;
    /** Total number of shapes on the board. */
    count: number;
    /** Shapes in paint order (later ones are drawn on top). */
    shapes: ShapeSummary[];
    /** How many of the oldest shapes were left out because of `maxShapes`. */
    omitted?: number;
};

export type DescribeOptions = {
    /** Keep only the most recent shapes. Defaults to 300. */
    maxShapes?: number;
};

const roundBox = (b: Box): Box => ({ x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) });

export function summarizeShape(shape: Shape): ShapeSummary {
    const s: ShapeSummary = { id: shape.id, type: shape.type, ...roundBox(shapeBox(shape)), color: shape.color };
    switch (shape.type) {
        case 'pen':
        case 'highlighter':
            s.points = shape.points.length;
            break;
        case 'line':
        case 'arrow':
            s.x1 = round(shape.x1);
            s.y1 = round(shape.y1);
            s.x2 = round(shape.x2);
            s.y2 = round(shape.y2);
            break;
        case 'text':
            s.text = shape.text;
            s.fontSize = shape.fontSize;
            break;
        default:
            s.fill = shape.fill;
    }
    return s;
}

/**
 * Turn the board into a compact, model-friendly description.
 * Send it as JSON in the user turn (or a tool result) so the model can refer to shapes by id.
 */
export function describeBoard(shapes: Shape[], options: DescribeOptions = {}): BoardDescription {
    const max = options.maxShapes ?? 300;
    const kept = shapes.length > max ? shapes.slice(shapes.length - max) : shapes;
    const bounds = unionBox(shapes.map(shapeBox));
    const description: BoardDescription = {
        bounds: bounds && roundBox(bounds),
        count: shapes.length,
        shapes: kept.map(summarizeShape),
    };
    if (kept.length < shapes.length) description.omitted = shapes.length - kept.length;
    return description;
}
