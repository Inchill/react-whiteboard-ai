import type { FillStyle, Shape, StrokeStyle } from '@inchill/react-whiteboard';

export type { Shape, FillStyle, StrokeStyle };

/** Color token that follows the board theme (dark ink on light, light ink on dark). */
export const INK = 'ink';

/** Optional style fields a model may set on any new shape. */
export type StyleInput = {
    /** `"ink"` or a hex color such as `#e03131`. */
    color?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
};

export type BoxInput = StyleInput & {
    type: 'rect' | 'ellipse' | 'triangle';
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: FillStyle;
};

export type LinearInput = StyleInput & {
    type: 'line' | 'arrow';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

export type TextInput = {
    type: 'text';
    x: number;
    y: number;
    text: string;
    fontSize?: number;
    color?: string;
};

/** A shape as a model describes it: no id, styles optional. */
export type ShapeInput = BoxInput | LinearInput | TextInput;

/** Changes to an existing shape. Fields that do not apply to the shape's type are rejected. */
export type ShapePatch = {
    id: string;
    /** Move the shape by this offset (works for every type, including freehand strokes). */
    dx?: number;
    dy?: number;
    color?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
    /** Boxes only. */
    fill?: FillStyle;
    /** Boxes only: new position / size. */
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    /** Lines and arrows only: new end points. */
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    /** Text only. */
    text?: string;
    fontSize?: number;
};

export type Operation =
    | { op: 'add_shapes'; shapes: ShapeInput[] }
    | { op: 'update_shapes'; updates: ShapePatch[] }
    | { op: 'delete_shapes'; ids: string[] };

export type OperationName = Operation['op'];
