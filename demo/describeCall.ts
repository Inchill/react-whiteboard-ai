import type { ToolCall, ToolCallResult } from '../src';

export type CallKind = 'add' | 'update' | 'delete' | 'error';

const TYPE_NAMES: Record<string, [string, string]> = {
    rect: ['个矩形', '矩形'],
    ellipse: ['个椭圆', '椭圆'],
    triangle: ['个三角形', '三角形'],
    line: ['条线', '线'],
    arrow: ['个箭头', '箭头'],
    text: ['段文字', '文字'],
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const field = (v: unknown, k: string) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined);

/** One plain-language line saying what a tool call does, so the log reads without opening JSON. */
export function describeCall(call: ToolCall, result: ToolCallResult): { kind: CallKind; title: string; detail?: string } {
    const kind: CallKind = !result.ok && !result.created.length && !result.updated.length && !result.deleted.length
        ? 'error'
        : call.name === 'add_shapes' || call.name === 'add_diagram' || call.name === 'draw_sketch' ? 'add' : call.name === 'delete_shapes' ? 'delete' : 'update';

    switch (call.name) {
        case 'add_shapes': {
            const shapes = list(field(call.input, 'shapes'));
            const counts = new Map<string, number>();
            for (const s of shapes) {
                const t = String(field(s, 'type'));
                counts.set(t, (counts.get(t) ?? 0) + 1);
            }
            const parts = [...counts].map(([t, n]) => (TYPE_NAMES[t] ? `${n} ${TYPE_NAMES[t][0]}` : `${n} 个“${t}”`));
            const done = result.created.length;
            return {
                kind,
                title: kind === 'error' ? `想添加 ${shapes.length} 个图形，但参数有误` : `添加了 ${done} 个图形`,
                detail: parts.join('、'),
            };
        }
        case 'update_shapes': {
            const n = list(field(call.input, 'updates')).length;
            return { kind, title: kind === 'error' ? `想修改 ${n} 个图形，但参数有误` : `修改了 ${result.updated.length} 个图形` };
        }
        case 'add_diagram': {
            const nodes = list(field(call.input, 'nodes')).length;
            const edges = list(field(call.input, 'edges')).length;
            const layers = new Set(list(field(call.input, 'nodes')).map((n) => field(n, 'layer')).filter(Boolean)).size;
            const parts = [`${nodes} 个节点`, `${edges} 条连线`, ...(layers ? [`${layers} 层`] : [])];
            return {
                kind,
                title: kind === 'error' ? '想画一张图，但结构有误' : '自动排版了一张图',
                detail: parts.join('、'),
            };
        }
        case 'draw_sketch': {
            const strokes = list(field(call.input, 'strokes')).length;
            const parts = list(field(call.input, 'parts')).length;
            return {
                kind,
                title: kind === 'error' ? '想画一幅线稿，但没通过检查' : '手绘了一幅线稿',
                detail:
                    kind === 'error'
                        ? `规划了 ${parts} 个部分、${strokes} 笔`
                        : `规划了 ${parts} 个部分，画了 ${strokes} 笔${result.notes?.length ? `，自动接上 ${result.notes.length} 处断开的部分` : ''}`,
            };
        }
        case 'delete_shapes': {
            const n = list(field(call.input, 'ids')).length;
            return { kind, title: kind === 'error' ? `想删除 ${n} 个图形，但没找到` : `删除了 ${result.deleted.length} 个图形` };
        }
        default:
            return { kind: 'error', title: `调用了不存在的工具“${call.name}”` };
    }
}
