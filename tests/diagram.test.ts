import { describe, expect, it } from 'vitest';
import { executeToolCalls, formatToolResult, layoutDiagram, parseOperation, type DiagramInput } from '../src';
import type { Shape } from '../src/types';

const ids = () => {
    let n = 0;
    return () => `s${++n}`;
};

type Box = { x: number; y: number; w: number; h: number };
type Linear = Extract<Shape, { type: 'line' | 'arrow' }>;

function boxesOf(input: DiagramInput) {
    const { shapes, nodes } = layoutDiagram(input, { createId: ids() });
    const byId = new Map(shapes.map((s) => [s.id, s]));
    const box = (node: string) => byId.get(nodes[node]) as unknown as Box;
    return { shapes, nodes, box };
}

const arch: DiagramInput = {
    nodes: [
        { id: 'browser', label: '浏览器', layer: '客户端' },
        { id: 'gw', label: 'API 网关', layer: '网关层' },
        { id: 'user', label: '用户服务', layer: '服务层' },
        { id: 'order', label: '订单服务', layer: '服务层' },
        { id: 'mysql', label: 'MySQL', layer: '数据层' },
        { id: 'redis', label: 'Redis', layer: '数据层' },
    ],
    edges: [
        { from: 'browser', to: 'gw' },
        { from: 'gw', to: 'user' },
        { from: 'gw', to: 'order' },
        { from: 'user', to: 'mysql' },
        { from: 'user', to: 'redis' },
        { from: 'order', to: 'mysql' },
        { from: 'order', to: 'redis' },
    ],
};

describe('layoutDiagram', () => {
    it('stacks named layers in order of first use, with one box size and a band per layer', () => {
        const { shapes, box } = boxesOf(arch);
        const rows = ['browser', 'gw', 'user', 'mysql'].map((n) => box(n).y);
        expect([...rows].sort((a, b) => a - b)).toEqual(rows);
        expect(box('user').y).toBe(box('order').y);
        const sizes = new Set(['browser', 'gw', 'user', 'order', 'mysql', 'redis'].map((n) => `${box(n).w}x${box(n).h}`));
        expect(sizes.size).toBe(1);
        const bands = shapes.filter((s) => s.type === 'rect' && s.strokeStyle === 'dashed');
        expect(bands).toHaveLength(4);
        expect(shapes.filter((s) => s.type === 'text').map((s) => (s as Extract<Shape, { type: 'text' }>).text)).toContain('服务层');
    });

    it('never overlaps boxes', () => {
        const { nodes, box } = boxesOf(arch);
        const all = Object.keys(nodes).map(box);
        for (const a of all) {
            for (const b of all) {
                if (a === b) continue;
                const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
                expect(apart).toBe(true);
            }
        }
    });

    it('draws a straight arrow between boxes stacked one above the other', () => {
        const { shapes, box } = boxesOf(arch);
        const b = box('browser');
        const g = box('gw');
        expect(b.x + b.w / 2).toBeCloseTo(g.x + g.w / 2);
        const straight = shapes.filter((s): s is Linear => s.type === 'arrow' && s.x1 === s.x2 && s.y1 >= b.y + b.h && s.y2 <= g.y);
        expect(straight).toHaveLength(1);
    });

    it('joins a parent to several children with a trunk, one bus and an arrow per child', () => {
        const { shapes, box } = boxesOf({
            nodes: ['ceo', 'cto', 'cfo', 'coo'].map((id) => ({ id, label: id.toUpperCase() })),
            edges: [
                { from: 'ceo', to: 'cto' },
                { from: 'ceo', to: 'cfo' },
                { from: 'ceo', to: 'coo' },
            ],
        });
        const arrows = shapes.filter((s): s is Linear => s.type === 'arrow');
        const lines = shapes.filter((s): s is Linear => s.type === 'line');
        expect(arrows).toHaveLength(3);
        expect(lines).toHaveLength(2); // trunk + bus
        const ceo = box('ceo');
        const centers = ['cto', 'cfo', 'coo'].map((n) => box(n).x + box(n).w / 2);
        // Parent centered over its children; arrows end on each child's center.
        expect(ceo.x + ceo.w / 2).toBeCloseTo((centers[0] + centers[2]) / 2);
        expect(arrows.map((a) => a.x2).sort((a, b) => a - b)).toEqual(centers.sort((a, b) => a - b));
    });

    it('ranks by the arrows when there are no layers, and loops a cycle back on the side', () => {
        const { shapes, box } = boxesOf({
            nodes: [
                { id: 'in', label: '输入' },
                { id: 'check', label: '校验' },
                { id: 'retry', label: '重试' },
            ],
            edges: [
                { from: 'in', to: 'check' },
                { from: 'check', to: 'retry', label: '失败' },
                { from: 'retry', to: 'in' },
            ],
        });
        expect(box('in').y).toBeLessThan(box('check').y);
        expect(box('check').y).toBeLessThan(box('retry').y);
        const dashed = shapes.filter((s) => (s.type === 'line' || s.type === 'arrow') && s.strokeStyle === 'dashed');
        expect(dashed).toHaveLength(3);
        expect(shapes.some((s) => s.type === 'text' && s.text === '失败')).toBe(true);
    });

    it('lays layers out left to right with direction "right"', () => {
        const { box } = boxesOf({
            direction: 'right',
            nodes: ['a', 'b', 'c'].map((id) => ({ id, label: id })),
            edges: [
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c' },
            ],
        });
        expect(box('a').y).toBe(box('b').y);
        expect(box('a').x).toBeLessThan(box('b').x);
        expect(box('b').x).toBeLessThan(box('c').x);
    });

    it('puts the top-left corner at x/y, or at the given origin', () => {
        const at = (input: DiagramInput, origin?: { x: number; y: number }) => {
            const { shapes } = layoutDiagram(input, { origin });
            const xs = shapes.flatMap((s) => (s.type === 'line' || s.type === 'arrow' ? [s.x1, s.x2] : 'x' in s ? [s.x] : []));
            const ys = shapes.flatMap((s) => (s.type === 'line' || s.type === 'arrow' ? [s.y1, s.y2] : 'y' in s ? [s.y] : []));
            return [Math.min(...xs), Math.min(...ys)];
        };
        expect(at({ ...arch, x: 100, y: 50 })).toEqual([100, 50]);
        expect(at(arch, { x: -20, y: 7 })).toEqual([-20, 7]);
    });
});

describe('add_diagram tool', () => {
    it('validates structure and reports every problem', () => {
        const r = parseOperation('add_diagram', {
            nodes: [
                { id: 'a', label: 'A', layer: 'top' },
                { id: 'a', label: 'B' },
                { id: 'c', label: '' },
            ],
            edges: [
                { from: 'a', to: 'zzz' },
                { from: 'a', to: 'a' },
            ],
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors).toEqual([
            'input.nodes[1].id: "a" is used by another node',
            'input.nodes[2].label: expected a non-empty string',
            'input.nodes: give every node a layer, or none of them',
            'input.edges[0].to: expected the id of a node in this diagram',
            'input.edges[1]: an edge cannot connect a node to itself',
        ]);
    });

    it('places the diagram beside existing content and reports node boxes to the model', () => {
        const existing: Shape = { id: 'old', type: 'rect', x: 0, y: 20, w: 100, h: 50, fill: 'none', color: 'ink', strokeWidth: 2, strokeStyle: 'solid' };
        const { shapes, results } = executeToolCalls([existing], [{ id: 't1', name: 'add_diagram', input: { nodes: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], edges: [{ from: 'x', to: 'y' }] } }]);
        const added = shapes.slice(1);
        const minX = Math.min(...added.map((s) => ('x' in s ? s.x : s.type === 'arrow' || s.type === 'line' ? Math.min(s.x1, s.x2) : Infinity)));
        expect(minX).toBe(180);
        expect(results[0].ok).toBe(true);
        expect(Object.keys(results[0].nodes!)).toEqual(['x', 'y']);
        expect(formatToolResult(results[0])).toMatch(/^diagram drawn; node boxes: x=\S+, y=\S+/);
    });
});
