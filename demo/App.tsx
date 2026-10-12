import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { formatToolResult, useWhiteboardAI, type ToolCall, type ToolCallResult } from '../src';
import { describeCall } from './describeCall';
import { EXAMPLES, type Example } from './examples';
import { SettingsPanel } from './SettingsPanel';
import { clearSettings, loadSettings, modelInfo, PROVIDERS, saveSettings, settingsHeaders, type AISettings, type Provider } from './settings';

type LogEntry =
    | { kind: 'prompt'; text: string; canned: boolean }
    | { kind: 'say'; text: string }
    | { kind: 'calls'; calls: ToolCall[]; results: ToolCallResult[] }
    | { kind: 'error'; text: string; auth: boolean };

type ContentBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
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
    }, [log, busy]);

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

    const runExample = (ex: Example) => {
        const description = ai.describe();
        if (!description) return;
        push({ kind: 'prompt', text: ex.prompt, canned: true });
        const calls = ex.calls(description);
        if (calls.length) run(calls);
        else push({ kind: 'say', text: '画布上还没有东西。先画几笔，或者试试“画一个登录流程图”。' });
    };

    async function ask(e?: FormEvent) {
        e?.preventDefault();
        const prompt = input.trim();
        if (!prompt || busy || !canAsk) return;
        setInput('');
        setBusy(true);
        push({ kind: 'prompt', text: prompt, canned: false });
        const messages: Message[] = [{ role: 'user', content: `Board:\n${JSON.stringify(ai.describe())}\n\n${prompt}` }];
        try {
            for (let round = 0; round < MAX_ROUNDS; round++) {
                const res = await fetch('/api/ai', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...(settings ? settingsHeaders(settings) : {}) },
                    body: JSON.stringify({ messages }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const detail = data.error?.message ?? data.error ?? `HTTP ${res.status}`;
                    const auth = res.status === 401 || res.status === 403;
                    push({ kind: 'error', text: auth ? `模型拒绝了这个 API key（${res.status}）：${detail}` : `请求失败：${detail}`, auth });
                    return;
                }
                const content = data.content as ContentBlock[];
                messages.push({ role: 'assistant', content });
                for (const b of content) if (b.type === 'text' && b.text.trim()) push({ kind: 'say', text: b.text });
                const calls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
                if (!calls.length) break;
                const results = run(calls);
                messages.push({
                    role: 'user',
                    content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: formatToolResult(r), is_error: !r.ok })),
                });
            }
        } catch (err) {
            push({ kind: 'error', text: `连不上本地开发服务器：${err instanceof Error ? err.message : String(err)}`, auth: false });
        } finally {
            setBusy(false);
            composer.current?.focus();
        }
    }

    const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends, Shift+Enter breaks the line; never send while an IME is composing (Chinese input).
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ask();
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
                                {canAsk ? '' : '还没连接模型的话，可以先点下面的示例看效果。'}
                            </p>
                        </div>
                    )}
                    {log.map((entry, i) => (
                        <LogItem key={i} entry={entry} index={i} onOpenSettings={() => setSettingsOpen(true)} />
                    ))}
                    {busy && (
                        <p className="log-busy" role="status">
                            正在画<span aria-hidden>…</span>
                        </p>
                    )}
                    <div ref={logEnd} />
                </section>

                <form onSubmit={ask} className="composer">
                    <div className="composer-examples" role="group" aria-label="示例">
                        <span>示例</span>
                        {EXAMPLES.map((ex) => (
                            <button key={ex.label} type="button" onClick={() => runExample(ex)} disabled={busy}>
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
                        {canAsk ? (
                            <button type="submit" className="button-primary" disabled={busy || !input.trim()}>
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
                    {entry.canned && <span className="note-tag">示例</span>}
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
