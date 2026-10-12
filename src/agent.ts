import type { WhiteboardHandle } from '@inchill/react-whiteboard';
import { describeBoard, type BoardDescription, type DescribeOptions } from './context/describe';
import { executeToolCalls, type ApplyOptions, type ToolCall, type ToolCallResult } from './executor/apply';

type HandleSource = { current: WhiteboardHandle | null } | (() => WhiteboardHandle | null);

export type WhiteboardAgent = {
    /** Describe the current board for the model. Returns null when the board is not mounted. */
    describe: (options?: DescribeOptions) => BoardDescription | null;
    /**
     * Validate and apply one model turn of tool calls. All changes land as a single undo step,
     * so the user can take back everything the model did with one Ctrl+Z.
     */
    execute: (calls: ToolCall[]) => ToolCallResult[];
};

/** Connect to a mounted `<Whiteboard ref={...} />`. Framework-free; see `useWhiteboardAI` for React. */
export function createWhiteboardAgent(source: HandleSource, options: ApplyOptions = {}): WhiteboardAgent {
    const handle = () => (typeof source === 'function' ? source() : source.current);
    return {
        describe(describeOptions) {
            const board = handle();
            return board ? describeBoard(board.getShapes(), describeOptions) : null;
        },
        execute(calls) {
            const board = handle();
            if (!board) {
                return calls.map((c) => ({ id: c.id, name: c.name, ok: false, created: [], updated: [], deleted: [], errors: ['whiteboard is not mounted'] }));
            }
            const before = board.getShapes();
            const { shapes, results } = executeToolCalls(before, calls, options);
            if (shapes !== before) board.setShapes(shapes);
            return results;
        },
    };
}
