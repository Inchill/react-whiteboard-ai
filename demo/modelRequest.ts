import { buildSystemPrompt } from '../src/prompts/system';
import { toAnthropicTools, toOpenAITools } from '../src/tools/schema';
import { chatCompletionsUrl, toAnthropicMessage, toAnthropicStream, toChatMessages } from './openai';

/**
 * Building and sending a streamed Messages API request. Shared by the local dev proxy (Node) and
 * by the deployed page, which calls the model straight from the browser because a static host
 * such as GitHub Pages has no server to proxy through.
 *
 * Two request formats: the Anthropic Messages format (Claude itself, and the compatible endpoints
 * of DeepSeek, Qwen, GLM, Doubao and others) and OpenAI-compatible Chat Completions, which most
 * company gateways offer. Replies in either format come back as Anthropic Messages events.
 */

export type ApiFormat = 'anthropic' | 'openai';

export type Target = {
    /** A base ("https://host/anthropic"), a base ending in "/v1", or a full ".../v1/messages" or ".../chat/completions" URL. */
    baseUrl: string;
    key: string;
    model: string;
    /** Defaults to 'anthropic'. */
    format?: ApiFormat;
};

/** A guess from the address alone: a Chat Completions URL is OpenAI format. */
export const formatFromUrl = (url: string): ApiFormat | null => (/\/chat\/completions\/?$/i.test(url.trim()) ? 'openai' : null);

/** Known Anthropic-compatible endpoints, offered as suggestions and used to name the service (`name` in Chinese, `en` in English). */
export const KNOWN_ENDPOINTS = [
    { name: 'DeepSeek', en: 'DeepSeek', url: 'https://api.deepseek.com/anthropic' },
    { name: '千问', en: 'Qwen', url: 'https://dashscope.aliyuncs.com/apps/anthropic' },
    { name: '智谱', en: 'GLM', url: 'https://open.bigmodel.cn/api/anthropic' },
    { name: '豆包', en: 'Doubao', url: 'https://ark.cn-beijing.volces.com/api/compatible' },
    { name: 'Claude', en: 'Claude', url: 'https://api.anthropic.com' },
] as const;

/** Reasoning models spend part of this on thinking, so leave plenty of room for the answer. */
export const MAX_TOKENS = 16000;

/**
 * DeepSeek's usual (OpenAI-style) address, "https://api.deepseek.com" or ".../v1", has no Messages
 * API, so it is mapped to the Anthropic-compatible endpoint on the same host.
 */
export function messagesUrl(baseUrl: string): string {
    let base = baseUrl.trim().replace(/\/+$/, '');
    if (/^https?:\/\/api\.deepseek\.com(\/v1)?$/i.test(base)) base = 'https://api.deepseek.com/anthropic';
    if (base.endsWith('/v1/messages')) return base;
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
}

const hostOf = (baseUrl: string) => {
    try {
        return new URL(messagesUrl(baseUrl)).host;
    } catch {
        return '';
    }
};

const sameEndpoint = (a: string, b: string) => messagesUrl(a) === messagesUrl(b);

/**
 * A short name for the service behind an endpoint: one the user named, a known one, otherwise its
 * host. User-named endpoints match by full address, since a proxy may share a host with others.
 */
export function serviceName(baseUrl: string, named: readonly { name: string; url: string }[] = [], lang: 'zh' | 'en' = 'zh'): string {
    const host = hostOf(baseUrl);
    if (!host) return lang === 'en' ? 'endpoint' : '接口地址';
    const own = named.find((e) => sameEndpoint(e.url, baseUrl));
    if (own) return own.name;
    const known = host.endsWith('.maas.aliyuncs.com') ? KNOWN_ENDPOINTS[1] : KNOWN_ENDPOINTS.find((e) => hostOf(e.url) === host);
    return known ? known[lang === 'en' ? 'en' : 'name'] : host;
}

const isAnthropic = (baseUrl: string) => hostOf(baseUrl) === 'api.anthropic.com';

/**
 * Said explicitly either way: whether a model thinks by default differs between services and
 * models. `budget_tokens` is needed by Claude (below max_tokens) and ignored by most others.
 */
export function thinkingParam(on: boolean, maxTokens: number) {
    return on ? { type: 'enabled', budget_tokens: Math.min(8000, Math.floor(maxTokens / 2)) } : { type: 'disabled' };
}

export type CallOptions = {
    messages: unknown[];
    thinking: boolean;
    maxTokens?: number;
    signal?: AbortSignal;
    /** Sending from a web page: Anthropic requires an explicit opt-in header for that. */
    fromBrowser?: boolean;
    /** Told when a model rejected the thinking setting and the request is retried without it. */
    onRetry?: () => void;
};

export async function callModel(t: Target, o: CallOptions): Promise<Response> {
    if (t.format === 'openai') return callChatCompletions(t, o);
    const maxTokens = o.maxTokens ?? MAX_TOKENS;
    const headers: Record<string, string> = { 'x-api-key': t.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (isAnthropic(t.baseUrl)) {
        if (o.fromBrowser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
        // Compatible endpoints differ in which header carries the key; most accept a bearer token.
        headers.authorization = `Bearer ${t.key}`;
    }
    const send = (withThinking: boolean) =>
        fetch(messagesUrl(t.baseUrl), {
            method: 'POST',
            signal: o.signal,
            headers,
            body: JSON.stringify({
                model: t.model,
                max_tokens: maxTokens,
                stream: true,
                system: buildSystemPrompt(),
                tools: toAnthropicTools(),
                messages: o.messages,
                ...(withThinking ? { thinking: thinkingParam(o.thinking, maxTokens) } : {}),
            }),
        });
    const first = await send(true);
    // A model that does not accept the thinking setting still gets a normal request.
    if (first.status === 400) {
        o.onRetry?.();
        return send(false);
    }
    return first;
}

/**
 * The same request in OpenAI-compatible Chat Completions format, answered as Anthropic Messages
 * events (or a Messages body when the service did not stream). Errors pass through unchanged:
 * OpenAI-style error bodies have the same `error.message` the page reads. There is no common way
 * to switch reasoning on or off in this format, so the thinking setting is not sent; reasoning a
 * model does anyway (`reasoning_content`) still shows as thinking.
 */
async function callChatCompletions(t: Target, o: CallOptions): Promise<Response> {
    const res = await fetch(chatCompletionsUrl(t.baseUrl), {
        method: 'POST',
        signal: o.signal,
        headers: { authorization: `Bearer ${t.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            model: t.model,
            max_tokens: o.maxTokens ?? MAX_TOKENS,
            stream: true,
            messages: toChatMessages(buildSystemPrompt(), o.messages),
            tools: toOpenAITools(),
        }),
    });
    if (!res.ok || !res.body) return res;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream')) {
        return new Response(toAnthropicStream(res.body), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const data = await res.json().catch(() => null);
    if (!data) return new Response(JSON.stringify({ error: { message: 'The service answered with something that is not JSON.' } }), { status: 502 });
    return new Response(JSON.stringify(toAnthropicMessage(data)), { status: 200, headers: { 'content-type': 'application/json' } });
}
