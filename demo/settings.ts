import { loadCustomEndpoints } from './endpoints';
import { serviceName, type ApiFormat } from './modelRequest';

/** Any Anthropic-compatible endpoint: the user fills in all three. */
export type AISettings = {
    baseUrl: string;
    key: string;
    model: string;
    /** The request format the endpoint speaks. */
    format: ApiFormat;
    /** Keep in localStorage across sessions instead of sessionStorage (this tab only). */
    remember: boolean;
};

/** Settings saved before the endpoint became free-form named a provider instead. */
const LEGACY: Record<string, { baseUrl: string; model: string }> = {
    deepseek: { baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' },
    anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
};

const STORAGE_KEY = 'react-whiteboard-ai-demo:settings';

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function upgrade(v: unknown): AISettings | null {
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    const legacy = LEGACY[text(o.provider)];
    const settings = {
        baseUrl: text(o.baseUrl) || legacy?.baseUrl || '',
        key: text(o.key),
        model: text(o.model) || legacy?.model || '',
        format: o.format === 'openai' ? ('openai' as const) : ('anthropic' as const),
        remember: o.remember === true,
    };
    return settings.baseUrl && settings.key && settings.model ? settings : null;
}

function read(storage: () => Storage): AISettings | null {
    try {
        const raw = storage().getItem(STORAGE_KEY);
        return raw ? upgrade(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

const remove = (storage: () => Storage) => {
    try {
        storage().removeItem(STORAGE_KEY);
    } catch {
        /* storage unavailable */
    }
};

export function loadSettings(): AISettings | null {
    return read(() => sessionStorage) ?? read(() => localStorage);
}

/** Store in exactly one place, so turning "remember" off really forgets the key. */
export function saveSettings(s: AISettings) {
    const [keep, drop] = s.remember ? [() => localStorage, () => sessionStorage] : [() => sessionStorage, () => localStorage];
    remove(drop);
    try {
        keep().setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        /* storage unavailable: settings live for this page only */
    }
}

export function clearSettings() {
    remove(() => sessionStorage);
    remove(() => localStorage);
}

/** What the header shows: the service (by the user's own name for it, if any) and the model. */
export const modelInfo = (s: Pick<AISettings, 'baseUrl' | 'model'>) => ({ service: serviceName(s.baseUrl, loadCustomEndpoints()), model: s.model });

/** Headers the local dev proxy reads to use this endpoint and key for one request. */
export const settingsHeaders = (s: AISettings): Record<string, string> => ({
    'x-ai-base-url': s.baseUrl,
    'x-ai-key': s.key,
    'x-ai-model': s.model,
    'x-ai-format': s.format,
});

const THINKING_KEY = 'react-whiteboard-ai-demo:thinking';

/** Whether the model should reason before answering. Off by default: drawing rarely needs it and it is much slower. */
export function loadThinking(): boolean {
    try {
        return localStorage.getItem(THINKING_KEY) === 'on';
    } catch {
        return false;
    }
}

export function saveThinking(on: boolean) {
    try {
        localStorage.setItem(THINKING_KEY, on ? 'on' : 'off');
    } catch {
        /* storage unavailable: the choice lasts for this page only */
    }
}
