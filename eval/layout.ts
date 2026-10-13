/**
 * Layout benchmark: lay out every case in cases/diagrams.ts with add_diagram's layout, measure it,
 * compare with eval/baseline.json and write eval/out/layout.html.
 *
 *   pnpm eval:layout            measure and compare
 *   pnpm eval:layout --update   also save the results as the new baseline
 *   pnpm eval:layout --check    exit with an error when any case scores lower than its baseline
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../src/layout/diagram';
import { DIAGRAM_CASES } from './cases/diagrams';
import { layoutScore, measureLayout, type LayoutMetrics } from './metrics';
import { metricsTable, page, scoreBadge, svgOf } from './report';

const here = dirname(fileURLToPath(import.meta.url));
const baselineFile = join(here, 'baseline.json');
const outDir = join(here, 'out');
const args = new Set(process.argv.slice(2));

const baseline: Record<string, LayoutMetrics> = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {};

let counter = 0;
const results = DIAGRAM_CASES.map((c) => {
    const { shapes } = layoutDiagram(c.input, { origin: { x: 0, y: 0 }, createId: () => `s${++counter}` });
    return { ...c, shapes, metrics: measureLayout(shapes) };
});

const rows = results.map((r) => {
    const before = baseline[r.id];
    const score = layoutScore(r.metrics);
    const was = before ? layoutScore(before) : undefined;
    return {
        case: r.id,
        score: was === undefined || was === score ? `${score}` : `${score} (${score > was ? '+' : ''}${score - was})`,
        crossings: r.metrics.crossings,
        throughBox: r.metrics.edgeThroughBox,
        labelOverlaps: r.metrics.labelOverlaps,
        closeParallels: r.metrics.closeParallels,
        bends: r.metrics.bendsPerEdge,
    };
});
console.table(rows);
const average = Math.round(results.reduce((s, r) => s + layoutScore(r.metrics), 0) / results.length);
const averageBefore = Object.keys(baseline).length
    ? Math.round(results.reduce((s, r) => s + layoutScore(baseline[r.id] ?? r.metrics), 0) / results.length)
    : undefined;
console.log(`Average score: ${average}${averageBefore !== undefined && averageBefore !== average ? ` (baseline ${averageBefore})` : ''}`);

mkdirSync(outDir, { recursive: true });
const report = join(outDir, 'layout.html');
writeFileSync(
    report,
    page(
        '布局测试',
        `${results.length} 个用例，平均分 ${average}${averageBefore !== undefined ? `（基线 ${averageBefore}）` : ''}。括号里是和基线（eval/baseline.json）相比的变化，绿色变好，红色变差。`,
        results.map((r) => ({
            title: r.title,
            subtitle: r.id,
            badge: scoreBadge(r.metrics, baseline[r.id]),
            body: metricsTable(r.metrics, baseline[r.id]),
            picture: svgOf(r.shapes),
        })),
    ),
);
console.log(`Report: ${report}`);

if (args.has('--update')) {
    writeFileSync(baselineFile, `${JSON.stringify(Object.fromEntries(results.map((r) => [r.id, r.metrics])), null, 2)}\n`);
    console.log(`Baseline updated: ${baselineFile}`);
}
if (args.has('--check')) {
    const worse = results.filter((r) => baseline[r.id] && layoutScore(r.metrics) < layoutScore(baseline[r.id]));
    if (worse.length) {
        console.error(`Scores dropped: ${worse.map((r) => r.id).join(', ')}`);
        process.exit(1);
    }
}
