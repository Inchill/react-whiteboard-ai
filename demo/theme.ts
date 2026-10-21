import type { Theme } from '@inchill/react-whiteboard';

/** Where the board autosaves, its theme included. */
export const BOARD_KEY = 'react-whiteboard-ai-demo';

const BACKGROUND: Record<Theme, string> = { light: '#ffffff', dark: '#0f1116' };

/**
 * The theme the board starts in, worked out the same way the board does: the one saved with the
 * board, else the system's. The board keeps its own toggle (a controlled `theme` would hide it),
 * so the page follows it through `onThemeChange` instead.
 */
function initialTheme(): Theme {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(BOARD_KEY) ?? 'null')?.app?.theme;
        if (saved === 'light' || saved === 'dark') return saved;
    } catch {
        /* storage unavailable or not the board's data */
    }
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Theme the page around the board: the panel, the sheet and the browser's own bar. */
export function applyTheme(theme: Theme) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.removeAttribute('media');
        meta.setAttribute('content', BACKGROUND[theme]);
    });
}

applyTheme(initialTheme());
