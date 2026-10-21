import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { formatToolResult, useWhiteboardAI, type ToolCall, type ToolCallResult } from '../src';
import { describeCall } from './describeCall';
import { EXAMPLE_GROUPS, loadExampleGroup, saveExampleGroup } from './examples';
import { getLang, setLang, STRINGS, useLang, useT, type Lang } from './i18n';
import { SettingsPanel } from './SettingsPanel';
import { callModel } from './modelRequest';
import { countSoFar, fromCompleteMessage, readMessageStream, toAssistantContent, type LiveMessage } from './stream';
import {
    clearSettings,
    loadPanelOpen,
    loadSettings,
    loadThinking,
    modelInfo,
    savePanelOpen,
    saveSettings,
    saveThinking,
    settingsHeaders,
    type AISettings,
} from './settings';

type LogEntry =
    | { kind: 'prompt'; text: string; example: boolean }
    | { kind: 'say'; text: string }
    | { kind: 'thought'; text: string; seconds: number; open: boolean }
    | { kind: 'calls'; calls: ToolCall[]; results: ToolCallResult[] }
    /** `fix`: label of a button that opens the settings, when the settings can fix the problem. */
    | { kind: 'error'; text: string; fix?: string };

type Message = { role: 'user' | 'assistant'; content: unknown };

/** How many model ↔ tool round trips one prompt may take. */
const MAX_ROUNDS = 5;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = isMac ? '⌘Z' : 'Ctrl+Z';

const REPO_URL = 'https://github.com/Inchill/react-whiteboard-ai';

/** Phones get the chat as a bottom sheet over the board instead of a side panel; matches the CSS breakpoint. */
const NARROW = '(max-width: 760px)';
const narrowQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null;
const subscribeNarrow = (cb: () => void) => {
    narrowQuery?.addEventListener('change', cb);
    return () => narrowQuery?.removeEventListener('change', cb);
};
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => narrowQuery?.matches ?? false, () => false);

/** How far a drag on the sheet's handle has to travel before it opens or closes the sheet. */
const SWIPE = 40;

/** The GitHub mark, drawn as an outline like react-whiteboard's own icon for it. */
const GitHubIcon = () => (
    <svg viewBox="0 0 24 24" className="github-mark" aria-hidden>
        <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
    </svg>
);

/*
 * A built page (for GitHub Pages or any static host) has no dev server to proxy through, so it
 * calls the provider straight from the browser with the key the visitor entered. Everything that
 * talks to the dev server, or mentions .env.local, sits behind a literal `import.meta.env.DEV`
 * check, so the build drops it: the published page has no way to use the developer's key.
 */

export function App() {
    const board = useRef<WhiteboardHandle>(null);
    const ai = useWhiteboardAI(board);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    /** The model's reply while it is still streaming in. */
    const [live, setLive] = useState<LiveMessage | null>(null);
    const stopRef = useRef<AbortController | null>(null);
    /** Endpoint and model configured in .env.local, if any. */
    const [serverModel, setServerModel] = useState<{ service: string; model: string } | null>(null);
    const [settings, setSettings] = useState<AISettings | null>(loadSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const connectionButton = useRef<HTMLButtonElement>(null);
    const popover = useRef<HTMLDivElement>(null);
    const closeSettings = (refocus = true) => {
        setSettingsOpen(false);
        if (refocus) connectionButton.current?.focus();
    };
    const [deepThinking, setDeepThinking] = useState(loadThinking);
    // The panel can fold away to give the board the whole window. It stays mounted while folded, so
    // a reply keeps streaming; the button that brings it back shows that work and any news.
    const [panelOpen, setPanelOpen] = useState(loadPanelOpen);
    const [unseen, setUnseen] = useState(false);
    const narrow = useNarrow();
    // On phones the chat is a sheet over the board: up while talking, down (a slim bar) to draw.
    const [sheetUp, setSheetUp] = useState(true);
    const sheetUpRef = useRef(sheetUp);
    sheetUpRef.current = sheetUp;
    const [dragY, setDragY] = useState<number | null>(null);
    const drag = useRef<{ y: number; moved: boolean } | null>(null);
    const moveSheet = (up: boolean) => {
        setSheetUp(up);
        if (up) setUnseen(false);
        else setSettingsOpen(false);
    };
    const chatShown = narrow ? sheetUp : panelOpen;
    const collapseButton = useRef<HTMLButtonElement>(null);
    const reopenButton = useRef<HTMLButtonElement>(null);
    const togglePanel = (open: boolean) => {
        savePanelOpen(open);
        setPanelOpen(open);
        if (open) setUnseen(false);
        else setSettingsOpen(false);
    };
    const lang = useLang();
    const t = STRINGS[lang];
    const groups = EXAMPLE_GROUPS[lang];
    const [exampleGroup, setExampleGroup] = useState(loadExampleGroup);
    const examples = groups.find((g) => g.id === exampleGroup) ?? groups[0];
    const logRef = useRef<HTMLElement>(null);
    // Follow new entries while the reader is at the bottom of the log; scrolling up to read stops it.
    const followLog = useRef(true);
    const composer = useRef<HTMLTextAreaElement>(null);
    // Bumped after each AI turn; the effect below fits the view once React has rendered the new shapes.
    const [fitRequest, setFitRequest] = useState(0);
    // Ticks once a second while the model works, so "thinking for 12 s" stays current.
    const [now, setNow] = useState(() => Date.now());
    const thinking = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
    // Whether the live thinking is expanded; the logged copy keeps that state when the round ends.
    const [thoughtOpen, setThoughtOpen] = useState(false);
    const thoughtOpenRef = useRef(false);
    const toggleThought = () => {
        thoughtOpenRef.current = !thoughtOpenRef.current;
        setThoughtOpen(thoughtOpenRef.current);
    };
    const canAsk = Boolean(settings || serverModel);

    useEffect(() => {
        if (!import.meta.env.DEV) return;
        fetch('/api/status')
            .then((r) => r.json())
            .then((s) => setServerModel(s && typeof s.service === 'string' && typeof s.model === 'string' ? s : null))
            .catch(() => setServerModel(null));
    }, []);

    // Keep the log pinned to its bottom while following: after every change to its content, and
    // whenever its box changes size (the examples above the composer come and go with each turn).
    // Only the log scrolls, never the page around it, and it lands exactly at the end.
    const stickToBottom = () => {
        const el = logRef.current;
        if (el && followLog.current) el.scrollTop = el.scrollHeight;
    };
    useLayoutEffect(stickToBottom, [log, busy, live]);
    useEffect(() => {
        const el = logRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const watch = new ResizeObserver(stickToBottom);
        watch.observe(el);
        return () => watch.disconnect();
    }, []);

    // The composer grows with its text, up to a few lines, then scrolls.
    useLayoutEffect(() => {
        const el = composer.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [input]);

    useEffect(() => {
        if (fitRequest) board.current?.zoomToFit();
    }, [fitRequest]);

    // New entries while the panel is folded light a dot on the button that opens it.
    const seenEntries = useRef(log.length);
    useEffect(() => {
        if (!chatShown && log.length > seenEntries.current) setUnseen(true);
        seenEntries.current = log.length;
    }, [log.length, chatShown]);

    // Keep keyboard focus on the control that remains after folding or unfolding (only on a change,
    // not on load).
    const shownPanel = useRef(panelOpen);
    useEffect(() => {
        if (shownPanel.current === panelOpen) return;
        shownPanel.current = panelOpen;
        (panelOpen ? collapseButton : reopenButton).current?.focus();
    }, [panelOpen]);

    // The settings popover closes on Escape and on a click anywhere outside it (except its own button).
    useEffect(() => {
        if (!settingsOpen) return;
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') closeSettings();
        };
        const onDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (!popover.current?.contains(target) && !connectionButton.current?.contains(target)) closeSettings(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('pointerdown', onDown);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('pointerdown', onDown);
        };
    }, [settingsOpen]);

    useEffect(() => {
        if (!busy) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [busy]);

    const push = (entry: LogEntry) => setLog((l) => [...l, entry]);

    const run = (calls: ToolCall[]) => {
        const results = ai.execute(calls);
        push({ kind: 'calls', calls, results });
        setFitRequest((n) => n + 1);
        return results;
    };

    /** Send a prompt to the model: the composer's text, or an example's. */
    async function ask(prompt: string, example = false) {
        prompt = prompt.trim();
        if (!prompt || busy) return;
        if (!canAsk) {
            setSettingsOpen(true);
            return;
        }
        if (!example) setInput('');
        followLog.current = true;
        setBusy(true);
        push({ kind: 'prompt', text: prompt, example });
        thoughtOpenRef.current = false;
        setThoughtOpen(false);
        const stop = new AbortController();
        stopRef.current = stop;
        // On a phone the sheet goes down by itself once a turn has drawn cleanly, to show the result.
        let drewCleanly = false;
        // Messages written during this request use the language it started in.
        const t = STRINGS[getLang()];
        const messages: Message[] = [{ role: 'user', content: `Board:\n${JSON.stringify(ai.describe())}\n\n${prompt}` }];
        // Stream updates arrive many times a second; render at most once per frame.
        let frame = 0;
        const show = (m: LiveMessage) => {
            // Time the thinking phase: from the first thinking block to the first block of anything else.
            const t = thinking.current;
            if (!t.start && m.blocks.some((b) => b?.type === 'thinking')) t.start = Date.now();
            if (t.start && !t.end && m.blocks.some((b) => b && b.type !== 'thinking' && b.type !== 'other')) t.end = Date.now();
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setLive(m));
        };
        try {
            for (let round = 0; round < MAX_ROUNDS; round++) {
                thinking.current = { start: 0, end: 0 };
                const res = import.meta.env.DEV
                    ? await fetch('/api/ai', {
                        method: 'POST',
                        signal: stop.signal,
                        headers: {
                            'content-type': 'application/json',
                            'x-ai-thinking': deepThinking ? 'on' : 'off',
                            ...(settings ? settingsHeaders(settings) : {}),
                        },
                        body: JSON.stringify({ messages }),
                    })
                    : // canAsk: without the dev server, only the visitor's own settings can ask.
                    await callModel(settings!, { messages, thinking: deepThinking, signal: stop.signal, fromBrowser: true });
                if (!res.ok || !res.body) {
                    const data = await res.json().catch(() => ({}));
                    const detail = data.error?.message ?? data.error ?? `HTTP ${res.status}`;
                    const auth = res.status === 401 || res.status === 403;
                    push({
                        kind: 'error',
                        text: auth ? t.keyRejected(res.status, detail) : t.requestFailed(detail),
                        fix: auth ? t.checkKey : undefined,
                    });
                    return;
                }
                // The proxy streams; if the upstream answered in one piece instead, read it whole.
                const streamed = (res.headers.get('content-type') ?? '').includes('text/event-stream');
                const message = streamed ? await readMessageStream(res.body, show) : fromCompleteMessage(await res.json());
                cancelAnimationFrame(frame);
                setLive(null);

                messages.push({ role: 'assistant', content: toAssistantContent(message) });
                const thought = message.blocks.map((b) => (b.type === 'thinking' ? b.thinking : '')).join('\n').trim();
                if (thought) {
                    const t = thinking.current;
                    const seconds = t.start ? Math.round(((t.end || Date.now()) - t.start) / 1000) : 0;
                    push({ kind: 'thought', text: thought, seconds, open: thoughtOpenRef.current });
                }
                for (const b of message.blocks) if (b.type === 'text' && b.text.trim()) push({ kind: 'say', text: b.text });
                const calls = message.blocks.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
                if (!calls.length) {
                    // Say why a round ended with nothing to show instead of going quiet.
                    const said = message.blocks.some((b) => b.type === 'text' && b.text.trim());
                    if (message.stopReason === 'max_tokens') {
                        push({
                            kind: 'error',
                            text: said
                                ? t.truncated
                                : t.allThinking,
                        });
                    } else if (!said) {
                        push({ kind: 'say', text: t.noReply });
                    }
                    break;
                }
                // Everything the model wrote this round lands on the board at once: one undo step.
                const results = run(calls);
                // When every call worked the drawing is done; going back to the model would only cost
                // another full round trip for a closing sentence. Errors go back so it can fix them.
                if (results.every((r) => r.ok)) {
                    drewCleanly = true;
                    break;
                }
                messages.push({
                    role: 'user',
                    content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: formatToolResult(r), is_error: !r.ok })),
                });
            }
        } catch (err) {
            if (stop.signal.aborted) push({ kind: 'say', text: t.stopped });
            else if (!import.meta.env.DEV && err instanceof TypeError && settings) {
                // A fetch that fails outright from a page is a blocked cross-origin request or no network.
                push({
                    kind: 'error',
                    text: t.unreachable(modelInfo(settings).service),
                    fix: t.openSettings,
                });
            } else push({ kind: 'error', text: t.failed(err instanceof Error ? err.message : String(err)) });
        } finally {
            if (drewCleanly && !stop.signal.aborted && narrowQuery?.matches) {
                // A short pause, so the last entry registers before the sheet slides away.
                setTimeout(() => moveSheet(false), 600);
            }
            cancelAnimationFrame(frame);
            setLive(null);
            stopRef.current = null;
            setBusy(false);
            if (!narrowQuery?.matches) composer.current?.focus();
        }
    }

    // Dragging the sheet's handle: it follows the finger, then settles up or down; a tap toggles it.
    const onHandleDown = (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, moved: false };
    };
    const onHandleMove = (e: ReactPointerEvent<HTMLElement>) => {
        if (!drag.current) return;
        const dy = e.clientY - drag.current.y;
        if (Math.abs(dy) > 4) drag.current.moved = true;
        if (drag.current.moved) setDragY(dy);
    };
    const onHandleUp = (e: ReactPointerEvent<HTMLElement>) => {
        const d = drag.current;
        drag.current = null;
        setDragY(null);
        if (!d) return;
        const dy = e.clientY - d.y;
        if (!d.moved) moveSheet(!sheetUpRef.current);
        else if (dy > SWIPE) moveSheet(false);
        else if (dy < -SWIPE) moveSheet(true);
    };
    const handleProps = {
        onPointerDown: onHandleDown,
        onPointerMove: onHandleMove,
        onPointerUp: onHandleUp,
        onPointerCancel: () => {
            drag.current = null;
            setDragY(null);
        },
    };
    // While dragging, the sheet follows the finger from where it rests; CSS does the resting positions.
    const sheetStyle =
        narrow && dragY !== null
            ? { transform: sheetUp ? `translateY(${Math.max(0, dragY)}px)` : `translateY(calc(100% - var(--peek-full) + ${Math.min(0, dragY)}px))`, transition: 'none' }
            : undefined;
    const lastEntry = log[log.length - 1];
    const peekText = busy ? t.waiting : lastEntry ? summarize(lastEntry, lang) : t.sheetIdle;

    const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends, Shift+Enter breaks the line; never send while an IME is composing (Chinese input).
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ask(input);
        }
    };

    const connection = settings ? modelInfo(settings) : serverModel;

    return (
        <div className={`demo${panelOpen || narrow ? '' : ' is-folded'}${narrow && !sheetUp ? ' is-sheet-down' : ''}`}>
            <main className="demo-board" aria-label={t.board}>
                <Whiteboard ref={board} storageKey="react-whiteboard-ai-demo" locale={lang} />
                {!panelOpen && !narrow && (
                    <div className="board-corner">
                        <a className="board-github" href={REPO_URL} target="_blank" rel="noreferrer" aria-label={t.viewSource} title="GitHub">
                            <GitHubIcon />
                        </a>
                        <button ref={reopenButton} type="button" className="panel-reopen" onClick={() => togglePanel(true)} aria-label={t.openAssistant(busy, unseen)}>
                            {busy ? (
                                <span className="spinner" aria-hidden />
                            ) : (
                                <svg viewBox="0 0 16 16" aria-hidden>
                                    <path d="M8 1.5c.5 2.9 1.6 4 4.5 4.5-2.9.5-4 1.6-4.5 4.5-.5-2.9-1.6-4-4.5-4.5 2.9-.5 4-1.6 4.5-4.5ZM12.5 10.5c.2 1.2.7 1.7 2 2-1.3.3-1.8.8-2 2-.2-1.2-.7-1.7-2-2 1.3-.3 1.8-.8 2-2Z" />
                                </svg>
                            )}
                            {t.assistant}
                            {unseen && !busy && <span className="panel-reopen-dot" aria-hidden />}
                        </button>
                    </div>
                )}
            </main>

            {/* Phones: while the sheet is up, a tap on the board behind it puts the sheet away without drawing. */}
            {narrow && sheetUp && <div className="sheet-scrim" aria-hidden onPointerDown={() => moveSheet(false)} />}
            <aside className="panel" aria-label={t.assistant} inert={!chatShown && !narrow} style={sheetStyle}>
                {/* Phones only: the grabber at the top of the sheet, and the slim bar it leaves when down. */}
                <div className="sheet-grabber" aria-hidden {...handleProps}>
                    <span />
                </div>
                <button
                    type="button"
                    className="sheet-peek"
                    aria-label={t.sheetUp}
                    aria-expanded={false}
                    tabIndex={narrow && !sheetUp ? 0 : -1}
                    {...handleProps}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            moveSheet(true);
                        }
                    }}
                >
                    <span className="sheet-peek-grabber" aria-hidden />
                    <span className="sheet-peek-row">
                        {busy ? <span className="spinner" aria-hidden /> : <span className={`sheet-peek-dot${unseen ? ' is-new' : ''}`} aria-hidden />}
                        <span className="sheet-peek-text">{peekText}</span>
                        <svg viewBox="0 0 16 16" className="sheet-peek-chevron" aria-hidden>
                            <path d="M4 10l4-4 4 4" />
                        </svg>
                    </span>
                </button>
                <div className="panel-body" inert={narrow && !sheetUp}>
                    <header className="panel-head">
                        <h1>react-whiteboard-ai</h1>
                        <a className="panel-icon panel-github" href={REPO_URL} target="_blank" rel="noreferrer" aria-label={t.viewSource} title="GitHub">
                            <GitHubIcon />
                        </a>
                        <button
                            ref={connectionButton}
                            type="button"
                            className={`connection${connection ? ' is-on' : ''}`}
                            aria-expanded={settingsOpen}
                            aria-haspopup="dialog"
                            // The model name is cut short when the header is tight; the tooltip has it whole.
                            title={connection ? `${connection.service} · ${connection.model}` : undefined}
                            onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
                        >
                            <span className="connection-dot" aria-hidden />
                            {connection ? (
                                <>
                                    <strong>{connection.service}</strong>
                                    <span className="connection-model">{connection.model}</span>
                                    {import.meta.env.DEV && !settings && <span className="connection-model">（.env.local）</span>}
                                </>
                            ) : (
                                <strong>{t.connectShort}</strong>
                            )}
                        </button>
                        {settingsOpen && (
                            <div ref={popover} className="popover" role="dialog" aria-label={t.connect}>
                                <SettingsPanel
                                    settings={settings}
                                    hasServerKey={Boolean(serverModel)}
                                    onSave={(s) => {
                                        saveSettings(s);
                                        setSettings(s);
                                        closeSettings(false);
                                        composer.current?.focus();
                                    }}
                                    onClear={() => {
                                        clearSettings();
                                        setSettings(null);
                                        closeSettings();
                                    }}
                                    onClose={() => closeSettings()}
                                />
                            </div>
                        )}
                        {/* On phones the switch moves up here, where the composer's footer line is dropped. */}
                        <button type="button" className="panel-icon lang-switch-head" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t.switchLabel} title={t.switchLabel} lang={lang === 'zh' ? 'en' : 'zh-CN'}>
                            {lang === 'zh' ? 'EN' : '中'}
                        </button>
                        <button ref={collapseButton} type="button" className="panel-icon panel-collapse" onClick={() => (narrow ? moveSheet(false) : togglePanel(false))} aria-label={narrow ? t.sheetDown : t.closeAssistant} title={t.close}>
                            <svg viewBox="0 0 16 16" aria-hidden>
                                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
                                <path d="M10.25 2.75v10.5M4.75 6.25 6.5 8l-1.75 1.75" />
                            </svg>
                        </button>
                    </header>

                    <section
                        ref={logRef}
                        className={`log${log.length || busy ? '' : ' is-empty'}`}
                        aria-live="polite"
                        aria-label={t.log}
                        onScroll={(e) => {
                            const el = e.currentTarget;
                            followLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                        }}
                    >
                        {log.length === 0 && (
                            <div className="log-empty">
                                <p className="log-empty-title">{t.emptyTitle}</p>
                                <p>
                                    {t.emptyExamples}
                                    {canAsk ? t.emptyCanAsk : t.emptyConnect}
                                </p>
                            </div>
                        )}
                        {log.map((entry, i) => (
                            <LogItem key={i} entry={entry} index={i} onOpenSettings={() => setSettingsOpen(true)} />
                        ))}
                        {live && (
                            <LiveReply
                                message={live}
                                thoughtOpen={thoughtOpen}
                                onToggleThought={toggleThought}
                                thinkingSeconds={thinking.current.start ? Math.max(0, Math.round((now - thinking.current.start) / 1000)) : 0}
                            />
                        )}
                        {busy && !live?.blocks.some((b) => b && b.type !== 'other') && (
                            <p className="working" role="status">
                                <span className="spinner" aria-hidden />
                                <span className="trim">{t.waiting}</span>
                            </p>
                        )}
                    </section>

                    <form
                        className="composer"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void ask(input);
                        }}
                    >
                        {!busy && (
                            <div className="examples">
                                <div className="examples-tabs" role="tablist" aria-label={t.exampleGroups}>
                                    {groups.map((g) => (
                                        <button
                                            key={g.id}
                                            type="button"
                                            role="tab"
                                            id={`examples-tab-${g.id}`}
                                            aria-selected={g.id === examples.id}
                                            aria-controls="examples-panel"
                                            onClick={() => {
                                                saveExampleGroup(g.id);
                                                setExampleGroup(g.id);
                                            }}
                                        >
                                            {g.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="composer-examples" role="tabpanel" id="examples-panel" aria-labelledby={`examples-tab-${examples.id}`}>
                                    {examples.examples.map((ex) => (
                                        <button key={ex.label} type="button" onClick={() => void ask(ex.prompt, true)} title={ex.prompt}>
                                            {ex.label}
                                        </button>
                                    ))}
                                </div>
                                {examples.hint && !deepThinking && <p className="examples-hint">{examples.hint}</p>}
                            </div>
                        )}
                        <div
                            className={`composer-box${!canAsk ? ' is-off' : ''}`}
                            // A click anywhere on the box (not on its buttons) puts the cursor in the text.
                            onMouseDown={(e) => {
                                if (e.target === e.currentTarget) {
                                    e.preventDefault();
                                    composer.current?.focus();
                                }
                            }}
                        >
                            <textarea
                                ref={composer}
                                value={input}
                                rows={1}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={onComposerKey}
                                placeholder={canAsk ? t.placeholder : t.placeholderOff}
                                disabled={!canAsk || busy}
                                aria-label={t.composerLabel}
                            />
                            <div className="composer-tools">
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={deepThinking}
                                    className="think-toggle"
                                    title={t.thinkTitle}
                                    onClick={() => {
                                        saveThinking(!deepThinking);
                                        setDeepThinking(!deepThinking);
                                    }}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden>
                                        <path d="M8 1.75a4.25 4.25 0 0 0-2.4 7.76c.4.27.65.72.65 1.2v.54h3.5v-.54c0-.48.25-.93.65-1.2A4.25 4.25 0 0 0 8 1.75ZM6.25 13h3.5M6.75 14.75h2.5" />
                                    </svg>
                                    <span className="think-label">{t.think}</span>
                                </button>
                                {busy ? (
                                    <button type="button" className="send is-stop" onClick={() => stopRef.current?.abort()} aria-label={t.stop} title={t.stop}>
                                        <svg viewBox="0 0 16 16" aria-hidden>
                                            <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
                                        </svg>
                                    </button>
                                ) : canAsk ? (
                                    <button type="submit" className="send" disabled={!input.trim()} aria-label={t.send} title={t.sendTitle}>
                                        <svg viewBox="0 0 16 16" aria-hidden>
                                            <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
                                        </svg>
                                    </button>
                                ) : (
                                    <button type="button" className="send-connect" onClick={() => setSettingsOpen(true)}>
                                        {t.connect}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="composer-foot">
                            <p className="composer-hint">{t.composerHint(UNDO_KEYS)}</p>
                            {/* Named in the other language, so it reads as the way out to anyone who cannot read this one. */}
                            <button type="button" className="lang-switch" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label={t.switchLabel} title={t.switchLabel} lang={lang === 'zh' ? 'en' : 'zh-CN'}>
                                <svg viewBox="0 0 16 16" aria-hidden>
                                    <circle cx="8" cy="8" r="6.25" />
                                    <path d="M1.75 8h12.5M8 1.75c1.7 1.8 2.5 3.9 2.5 6.25S9.7 12.45 8 14.25C6.3 12.45 5.5 10.35 5.5 8S6.3 3.55 8 1.75Z" />
                                </svg>
                                {t.switchTo}
                            </button>
                        </div>
                    </form>
                </div>
            </aside>
        </div>
    );
}

/** One line about a log entry for the sheet's slim bar. */
function summarize(entry: LogEntry, lang: Lang): string {
    switch (entry.kind) {
        case 'calls': {
            const i = entry.calls.length - 1;
            return describeCall(entry.calls[i], entry.results[i], lang).title;
        }
        case 'thought':
            return STRINGS[lang].thought(entry.seconds);
        default:
            return entry.text;
    }
}

function LogItem({ entry, index, onOpenSettings }: { entry: LogEntry; index: number; onOpenSettings: () => void }) {
    const lang = useLang();
    const t = STRINGS[lang];
    switch (entry.kind) {
        case 'prompt':
            return (
                <div className={`note${index % 2 ? ' note-tilt' : ''}`}>
                    <p>{entry.text}</p>
                    {entry.example && <span className="note-tag">{t.exampleTag}</span>}
                </div>
            );
        case 'say':
            return <p className="say">{entry.text}</p>;
        case 'thought':
            return <Thought text={entry.text} seconds={entry.seconds} live={false} defaultOpen={entry.open} />;
        case 'error':
            return (
                <div className="op op-error">
                    <p className="op-title">{entry.text}</p>
                    {entry.fix && (
                        <button type="button" className="button-quiet" onClick={onOpenSettings}>
                            {entry.fix}
                        </button>
                    )}
                </div>
            );
        case 'calls':
            return (
                <ul className="ops">
                    {entry.calls.map((call, i) => {
                        const result = entry.results[i];
                        const { kind, title, detail } = describeCall(call, result, lang);
                        return (
                            <li key={i} className={`op op-${kind}`}>
                                <p className="op-title">{title}</p>
                                {detail && <p className="op-detail">{detail}</p>}
                                {result.errors.length > 0 && (
                                    <ul className="op-errors" aria-label={t.returnedErrors}>
                                        {result.errors.map((err) => (
                                            <li key={err}>{err}</li>
                                        ))}
                                    </ul>
                                )}
                                <details>
                                    <summary>{t.showInput}</summary>
                                    <pre>
                                        <code>
                                            {call.name}
                                            {'\n'}
                                            {JSON.stringify(call.input, null, 2)}
                                        </code>
                                    </pre>
                                </details>
                            </li>
                        );
                    })}
                </ul>
            );
    }
}

/** The reply as it streams in: text grows word by word, tool calls show how far along they are. */
type LiveReplyProps = { message: LiveMessage; thinkingSeconds: number; thoughtOpen: boolean; onToggleThought: () => void };

function LiveReply({ message, thinkingSeconds, thoughtOpen, onToggleThought }: LiveReplyProps) {
    const t = useT();
    return (
        <>
            {message.blocks.map((b, i) => {
                if (!b) return null;
                if (b.type === 'text') {
                    // The caret only follows the text that is still being written.
                    const writing = i === message.blocks.length - 1;
                    return b.text ? (
                        <p key={i} className={writing ? 'say say-live' : 'say'}>
                            {b.text}
                        </p>
                    ) : null;
                }
                if (b.type === 'thinking') {
                    // Reasoning models (DeepSeek V4 among them) think before answering; keep it to one quiet line.
                    const writing = i === message.blocks.length - 1;
                    return (
                        <Thought
                            key={i}
                            text={b.thinking}
                            seconds={thinkingSeconds}
                            live={writing}
                            open={thoughtOpen}
                            onToggle={onToggleThought}
                        />
                    );
                }
                if (b.type === 'tool_use') {
                    const [label, unit] = t.pending[b.name] ?? t.pendingOther(b.name);
                    const n = countSoFar(b.name, b.partialJson);
                    return (
                        <div key={i} className="op op-pending" role="status">
                            <span className="spinner" aria-hidden />
                            <p className="op-title">{label}</p>
                            <p className="op-detail">{n ? t.pendingCount(n, unit) : t.pendingStart}</p>
                        </div>
                    );
                }
                return null;
            })}
        </>
    );
}

type ThoughtProps = {
    text: string;
    seconds: number;
    /** Still being written. */
    live: boolean;
    /** Controlled open state (the live thought); otherwise the component keeps its own. */
    open?: boolean;
    onToggle?: () => void;
    defaultOpen?: boolean;
};

/**
 * A model's reasoning, folded to one line: a spinner and a timer while it thinks, with the latest
 * words peeking through; afterwards "thought for 12 s". Expand / collapse shows the full text,
 * which follows new words while it streams unless the reader has scrolled up.
 */
function Thought({ text, seconds, live, open: controlled, onToggle, defaultOpen = false }: ThoughtProps) {
    const t = useT();
    const id = useId();
    const [own, setOwn] = useState(defaultOpen);
    const open = controlled ?? own;
    const toggle = onToggle ?? (() => setOwn((o) => !o));
    const full = useRef<HTMLDivElement>(null);
    const followBottom = useRef(true);
    const tail = text.replace(/\s+/g, ' ').trim().slice(-90);

    useEffect(() => {
        const el = full.current;
        if (el && live && followBottom.current) el.scrollTop = el.scrollHeight;
    }, [text, live, open]);

    return (
        <div className={`thought${live ? ' is-live' : ''}`}>
            <button type="button" className="thought-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>
                <span className="thought-status">
                    {live && <span className="spinner" aria-hidden />}
                    <span className="trim">{live ? t.thinking(seconds) : seconds ? t.thought(seconds) : t.thoughtUntimed}</span>
                </span>
                <span className="thought-action">
                    <span className="trim">{open ? t.collapse : t.expand}</span>
                    <span className="thought-chevron" aria-hidden />
                </span>
            </button>
            {open ? (
                <div
                    id={id}
                    ref={full}
                    className="thought-full"
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        followBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
                    }}
                >
                    {text}
                </div>
            ) : (
                live &&
                tail && (
                    <p className="thought-peek">
                        {/* Right-aligned and clipped on the left, so the newest words stay in view. */}
                        <span dir="ltr">{tail}</span>
                    </p>
                )
            )}
        </div>
    );
}
