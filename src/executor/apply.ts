import { createId as defaultCreateId, measureText, shapeBox, translateShape, unionBox } from '../geometry';
import { layoutDiagram } from '../layout/diagram';
import { joinParts } from '../sketch/join';
import { sketchToShapes } from '../sketch/sketch';
import { parseOperation } from '../tools/validate';
import { INK, type Operation, type Shape, type ShapeInput, type ShapePatch } from '../types';

/** Defaults for shapes a model adds: a lighter line and smaller text than hand drawing, which suits diagrams. */
export const DEFAULTS = { color: INK, strokeWidth: 2, strokeStyle: 'solid', fill: 'none', fontSize: 20 } as const;

export type OperationResult = {
    op: Operation['op'];
    /** Ids of shapes this operation created, in input order. */
    created: string[];
    updated: string[];
    deleted: string[];
    /** Items that could not be applied (for example an unknown id). The rest of the operation still applies. */
    errors: string[];
    /** add_diagram only: diagram node id → id of the box drawn for it. */
    nodes?: Record<string, string>;
    /** Adjustments made while drawing that the model should know about, e.g. a sketch part moved to join another. */
    notes?: string[];
};

export type ApplyOptions = {
    createId?: () => string;
};

export function inputToShape(input: ShapeInput, id: string): Shape {
    switch (input.type) {
        case 'text': {
            const fontSize = input.fontSize ?? DEFAULTS.fontSize;
            return {
                id,
                type: 'text',
                x: input.x,
                y: input.y,
                text: input.text,
                fontSize,
                color: input.color ?? DEFAULTS.color,
                strokeWidth: DEFAULTS.strokeWidth,
                strokeStyle: DEFAULTS.strokeStyle,
                ...measureText(input.text, fontSize),
            };
        }
        case 'line':
        case 'arrow':
            return {
                id,
                type: input.type,
                x1: input.x1,
                y1: input.y1,
                x2: input.x2,
                y2: input.y2,
                ...(input.via?.length ? { via: input.via } : {}),
                ...(input.curved && input.via?.length ? { curved: true } : {}),
                color: input.color ?? DEFAULTS.color,
                strokeWidth: input.strokeWidth ?? DEFAULTS.strokeWidth,
                strokeStyle: input.strokeStyle ?? DEFAULTS.strokeStyle,
            };
        default:
            return {
                id,
                type: input.type,
                x: input.x,
                y: input.y,
                w: input.w,
                h: input.h,
                fill: input.fill ?? DEFAULTS.fill,
                color: input.color ?? DEFAULTS.color,
                strokeWidth: input.strokeWidth ?? DEFAULTS.strokeWidth,
                strokeStyle: input.strokeStyle ?? DEFAULTS.strokeStyle,
            };
    }
}

/** Fields each shape type accepts in an update, besides id / dx / dy / color. */
const PATCHABLE: Record<Shape['type'], readonly (keyof ShapePatch)[]> = {
    rect: ['x', 'y', 'w', 'h', 'fill', 'strokeWidth', 'strokeStyle'],
    ellipse: ['x', 'y', 'w', 'h', 'fill', 'strokeWidth', 'strokeStyle'],
    triangle: ['x', 'y', 'w', 'h', 'fill', 'strokeWidth', 'strokeStyle'],
    line: ['x1', 'y1', 'x2', 'y2', 'via', 'curved', 'strokeWidth', 'strokeStyle'],
    arrow: ['x1', 'y1', 'x2', 'y2', 'via', 'curved', 'strokeWidth', 'strokeStyle'],
    text: ['text', 'fontSize'],
    pen: ['strokeWidth'],
    highlighter: [],
};
const ALWAYS = ['id', 'dx', 'dy', 'color'];

/** Apply a patch to a shape, or return an error message when a field does not fit its type. */
export function patchShape(shape: Shape, patch: ShapePatch): Shape | string {
    const allowed = PATCHABLE[shape.type];
    const wrong = Object.keys(patch).filter((k) => !ALWAYS.includes(k) && !allowed.includes(k as keyof ShapePatch));
    if (wrong.length) return `${wrong.join(', ')} cannot be set on a ${shape.type}`;

    const { id: _id, dx, dy, ...fields } = patch;
    void _id;
    let next = { ...shape, ...fields } as Shape;
    if (next.type === 'text' && (fields.text !== undefined || fields.fontSize !== undefined)) {
        next = { ...next, ...measureText(next.text, next.fontSize) };
    }
    if (next.type === 'line' || next.type === 'arrow') {
        // An empty via makes the line straight again; a curve needs points to pass through.
        if (!next.via?.length) {
            if (fields.curved) return 'curved needs via points to bend through';
            const { via: _via, curved: _curved, ...straight } = next;
            void _via;
            void _curved;
            next = straight;
        } else if (next.curved === false) {
            const { curved: _curved, ...plain } = next;
            void _curved;
            next = plain;
        }
    }
    if (dx || dy) next = translateShape(next, dx ?? 0, dy ?? 0);
    return next;
}

/** Where new content goes when the model does not say: to the right of everything on the board. */
function besideContent(shapes: Shape[]) {
    const bounds = unionBox(shapes.map(shapeBox));
    return bounds ? { x: bounds.x + bounds.w + 80, y: bounds.y } : { x: 0, y: 0 };
}

function applyOne(shapes: Shape[], op: Operation, createId: () => string): { shapes: Shape[]; result: OperationResult } {
    const result: OperationResult = { op: op.op, created: [], updated: [], deleted: [], errors: [] };
    switch (op.op) {
        case 'add_shapes': {
            const added = op.shapes.map((input) => inputToShape(input, createId()));
            result.created = added.map((s) => s.id);
            return { shapes: [...shapes, ...added], result };
        }
        case 'update_shapes': {
            const index = new Map(shapes.map((s, i) => [s.id, i]));
            const next = shapes.slice();
            op.updates.forEach((patch, i) => {
                const at = index.get(patch.id);
                if (at === undefined) {
                    result.errors.push(`updates[${i}]: no shape with id "${patch.id}"`);
                    return;
                }
                const patched = patchShape(next[at], patch);
                if (typeof patched === 'string') {
                    result.errors.push(`updates[${i}]: ${patched}`);
                    return;
                }
                next[at] = patched;
                if (!result.updated.includes(patch.id)) result.updated.push(patch.id);
            });
            return { shapes: result.updated.length ? next : shapes, result };
        }
        case 'draw_sketch': {
            const drawn = sketchToShapes(op.sketch, { createId, origin: besideContent(shapes) });
            result.created = drawn.map((s) => s.id);
            const moves = joinParts(op.sketch);
            if (moves.length) result.notes = moves.map((m) => `moved "${m.part}" by (${m.dx}, ${m.dy}) to join "${m.on}"`);
            return { shapes: [...shapes, ...drawn], result };
        }
        case 'add_diagram': {
            // Unless told where, put the diagram to the right of what is already on the board.
            const origin = besideContent(shapes);
            const drawn = layoutDiagram(op.diagram, { createId, origin });
            result.created = drawn.shapes.map((s) => s.id);
            result.nodes = drawn.nodes;
            return { shapes: [...shapes, ...drawn.shapes], result };
        }
        case 'delete_shapes': {
            const existing = new Set(shapes.map((s) => s.id));
            const remove = new Set<string>();
            op.ids.forEach((id, i) => {
                if (existing.has(id)) remove.add(id);
                else result.errors.push(`ids[${i}]: no shape with id "${id}"`);
            });
            result.deleted = [...remove];
            return { shapes: remove.size ? shapes.filter((s) => !remove.has(s.id)) : shapes, result };
        }
    }
}

/**
 * Apply operations in order to a shape list. Pure: returns a new list and never mutates the input.
 * Later operations see the result of earlier ones, so a model can add a shape and then refer to it
 * in the same turn once it has the created id.
 */
export function applyOperations(shapes: Shape[], ops: Operation[], options: ApplyOptions = {}): { shapes: Shape[]; results: OperationResult[] } {
    const createId = options.createId ?? defaultCreateId;
    const results: OperationResult[] = [];
    let current = shapes;
    for (const op of ops) {
        const out = applyOne(current, op, createId);
        current = out.shapes;
        results.push(out.result);
    }
    return { shapes: current, results };
}

/** A tool call as returned by a model: the tool name and its (already JSON-parsed) arguments. */
export type ToolCall = { id?: string; name: string; input: unknown };

export type ToolCallResult = {
    id?: string;
    name: string;
    ok: boolean;
    created: string[];
    updated: string[];
    deleted: string[];
    errors: string[];
    /** add_diagram only: diagram node id → id of the box drawn for it. */
    nodes?: Record<string, string>;
    notes?: string[];
};

/** Short text to send back to the model as the tool result. */
export function formatToolResult(r: ToolCallResult): string {
    const parts: string[] = [];
    if (r.nodes) {
        const pairs = Object.entries(r.nodes).map(([node, box]) => `${node}=${box}`);
        parts.push(`diagram drawn; node boxes: ${pairs.join(', ')}`);
    }
    if (r.created.length) parts.push(`created ${r.created.join(', ')}`);
    if (r.updated.length) parts.push(`updated ${r.updated.join(', ')}`);
    if (r.deleted.length) parts.push(`deleted ${r.deleted.join(', ')}`);
    if (r.notes?.length) parts.push(`adjusted: ${r.notes.join('; ')}`);
    if (r.errors.length) parts.push(`errors:\n- ${r.errors.join('\n- ')}`);
    return parts.join('\n') || 'no changes';
}

/**
 * Validate and apply a batch of tool calls (typically one model turn).
 * Invalid calls are skipped and reported; valid ones are applied in order.
 */
export function executeToolCalls(shapes: Shape[], calls: ToolCall[], options: ApplyOptions = {}): { shapes: Shape[]; results: ToolCallResult[] } {
    let current = shapes;
    const results = calls.map((call): ToolCallResult => {
        const parsed = parseOperation(call.name, call.input);
        const base = { id: call.id, name: call.name, created: [], updated: [], deleted: [] };
        if (!parsed.ok) return { ...base, ok: false, errors: parsed.errors };
        const out = applyOperations(current, [parsed.value], options);
        current = out.shapes;
        const r = out.results[0];
        return { ...base, ok: r.errors.length === 0, created: r.created, updated: r.updated, deleted: r.deleted, errors: r.errors, ...(r.nodes ? { nodes: r.nodes } : {}), ...(r.notes ? { notes: r.notes } : {}) };
    });
    return { shapes: current, results };
}
