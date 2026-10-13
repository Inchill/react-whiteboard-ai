/**
 * OpenAI-compatible Chat Completions, spoken through the Anthropic shapes the rest of the demo uses.
 * Company gateways (one-api, new-api, LiteLLM, Azure and the like) usually offer only this format.
 *
 * Requests: the conversation (Anthropic messages with tool_use / tool_result blocks) becomes chat
 * messages with tool_calls and tool messages. Replies: the streamed chunks become Anthropic
 * Messages events (content_block_start / _delta / _stop, message_delta), so the stream reader, the
 * dev proxy's tally and the page do not need to know which format the model spoke.
 */

type Block = Record<string, unknown> & { type?: string };
type AnthropicMessage = { role: string; content: string | Block[] };

export type ChatMessage =
    | { role: 'system' | 'user'; content: string }
    | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
    | { role: 'tool'; tool_call_id: string; content: string };

/** "https://host/v1", "https://host" or a full ".../chat/completions" URL. */
export function chatCompletionsUrl(baseUrl: string): string {
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) return base;
    return /\/v\d+[a-z]*$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

const textOf = (content: unknown): string =>
    typeof content === 'string'
        ? content
        : Array.isArray(content)
            ? content.map((b: Block) => (b?.type === 'text' ? String(b.text ?? '') : '')).join('')
            : JSON.stringify(content ?? '');

/** The system prompt and an Anthropic conversation as chat messages. Thinking blocks are dropped. */
export function toChatMessages(system: string, messages: unknown[]): ChatMessage[] {
    const out: ChatMessage[] = [{ role: 'system', content: system }];
    for (const raw of messages as AnthropicMessage[]) {
        if (typeof raw.content === 'string') {
            out.push(raw.role === 'assistant' ? { role: 'assistant', content: raw.content } : { role: 'user', content: raw.content });
            continue;
        }
        const blocks = raw.content ?? [];
        if (raw.role === 'assistant') {
            const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('');
            const calls = blocks
                .filter((b) => b.type === 'tool_use')
                .map((b) => ({ id: String(b.id), type: 'function' as const, function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
            out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
        } else {
            // Tool results answer the previous assistant turn's calls, so they come first.
            for (const b of blocks.filter((b) => b.type === 'tool_result')) {
                const content = textOf(b.content);
                out.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: b.is_error ? `Error: ${content}` : content });
            }
            const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n');
            if (text) out.push({ role: 'user', content: text });
        }
    }
    return out;
}

const STOP_REASONS: Record<string, string> = { stop: 'end_turn', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

type Chunk = {
    choices?: {
        delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string | null;
    }[];
    error?: { message?: string };
};

/**
 * Turns a Chat Completions event stream into an Anthropic Messages event stream. Text and reasoning
 * blocks close when something else starts; tool calls stay open until the end, because some
 * services interleave the arguments of parallel calls.
 */
export function toAnthropicStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';
    let next = 0;
    let open: { index: number; kind: 'text' | 'thinking' } | null = null;
    const tools = new Map<number, number>(); // OpenAI tool call index → block index
    let stopReason: string | null = null;
    let finished = false;

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
            const closeOpen = () => {
                if (open) emit({ type: 'content_block_stop', index: open.index });
                open = null;
            };
            const streamInto = (kind: 'text' | 'thinking', text: string) => {
                if (open?.kind !== kind) {
                    closeOpen();
                    open = { index: next++, kind };
                    emit({ type: 'content_block_start', index: open.index, content_block: kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' } });
                }
                emit({ type: 'content_block_delta', index: open.index, delta: kind === 'text' ? { type: 'text_delta', text } : { type: 'thinking_delta', thinking: text } });
            };
            const finish = () => {
                if (finished) return;
                finished = true;
                closeOpen();
                for (const index of tools.values()) emit({ type: 'content_block_stop', index });
                emit({ type: 'message_delta', delta: { stop_reason: stopReason ?? (tools.size ? 'tool_use' : 'end_turn') } });
                emit({ type: 'message_stop' });
            };
            const handle = (chunk: Chunk) => {
                if (chunk.error) {
                    emit({ type: 'error', error: { type: 'api_error', message: chunk.error.message ?? 'The model stream reported an error.' } });
                    return;
                }
                for (const choice of chunk.choices ?? []) {
                    const d = choice.delta ?? {};
                    const reasoning = d.reasoning_content ?? d.reasoning;
                    if (reasoning) streamInto('thinking', reasoning);
                    if (d.content) streamInto('text', d.content);
                    for (const call of d.tool_calls ?? []) {
                        const key = call.index ?? 0;
                        let index = tools.get(key);
                        if (index === undefined) {
                            closeOpen();
                            index = next++;
                            tools.set(key, index);
                            emit({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id ?? `call_${key}`, name: call.function?.name ?? '', input: {} } });
                        }
                        if (call.function?.arguments) emit({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: call.function.arguments } });
                    }
                    if (choice.finish_reason) stopReason = STOP_REASONS[choice.finish_reason] ?? choice.finish_reason;
                }
            };

            emit({ type: 'message_start', message: { type: 'message', role: 'assistant', content: [] } });
            const reader = body.getReader();
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    buffer += decoder.decode(value, { stream: !done });
                    const events = buffer.split(/\r?\n\r?\n/);
                    buffer = done ? '' : (events.pop() ?? '');
                    for (const raw of events) {
                        const data = raw
                            .split(/\r?\n/)
                            .filter((line) => line.startsWith('data:'))
                            .map((line) => line.slice(5).trimStart())
                            .join('\n');
                        if (!data) continue;
                        if (data === '[DONE]') {
                            finish();
                            continue;
                        }
                        try {
                            handle(JSON.parse(data) as Chunk);
                        } catch {
                            /* not JSON: a keep-alive or comment */
                        }
                    }
                    if (done) break;
                }
                finish();
                controller.close();
            } catch (err) {
                controller.error(err);
            }
        },
    });
}

type Completion = {
    choices?: {
        message?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string | null;
    }[];
};

/** A complete (non-streamed) completion as an Anthropic Messages response body. */
export function toAnthropicMessage(data: Completion): { content: Block[]; stop_reason: string } {
    const choice = data.choices?.[0];
    const m = choice?.message ?? {};
    const content: Block[] = [];
    if (m.reasoning_content) content.push({ type: 'thinking', thinking: m.reasoning_content, signature: '' });
    if (m.content) content.push({ type: 'text', text: m.content });
    (m.tool_calls ?? []).forEach((call, i) => {
        let input: unknown = {};
        try {
            input = JSON.parse(call.function?.arguments || '{}');
        } catch {
            input = call.function?.arguments ?? '';
        }
        content.push({ type: 'tool_use', id: call.id ?? `call_${i}`, name: call.function?.name ?? '', input });
    });
    const reason = choice?.finish_reason ?? '';
    return { content, stop_reason: STOP_REASONS[reason] ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn') };
}
