import type { BoardDescription, ToolCall } from '../src';

export type Example = { label: string; prompt: string; calls: (board: BoardDescription) => ToolCall[] };

/** Where new content goes: to the right of everything already on the board. */
const origin = (b: BoardDescription) => (b.bounds ? { x: b.bounds.x + b.bounds.w + 80, y: b.bounds.y } : { x: 0, y: 0 });

/**
 * Canned model turns, written exactly as a model would return them,
 * so the whole pipeline can be tried without an API key.
 */
export const EXAMPLES: Example[] = [
    {
        label: '画一个登录流程图',
        prompt: '画一个用户登录的流程图',
        calls: (b) => {
            const { x, y } = origin(b);
            const box = (i: number, text: string, color = 'ink') => [
                { type: 'rect', x: x + i * 240, y, w: 180, h: 80, color, fill: 'semi' },
                { type: 'text', x: x + i * 240 + 24, y: y + 26, text, fontSize: 22 },
            ];
            const arrow = (i: number) => ({ type: 'arrow', x1: x + i * 240 + 188, y1: y + 40, x2: x + i * 240 + 232, y2: y + 40 });
            return [
                {
                    id: 'demo-1',
                    name: 'add_shapes',
                    input: {
                        shapes: [
                            ...box(0, '输入账号密码', '#1971c2'),
                            arrow(0),
                            ...box(1, '服务端校验', '#f08c00'),
                            arrow(1),
                            ...box(2, '登录成功', '#2f9e44'),
                            { type: 'arrow', x1: x + 330, y1: y + 88, x2: x + 330, y2: y + 160, color: '#e03131', strokeStyle: 'dashed' },
                            { type: 'text', x: x + 270, y: y + 168, text: '失败：提示重试', fontSize: 18, color: '#e03131' },
                        ],
                    },
                },
            ];
        },
    },
    {
        label: '全部右移 120 并变蓝',
        prompt: '把所有图形往右移 120，颜色改成蓝色',
        calls: (b) =>
            b.shapes.length
                ? [{ id: 'demo-2', name: 'update_shapes', input: { updates: b.shapes.map((s) => ({ id: s.id, dx: 120, color: '#1971c2' })) } }]
                : [],
    },
    {
        label: '删除最后一个图形',
        prompt: '删掉最后画的那个',
        calls: (b) => (b.shapes.length ? [{ id: 'demo-3', name: 'delete_shapes', input: { ids: [b.shapes[b.shapes.length - 1].id] } }] : []),
    },
    {
        label: '模型出错时',
        prompt: '（演示：模型给了错误的参数）',
        calls: () => [
            {
                id: 'demo-4',
                name: 'add_shapes',
                input: { shapes: [{ type: 'circle', x: 0, y: 0, r: 40 }, { type: 'rect', x: 0, y: 0, w: 0, h: 50, color: 'blue' }] },
            },
            { id: 'demo-5', name: 'delete_shapes', input: { ids: ['not-a-real-id'] } },
        ],
    },
];
