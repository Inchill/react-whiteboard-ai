import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { callModel, MAX_TOKENS, serviceName, type Target } from './modelRequest';

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

/**
 * The endpoint configured in .env.local, used when the page sends none of its own:
 * AI_BASE_URL, AI_API_KEY and AI_MODEL. Older files with DEEPSEEK_API_KEY or ANTHROPIC_API_KEY
 * (and AI_PROVIDER to choose between them) still work.
 */
function targetFromEnv(env: Record<string, string>): Target | null {
    if (env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL) return { baseUrl: env.AI_BASE_URL, key: env.AI_API_KEY, model: env.AI_MODEL };
    const legacy = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.DEEPSEEK_API_KEY ? 'deepseek' : '');
    if (legacy === 'deepseek' && env.DEEPSEEK_API_KEY) {
        return { baseUrl: 'https://api.deepseek.com/anthropic', key: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL || 'deepseek-flash' };
    }
    if (legacy === 'anthropic' && env.ANTHROPIC_API_KEY) {
        return { baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' };
    }
    return null;
}

const header = (req: IncomingMessage, name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** Settings entered on the page arrive in request headers and are used for this request only. */
function targetFromRequest(req: IncomingMessage): Target | null | 'incomplete' {
    const key = header(req, 'x-ai-key');
    if (!key) return null;
    const baseUrl = header(req, 'x-ai-base-url');
    const model = header(req, 'x-ai-model');
    return baseUrl && model ? { baseUrl, key, model } : 'incomplete';
}

/**
 * Dev-only proxy to the model API. Keys come from the page (per request) or from .env.local,
 * stay in this Node process and are never logged or stored.
 */
export function aiProxy(env: Record<string, string>): Plugin {
    const fallback = targetFromEnv(env);
    const maxTokens = Number(env.AI_MAX_TOKENS) > 0 ? Number(env.AI_MAX_TOKENS) : MAX_TOKENS;
    return {
        name: 'whiteboard-ai-proxy',
        configureServer(server) {
            const log = (message: string) => server.config.logger.info(`[whiteboard-ai] ${message}`, { timestamp: true });
            server.middlewares.use('/api/status', (_req, res) =>
                send(res, 200, fallback ? { service: serviceName(fallback.baseUrl), model: fallback.model } : null),
            );
            server.middlewares.use('/api/ai', async (req, res) => {
                if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
                const fromPage = targetFromRequest(req);
                if (fromPage === 'incomplete') return send(res, 400, { error: 'Set the endpoint, key and model in the settings panel.' });
                const target = fromPage ?? fallback;
                if (!target) return send(res, 501, { error: 'No model configured. Set one in the settings panel, or in .env.local.' });
                // Stop the upstream request when the page goes away or presses Stop.
                const abort = new AbortController();
                const started = Date.now();
                res.on('close', () => abort.abort());
                try {
                    const { messages } = JSON.parse(await readBody(req));
                    const label = `${serviceName(target.baseUrl)} ${target.model}`;
                    const upstream = await callModel(target, {
                        messages,
                        thinking: (header(req, 'x-ai-thinking') ?? env.AI_THINKING) === 'on',
                        maxTokens,
                        signal: abort.signal,
                        onRetry: () => log(`${label}: HTTP 400, retrying without the thinking setting`),
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
