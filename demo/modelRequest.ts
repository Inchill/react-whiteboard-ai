import { buildSystemPrompt } from '../src/prompts/system';
import { toAnthropicTools } from '../src/tools/schema';

/**
 * Building and sending a streamed Messages API request. Shared by the local dev proxy (Node) and
 * by the deployed page, which calls the provider straight from the browser because a static host
 * such as GitHub Pages has no server to proxy through.
 */

export type ProviderName = 'anthropic' | 'deepseek';

/** Both speak the Anthropic Messages format; DeepSeek through its compatible endpoint. */
export const ENDPOINTS: Record<ProviderName, { base: string; model: string }> = {
    deepseek: { base: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' },
    anthropic: { base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
};

/** Reasoning models spend part of this on thinking, so leave plenty of room for the answer. */
export const MAX_TOKENS = 16000;

export type Target = {
    provider: ProviderName;
    key: string;
    /** Empty: the provider's default model. */
    model?: string;
    /** Empty: the provider's own endpoint. Otherwise a compatible endpoint or the user's own proxy. */
    baseUrl?: string;
};

/**
 * Accepts a base ("https://host/anthropic"), a base ending in "/v1", or a full ".../v1/messages" URL.
 * DeepSeek's usual (OpenAI-style) address, "https://api.deepseek.com" or ".../v1", has no Messages
 * API, so it is mapped to the Anthropic-compatible endpoint on the same host.
 */
export function messagesUrl(t: Pick<Target, 'provider' | 'baseUrl'>): string {
    let base = (t.baseUrl?.trim() || ENDPOINTS[t.provider].base).replace(/\/+$/, '');
    if (/^https?:\/\/api\.deepseek\.com(\/v1)?$/i.test(base)) base = ENDPOINTS.deepseek.base;
    if (base.endsWith('/v1/messages')) return base;
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
}

export const modelOf = (t: Pick<Target, 'provider' | 'model'>) => t.model?.trim() || ENDPOINTS[t.provider].model;

/**
 * DeepSeek's reasoning models think by default, so "off" has to be said explicitly; Claude only
 * thinks when asked. DeepSeek ignores budget_tokens; Claude needs it below max_tokens.
 */
export function thinkingParam(provider: ProviderName, on: boolean, maxTokens: number) {
    if (on) return { type: 'enabled', budget_tokens: Math.min(8000, Math.floor(maxTokens / 2)) };
    return provider === 'deepseek' ? { type: 'disabled' } : null;
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
    const thinking = thinkingParam(t.provider, o.thinking, maxTokens);
    const headers: Record<string, string> = { 'x-api-key': t.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    if (o.fromBrowser && t.provider === 'anthropic') headers['anthropic-dangerous-direct-browser-access'] = 'true';
    const send = (withThinking: boolean) =>
        fetch(messagesUrl(t), {
            method: 'POST',
            signal: o.signal,
            headers,
            body: JSON.stringify({
                model: modelOf(t),
                max_tokens: maxTokens,
                stream: true,
                system: buildSystemPrompt(),
                tools: toAnthropicTools(),
                messages: o.messages,
                ...(withThinking && thinking ? { thinking } : {}),
            }),
        });
    const first = await send(true);
    // A model that does not accept the thinking setting still gets a normal request.
    if (first.status === 400 && thinking) {
        o.onRetry?.();
        return send(false);
    }
    return first;
}
