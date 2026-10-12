import type { DiagramEdge, DiagramInput, DiagramNode } from '../layout/diagram';
import { JOIN, nearest } from '../sketch/join';
import { smoothPath } from '../sketch/smooth';
import { parsePath, samplePath, type Pt } from '../sketch/path';
import { SKETCH_DEFAULTS, type SketchInput, type SketchPart, type SketchStroke } from '../sketch/sketch';
import type { Operation, OperationName, ShapeInput, ShapePatch } from '../types';

/** Limits that keep a confused model from producing unusable or huge documents. */
export const LIMITS = {
    coordinate: 1e6,
    strokeWidth: { min: 1, max: 64 },
    fontSize: { min: 8, max: 200 },
    textLength: 2000,
    itemsPerOperation: 200,
    diagram: { nodes: 60, edges: 120, labelLength: 80, idLength: 40 },
    sketch: { pointsPerStroke: 200, parts: 30, partName: 40, subjectLength: 200, strokes: 120, pathLength: 4000, totalPathLength: 40000, width: { min: 1, max: 16 }, size: { min: 40, max: 2000 } },
} as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const COLOR = /^(ink|#[0-9a-f]{3}|#[0-9a-f]{6})$/i;
const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
const FILLS = ['none', 'semi', 'solid'] as const;
const BOX_TYPES = ['rect', 'ellipse', 'triangle'] as const;
const LINEAR_TYPES = ['line', 'arrow'] as const;
export const OPERATION_NAMES: OperationName[] = ['add_shapes', 'update_shapes', 'delete_shapes', 'add_diagram', 'draw_sketch'];

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

const short = (c: Checker, o: Obj, key: string, path: string, max: number, required: boolean): string | undefined => {
    const v = c.text(o, key, path, required);
    if (v !== undefined && v.length > max) {
        c.fail(`${path}.${key}`, `is longer than ${max} characters`);
        return undefined;
    }
    return v;
};

function parseDiagram(c: Checker, input: Obj): DiagramInput | undefined {
    const before = c.errors.length;
    const L = LIMITS.diagram;
    c.unknownKeys(input, 'input', ['direction', 'nodes', 'edges', 'x', 'y']);
    const direction = c.oneOf(input, 'direction', 'input', ['down', 'right'] as const);
    const x = c.number(input, 'x', 'input');
    const y = c.number(input, 'y', 'input');

    const rawNodes = c.array(input, 'nodes', 'input') ?? [];
    if (rawNodes.length > L.nodes) c.fail('input.nodes', `has more than ${L.nodes} nodes`);
    const nodes: DiagramNode[] = [];
    const ids = new Set<string>();
    rawNodes.slice(0, L.nodes).forEach((raw, i) => {
        const path = `input.nodes[${i}]`;
        if (!isObj(raw)) return c.fail(path, 'expected an object');
        c.unknownKeys(raw, path, ['id', 'label', 'layer', 'color', 'shape']);
        const id = short(c, raw, 'id', path, L.idLength, true);
        if (id && ids.has(id)) c.fail(`${path}.id`, `"${id}" is used by another node`);
        if (id) ids.add(id);
        const node = clean({
            id: id!,
            label: short(c, raw, 'label', path, L.labelLength, true)!,
            layer: short(c, raw, 'layer', path, L.idLength, false),
            color: c.color(raw, 'color', path),
            shape: c.oneOf(raw, 'shape', path, ['box', 'ellipse'] as const),
        });
        nodes.push(node);
    });
    const withLayer = nodes.filter((n) => n.layer).length;
    if (withLayer && withLayer < nodes.length) c.fail('input.nodes', 'give every node a layer, or none of them');

    let edges: DiagramEdge[] | undefined;
    if (input.edges !== undefined) {
        if (!Array.isArray(input.edges)) c.fail('input.edges', 'expected an array');
        else {
            if (input.edges.length > L.edges) c.fail('input.edges', `has more than ${L.edges} edges`);
            edges = [];
            input.edges.slice(0, L.edges).forEach((raw, i) => {
                const path = `input.edges[${i}]`;
                if (!isObj(raw)) return c.fail(path, 'expected an object');
                c.unknownKeys(raw, path, ['from', 'to', 'label', 'style']);
                for (const end of ['from', 'to'] as const) {
                    if (typeof raw[end] !== 'string' || !ids.has(raw[end] as string)) c.fail(`${path}.${end}`, 'expected the id of a node in this diagram');
                }
                if (raw.from === raw.to) c.fail(path, 'an edge cannot connect a node to itself');
                edges!.push(
                    clean({
                        from: raw.from as string,
                        to: raw.to as string,
                        label: short(c, raw, 'label', path, L.labelLength, false),
                        style: c.oneOf(raw, 'style', path, STROKE_STYLES),
                    }),
                );
            });
        }
    }
    if (c.errors.length > before) return undefined;
    return clean({ direction, nodes, edges, x, y });
}

/** A stroke's line: SVG path data in `d`, or `points` with an optional `closed`. Exactly one of the two. */
function parseLine(c: Checker, item: Obj, path: string): Pick<SketchStroke, 'd' | 'points' | 'closed'> | undefined {
    const L = LIMITS.sketch;
    if (item.d !== undefined && item.points !== undefined) {
        c.fail(path, 'give either d or points, not both');
        return undefined;
    }
    if (item.d === undefined && item.points === undefined) {
        c.fail(path, 'needs d (SVG path data) or points');
        return undefined;
    }
    if (item.d !== undefined) {
        if (item.closed !== undefined) c.fail(`${path}.closed`, 'only applies to points; close a path with Z');
        const d = c.text(item, 'd', path, true);
        if (d === undefined) return undefined;
        if (d.length > L.pathLength) {
            c.fail(`${path}.d`, `is longer than ${L.pathLength} characters; split it into several strokes`);
            return undefined;
        }
        return { d };
    }
    const before = c.errors.length;
    let closed: boolean | undefined;
    if (item.closed !== undefined) {
        if (typeof item.closed === 'boolean') closed = item.closed;
        else c.fail(`${path}.closed`, 'expected true or false');
    }
    const raw = item.points;
    if (!Array.isArray(raw) || raw.length < 2) {
        c.fail(`${path}.points`, 'expected at least 2 points, each [x, y]');
        return undefined;
    }
    if (raw.length > L.pointsPerStroke) {
        c.fail(`${path}.points`, `has more than ${L.pointsPerStroke} points`);
        return undefined;
    }
    if (closed && raw.length < 3) c.fail(`${path}.points`, 'a closed line needs at least 3 points');
    const points: [number, number][] = [];
    raw.forEach((p, i) => {
        const ok = Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMITS.coordinate);
        if (ok) points.push([p[0], p[1]]);
        else c.fail(`${path}.points[${i}]`, 'expected [x, y] with two numbers');
    });
    if (c.errors.length > before) return undefined;
    return clean({ points, closed });
}

function parseSketch(c: Checker, input: Obj): SketchInput | undefined {
    const before = c.errors.length;
    const L = LIMITS.sketch;
    c.unknownKeys(input, 'input', ['subject', 'width', 'height', 'parts', 'strokes', 'size', 'x', 'y']);
    const subject = short(c, input, 'subject', 'input', L.subjectLength, true);
    const width = c.number(input, 'width', 'input', { min: 1, max: 10000 });
    const height = c.number(input, 'height', 'input', { min: 1, max: 10000 });
    const size = c.number(input, 'size', 'input', L.size);
    const x = c.number(input, 'x', 'input');
    const y = c.number(input, 'y', 'input');
    const boxW = width ?? SKETCH_DEFAULTS.box;
    const boxH = height ?? SKETCH_DEFAULTS.box;

    const parts = new Map<string, SketchPart>();
    const partIndex = new Map<string, number>();
    const rawParts = c.array(input, 'parts', 'input') ?? [];
    if (rawParts.length > L.parts) c.fail('input.parts', `has more than ${L.parts} parts; group small details into one part`);
    rawParts.slice(0, L.parts).forEach((item, i) => {
        const path = `input.parts[${i}]`;
        if (!isObj(item)) return c.fail(path, 'expected an object');
        c.unknownKeys(item, path, ['name', 'on', 'x', 'y', 'w', 'h']);
        const name = short(c, item, 'name', path, L.partName, true);
        const on = short(c, item, 'on', path, L.partName, false);
        const box = {
            x: c.number(item, 'x', path, { required: true }),
            y: c.number(item, 'y', path, { required: true }),
            w: c.number(item, 'w', path, { required: true, min: 0.5 }),
            h: c.number(item, 'h', path, { required: true, min: 0.5 }),
        };
        if (name === undefined || box.x === undefined || box.y === undefined || box.w === undefined || box.h === undefined) return;
        if (parts.has(name)) return c.fail(`${path}.name`, `"${name}" is used by another part; give each part its own name`);
        const part: SketchPart = clean({ name, on, x: box.x, y: box.y, w: box.w, h: box.h });
        const slack = 0.05 * Math.max(boxW, boxH);
        if (part.x < -slack || part.y < -slack || part.x + part.w > boxW + slack || part.y + part.h > boxH + slack) {
            c.fail(path, `"${name}" (${area(part)}) is outside the ${boxW} × ${boxH} drawing box`);
        }
        parts.set(name, part);
        partIndex.set(name, i);
    });

    parts.forEach((p) => {
        if (p.on === undefined) return;
        const path = `input.parts[${partIndex.get(p.name)}].on`;
        if (p.on === p.name) c.fail(path, 'a part cannot be on itself');
        else if (!parts.has(p.on)) c.fail(path, `"${p.on}" is not one of the parts: ${[...parts.keys()].join(', ')}`);
    });

    const extent = Math.max(boxW, boxH);
    // Points along each part's strokes, for the attachment check below.
    const drawn = new Map<string, Pt[]>();
    const raw = c.array(input, 'strokes', 'input') ?? [];
    if (raw.length > L.strokes) c.fail('input.strokes', `has more than ${L.strokes} strokes`);
    let total = 0;
    const used = new Set<string>();
    const strokes: SketchStroke[] = [];
    raw.slice(0, L.strokes).forEach((item, i) => {
        const path = `input.strokes[${i}]`;
        if (!isObj(item)) return c.fail(path, 'expected an object');
        c.unknownKeys(item, path, ['part', 'd', 'points', 'closed', 'color', 'width']);
        const partName = short(c, item, 'part', path, L.partName, true);
        const part = partName === undefined ? undefined : parts.get(partName);
        if (partName !== undefined) {
            if (part) used.add(partName);
            else if (rawParts.length) c.fail(`${path}.part`, `"${partName}" is not one of the parts: ${[...parts.keys()].join(', ')}`);
        }
        const given = parseLine(c, item, path);
        if (given) {
            const field = given.d !== undefined ? `${path}.d` : `${path}.points`;
            const d = given.d ?? smoothPath(given.points!, given.closed);
            if (given.d !== undefined) total += d.length;
            try {
                const subpaths = parsePath(d);
                if (!subpaths.length) c.fail(field, 'draws nothing');
                else if (part) {
                    const points = subpaths.flatMap((sub) => samplePath(sub, extent / 100));
                    checkInside(c, field, points, part, extent);
                    drawn.set(part.name, [...(drawn.get(part.name) ?? []), ...points]);
                }
            } catch (e) {
                c.fail(field, `is not valid SVG path data: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        strokes.push(clean({ part: partName, ...given, color: c.color(item, 'color', path), width: c.number(item, 'width', path, L.width) }));
    });
    if (total > L.totalPathLength) c.fail('input.strokes', `has more than ${L.totalPathLength} characters of path data in total`);
    if (raw.length) {
        parts.forEach((p) => {
            if (!used.has(p.name)) c.fail(`input.parts[${partIndex.get(p.name)}]`, `"${p.name}" has no strokes; draw it or remove it from parts`);
        });
    }
    if (c.errors.length === before) checkAttached(c, parts, partIndex, drawn, extent);
    if (c.errors.length > before) return undefined;
    return clean({ subject, width, height, parts: [...parts.values()], strokes, size, x, y });
}

const r0 = (n: number) => Math.round(n);
const area = (p: SketchPart) => `x ${r0(p.x)}–${r0(p.x + p.w)}, y ${r0(p.y)}–${r0(p.y + p.h)}`;

/**
 * A stroke that wanders far from its part's box means the coordinates and the plan disagree, which
 * is how a tail ends up across the face. A little overshoot is fine: hand drawing is not exact.
 */
function checkInside(c: Checker, field: string, points: Pt[], part: SketchPart, extent: number) {
    const tolerance = 0.2 * Math.max(part.w, part.h) + 0.03 * extent;
    let worst = { d: 0, x: 0, y: 0 };
    for (const p of points) {
        const dx = Math.max(part.x - p.x, 0, p.x - (part.x + part.w));
        const dy = Math.max(part.y - p.y, 0, p.y - (part.y + part.h));
        const d = Math.hypot(dx, dy);
        if (d > worst.d) worst = { d, x: p.x, y: p.y };
    }
    if (worst.d > tolerance) {
        c.fail(
            field,
            `reaches (${r0(worst.x)}, ${r0(worst.y)}), outside part "${part.name}" (${area(part)}). ` +
                'Keep each stroke in its part, or fix the part\'s box if the plan was wrong.',
        );
    }
}

/**
 * A part said to be on another (a tail on the body, an ear on the head) has to be near it. A small
 * gap is closed when drawing (see `joinParts`); a large one means the plan put the part in the wrong
 * place, which the box check cannot see, so it goes back to the model. `on` must not go round in a loop.
 */
function checkAttached(c: Checker, parts: Map<string, SketchPart>, index: Map<string, number>, drawn: Map<string, Pt[]>, extent: number) {
    parts.forEach((part) => {
        if (part.on === undefined) return;
        const path = `input.parts[${index.get(part.name)}]`;
        const chain = [part.name];
        for (let p = parts.get(part.on); p; p = p.on === undefined ? undefined : parts.get(p.on)) {
            const looped = chain.includes(p.name);
            chain.push(p.name);
            if (looped) return c.fail(`${path}.on`, `goes round in a loop (${chain.join(' → ')}); the main part must have no "on"`);
        }
        const gap = nearest(drawn.get(part.name) ?? [], drawn.get(part.on) ?? []);
        if (!gap || gap.d <= JOIN.maxGap * extent) return;
        c.fail(
            path,
            `"${part.name}" is on "${part.on}" but is far from it: the closest points are (${r0(gap.from.x)}, ${r0(gap.from.y)}) and ` +
                `(${r0(gap.to.x)}, ${r0(gap.to.y)}), ${r0(gap.d)} units apart. Plan "${part.name}" where it joins "${part.on}" and start it on that outline.`,
        );
    });
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
        case 'add_diagram': {
            const diagram = parseDiagram(c, input);
            if (diagram) op = { op: name, diagram };
            break;
        }
        case 'draw_sketch': {
            const sketch = parseSketch(c, input);
            if (sketch) op = { op: name, sketch };
            break;
        }
    }
    return c.errors.length || !op ? { ok: false, errors: c.errors } : { ok: true, value: op };
}
