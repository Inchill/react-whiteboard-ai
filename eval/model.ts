/**
 * Model eval: send each prompt in cases/prompts.ts to the model configured in .env.local, run its
 * tool calls the way the demo does, and measure the result: did the drawing contain what was asked
 * for, how well is it laid out, how many rounds, how long and how many tokens.
 * Writes eval/out/model-<time>.html and .json.
 *
 *   pnpm eval:model                       every case once
 *   pnpm eval:model --case er,login       some cases
 *   pnpm eval:model --runs 3              each case three times (results vary between runs)
 *   pnpm eval:model --thinking            with the model's reasoning turned on
 *
 * The model comes from AI_BASE_URL, AI_API_KEY and AI_MODEL (or DEEPSEEK_API_KEY / ANTHROPIC_API_KEY),
 * in the environment or in .env.local / .env.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callModel, serviceName, type Target } from '../demo/modelRequest';
import { targetFromEnv } from '../demo/server';
import { fromCompleteMessage, readMessageStream, toAssistantContent } from '../demo/stream';
import { describeBoard, executeToolCalls, formatToolResult, type ToolCall } from '../src';
import type { DiagramInput } from '../src/layout/diagram';
import type { Shape } from '../src/types';
import { PROMPT_CASES, type PromptCase } from './cases/prompts';
import { layoutScore, measureLayout, type LayoutMetrics } from './metrics';
import { metricsTable, page, scoreBadge, svgOf } from './report';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MAX_ROUNDS = 4;

// ---- options and model ---------------------------------------------------------------------

function option(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
}

/** KEY=value lines; quotes stripped. Values already in the environment win, as with Vite. */
function readEnvFile(file: string): Record<string, string> {
    if (!existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return out;
}

const env = { ...readEnvFile(join(root, '.env')), ...readEnvFile(join(root, '.env.local')), ...(process.env as Record<string, string>) };
const target: Target | null = targetFromEnv(env);
if (!target) {
    console.error('No model configured. Set AI_BASE_URL, AI_API_KEY and AI_MODEL in .env.local (see .env.example).');
    process.exit(1);
}
const thinking = process.argv.includes('--thinking');
const runs = Math.max(1, Number(option('runs') ?? 1) || 1);
const only = option('case')?.split(',').map((s) => s.trim());
const cases = only ? PROMPT_CASES.filter((c) => only.includes(c.id)) : PROMPT_CASES;
if (!cases.length) {
    console.error(`No case matches ${only?.join(', ')}. Cases: ${PROMPT_CASES.map((c) => c.id).join(', ')}`);
    process.exit(1);
}

// ---- one session -------------------------------------------------------------------------------

type Usage = { input: number; output: number };

/** Read the token counts from the raw event stream (message_start and message_delta carry them). */
async function sniffUsage(body: ReadableStream<Uint8Array>, usage: Usage) {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let text = '';
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += decoder.decode(r.value, { stream: true });
    const all = (re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1]));
    usage.input += Math.max(0, ...all(/"input_tokens"\s*:\s*(\d+)/g));
    usage.output += Math.max(0, ...all(/"output_tokens"\s*:\s*(\d+)/g));
}

type Turn = { rounds: number; calls: ToolCall[]; failedCalls: number; notes: string[] };

/** One prompt as the demo runs it: send, apply tool calls, return errors to the model, at most MAX_ROUNDS. */
async function turn(prompt: string, board: { shapes: Shape[] }, usage: Usage): Promise<Turn> {
    const messages: { role: string; content: unknown }[] = [{ role: 'user', content: `Board:\n${JSON.stringify(describeBoard(board.shapes))}\n\n${prompt}` }];
    const out: Turn = { rounds: 0, calls: [], failedCalls: 0, notes: [] };
    for (let round = 0; round < MAX_ROUNDS; round++) {
        out.rounds++;
        const res = await callModel(target!, { messages, thinking });
        if (!res.ok || !res.body) {
            out.notes.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
            break;
        }
        let message;
        if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
            const [a, b] = res.body.tee();
            [message] = await Promise.all([readMessageStream(a, () => {}), sniffUsage(b, usage)]);
        } else {
            const data = await res.json();
            usage.input += data.usage?.input_tokens ?? 0;
            usage.output += data.usage?.output_tokens ?? 0;
            message = fromCompleteMessage(data);
        }
        messages.push({ role: 'assistant', content: toAssistantContent(message) });
        const calls = message.blocks.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
        if (!calls.length) {
            if (message.stopReason === 'max_tokens') out.notes.push('hit max_tokens before calling a tool');
            break;
        }
        const { shapes, results } = executeToolCalls(board.shapes, calls);
        board.shapes = shapes;
        out.calls.push(...calls);
        out.failedCalls += results.filter((r) => !r.ok).length;
        if (results.every((r) => r.ok)) break;
        messages.push({
            role: 'user',
            content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: formatToolResult(r), is_error: !r.ok })),
        });
    }
    return out;
}

// ---- checking the content ------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

type Content = { missingNodes: string[]; missingEdges: string[]; edgesChecked: boolean; usedDiagram: boolean };

function checkContent(c: PromptCase, shapes: Shape[], calls: ToolCall[]): Content {
    const texts = shapes.filter((s): s is Extract<Shape, { type: 'text' }> => s.type === 'text').map((t) => norm(t.text));
    const missingNodes = c.expect.nodes.filter((n) => !texts.some((t) => t.includes(norm(n))));
    // Edges are known only from add_diagram input; shapes alone do not say what an arrow connects.
    const diagrams = calls.filter((k) => k.name === 'add_diagram').map((k) => k.input as DiagramInput);
    const links = diagrams.flatMap((d) => {
        const label = new Map((d.nodes ?? []).map((n) => [n.id, norm(n.label ?? '')]));
        return (d.edges ?? []).map((e) => [label.get(e.from) ?? '', label.get(e.to) ?? ''] as const);
    });
    const missingEdges = (c.expect.edges ?? [])
        .filter(([a, b]) => !links.some(([from, to]) => from.includes(norm(a)) && to.includes(norm(b))))
        .map(([a, b]) => `${a} → ${b}`);
    return { missingNodes, missingEdges, edgesChecked: diagrams.length > 0, usedDiagram: diagrams.length > 0 };
}

// ---- run ---------------------------------------------------------------------------------------------

type Result = {
    case: string;
    run: number;
    ms: number;
    rounds: number;
    toolCalls: string[];
    failedCalls: number;
    usage: Usage;
    content: Content;
    contentScore: number;
    metrics: LayoutMetrics;
    notes: string[];
    shapes: Shape[];
};

const results: Result[] = [];
console.log(`Model: ${serviceName(target.baseUrl)} ${target.model}${thinking ? ' (thinking on)' : ''}, ${cases.length} case(s) × ${runs} run(s)`);
for (const c of cases) {
    for (let run = 1; run <= runs; run++) {
        const board = { shapes: [] as Shape[] };
        const usage: Usage = { input: 0, output: 0 };
        const started = Date.now();
        let first: Turn = { rounds: 0, calls: [], failedCalls: 0, notes: [] };
        let second: Turn | undefined;
        try {
            first = await turn(c.prompt, board, usage);
            if (c.followUp) second = await turn(c.followUp, board, usage);
        } catch (e) {
            first.notes.push(`error: ${e instanceof Error ? e.message : String(e)}`);
        }
        const calls = [...first.calls, ...(second?.calls ?? [])];
        const content = checkContent(c, board.shapes, calls);
        const expected = c.expect.nodes.length + (content.edgesChecked ? (c.expect.edges?.length ?? 0) : 0);
        const found = expected - content.missingNodes.length - (content.edgesChecked ? content.missingEdges.length : 0);
        const result: Result = {
            case: c.id,
            run,
            ms: Date.now() - started,
            rounds: first.rounds + (second?.rounds ?? 0),
            toolCalls: calls.map((k) => k.name),
            failedCalls: first.failedCalls + (second?.failedCalls ?? 0),
            usage,
            content,
            contentScore: expected ? Math.round((100 * found) / expected) : 100,
            metrics: measureLayout(board.shapes),
            notes: [...first.notes, ...(second?.notes ?? [])],
            shapes: board.shapes,
        };
        results.push(result);
        console.log(
            `${c.id}#${run}: content ${result.contentScore}, layout ${layoutScore(result.metrics)}, ${result.rounds} round(s), ` +
                `${(result.ms / 1000).toFixed(1)} s, ${usage.input}+${usage.output} tokens${result.notes.length ? ` — ${result.notes.join('; ')}` : ''}`,
        );
    }
}

// ---- report ----------------------------------------------------------------------------------------

const avg = (f: (r: Result) => number) => Math.round(results.reduce((s, r) => s + f(r), 0) / results.length);
const summary =
    `${serviceName(target.baseUrl)} ${target.model}${thinking ? '，开启深度思考' : ''}。` +
    `${results.length} 次运行：内容平均 ${avg((r) => r.contentScore)} 分，排版平均 ${avg((r) => layoutScore(r.metrics))} 分，` +
    `平均 ${(avg((r) => r.ms) / 1000).toFixed(1)} 秒、${avg((r) => r.rounds)} 轮、输出 ${avg((r) => r.usage.output)} token。`;
console.log(summary);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `model-${stamp}.json`), JSON.stringify({ model: target.model, service: serviceName(target.baseUrl), thinking, results }, null, 2));
const html = join(outDir, `model-${stamp}.html`);
writeFileSync(
    html,
    page(
        '模型测试',
        summary,
        results.map((r) => {
            const c = cases.find((k) => k.id === r.case)!;
            const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li class="miss">${i}</li>`).join('')}</ul>` : '');
            const body =
                '<table>' +
                `<tr><th>内容</th><td>${r.contentScore}</td></tr>` +
                `<tr><th>轮数</th><td>${r.rounds}</td></tr>` +
                `<tr><th>出错的调用</th><td>${r.failedCalls}</td></tr>` +
                `<tr><th>用时</th><td>${(r.ms / 1000).toFixed(1)} 秒</td></tr>` +
                `<tr><th>token</th><td>${r.usage.input} 入 / ${r.usage.output} 出</td></tr>` +
                `<tr><th>工具</th><td>${r.toolCalls.join(', ') || '无'}</td></tr>` +
                '</table>' +
                (r.content.missingNodes.length ? `<p class="note">缺少的内容：</p>${list(r.content.missingNodes)}` : '') +
                (!r.content.edgesChecked && c.expect.edges?.length ? '<p class="note">没用 add_diagram，连线无法检查。</p>' : '') +
                (r.content.missingEdges.length && r.content.edgesChecked ? `<p class="note">缺少的连线：</p>${list(r.content.missingEdges)}` : '') +
                (r.notes.length ? `<p class="note">${r.notes.join('<br>')}</p>` : '') +
                metricsTable(r.metrics);
            return {
                title: `${c.title}${runs > 1 ? ` · 第 ${r.run} 次` : ''}`,
                subtitle: c.followUp ? `${c.prompt} → ${c.followUp}` : c.prompt,
                badge: scoreBadge(r.metrics),
                body,
                picture: svgOf(r.shapes),
            };
        }),
    ),
);
console.log(`Report: ${html}`);
