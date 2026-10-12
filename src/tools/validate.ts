import type { Operation, OperationName, ShapeInput, ShapePatch } from '../types';

/** Limits that keep a confused model from producing unusable or huge documents. */
export const LIMITS = {
    coordinate: 1e6,
    strokeWidth: { min: 1, max: 64 },
    fontSize: { min: 8, max: 200 },
    textLength: 2000,
    itemsPerOperation: 200,
} as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const COLOR = /^(ink|#[0-9a-f]{3}|#[0-9a-f]{6})$/i;
const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
const FILLS = ['none', 'semi', 'solid'] as const;
const BOX_TYPES = ['rect', 'ellipse', 'triangle'] as const;
const LINEAR_TYPES = ['line', 'arrow'] as const;
export const OPERATION_NAMES: OperationName[] = ['add_shapes', 'update_shapes', 'delete_shapes'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Collects errors with a JSON-ish path so the model can be told exactly what to fix. */
class Checker {
    errors: string[] = [];

    fail(path: string, message: string) {
        this.errors.push(`${path}: ${message}`);
    }

    number(o: Obj, key: string, path: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
        const v = o[key];
        if (v === undefined) {
            if (opts.required) this.fail(`${path}.${key}`, 'is required');
            return undefined;
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            this.fail(`${path}.${key}`, 'expected a finite number');
            return undefined;
        }
        const min = opts.min ?? -LIMITS.coordinate;
        const max = opts.max ?? LIMITS.coordinate;
        if (v < min || v > max) {
            this.fail(`${path}.${key}`, `expected a number between ${min} and ${max}`);
            return undefined;
        }
        return v;
    }

    color(o: Obj, key: string, path: string): string | undefined {
        const v = o[key];
        if (v === undefined) return undefined;
        if (typeof v !== 'string' || !COLOR.test(v)) {
            this.fail(`${path}.${key}`, 'expected "ink" or a hex color like "#e03131"');
            return undefined;
        }
        return v;
    }

    oneOf<T extends string>(o: Obj, key: string, path: string, list: readonly T[]): T | undefined {
        const v = o[key];
        if (v === undefined) return undefined;
        if (!includes(list, v)) {
            this.fail(`${path}.${key}`, `expected one of ${list.map((x) => `"${x}"`).join(', ')}`);
            return undefined;
        }
        return v;
    }

    text(o: Obj, key: string, path: string, required: boolean): string | undefined {
        const v = o[key];
        if (v === undefined) {
            if (required) this.fail(`${path}.${key}`, 'is required');
            return undefined;
        }
        if (typeof v !== 'string' || !v.trim()) {
            this.fail(`${path}.${key}`, 'expected a non-empty string');
            return undefined;
        }
        if (v.length > LIMITS.textLength) {
            this.fail(`${path}.${key}`, `is longer than ${LIMITS.textLength} characters`);
            return undefined;
        }
        return v;
    }

    array(o: Obj, key: string, path: string): unknown[] | undefined {
        const v = o[key];
        if (!Array.isArray(v)) {
            this.fail(`${path}.${key}`, 'expected an array');
            return undefined;
        }
        if (v.length === 0) {
            this.fail(`${path}.${key}`, 'must not be empty');
            return undefined;
        }
        if (v.length > LIMITS.itemsPerOperation) {
            this.fail(`${path}.${key}`, `has more than ${LIMITS.itemsPerOperation} items`);
            return undefined;
        }
        return v;
    }

    /** Report keys the schema does not know, which usually means the model guessed a field name. */
    unknownKeys(o: Obj, path: string, allowed: readonly string[]) {
        for (const k of Object.keys(o)) if (!allowed.includes(k)) this.fail(`${path}.${k}`, 'is not a known field');
    }
}

const STYLE_KEYS = ['color', 'strokeWidth', 'strokeStyle'] as const;
const BOX_KEYS = ['type', 'x', 'y', 'w', 'h', 'fill', ...STYLE_KEYS] as const;
const LINEAR_KEYS = ['type', 'x1', 'y1', 'x2', 'y2', ...STYLE_KEYS] as const;
const TEXT_KEYS = ['type', 'x', 'y', 'text', 'fontSize', 'color'] as const;
const PATCH_KEYS = [
    'id', 'dx', 'dy', 'color', 'strokeWidth', 'strokeStyle', 'fill',
    'x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'text', 'fontSize',
] as const;

/** Drop keys whose value is undefined so outputs stay minimal and comparable. */
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function parseShapeInput(c: Checker, raw: unknown, path: string): ShapeInput | undefined {
    if (!isObj(raw)) {
        c.fail(path, 'expected an object');
        return undefined;
    }
    const before = c.errors.length;
    const style = () => ({
        color: c.color(raw, 'color', path),
        strokeWidth: c.number(raw, 'strokeWidth', path, LIMITS.strokeWidth),
        strokeStyle: c.oneOf(raw, 'strokeStyle', path, STROKE_STYLES),
    });

    let shape: ShapeInput | undefined;
    if (includes(BOX_TYPES, raw.type)) {
        c.unknownKeys(raw, path, BOX_KEYS);
        shape = clean({
            type: raw.type,
            x: c.number(raw, 'x', path, { required: true })!,
            y: c.number(raw, 'y', path, { required: true })!,
            w: c.number(raw, 'w', path, { required: true, min: 1 })!,
            h: c.number(raw, 'h', path, { required: true, min: 1 })!,
            fill: c.oneOf(raw, 'fill', path, FILLS),
            ...style(),
        });
    } else if (includes(LINEAR_TYPES, raw.type)) {
        c.unknownKeys(raw, path, LINEAR_KEYS);
        shape = clean({
            type: raw.type,
            x1: c.number(raw, 'x1', path, { required: true })!,
            y1: c.number(raw, 'y1', path, { required: true })!,
            x2: c.number(raw, 'x2', path, { required: true })!,
            y2: c.number(raw, 'y2', path, { required: true })!,
            ...style(),
        });
        if (c.errors.length === before && raw.x1 === raw.x2 && raw.y1 === raw.y2) {
            c.fail(path, 'start and end points are the same');
        }
    } else if (raw.type === 'text') {
        c.unknownKeys(raw, path, TEXT_KEYS);
        shape = clean({
            type: 'text' as const,
            x: c.number(raw, 'x', path, { required: true })!,
            y: c.number(raw, 'y', path, { required: true })!,
            text: c.text(raw, 'text', path, true)!,
            fontSize: c.number(raw, 'fontSize', path, LIMITS.fontSize),
            color: c.color(raw, 'color', path),
        });
    } else {
        c.fail(`${path}.type`, 'expected one of "rect", "ellipse", "triangle", "line", "arrow", "text"');
    }
    return c.errors.length === before ? shape : undefined;
}

function parsePatch(c: Checker, raw: unknown, path: string): ShapePatch | undefined {
    if (!isObj(raw)) {
        c.fail(path, 'expected an object');
        return undefined;
    }
    const before = c.errors.length;
    c.unknownKeys(raw, path, PATCH_KEYS);
    if (typeof raw.id !== 'string' || !raw.id) c.fail(`${path}.id`, 'expected a shape id');
    const patch: ShapePatch = clean({
        id: raw.id as string,
        dx: c.number(raw, 'dx', path),
        dy: c.number(raw, 'dy', path),
        color: c.color(raw, 'color', path),
        strokeWidth: c.number(raw, 'strokeWidth', path, LIMITS.strokeWidth),
        strokeStyle: c.oneOf(raw, 'strokeStyle', path, STROKE_STYLES),
        fill: c.oneOf(raw, 'fill', path, FILLS),
        x: c.number(raw, 'x', path),
        y: c.number(raw, 'y', path),
        w: c.number(raw, 'w', path, { min: 1 }),
        h: c.number(raw, 'h', path, { min: 1 }),
        x1: c.number(raw, 'x1', path),
        y1: c.number(raw, 'y1', path),
        x2: c.number(raw, 'x2', path),
        y2: c.number(raw, 'y2', path),
        text: c.text(raw, 'text', path, false),
        fontSize: c.number(raw, 'fontSize', path, LIMITS.fontSize),
    });
    if (c.errors.length === before && Object.keys(patch).length === 1) c.fail(path, 'has no changes besides id');
    return c.errors.length === before ? patch : undefined;
}

/**
 * Validate one tool call from a model. `name` is the tool name, `input` its parsed JSON arguments.
 * Returns every problem at once so they can go back to the model in a single tool result.
 */
export function parseOperation(name: string, input: unknown): ParseResult<Operation> {
    const c = new Checker();
    if (!includes(OPERATION_NAMES, name)) return { ok: false, errors: [`unknown tool "${name}"`] };
    if (!isObj(input)) return { ok: false, errors: ['input: expected an object'] };

    let op: Operation | undefined;
    switch (name) {
        case 'add_shapes': {
            c.unknownKeys(input, 'input', ['shapes']);
            const items = c.array(input, 'shapes', 'input');
            const shapes = items?.map((s, i) => parseShapeInput(c, s, `input.shapes[${i}]`));
            if (shapes) op = { op: name, shapes: shapes as ShapeInput[] };
            break;
        }
        case 'update_shapes': {
            c.unknownKeys(input, 'input', ['updates']);
            const items = c.array(input, 'updates', 'input');
            const updates = items?.map((u, i) => parsePatch(c, u, `input.updates[${i}]`));
            if (updates) op = { op: name, updates: updates as ShapePatch[] };
            break;
        }
        case 'delete_shapes': {
            c.unknownKeys(input, 'input', ['ids']);
            const items = c.array(input, 'ids', 'input');
            items?.forEach((id, i) => {
                if (typeof id !== 'string' || !id) c.fail(`input.ids[${i}]`, 'expected a shape id');
            });
            if (items) op = { op: name, ids: items as string[] };
            break;
        }
    }
    return c.errors.length || !op ? { ok: false, errors: c.errors } : { ok: true, value: op };
}
