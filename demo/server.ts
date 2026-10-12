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

export type ProviderName = 'anthropic' | 'deepseek';
type Provider = { name: ProviderName; url: string; key: string; model: string };

/**
 * Both providers speak the Anthropic Messages format: DeepSeek offers a compatible
 * endpoint, so tool calls work the same way and the page needs no per-provider code.
 */
function makeProvider(name: ProviderName, key: string, model?: string, baseUrl?: string): Provider {
    if (name === 'deepseek') {
        return { name, key, url: 'https://api.deepseek.com/anthropic/v1/messages', model: model || 'deepseek-flash' };
    }
    const base = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    return { name, key, url: `${base}/v1/messages`, model: model || 'claude-sonnet-5-5' };
}

/** The provider configured in .env.local, used when the page sends no key of its own. */
function providerFromEnv(env: Record<string, string>): Provider | null {
    const wanted = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.DEEPSEEK_API_KEY ? 'deepseek' : '');
    if (wanted === 'deepseek' && env.DEEPSEEK_API_KEY) return makeProvider('deepseek', env.DEEPSEEK_API_KEY, env.DEEPSEEK_MODEL);
    if (wanted === 'anthropic' && env.ANTHROPIC_API_KEY) {
        return makeProvider('anthropic', env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL, env.ANTHROPIC_BASE_URL);
    }
    return null;
}

const header = (req: IncomingMessage, name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** A key entered on the page arrives in request headers; it is used for this request only. */
function providerFromRequest(req: IncomingMessage): Provider | null | 'invalid' {
    const key = header(req, 'x-ai-key');
    if (!key) return null;
    const name = header(req, 'x-ai-provider');
    if (name !== 'anthropic' && name !== 'deepseek') return 'invalid';
    return makeProvider(name, key, header(req, 'x-ai-model'));
}

/**
 * Dev-only proxy to the model API. Keys come from the page (per request) or from .env.local,
 * stay in this Node process and are never logged or stored.
 */
export function aiProxy(env: Record<string, string>): Plugin {
    const fallback = providerFromEnv(env);
    return {
        name: 'whiteboard-ai-proxy',
        configureServer(server) {
            server.middlewares.use('/api/status', (_req, res) =>
                send(res, 200, fallback ? { provider: fallback.name, model: fallback.model } : null),
            );
            server.middlewares.use('/api/ai', async (req, res) => {
                if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
                const fromPage = providerFromRequest(req);
                if (fromPage === 'invalid') return send(res, 400, { error: 'Unknown provider.' });
                const provider = fromPage ?? fallback;
                if (!provider) return send(res, 501, { error: 'No API key. Add one in the settings panel, or in .env.local.' });
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
