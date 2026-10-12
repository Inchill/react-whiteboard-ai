import { KNOWN_ENDPOINTS, messagesUrl } from './modelRequest';

/** An endpoint in the picker: a built-in one, or one the user added. */
export type Endpoint = { name: string; url: string; custom?: boolean };

const STORAGE_KEY = 'react-whiteboard-ai-demo:endpoints';

/** A usable http(s) endpoint, the form the picker stores. */
export function normalizeEndpoint(url: string): string | null {
    const trimmed = url.trim().replace(/\/+$/, '');
    try {
        const parsed = new URL(messagesUrl(trimmed));
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null;
    } catch {
        return null;
    }
}

/** Endpoints the user added, kept in this browser. Names and addresses only, never keys. */
export function loadCustomEndpoints(): Endpoint[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((e): e is Endpoint => typeof e?.name === 'string' && typeof e?.url === 'string' && e.name.trim() !== '' && normalizeEndpoint(e.url) !== null)
            .map((e) => ({ name: e.name.trim(), url: e.url, custom: true }));
    } catch {
        return [];
    }
}

export function saveCustomEndpoints(list: Endpoint[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(({ name, url }) => ({ name, url }))));
    } catch {
        /* storage unavailable: the list lasts for this page only */
    }
}

/** Built-in endpoints first, then the user's, without duplicates. */
export function allEndpoints(custom: Endpoint[]): Endpoint[] {
    const known = KNOWN_ENDPOINTS.map((e) => ({ name: e.name, url: e.url }));
    const seen = new Set(known.map((e) => messagesUrl(e.url)));
    return [...known, ...custom.filter((e) => !seen.has(messagesUrl(e.url)))];
}

export const isListed = (list: Endpoint[], url: string) => list.some((e) => messagesUrl(e.url) === messagesUrl(url.trim()));
