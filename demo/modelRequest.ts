import { buildSystemPrompt } from '../src/prompts/system';
import { toAnthropicTools } from '../src/tools/schema';

/**
 * Building and sending a streamed Messages API request. Shared by the local dev proxy (Node) and
 * by the deployed page, which calls the model straight from the browser because a static host
 * such as GitHub Pages has no server to proxy through.
 *
 * Any service that speaks the Anthropic Messages format works: Claude itself, and the compatible
 * endpoints of DeepSeek, Qwen, GLM, Doubao and others. The user sets the endpoint, key and model.
 */

export type Target = {
    /** A base ("https://host/anthropic"), a base ending in "/v1", or a full ".../v1/messages" URL. */
    baseUrl: string;
    key: string;
    model: string;
};

/** Known Anthropic-compatible endpoints, offered as suggestions and used to name the service. */
export const KNOWN_ENDPOINTS = [
    { name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic' },
    { name: '千问', url: 'https://dashscope.aliyuncs.com/apps/anthropic' },
    { name: '智谱', url: 'https://open.bigmodel.cn/api/anthropic' },
    { name: '豆包', url: 'https://ark.cn-beijing.volces.com/api/compatible' },
    { name: 'Claude', url: 'https://api.anthropic.com' },
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

/** A short name for the service behind an endpoint: a known one by name, otherwise its host. */
export function serviceName(baseUrl: string): string {
    const host = hostOf(baseUrl);
    if (!host) return '接口地址';
    if (host.endsWith('.maas.aliyuncs.com')) return '千问';
    return KNOWN_ENDPOINTS.find((e) => hostOf(e.url) === host)?.name ?? host;
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
