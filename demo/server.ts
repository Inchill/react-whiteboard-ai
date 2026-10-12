import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { callModel, MAX_TOKENS, modelOf, type ProviderName, type Target } from './modelRequest';

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
 * Counts event and delta types in a relayed stream, so the terminal shows what the model sent
 * (never its content): e.g. "first event after 420 ms, 63 events: thinking_delta×40, text_delta×12".
 */
class EventTally {
    private counts = new Map<string, number>();
    private first = 0;
    private rest = '';
    private decoder = new TextDecoder();
    constructor(private started: number) {}

    add(chunk: Uint8Array) {
        if (!this.first) this.first = Date.now() - this.started;
        const lines = (this.rest + this.decoder.decode(chunk, { stream: true })).split('\n');
        this.rest = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const kind = /"delta":\{"type":"([a-z_]+)"/.exec(line)?.[1] ?? /"type":"([a-z_]+)"/.exec(line)?.[1] ?? 'unknown';
            this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
        }
    }

    summary() {
        const total = [...this.counts.values()].reduce((a, b) => a + b, 0);
        const parts = [...this.counts].map(([k, n]) => `${k}×${n}`).join(', ');
        return `first event after ${this.first} ms, ${total} events in ${Date.now() - this.started} ms: ${parts || 'none'}`;
    }
}

type Provider = Target & { name: ProviderName };

/** The provider configured in .env.local, used when the page sends no key of its own. */
function providerFromEnv(env: Record<string, string>): Provider | null {
    const wanted = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.DEEPSEEK_API_KEY ? 'deepseek' : '');
    if (wanted === 'deepseek' && env.DEEPSEEK_API_KEY) {
        return { name: 'deepseek', provider: 'deepseek', key: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL };
    }
    if (wanted === 'anthropic' && env.ANTHROPIC_API_KEY) {
        return { name: 'anthropic', provider: 'anthropic', key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, baseUrl: env.ANTHROPIC_BASE_URL };
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
    return { name, provider: name, key, model: header(req, 'x-ai-model'), baseUrl: header(req, 'x-ai-base-url') };
}

/**
 * Dev-only proxy to the model API. Keys come from the page (per request) or from .env.local,
 * stay in this Node process and are never logged or stored.
 */
export function aiProxy(env: Record<string, string>): Plugin {
    const fallback = providerFromEnv(env);
    const maxTokens = Number(env.AI_MAX_TOKENS) > 0 ? Number(env.AI_MAX_TOKENS) : MAX_TOKENS;
    return {
        name: 'whiteboard-ai-proxy',
        configureServer(server) {
            const log = (message: string) => server.config.logger.info(`[whiteboard-ai] ${message}`, { timestamp: true });
            server.middlewares.use('/api/status', (_req, res) =>
                send(res, 200, fallback ? { provider: fallback.name, model: modelOf(fallback) } : null),
            );
            server.middlewares.use('/api/ai', async (req, res) => {
                if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
                const fromPage = providerFromRequest(req);
                if (fromPage === 'invalid') return send(res, 400, { error: 'Unknown provider.' });
                const provider = fromPage ?? fallback;
                if (!provider) return send(res, 501, { error: 'No API key. Add one in the settings panel, or in .env.local.' });
                // Stop the upstream request when the page goes away or presses Stop.
                const abort = new AbortController();
                const started = Date.now();
                res.on('close', () => abort.abort());
                try {
                    const { messages } = JSON.parse(await readBody(req));
                    const label = `${provider.name} ${modelOf(provider)}`;
                    const upstream = await callModel(provider, {
                        messages,
                        thinking: (header(req, 'x-ai-thinking') ?? env.AI_THINKING) === 'on',
                        maxTokens,
                        signal: abort.signal,
                        onRetry: () => log(`${label}: rejected the thinking setting, retrying without it`),
                    });
                    const type = upstream.headers.get('content-type') ?? '';
                    if (!upstream.ok || !upstream.body || !type.includes('text/event-stream')) {
                        log(`${label}: HTTP ${upstream.status}, ${type || 'no content type'} (not streamed)`);
                        return send(res, upstream.status, await upstream.text());
                    }
                    // Relay the server-sent events as they arrive.
                    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
                    const reader = upstream.body.getReader();
                    const tally = new EventTally(started);
                    for (let r = await reader.read(); !r.done; r = await reader.read()) {
                        tally.add(r.value);
                        res.write(r.value);
                    }
                    res.end();
                    log(`${label}: ${tally.summary()}`);
                } catch (e) {
                    if (abort.signal.aborted) return res.end();
                    if (res.headersSent) return res.end();
                    send(res, 502, { error: e instanceof Error ? e.message : String(e) });
                }
            });
        },
    };
}
