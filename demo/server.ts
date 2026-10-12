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

type Provider = { name: string; url: string; key: string; model: string };

/**
 * Pick the model provider from .env.local. Both speak the Anthropic Messages format:
 * DeepSeek offers a compatible endpoint, so tool calls work the same way.
 */
function resolveProvider(env: Record<string, string>): Provider | null {
    const wanted = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.DEEPSEEK_API_KEY ? 'deepseek' : '');
    if (wanted === 'deepseek' && env.DEEPSEEK_API_KEY) {
        return {
            name: 'deepseek',
            url: 'https://api.deepseek.com/anthropic/v1/messages',
            key: env.DEEPSEEK_API_KEY,
            model: env.DEEPSEEK_MODEL || 'deepseek-flash',
        };
    }
    if (wanted === 'anthropic' && env.ANTHROPIC_API_KEY) {
        return {
            name: 'anthropic',
            url: `${(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
            key: env.ANTHROPIC_API_KEY,
            model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        };
    }
    return null;
}

/**
 * Dev-only proxy to the model API. The key stays in this Node process
 * (read from .env.local) and never reaches the browser.
 */
export function aiProxy(env: Record<string, string>): Plugin {
    const provider = resolveProvider(env);
    return {
        name: 'whiteboard-ai-proxy',
        configureServer(server) {
            server.middlewares.use('/api/status', (_req, res) =>
                send(res, 200, { model: provider ? `${provider.name} · ${provider.model}` : null }),
            );
            server.middlewares.use('/api/ai', async (req, res) => {
                if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
                if (!provider) return send(res, 501, { error: 'Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY in .env.local and restart pnpm dev.' });
                try {
                    const { messages } = JSON.parse(await readBody(req));
                    const upstream = await fetch(provider.url, {
                        method: 'POST',
                        headers: { 'x-api-key': provider.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                        body: JSON.stringify({ model: provider.model, max_tokens: 4096, system: buildSystemPrompt(), tools: toAnthropicTools(), messages }),
                    });
                    send(res, upstream.status, await upstream.text());
                } catch (e) {
                    send(res, 502, { error: e instanceof Error ? e.message : String(e) });
                }
            });
        },
    };
}
