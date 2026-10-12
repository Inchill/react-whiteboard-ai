export type Provider = 'anthropic' | 'deepseek';

export type AISettings = {
    provider: Provider;
    key: string;
    /** Empty means the provider's default model. */
    model: string;
    /** Keep in localStorage across sessions instead of sessionStorage (this tab only). */
    remember: boolean;
};

export const PROVIDERS: Record<Provider, { label: string; defaultModel: string; keyHint: string }> = {
    deepseek: { label: 'DeepSeek', defaultModel: 'deepseek-flash', keyHint: 'sk-...' },
    anthropic: { label: 'Claude', defaultModel: 'claude-sonnet-5-5', keyHint: 'sk-ant-...' },
};

const STORAGE_KEY = 'react-whiteboard-ai-demo:settings';

const isSettings = (v: unknown): v is AISettings =>
    typeof v === 'object' &&
    v !== null &&
    ((v as AISettings).provider === 'anthropic' || (v as AISettings).provider === 'deepseek') &&
    typeof (v as AISettings).key === 'string' &&
    typeof (v as AISettings).model === 'string';

function read(storage: () => Storage): AISettings | null {
    try {
        const raw = storage().getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return isSettings(parsed) && parsed.key ? parsed : null;
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

export const modelLabel = (s: AISettings) => `${PROVIDERS[s.provider].label} · ${s.model || PROVIDERS[s.provider].defaultModel}`;

/** Headers the local dev proxy reads to use this key for one request. */
export const settingsHeaders = (s: AISettings): Record<string, string> => ({
    'x-ai-provider': s.provider,
    'x-ai-key': s.key,
    ...(s.model ? { 'x-ai-model': s.model } : {}),
});
