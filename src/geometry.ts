import type { Shape } from './types';

export type Box = { x: number; y: number; w: number; h: number };

/** Same values as the board, so text added by a model gets the size the board would give it. */
const FONT_FAMILY =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
export const LINE_HEIGHT = 1.25;

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Measure multi-line text in world units. Falls back to an estimate without a canvas (SSR, tests). */
export function measureText(text: string, fontSize: number): { w: number; h: number } {
    const lines = text.split('\n');
    if (measureCtx === undefined) {
        try {
            measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
        } catch {
            measureCtx = null;
        }
    }
    let w = 0;
    if (measureCtx) {
        measureCtx.font = `${fontSize}px ${FONT_FAMILY}`;
        for (const line of lines) w = Math.max(w, measureCtx.measureText(line).width);
    } else {
        // CJK glyphs are roughly square; Latin ones about 0.6em wide.
        for (const line of lines) {
            let lw = 0;
            for (const ch of line) lw += /[⺀-￯]/.test(ch) ? fontSize : fontSize * 0.6;
            w = Math.max(w, lw);
        }
    }
    return { w: Math.max(w, fontSize * 0.5), h: lines.length * fontSize * LINE_HEIGHT };
}

/** Axis-aligned bounding box of a shape (stroke width not included). */
export function shapeBox(shape: Shape): Box {
    switch (shape.type) {
        case 'pen':
        case 'highlighter': {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const [x, y] of shape.points) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
            if (!shape.points.length) return { x: 0, y: 0, w: 0, h: 0 };
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        case 'line':
        case 'arrow': {
            // A curve can bulge a little past its points; close enough for layout.
            const xs = [shape.x1, ...(shape.via ?? []).map((p) => p[0]), shape.x2];
            const ys = [shape.y1, ...(shape.via ?? []).map((p) => p[1]), shape.y2];
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
        }
        default: {
            // Boxes may carry negative w/h while drawing; normalize.
            const x = shape.w < 0 ? shape.x + shape.w : shape.x;
            const y = shape.h < 0 ? shape.y + shape.h : shape.y;
            return { x, y, w: Math.abs(shape.w), h: Math.abs(shape.h) };
        }
    }
}

export function unionBox(boxes: Box[]): Box | null {
    if (!boxes.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
    switch (shape.type) {
        case 'pen':
        case 'highlighter':
            return {
                ...shape,
                points: shape.points.map((p) => (p.length === 3 ? [p[0] + dx, p[1] + dy, p[2]] : [p[0] + dx, p[1] + dy])),
            };
        case 'line':
        case 'arrow':
            return {
                ...shape,
                x1: shape.x1 + dx,
                y1: shape.y1 + dy,
                x2: shape.x2 + dx,
                y2: shape.y2 + dy,
                ...(shape.via ? { via: shape.via.map(([x, y]): [number, number] => [x + dx, y + dy]) } : {}),
            };
        default:
            return { ...shape, x: shape.x + dx, y: shape.y + dy };
    }
}

let counter = 0;
/** Ids in the same shape as the board's own, so AI-made shapes are indistinguishable from drawn ones. */
export function createId(): string {
    counter = (counter + 1) % 1e6;
    return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const round = (n: number, digits = 0) => {
    const k = 10 ** digits;
    return Math.round(n * k) / k;
};
