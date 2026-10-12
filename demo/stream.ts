/**
 * Reads an Anthropic Messages API event stream (also served by DeepSeek's compatible endpoint)
 * and rebuilds the message as it arrives, so the page can show text and tool calls while the
 * model is still writing them.
 */

export type LiveBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; partialJson: string; input?: unknown; done: boolean }
    | { type: 'thinking'; thinking: string; signature: string }
    | { type: 'other'; raw: Record<string, unknown> };

export type LiveMessage = { blocks: LiveBlock[]; stopReason: string | null };

type Event = { type?: string; index?: number; content_block?: Record<string, unknown>; delta?: Record<string, unknown>; error?: { message?: string } };

function startBlock(cb: Record<string, unknown>): LiveBlock {
    switch (cb.type) {
        case 'text':
            return { type: 'text', text: String(cb.text ?? '') };
        case 'tool_use': {
            // Some compatible endpoints send the whole input here instead of streaming it in deltas.
            const full = cb.input && typeof cb.input === 'object' && Object.keys(cb.input).length ? cb.input : undefined;
            return { type: 'tool_use', id: String(cb.id), name: String(cb.name), partialJson: full ? JSON.stringify(full) : '', done: false };
        }
        case 'thinking':
            return { type: 'thinking', thinking: String(cb.thinking ?? ''), signature: String(cb.signature ?? '') };
        default:
            return { type: 'other', raw: cb };
    }
}

function applyDelta(block: LiveBlock, delta: Record<string, unknown>): LiveBlock {
    if (block.type === 'text' && delta.type === 'text_delta') return { ...block, text: block.text + String(delta.text ?? '') };
    if (block.type === 'tool_use' && delta.type === 'input_json_delta') return { ...block, partialJson: block.partialJson + String(delta.partial_json ?? '') };
    if (block.type === 'thinking' && delta.type === 'thinking_delta') return { ...block, thinking: block.thinking + String(delta.thinking ?? '') };
    if (block.type === 'thinking' && delta.type === 'signature_delta') return { ...block, signature: block.signature + String(delta.signature ?? '') };
    return block;
}

function finishBlock(block: LiveBlock): LiveBlock {
    if (block.type !== 'tool_use') return block;
    let input: unknown = {};
    if (block.partialJson.trim()) {
        try {
            input = JSON.parse(block.partialJson);
        } catch {
            // Leave it unparsable: validation reports it back to the model like any other bad input.
            input = block.partialJson;
        }
    }
    return { ...block, input, done: true };
}

/** Parse one server-sent event; returns null for comments, pings and keep-alives. */
function parseEvent(chunk: string): Event | null {
    const data = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
    if (!data || data === '[DONE]') return null;
    try {
        return JSON.parse(data) as Event;
    } catch {
        return null;
    }
}

export async function readMessageStream(body: ReadableStream<Uint8Array>, onUpdate: (m: LiveMessage) => void): Promise<LiveMessage> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let message: LiveMessage = { blocks: [], stopReason: null };

    const handle = (ev: Event) => {
        switch (ev.type) {
            case 'content_block_start': {
                const blocks = message.blocks.slice();
                blocks[ev.index ?? blocks.length] = startBlock(ev.content_block ?? {});
                message = { ...message, blocks };
                break;
            }
            case 'content_block_delta': {
                const i = ev.index ?? message.blocks.length - 1;
                if (!message.blocks[i] || !ev.delta) return;
                const blocks = message.blocks.slice();
                blocks[i] = applyDelta(blocks[i], ev.delta);
                message = { ...message, blocks };
                break;
            }
            case 'content_block_stop': {
                const i = ev.index ?? message.blocks.length - 1;
                if (!message.blocks[i]) return;
                const blocks = message.blocks.slice();
                blocks[i] = finishBlock(blocks[i]);
                message = { ...message, blocks };
                break;
            }
            case 'message_delta':
                message = { ...message, stopReason: String(ev.delta?.stop_reason ?? message.stopReason) };
                break;
            case 'error':
                throw new Error(ev.error?.message ?? 'The model stream reported an error.');
            default:
                return;
        }
        onUpdate(message);
    };

    for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = done ? '' : (events.pop() ?? '');
        for (const raw of events) {
            const ev = parseEvent(raw);
            if (ev) handle(ev);
        }
        if (done) break;
    }
    // A stream cut short still yields usable tool calls for the blocks that finished.
    message = { ...message, blocks: message.blocks.filter(Boolean).map((b) => (b.type === 'tool_use' && !b.done ? finishBlock(b) : b)) };
    return message;
}

/** Build the same result from a complete, non-streamed Messages API response. */
export function fromCompleteMessage(data: { content?: Record<string, unknown>[]; stop_reason?: string }): LiveMessage {
    const blocks = (data.content ?? []).map((cb) => finishBlock(startBlock(cb)));
    return { blocks, stopReason: data.stop_reason ?? null };
}

/** The assistant turn to send back to the model in the next request. */
export function toAssistantContent(m: LiveMessage): unknown[] {
    return m.blocks.map((b) => {
        switch (b.type) {
            case 'text':
                return { type: 'text', text: b.text };
            case 'tool_use':
                return { type: 'tool_use', id: b.id, name: b.name, input: typeof b.input === 'object' && b.input !== null ? b.input : {} };
            case 'thinking':
                return { type: 'thinking', thinking: b.thinking, signature: b.signature };
            default:
                return b.raw;
        }
    });
}

/** Rough progress from a half-written tool input, e.g. how many shapes the model has written so far. */
export function countSoFar(name: string, partialJson: string): number {
    const patterns: Record<string, RegExp> = {
        add_shapes: /"type"\s*:/g,
        update_shapes: /"id"\s*:/g,
        add_diagram: /"id"\s*:/g,
        draw_sketch: /"d"\s*:/g,
    };
    const pattern = patterns[name] ?? /"[^"]+"\s*[,\]]/g;
    return partialJson.match(pattern)?.length ?? 0;
}
