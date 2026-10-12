import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { buildSystemPrompt } from '../src/prompts/system';
import { toAnthropicTools } from '../src/tools/schema';

const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });

/**
 * Dev-only proxy to the Anthropic Messages API. The key stays in this Node process
 * (read from .env.local) and never reaches the browser.
 */
export function aiProxy(env: Record<string, string>): Plugin {
    const key = env.ANTHROPIC_API_KEY;
    const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
    return {
        name: 'whiteboard-ai-proxy',
        configureServer(server) {
            server.middlewares.use('/api/status', (_req, res) => send(res, 200, { model: key ? model : null }));
            server.middlewares.use('/api/ai', async (req, res) => {
                if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
                if (!key) return send(res, 501, { error: 'Set ANTHROPIC_API_KEY in .env.local and restart pnpm dev.' });
                try {
                    const { messages } = JSON.parse(await readBody(req));
                    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                        body: JSON.stringify({ model, max_tokens: 4096, system: buildSystemPrompt(), tools: toAnthropicTools(), messages }),
                    });
                    send(res, upstream.status, await upstream.text());
                } catch (e) {
                    send(res, 502, { error: e instanceof Error ? e.message : String(e) });
                }
            });
        },
    };
}
