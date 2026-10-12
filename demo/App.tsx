import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { formatToolResult, useWhiteboardAI, type ToolCall, type ToolCallResult } from '../src';
import { EXAMPLES, type Example } from './examples';

type LogEntry =
    | { kind: 'prompt'; text: string }
    | { kind: 'say'; text: string }
    | { kind: 'calls'; calls: ToolCall[]; results: ToolCallResult[] }
    | { kind: 'error'; text: string };

type ContentBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
type Message = { role: 'user' | 'assistant'; content: unknown };

/** How many model ↔ tool round trips one prompt may take. */
const MAX_ROUNDS = 5;

export function App() {
    const board = useRef<WhiteboardHandle>(null);
    const ai = useWhiteboardAI(board);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [model, setModel] = useState<string | null | undefined>(undefined);
    const logEnd = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch('/api/status')
            .then((r) => r.json())
            .then((s) => setModel(s.model))
            .catch(() => setModel(null));
    }, []);

    // Braces matter: newer browsers return a Promise from scrollIntoView, and React treats
    // any non-function return value of an effect as a mistake.
    useEffect(() => {
        logEnd.current?.scrollIntoView({ block: 'end' });
    }, [log]);

    const push = (entry: LogEntry) => setLog((l) => [...l, entry]);

    const run = (calls: ToolCall[]) => {
        const results = ai.execute(calls);
        push({ kind: 'calls', calls, results });
        requestAnimationFrame(() => board.current?.zoomToFit());
        return results;
    };

    const runExample = (ex: Example) => {
        const description = ai.describe();
        if (!description) return;
        push({ kind: 'prompt', text: ex.prompt });
        const calls = ex.calls(description);
        if (calls.length) run(calls);
        else push({ kind: 'say', text: '画布是空的，先画点东西或运行第一个示例。' });
    };

    async function ask(e: FormEvent) {
        e.preventDefault();
        const prompt = input.trim();
        if (!prompt || busy) return;
        setInput('');
        setBusy(true);
        push({ kind: 'prompt', text: prompt });
        const messages: Message[] = [{ role: 'user', content: `Board:\n${JSON.stringify(ai.describe())}\n\n${prompt}` }];
        try {
            for (let round = 0; round < MAX_ROUNDS; round++) {
                const res = await fetch('/api/ai', { method: 'POST', body: JSON.stringify({ messages }) });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error?.message ?? data.error ?? `HTTP ${res.status}`);
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
            push({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="demo">
            <main className="demo-board">
                <Whiteboard ref={board} storageKey="react-whiteboard-ai-demo" locale="zh" />
            </main>
            <aside className="demo-panel">
                <header>
                    <h1>react-whiteboard-ai</h1>
                    <p>
                        AI 的每一轮修改都只算一步撤销，按 <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> 即可整体撤回。
                    </p>
                </header>

                <section>
                    <h2>预置示例 · 无需 API key</h2>
                    <div className="demo-examples">
                        {EXAMPLES.map((ex) => (
                            <button key={ex.label} type="button" onClick={() => runExample(ex)} disabled={busy}>
                                {ex.label}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="demo-log" aria-live="polite">
                    {log.length === 0 && <p className="demo-muted">运行一个示例，这里会显示模型发出的工具调用和执行结果。</p>}
                    {log.map((entry, i) => (
                        <LogItem key={i} entry={entry} />
                    ))}
                    <div ref={logEnd} />
                </section>

                <form onSubmit={ask} className="demo-ask">
                    {model === null && (
                        <p className="demo-muted">
                            想用自然语言指挥？在项目根目录的 <code>.env.local</code> 里写入 <code>ANTHROPIC_API_KEY=...</code>，然后重启 <code>pnpm dev</code>。
                        </p>
                    )}
                    {model && <p className="demo-muted">模型：{model}</p>}
                    <div className="demo-ask-row">
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={model ? '比如：在右边画一个三步的注册流程' : '需要先配置 API key'}
                            disabled={!model || busy}
                            aria-label="给 AI 的指令"
                        />
                        <button type="submit" disabled={!model || busy || !input.trim()}>
                            {busy ? '思考中…' : '发送'}
                        </button>
                    </div>
                </form>
            </aside>
        </div>
    );
}

function LogItem({ entry }: { entry: LogEntry }) {
    switch (entry.kind) {
        case 'prompt':
            return <div className="log-prompt">{entry.text}</div>;
        case 'say':
            return <div className="log-say">{entry.text}</div>;
        case 'error':
            return <div className="log-error">{entry.text}</div>;
        case 'calls':
            return (
                <div className="log-calls">
                    {entry.calls.map((call, i) => {
                        const r = entry.results[i];
                        return (
                            <details key={i} className={r.ok ? 'ok' : 'fail'}>
                                <summary>
                                    <code>{call.name}</code>
                                    <span>{r.ok ? '已执行' : '有错误'}</span>
                                </summary>
                                <pre>{JSON.stringify(call.input, null, 2)}</pre>
                                <pre className="log-result">{formatToolResult(r)}</pre>
                            </details>
                        );
                    })}
                </div>
            );
    }
}
