import { describe, expect, it } from 'vitest';
import { chatCompletionsUrl, toAnthropicMessage, toAnthropicStream, toChatMessages } from '../demo/openai';
import { readMessageStream } from '../demo/stream';

const sse = (chunks: unknown[], done = true) =>
    new ReadableStream<Uint8Array>({
        start(c) {
            const enc = new TextEncoder();
            for (const chunk of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            if (done) c.enqueue(enc.encode('data: [DONE]\n\n'));
            c.close();
        },
    });

describe('chatCompletionsUrl', () => {
    it('accepts a host, a /v1 base or the full URL', () => {
        expect(chatCompletionsUrl('https://gw.corp/')).toBe('https://gw.corp/v1/chat/completions');
        expect(chatCompletionsUrl('https://gw.corp/openai/v1')).toBe('https://gw.corp/openai/v1/chat/completions');
        expect(chatCompletionsUrl('https://gw.corp/api/v3/chat/completions')).toBe('https://gw.corp/api/v3/chat/completions');
    });
});

describe('toChatMessages', () => {
    it('turns tool_use and tool_result blocks into tool calls and tool messages, dropping thinking', () => {
        const out = toChatMessages('SYS', [
            { role: 'user', content: 'draw a box' },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'hmm', signature: '' },
                    { type: 'text', text: 'Sure.' },
                    { type: 'tool_use', id: 't1', name: 'add_shapes', input: { shapes: [] } },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
                    { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'bad' }], is_error: true },
                    { type: 'text', text: 'Continue.' },
                ],
            },
        ]);
        expect(out).toEqual([
            { role: 'system', content: 'SYS' },
            { role: 'user', content: 'draw a box' },
            { role: 'assistant', content: 'Sure.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'add_shapes', arguments: '{"shapes":[]}' } }] },
            { role: 'tool', tool_call_id: 't1', content: 'ok' },
            { role: 'tool', tool_call_id: 't2', content: 'Error: bad' },
            { role: 'user', content: 'Continue.' },
        ]);
    });
});

describe('toAnthropicStream', () => {
    it('rebuilds reasoning, text and streamed tool calls', async () => {
        const stream = toAnthropicStream(
            sse([
                { choices: [{ delta: { reasoning_content: 'think ' } }] },
                { choices: [{ delta: { reasoning_content: 'more' } }] },
                { choices: [{ delta: { content: 'Drawing.' } }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_shapes', arguments: '{"sha' } }] } }] },
                { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'clear', arguments: '{}' } }] } }] },
                // The first call's arguments continue after the second call started.
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'pes":[]}' } }] } }] },
                { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
            ]),
        );
        const m = await readMessageStream(stream, () => {});
        expect(m.stopReason).toBe('tool_use');
        expect(m.blocks).toEqual([
            { type: 'thinking', thinking: 'think more', signature: '' },
            { type: 'text', text: 'Drawing.' },
            { type: 'tool_use', id: 'c1', name: 'add_shapes', partialJson: '{"shapes":[]}', input: { shapes: [] }, done: true },
            { type: 'tool_use', id: 'c2', name: 'clear', partialJson: '{}', input: {}, done: true },
        ]);
    });

    it('finishes a stream that ends without [DONE], and passes errors on', async () => {
        const m = await readMessageStream(toAnthropicStream(sse([{ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }], false)), () => {});
        expect(m).toEqual({ blocks: [{ type: 'text', text: 'hi' }], stopReason: 'end_turn' });
        await expect(readMessageStream(toAnthropicStream(sse([{ error: { message: 'quota exceeded' } }])), () => {})).rejects.toThrow('quota exceeded');
    });
});

describe('toAnthropicMessage', () => {
    it('converts a complete answer', () => {
        expect(
            toAnthropicMessage({
                choices: [{ message: { content: 'ok', tool_calls: [{ id: 'c1', function: { name: 'clear', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
            }),
        ).toEqual({
            content: [
                { type: 'text', text: 'ok' },
                { type: 'tool_use', id: 'c1', name: 'clear', input: {} },
            ],
            stop_reason: 'tool_use',
        });
    });
});
