import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { formatToolResult, useWhiteboardAI, type ToolCall, type ToolCallResult } from '../src';
import { describeCall } from './describeCall';
import { EXAMPLE_GROUPS, loadExampleGroup, saveExampleGroup } from './examples';
import { SettingsPanel } from './SettingsPanel';
import { callModel } from './modelRequest';
import { countSoFar, fromCompleteMessage, readMessageStream, toAssistantContent, type LiveMessage } from './stream';
import {
    clearSettings,
    loadSettings,
    loadThinking,
    modelInfo,
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

/**
 * A built page (for GitHub Pages or any static host) has no dev server to proxy through, so it
 * calls the provider straight from the browser with the key the visitor entered.
 */
const DIRECT = !import.meta.env.DEV;

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
    const [exampleGroup, setExampleGroup] = useState(loadExampleGroup);
    const examples = EXAMPLE_GROUPS.find((g) => g.id === exampleGroup) ?? EXAMPLE_GROUPS[0];
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
        if (DIRECT) return;
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
                const res =
                    DIRECT && settings
                        ? await callModel(settings, { messages, thinking: deepThinking, signal: stop.signal, fromBrowser: true })
                        : await fetch('/api/ai', {
                            method: 'POST',
                            signal: stop.signal,
                            headers: {
                                'content-type': 'application/json',
                                'x-ai-thinking': deepThinking ? 'on' : 'off',
                                ...(settings ? settingsHeaders(settings) : {}),
                            },
                            body: JSON.stringify({ messages }),
                        });
                if (!res.ok || !res.body) {
                    const data = await res.json().catch(() => ({}));
                    const detail = data.error?.message ?? data.error ?? `HTTP ${res.status}`;
                    const auth = res.status === 401 || res.status === 403;
                    push({
                        kind: 'error',
                        text: auth ? `模型拒绝了这个 API key（${res.status}）：${detail}` : `请求失败：${detail}`,
                        fix: auth ? '检查 API key' : undefined,
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
                                ? '模型的输出达到长度上限，回答被截断了。'
                                : '模型把输出额度都用在了思考上，还没来得及画。可以把要求说得更具体一些，或者换一个思考更少的模型（比如 deepseek-flash）。',
                        });
                    } else if (!said) {
                        push({ kind: 'say', text: '模型这一轮没有回复，也没有修改白板。' });
                    }
                    break;
                }
                // Everything the model wrote this round lands on the board at once: one undo step.
                const results = run(calls);
                // When every call worked the drawing is done; going back to the model would only cost
                // another full round trip for a closing sentence. Errors go back so it can fix them.
                if (results.every((r) => r.ok)) break;
                messages.push({
                    role: 'user',
                    content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: formatToolResult(r), is_error: !r.ok })),
                });
            }
        } catch (err) {
            if (stop.signal.aborted) push({ kind: 'say', text: '已停止。这一轮还没写完的修改没有画到白板上。' });
            else if (DIRECT && err instanceof TypeError && settings) {
                // A fetch that fails outright from a page is a blocked cross-origin request or no network.
                push({
                    kind: 'error',
                    text: `浏览器连不上 ${modelInfo(settings).service}。这个服务可能不允许网页直接调用（跨域限制），可以在设置里填写一个代理的接口地址；也请检查网络连接。`,
                    fix: '打开设置',
                });
            } else push({ kind: 'error', text: `出错了：${err instanceof Error ? err.message : String(err)}` });
        } finally {
            cancelAnimationFrame(frame);
            setLive(null);
            stopRef.current = null;
            setBusy(false);
            composer.current?.focus();
        }
    }

    const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends, Shift+Enter breaks the line; never send while an IME is composing (Chinese input).
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ask(input);
        }
    };

    const connection = settings ? modelInfo(settings) : serverModel;

    return (
        <div className="demo">
            <main className="demo-board" aria-label="白板">
                <Whiteboard ref={board} storageKey="react-whiteboard-ai-demo" locale="zh" />
            </main>

            <aside className="panel" aria-label="AI 助手">
                <header className="panel-head">
                    <h1>react-whiteboard-ai</h1>
                    <button
                        ref={connectionButton}
                        type="button"
                        className={`connection${connection ? ' is-on' : ''}`}
                        aria-expanded={settingsOpen}
                        aria-haspopup="dialog"
                        onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
                    >
                        <span className="connection-dot" aria-hidden />
                        {connection ? (
                            <>
                                <strong>{connection.service}</strong>
                                <span className="connection-model">{connection.model}</span>
                                {!settings && <span className="connection-model">（.env.local）</span>}
                            </>
                        ) : (
                            <strong>连接模型</strong>
                        )}
                    </button>
                    {settingsOpen && (
                        <div ref={popover} className="popover" role="dialog" aria-label="连接模型">
                            <SettingsPanel
                                settings={settings}
                                hasServerKey={Boolean(serverModel)}
                                direct={DIRECT}
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
                </header>

                <section
                    ref={logRef}
                    className="log"
                    aria-live="polite"
                    aria-label="操作记录"
                    onScroll={(e) => {
                        const el = e.currentTarget;
                        followLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                    }}
                >
                    {log.length === 0 && (
                        <div className="log-empty">
                            <p className="log-empty-title">告诉我要在白板上画什么</p>
                            <p>
                                比如“画一个三步的注册流程”“把所有框改成蓝色”。
                                {canAsk ? '也可以直接点下面的示例。' : '先在右上角连接模型（DeepSeek 或 Claude），再输入指令或点下面的示例。'}
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
                            <span className="trim">等待模型回复</span>
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
                            <div className="examples-tabs" role="tablist" aria-label="示例分类">
                                {EXAMPLE_GROUPS.map((g) => (
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
                            placeholder={canAsk ? '要画什么？' : '先连接模型，才能用文字指挥'}
                            disabled={!canAsk || busy}
                            aria-label="给 AI 的指令"
                        />
                        <div className="composer-tools">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={deepThinking}
                                className="think-toggle"
                                title="让模型先推理再动手。更适合复杂指令，但会慢很多。"
                                onClick={() => {
                                    saveThinking(!deepThinking);
                                    setDeepThinking(!deepThinking);
                                }}
                            >
                                <svg viewBox="0 0 16 16" aria-hidden>
                                    <path d="M8 1.75a4.25 4.25 0 0 0-2.4 7.76c.4.27.65.72.65 1.2v.54h3.5v-.54c0-.48.25-.93.65-1.2A4.25 4.25 0 0 0 8 1.75ZM6.25 13h3.5M6.75 14.75h2.5" />
                                </svg>
                                深度思考
                            </button>
                            {busy ? (
                                <button type="button" className="send is-stop" onClick={() => stopRef.current?.abort()} aria-label="停止" title="停止">
                                    <svg viewBox="0 0 16 16" aria-hidden>
                                        <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
                                    </svg>
                                </button>
                            ) : canAsk ? (
                                <button type="submit" className="send" disabled={!input.trim()} aria-label="发送" title="发送（回车）">
                                    <svg viewBox="0 0 16 16" aria-hidden>
                                        <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
                                    </svg>
                                </button>
                            ) : (
                                <button type="button" className="send-connect" onClick={() => setSettingsOpen(true)}>
                                    连接模型
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="composer-hint">回车发送，Shift+回车换行 · AI 每轮修改算一步，{UNDO_KEYS} 整体撤回</p>
                </form>
            </aside>
        </div>
    );
}

function LogItem({ entry, index, onOpenSettings }: { entry: LogEntry; index: number; onOpenSettings: () => void }) {
    switch (entry.kind) {
        case 'prompt':
            return (
                <div className={`note${index % 2 ? ' note-tilt' : ''}`}>
                    <p>{entry.text}</p>
                    {entry.example && <span className="note-tag">示例</span>}
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
                        const { kind, title, detail } = describeCall(call, result);
                        return (
                            <li key={i} className={`op op-${kind}`}>
                                <p className="op-title">{title}</p>
                                {detail && <p className="op-detail">{detail}</p>}
                                {result.errors.length > 0 && (
                                    <ul className="op-errors" aria-label="退回给模型的错误">
                                        {result.errors.map((err) => (
                                            <li key={err}>{err}</li>
                                        ))}
                                    </ul>
                                )}
                                <details>
                                    <summary>查看参数</summary>
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

const PENDING: Record<string, [string, string]> = {
    add_shapes: ['正在添加图形', '个'],
    add_diagram: ['正在描述图的结构', '个节点'],
    draw_sketch: ['正在构思线稿', '笔'],
    update_shapes: ['正在修改图形', '处'],
    delete_shapes: ['正在删除图形', '个'],
};

/** The reply as it streams in: text grows word by word, tool calls show how far along they are. */
type LiveReplyProps = { message: LiveMessage; thinkingSeconds: number; thoughtOpen: boolean; onToggleThought: () => void };

function LiveReply({ message, thinkingSeconds, thoughtOpen, onToggleThought }: LiveReplyProps) {
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
                    const [label, unit] = PENDING[b.name] ?? [`正在调用 ${b.name}`, '项'];
                    const n = countSoFar(b.name, b.partialJson);
                    return (
                        <div key={i} className="op op-pending" role="status">
                            <span className="spinner" aria-hidden />
                            <p className="op-title">{label}</p>
                            <p className="op-detail">{n ? `已写好 ${n} ${unit}，写完后一起画到白板上` : '正在写参数'}</p>
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
                    <span className="trim">{live ? `正在思考，已 ${seconds} 秒` : seconds ? `思考了 ${seconds} 秒` : '思考过程'}</span>
                </span>
                <span className="thought-action">
                    <span className="trim">{open ? '收起' : '展开'}</span>
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
