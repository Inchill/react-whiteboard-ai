import { exportToSvg } from '@inchill/react-whiteboard';
import type { Shape } from '../src/types';
import { layoutScore, type LayoutMetrics } from './metrics';

/** A self-contained HTML page of result cards, to open in a browser. No scripts, no external files. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const METRIC_LABELS: [keyof LayoutMetrics, string][] = [
    ['crossings', '交叉'],
    ['edgeThroughBox', '穿过方框'],
    ['labelOverlaps', '标签重叠'],
    ['closeParallels', '平行线过近'],
    ['bendsPerEdge', '平均拐弯'],
    ['edgeLength', '平均线长'],
    ['width', '宽'],
    ['height', '高'],
];

/** "3 (+1)" with the change from the baseline, colored by whether lower is better. */
function cell(now: number, before: number | undefined, higherIsBetter = false): string {
    if (before === undefined || before === now) return `${now}`;
    const diff = Math.round((now - before) * 100) / 100;
    const better = higherIsBetter ? diff > 0 : diff < 0;
    return `${now} <span class="${better ? 'up' : 'down'}">(${diff > 0 ? '+' : ''}${diff})</span>`;
}

export function metricsTable(m: LayoutMetrics, base?: LayoutMetrics): string {
    const rows = METRIC_LABELS.map(([k, label]) => `<tr><th>${label}</th><td>${cell(m[k], base?.[k])}</td></tr>`).join('');
    return `<table>${rows}</table>`;
}

export function scoreBadge(m: LayoutMetrics, base?: LayoutMetrics): string {
    const s = layoutScore(m);
    const tone = s >= 85 ? 'good' : s >= 60 ? 'ok' : 'bad';
    return `<span class="score ${tone}">${cell(s, base && layoutScore(base), true)}</span>`;
}

export function svgOf(shapes: Shape[]): string {
    return shapes.length ? exportToSvg(shapes, { theme: 'light', padding: 16 }) : '<p class="empty">没有画出任何图形</p>';
}

export type Card = { title: string; subtitle?: string; badge?: string; body: string; picture: string };

export function page(title: string, summary: string, cards: Card[]): string {
    const items = cards
        .map(
            (c) => `<section class="card">
  <header><h2>${esc(c.title)}</h2>${c.badge ?? ''}</header>
  ${c.subtitle ? `<p class="sub">${esc(c.subtitle)}</p>` : ''}
  <div class="row"><div class="pic">${c.picture}</div><div class="data">${c.body}</div></div>
</section>`,
        )
        .join('\n');
    return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body { margin: 0; padding: 24px; background: #f5f6f8; color: #1e1e1e; font: 14px/1.5 system-ui, -apple-system, "PingFang SC", sans-serif; }
h1 { margin: 0 0 4px; font-size: 20px; }
.summary { margin: 0 0 20px; color: #5d6573; }
.card { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
.card header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 16px; }
.sub { margin: 2px 0 0; color: #6b7280; font-size: 13px; }
.row { display: flex; gap: 20px; margin-top: 12px; align-items: flex-start; }
.pic { flex: 1; min-width: 0; overflow: auto; border: 1px solid #eef0f3; border-radius: 8px; }
.pic svg { display: block; max-width: 100%; height: auto; }
.data { flex: none; width: 240px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 3px 0; border-bottom: 1px solid #f0f1f3; }
th { color: #6b7280; font-weight: 500; }
.score { font-weight: 700; font-size: 18px; }
.score.good { color: #2f9e44; } .score.ok { color: #f08c00; } .score.bad { color: #e03131; }
.up { color: #2f9e44; font-weight: 600; } .down { color: #e03131; font-weight: 600; }
.empty, .note { color: #6b7280; padding: 8px; }
ul { margin: 6px 0 0; padding-left: 18px; }
.miss { color: #e03131; }
@media (max-width: 760px) { .row { flex-direction: column; } .data { width: 100%; } }
</style></head>
<body><h1>${esc(title)}</h1><p class="summary">${summary}</p>
${items}
</body></html>
`;
}
