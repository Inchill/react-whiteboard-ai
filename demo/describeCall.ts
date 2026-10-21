import type { ToolCall, ToolCallResult } from '../src';
import type { Lang } from './i18n';

export type CallKind = 'add' | 'update' | 'delete' | 'error';

const TYPE_NAMES: Record<Lang, Record<string, string>> = {
    zh: { rect: '个矩形', ellipse: '个椭圆', triangle: '个三角形', line: '条线', arrow: '个箭头', text: '段文字' },
    en: { rect: 'rectangle', ellipse: 'ellipse', triangle: 'triangle', line: 'line', arrow: 'arrow', text: 'label' },
};

/** A count with an English noun, plural when it is not one: "1 arrow", "2 arrows". */
const en = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const field = (v: unknown, k: string) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined);

/** One plain-language line saying what a tool call does, so the log reads without opening JSON. */
export function describeCall(call: ToolCall, result: ToolCallResult, lang: Lang = 'zh'): { kind: CallKind; title: string; detail?: string } {
    const kind: CallKind = !result.ok && !result.created.length && !result.updated.length && !result.deleted.length
        ? 'error'
        : call.name === 'add_shapes' || call.name === 'add_diagram' || call.name === 'draw_sketch' ? 'add' : call.name === 'delete_shapes' ? 'delete' : 'update';
    const zh = lang === 'zh';
    const failed = kind === 'error';

    switch (call.name) {
        case 'add_shapes': {
            const shapes = list(field(call.input, 'shapes'));
            const counts = new Map<string, number>();
            for (const s of shapes) {
                const t = String(field(s, 'type'));
                counts.set(t, (counts.get(t) ?? 0) + 1);
            }
            const names = TYPE_NAMES[lang];
            const parts = [...counts].map(([t, n]) => (zh ? (names[t] ? `${n} ${names[t]}` : `${n} 个“${t}”`) : en(n, names[t] ?? `"${t}"`)));
            const done = result.created.length;
            return {
                kind,
                title: zh
                    ? failed ? `想添加 ${shapes.length} 个图形，但参数有误` : `添加了 ${done} 个图形`
                    : failed ? `Tried to add ${en(shapes.length, 'shape')}, but the input was invalid` : `Added ${en(done, 'shape')}`,
                detail: parts.join(zh ? '、' : ', '),
            };
        }
        case 'update_shapes': {
            const n = list(field(call.input, 'updates')).length;
            const done = result.updated.length;
            return {
                kind,
                title: zh
                    ? failed ? `想修改 ${n} 个图形，但参数有误` : `修改了 ${done} 个图形`
                    : failed ? `Tried to edit ${en(n, 'shape')}, but the input was invalid` : `Edited ${en(done, 'shape')}`,
            };
        }
        case 'add_diagram': {
            const nodes = list(field(call.input, 'nodes')).length;
            const edges = list(field(call.input, 'edges')).length;
            const layers = new Set(list(field(call.input, 'nodes')).map((n) => field(n, 'layer')).filter(Boolean)).size;
            const parts = zh
                ? [`${nodes} 个节点`, `${edges} 条连线`, ...(layers ? [`${layers} 层`] : [])]
                : [en(nodes, 'node'), en(edges, 'edge'), ...(layers ? [en(layers, 'layer')] : [])];
            return {
                kind,
                title: zh ? (failed ? '想画一张图，但结构有误' : '自动排版了一张图') : failed ? 'Tried to draw a diagram, but its structure was invalid' : 'Laid out a diagram',
                detail: parts.join(zh ? '、' : ', '),
            };
        }
        case 'draw_sketch': {
            const strokes = list(field(call.input, 'strokes')).length;
            const parts = list(field(call.input, 'parts')).length;
            const joined = result.notes?.filter((n) => n.includes('to join')).length ?? 0;
            return {
                kind,
                title: zh ? (failed ? '想画一幅线稿，但没通过检查' : '手绘了一幅线稿') : failed ? 'Tried to draw a sketch, but it failed the checks' : 'Drew a sketch',
                detail: zh
                    ? failed
                        ? `规划了 ${parts} 个部分、${strokes} 笔`
                        : `规划了 ${parts} 个部分，画了 ${strokes} 笔${joined ? `，自动接上 ${joined} 处断开的部分` : ''}`
                    : failed
                        ? `Planned ${en(parts, 'part')} and ${en(strokes, 'stroke')}`
                        : `Planned ${en(parts, 'part')}, drew ${en(strokes, 'stroke')}${joined ? `, joined ${joined} loose ${joined === 1 ? 'part' : 'parts'}` : ''}`,
            };
        }
        case 'delete_shapes': {
            const n = list(field(call.input, 'ids')).length;
            const done = result.deleted.length;
            return {
                kind,
                title: zh
                    ? failed ? `想删除 ${n} 个图形，但没找到` : `删除了 ${done} 个图形`
                    : failed ? `Tried to delete ${en(n, 'shape')}, but none were found` : `Deleted ${en(done, 'shape')}`,
            };
        }
        default:
            return { kind: 'error', title: zh ? `调用了不存在的工具“${call.name}”` : `Called a tool that does not exist: "${call.name}"` };
    }
}
