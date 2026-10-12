import { LIMITS } from './validate';
import type { OperationName } from '../types';

/** A provider-neutral tool definition: a name, a description and a JSON Schema for the input. */
export type ToolDefinition = {
    name: OperationName;
    description: string;
    inputSchema: Record<string, unknown>;
};

const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'number', description, ...extra });
const color = { type: 'string', description: '"ink" (theme foreground, the default) or a hex color such as "#e03131".' };
const strokeWidth = num('Stroke width in world units. Default 2.', { minimum: LIMITS.strokeWidth.min, maximum: LIMITS.strokeWidth.max });
const strokeStyle = { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Default "solid".' };
const fill = { type: 'string', enum: ['none', 'semi', 'solid'], description: 'Fill with the shape color: none, translucent or opaque. Default "none".' };
const fontSize = num('Font size in world units. Default 20.', { minimum: LIMITS.fontSize.min, maximum: LIMITS.fontSize.max });

const boxShape = {
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['rect', 'ellipse', 'triangle'] },
        x: num('Left edge.'),
        y: num('Top edge.'),
        w: num('Width.', { minimum: 1 }),
        h: num('Height.', { minimum: 1 }),
        fill,
        color,
        strokeWidth,
        strokeStyle,
    },
    required: ['type', 'x', 'y', 'w', 'h'],
    additionalProperties: false,
};

const linearShape = {
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['line', 'arrow'], description: 'An arrow points from (x1, y1) to (x2, y2).' },
        x1: num('Start x.'),
        y1: num('Start y.'),
        x2: num('End x.'),
        y2: num('End y.'),
        color,
        strokeWidth,
        strokeStyle,
    },
    required: ['type', 'x1', 'y1', 'x2', 'y2'],
    additionalProperties: false,
};

const textShape = {
    type: 'object',
    properties: {
        type: { type: 'string', enum: ['text'] },
        x: num('Left edge of the first line.'),
        y: num('Top edge of the first line.'),
        text: { type: 'string', description: 'Use \\n for line breaks.', maxLength: LIMITS.textLength },
        fontSize,
        color,
    },
    required: ['type', 'x', 'y', 'text'],
    additionalProperties: false,
};

const D = LIMITS.diagram;

const diagramTool: ToolDefinition = {
    name: 'add_diagram',
    description:
        'Draw a diagram of boxes joined by arrows: flowcharts, architecture or layer diagrams, org charts, trees, state machines, pipelines. ' +
        'Give only the structure. Layout, box sizes, alignment, colors and arrow routing are automatic, the result is placed next to ' +
        'existing content, and it stays editable. Prefer this over add_shapes whenever the picture is nodes and links.',
    inputSchema: {
        type: 'object',
        properties: {
            direction: { type: 'string', enum: ['down', 'right'], description: 'down: top to bottom (default). right: left to right, for pipelines and timelines.' },
            nodes: {
                type: 'array',
                minItems: 1,
                maxItems: D.nodes,
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', maxLength: D.idLength, description: 'Short id used by edges, e.g. "gateway".' },
                        label: { type: 'string', maxLength: D.labelLength, description: 'Text in the box. Keep it short; use \\n for a second line.' },
                        layer: {
                            type: 'string',
                            maxLength: D.idLength,
                            description:
                                'Optional row name, e.g. "服务层". Give every node a layer or none. With layers, rows follow first use and get a labeled band; ' +
                                'without, rows follow the arrows.',
                        },
                        color,
                        shape: { type: 'string', enum: ['box', 'ellipse'], description: 'ellipse for start and end points of a flow. Default box.' },
                    },
                    required: ['id', 'label'],
                    additionalProperties: false,
                },
            },
            edges: {
                type: 'array',
                maxItems: D.edges,
                items: {
                    type: 'object',
                    properties: {
                        from: { type: 'string', description: 'Node id.' },
                        to: { type: 'string', description: 'Node id.' },
                        label: { type: 'string', maxLength: D.labelLength, description: 'Optional short text on the arrow, e.g. "是" / "否".' },
                        style: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
                    },
                    required: ['from', 'to'],
                    additionalProperties: false,
                },
            },
            x: num('Optional left edge. Omit to place it beside existing content.'),
            y: num('Optional top edge.'),
        },
        required: ['nodes'],
        additionalProperties: false,
    },
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
    diagramTool,
    {
        name: 'add_shapes',
        description:
            'Add shapes to the whiteboard. Coordinates are world units: x grows right, y grows down. ' +
            'Place new content where it does not overlap existing shapes unless the user asks for that.',
        inputSchema: {
            type: 'object',
            properties: {
                shapes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: LIMITS.itemsPerOperation,
                    items: { anyOf: [boxShape, linearShape, textShape] },
                },
            },
            required: ['shapes'],
            additionalProperties: false,
        },
    },
    {
        name: 'update_shapes',
        description:
            'Change existing shapes by id. Use dx/dy to move any shape, including freehand strokes. ' +
            'Only set fields that apply to the shape: fill and x/y/w/h for rect, ellipse and triangle; ' +
            'x1/y1/x2/y2 for line and arrow; text and fontSize for text.',
        inputSchema: {
            type: 'object',
            properties: {
                updates: {
                    type: 'array',
                    minItems: 1,
                    maxItems: LIMITS.itemsPerOperation,
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Id of an existing shape.' },
                            dx: num('Move right by this amount (negative moves left).'),
                            dy: num('Move down by this amount (negative moves up).'),
                            color,
                            strokeWidth,
                            strokeStyle,
                            fill,
                            x: num('New left edge.'),
                            y: num('New top edge.'),
                            w: num('New width.', { minimum: 1 }),
                            h: num('New height.', { minimum: 1 }),
                            x1: num('New start x.'),
                            y1: num('New start y.'),
                            x2: num('New end x.'),
                            y2: num('New end y.'),
                            text: { type: 'string', maxLength: LIMITS.textLength },
                            fontSize,
                        },
                        required: ['id'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['updates'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_shapes',
        description: 'Delete shapes by id.',
        inputSchema: {
            type: 'object',
            properties: {
                ids: { type: 'array', minItems: 1, maxItems: LIMITS.itemsPerOperation, items: { type: 'string' } },
            },
            required: ['ids'],
            additionalProperties: false,
        },
    },
];

/** Tool list for the Anthropic Messages API (`tools` parameter). */
export const toAnthropicTools = (tools: ToolDefinition[] = TOOL_DEFINITIONS) =>
    tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

/** Tool list for OpenAI-compatible Chat Completions APIs (`tools` parameter). */
export const toOpenAITools = (tools: ToolDefinition[] = TOOL_DEFINITIONS) =>
    tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
