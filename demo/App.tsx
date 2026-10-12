import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { formatToolResult, useWhiteboardAI, type ToolCall, type ToolCallResult } from '../src';
import { describeCall } from './describeCall';
import { EXAMPLES } from './examples';
import { SettingsPanel } from './SettingsPanel';
import { countSoFar, fromCompleteMessage, readMessageStream, toAssistantContent, type LiveMessage } from './stream';
import { clearSettings, loadSettings, modelInfo, PROVIDERS, saveSettings, settingsHeaders, type AISettings, type Provider } from './settings';

type LogEntry =
    | { kind: 'prompt'; text: string; example: boolean }
    | { kind: 'say'; text: string }
    | { kind: 'calls'; calls: ToolCall[]; results: ToolCallResult[] }
    | { kind: 'error'; text: string; auth: boolean };

type Message = { role: 'user' | 'assistant'; content: unknown };

/** How many model ↔ tool round trips one prompt may take. */
const MAX_ROUNDS = 5;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = isMac ? '⌘Z' : 'Ctrl+Z';

export function App() {
    const board = useRef<WhiteboardHandle>(null);
    const ai = useWhiteboardAI(board);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    /** The model's reply while it is still streaming in. */
    const [live, setLive] = useState<LiveMessage | null>(null);
    const stopRef = useRef<AbortController | null>(null);
    /** Provider configured in .env.local, if any. */
    const [serverModel, setServerModel] = useState<{ provider: Provider; model: string } | null>(null);
    const [settings, setSettings] = useState<AISettings | null>(loadSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const logEnd = useRef<HTMLDivElement>(null);
    const composer = useRef<HTMLTextAreaElement>(null);
    // Bumped after each AI turn; the effect below fits the view once React has rendered the new shapes.
    const [fitRequest, setFitRequest] = useState(0);
    const canAsk = Boolean(settings || serverModel);

    useEffect(() => {
        fetch('/api/status')
            .then((r) => r.json())
            .then((s) => setServerModel(s && PROVIDERS[s.provider as Provider] ? s : null))
            .catch(() => setServerModel(null));
    }, []);

    // Braces matter: newer browsers return a Promise from scrollIntoView, and React treats
    // any non-function return value of an effect as a mistake.
    useEffect(() => {
        logEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, [log, busy, live]);

    useEffect(() => {
        if (fitRequest) board.current?.zoomToFit();
    }, [fitRequest]);

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
        setBusy(true);
        push({ kind: 'prompt', text: prompt, example });
        const stop = new AbortController();
        stopRef.current = stop;
        const messages: Message[] = [{ role: 'user', content: `Board:\n${JSON.stringify(ai.describe())}\n\n${prompt}` }];
        // Stream updates arrive many times a second; render at most once per frame.
        let frame = 0;
        const show = (m: LiveMessage) => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setLive(m));
        };
        try {
            for (let round = 0; round < MAX_ROUNDS; round++) {
                const res = await fetch('/api/ai', {
                    method: 'POST',
                    signal: stop.signal,
                    headers: { 'content-type': 'application/json', ...(settings ? settingsHeaders(settings) : {}) },
                    body: JSON.stringify({ messages }),
                });
                if (!res.ok || !res.body) {
                    const data = await res.json().catch(() => ({}));
                    const detail = data.error?.message ?? data.error ?? `HTTP ${res.status}`;
                    const auth = res.status === 401 || res.status === 403;
                    push({ kind: 'error', text: auth ? `模型拒绝了这个 API key（${res.status}）：${detail}` : `请求失败：${detail}`, auth });
                    return;
                }
                // The proxy streams; if the upstream answered in one piece instead, read it whole.
                const streamed = (res.headers.get('content-type') ?? '').includes('text/event-stream');
                const message = streamed ? await readMessageStream(res.body, show) : fromCompleteMessage(await res.json());
                cancelAnimationFrame(frame);
                setLive(null);

                messages.push({ role: 'assistant', content: toAssistantContent(message) });
                for (const b of message.blocks) if (b.type === 'text' && b.text.trim()) push({ kind: 'say', text: b.text });
                const calls = message.blocks.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
                if (!calls.length) break;
                // Everything the model wrote this round lands on the board at once: one undo step.
                const results = run(calls);
                messages.push({
                    role: 'user',
                    content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: formatToolResult(r), is_error: !r.ok })),
                });
            }
        } catch (err) {
            if (stop.signal.aborted) push({ kind: 'say', text: '已停止。这一轮还没写完的修改没有画到白板上。' });
            else push({ kind: 'error', text: `出错了：${err instanceof Error ? err.message : String(err)}`, auth: false });
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

    const connection = settings
        ? modelInfo(settings)
        : serverModel
            ? { provider: PROVIDERS[serverModel.provider].label, model: serverModel.model }
            : null;

    return (
        <div className="demo">
            <main className="demo-board" aria-label="白板">
                <Whiteboard ref={board} storageKey="react-whiteboard-ai-demo" locale="zh" />
            </main>

            <aside className="panel" aria-label="AI 助手">
                <header className="panel-head">
                    <h1>react-whiteboard-ai</h1>
                    <button
                        type="button"
                        className={`connection${connection ? ' is-on' : ''}`}
                        aria-expanded={settingsOpen}
                        onClick={() => setSettingsOpen((o) => !o)}
                    >
                        <span className="connection-dot" aria-hidden />
                        {connection ? (
                            <>
                                <strong>{connection.provider}</strong>
                                <span className="connection-model">{connection.model}</span>
                                {!settings && <span className="connection-model">（.env.local）</span>}
                            </>
                        ) : (
                            <strong>连接模型</strong>
                        )}
                    </button>
                </header>

                {settingsOpen && (
                    <SettingsPanel
                        settings={settings}
                        hasServerKey={Boolean(serverModel)}
                        onSave={(s) => {
                            saveSettings(s);
                            setSettings(s);
                            setSettingsOpen(false);
                            composer.current?.focus();
                        }}
                        onClear={() => {
                            clearSettings();
                            setSettings(null);
                            setSettingsOpen(false);
                        }}
                        onClose={() => setSettingsOpen(false)}
                    />
                )}

                <section className="log" aria-live="polite" aria-label="操作记录">
                    {log.length === 0 && (
                        <div className="log-empty">
                            <p className="log-empty-hand">告诉我要在白板上画什么</p>
                            <p>
                                比如“画一个三步的注册流程”“把所有框改成蓝色”。
                                {canAsk ? '也可以直接点下面的示例。' : '先在右上角连接模型（DeepSeek 或 Claude），再输入指令或点下面的示例。'}
                            </p>
                        </div>
                    )}
                    {log.map((entry, i) => (
                        <LogItem key={i} entry={entry} index={i} onOpenSettings={() => setSettingsOpen(true)} />
                    ))}
                    {live && <LiveReply message={live} />}
                    {busy && !live?.blocks.some((b) => b && b.type !== 'other') && (
                        <p className="log-busy" role="status">
                            正在想<span aria-hidden>…</span>
                        </p>
                    )}
                    <div ref={logEnd} />
                </section>

                <form
                    className="composer"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void ask(input);
                    }}
                >
                    <div className="composer-examples" role="group" aria-label="示例">
                        <span>试试</span>
                        {EXAMPLES.map((ex) => (
                            <button key={ex.label} type="button" onClick={() => void ask(ex.prompt, true)} disabled={busy} title={ex.prompt}>
                                {ex.label}
                            </button>
                        ))}
                    </div>
                    <div className="composer-box">
                        <textarea
                            ref={composer}
                            value={input}
                            rows={2}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={onComposerKey}
                            placeholder={canAsk ? '要画什么？回车发送，Shift+回车换行' : '先连接模型，才能用文字指挥'}
                            disabled={!canAsk || busy}
                            aria-label="给 AI 的指令"
                        />
                        {busy ? (
                            <button type="button" className="button-stop" onClick={() => stopRef.current?.abort()}>
                                停止
                            </button>
                        ) : canAsk ? (
                            <button type="submit" className="button-primary" disabled={!input.trim()}>
                                发送
                            </button>
                        ) : (
                            <button type="button" className="button-primary" onClick={() => setSettingsOpen(true)}>
                                连接
                            </button>
                        )}
                    </div>
                    <p className="composer-hint">AI 每一轮的修改算一步，按 {UNDO_KEYS} 可以整体撤回。</p>
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
        case 'error':
            return (
                <div className="op op-error">
                    <p className="op-title">{entry.text}</p>
                    {entry.auth && (
                        <button type="button" className="button-quiet" onClick={onOpenSettings}>
                            检查 API key
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
    update_shapes: ['正在修改图形', '处'],
    delete_shapes: ['正在删除图形', '个'],
};

/** The reply as it streams in: text grows word by word, tool calls show how far along they are. */
function LiveReply({ message }: { message: LiveMessage }) {
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
                    // Reasoning models (DeepSeek V4 among them) think before answering; show it so the wait is visible.
                    const writing = i === message.blocks.length - 1;
                    return b.thinking ? (
                        <details key={i} className="thinking" open={writing}>
                            <summary>{writing ? '正在思考…' : '思考过程'}</summary>
                            <p className={writing ? 'say-live' : undefined}>{b.thinking}</p>
                        </details>
                    ) : null;
                }
                if (b.type === 'tool_use') {
                    const [label, unit] = PENDING[b.name] ?? [`正在调用 ${b.name}`, '项'];
                    const n = countSoFar(b.name, b.partialJson);
                    return (
                        <div key={i} className="op op-pending" role="status">
                            <p className="op-title">
                                {label}
                                <span aria-hidden>…</span>
                            </p>
                            <p className="op-detail">{n ? `已写好 ${n} ${unit}，写完后一起画到白板上` : '正在写参数'}</p>
                        </div>
                    );
                }
                return null;
            })}
        </>
    );
}
