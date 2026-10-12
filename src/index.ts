export { describeBoard, summarizeShape } from './context/describe';
export type { BoardDescription, DescribeOptions, ShapeSummary } from './context/describe';

export { TOOL_DEFINITIONS, toAnthropicTools, toOpenAITools } from './tools/schema';
export type { ToolDefinition } from './tools/schema';
export { parseOperation, LIMITS, OPERATION_NAMES } from './tools/validate';
export type { ParseResult } from './tools/validate';

export { INK } from './types';
export type { Operation, OperationName, ShapeInput, ShapePatch, BoxInput, LinearInput, TextInput, StyleInput } from './types';
