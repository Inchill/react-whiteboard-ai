import { useMemo, type RefObject } from 'react';
import type { WhiteboardHandle } from '@inchill/react-whiteboard';
import { createWhiteboardAgent, type WhiteboardAgent } from '../agent';

/**
 * React binding for `createWhiteboardAgent`.
 *
 * ```tsx
 * const board = useRef<WhiteboardHandle>(null);
 * const ai = useWhiteboardAI(board);
 * // send ai.describe() to your backend, then: ai.execute(toolCalls)
 * <Whiteboard ref={board} />
 * ```
 */
export function useWhiteboardAI(ref: RefObject<WhiteboardHandle | null>): WhiteboardAgent {
    return useMemo(() => createWhiteboardAgent(ref), [ref]);
}
