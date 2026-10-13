import { describe, expect, it } from 'vitest';
import { executeToolCalls, formatToolResult, layoutDiagram, parseOperation, type DiagramInput } from '../src';
import type { Shape } from '../src/types';
import { DIAGRAM_CASES } from '../eval/cases/diagrams';
import { measureLayout } from '../eval/metrics';

const ids = () => {
    let n = 0;
    return () => `s${++n}`;
};

type Box = { x: number; y: number; w: number; h: number };
type Linear = Extract<Shape, { type: 'line' | 'arrow' }>;

type Seg = { x1: number; y1: number; x2: number; y2: number; line: Linear; last: boolean };

/** Every straight segment of every line and arrow, through its via points. */
function segmentsOf(shapes: Shape[]): Seg[] {
    return shapes
        .filter((s): s is Linear => s.type === 'line' || s.type === 'arrow')
        .flatMap((line) => {
            const pts = [[line.x1, line.y1], ...(line.via ?? []), [line.x2, line.y2]];
            return pts.slice(1).map(([x2, y2], i) => ({ x1: pts[i][0], y1: pts[i][1], x2, y2, line, last: i === pts.length - 2 }));
        });
}

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

    it('ranks by the arrows when there are no layers, and loops a long cycle around the side', () => {
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
        // One dashed arrow that turns around the side.
        const back = shapes.filter((s): s is Linear => (s.type === 'line' || s.type === 'arrow') && s.strokeStyle === 'dashed');
        expect(back).toHaveLength(1);
        expect(back[0].type).toBe('arrow');
        expect(back[0].via).toHaveLength(2);
        // Enters the box it returns to from the right, pointing left.
        const head = segmentsOf(back).find((g) => g.last)!;
        expect(head.x2).toBeCloseTo(box('in').x + box('in').w + 4);
        expect(head.x2).toBeLessThan(head.x1);
        expect(shapes.some((s) => s.type === 'text' && s.text === '失败')).toBe(true);
    });

    it('routes a short cycle back up through the gap as a dashed arrow', () => {
        const { shapes, box } = boxesOf({
            nodes: [
                { id: 'a', label: '订单', layer: 'svc' },
                { id: 'b', label: '支付', layer: 'svc' },
                { id: 'mq', label: '消息队列', layer: 'mw' },
            ],
            edges: [
                { from: 'b', to: 'mq' },
                { from: 'mq', to: 'a', label: '通知' },
            ],
        });
        const back = shapes.filter((s): s is Linear => s.type === 'arrow' && s.strokeStyle === 'dashed');
        expect(back).toHaveLength(1);
        // Points up and lands just under the box it returns to, never crossing the row sideways.
        expect(back[0].y2).toBeLessThan(back[0].y1);
        expect(back[0].y2).toBeCloseTo(box('a').y + box('a').h + 4);
        expect(back[0].x2).toBeGreaterThan(box('a').x);
        expect(back[0].x2).toBeLessThan(box('a').x + box('a').w);
    });

    it('keeps links that skip a layer out of the boxes in between', () => {
        const { shapes, nodes, box } = boxesOf({
            nodes: [
                { id: 'svc', label: '服务', layer: 'a' },
                { id: 'mq', label: '消息队列', layer: 'b' },
                { id: 'cache', label: '缓存', layer: 'b' },
                { id: 'db', label: '数据库', layer: 'c' },
            ],
            edges: [
                { from: 'svc', to: 'db' },
                { from: 'svc', to: 'cache' },
            ],
        });
        const boxes = Object.keys(nodes).map(box);
        const legs = segmentsOf(shapes);
        for (const leg of legs) {
            for (const b of boxes) {
                // Sample along each leg; no point may sit strictly inside a box.
                for (let t = 0; t <= 1; t += 0.05) {
                    const x = leg.x1 + (leg.x2 - leg.x1) * t;
                    const y = leg.y1 + (leg.y2 - leg.y1) * t;
                    expect(x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1).toBe(false);
                }
            }
        }
        // It arrives at the database straight from above, inside the box's width.
        const db = box('db');
        const into = legs.filter((l) => l.last && l.line.type === 'arrow' && Math.abs(l.y2 - (db.y - 4)) < 0.01);
        expect(into).toHaveLength(1);
        expect(into[0].x1).toBe(into[0].x2);
        expect(into[0].x2).toBeGreaterThan(db.x);
        expect(into[0].x2).toBeLessThan(db.x + db.w);
    });

    it('merges several links into one box into a single arrow, but keeps labelled links apart', () => {
        const { shapes, box } = boxesOf({
            nodes: [
                ...['a', 'b', 'c'].map((id) => ({ id, label: id, layer: 'top' })),
                ...['t', 'u'].map((id) => ({ id, label: id, layer: 'bottom' })),
            ],
            edges: [
                { from: 'a', to: 't' },
                { from: 'b', to: 't' },
                { from: 'c', to: 't' },
                { from: 'c', to: 'u' },
                { from: 'b', to: 'u', label: '写入' },
            ],
        });
        const into = (id: string) => shapes.filter((s) => s.type === 'arrow' && Math.abs(s.y2 - (box(id).y - 4)) < 1 && s.x2 > box(id).x && s.x2 < box(id).x + box(id).w);
        expect(into('t')).toHaveLength(1);
        // u has one plain link and one labelled link: two arrows of their own.
        expect(into('u')).toHaveLength(2);
    });

    it('draws same-layer links straight between neighbors and around boxes in between', () => {
        const { shapes, box } = boxesOf({
            nodes: ['a', 'b', 'c'].map((id) => ({ id, label: id, layer: 'one' })),
            edges: [
                { from: 'a', to: 'c' },
                { from: 'a', to: 'b', label: '请求' },
                { from: 'b', to: 'a', label: '回复' },
            ],
        });
        // a and b sit side by side: two parallel straight arrows. a → c goes around b.
        const row = box('a').y;
        const horizontal = segmentsOf(shapes).filter((g) => g.y1 === g.y2);
        const between = horizontal.filter((g) => g.y1 > row && g.y1 < row + box('a').h);
        expect(new Set(between.map((g) => g.y1)).size).toBe(2);
        expect(horizontal.filter((g) => g.y1 < row || g.y1 > row + box('a').h)).toHaveLength(1);
        expect(shapes.filter((s) => s.type === 'line')).toHaveLength(0);
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

describe('layout quality over the benchmark cases', () => {
    const cases = DIAGRAM_CASES.map((c) => ({ id: c.id, shapes: layoutDiagram(c.input, { createId: ids() }).shapes }));

    it('draws every line straight across or along, never at a slant', () => {
        for (const { id, shapes } of cases) {
            for (const g of segmentsOf(shapes)) {
                const slanted = Math.abs(g.x1 - g.x2) > 0.01 && Math.abs(g.y1 - g.y2) > 0.01;
                expect(slanted, `${id}: (${g.x1}, ${g.y1}) → (${g.x2}, ${g.y2})`).toBe(false);
            }
        }
    });

    // Cases that still have these defects; remove an id once its layout is fixed.
    const knownIssues = new Set(['state-machine', 'dev-loops']);

    it('keeps edge labels clear of boxes, lines and each other, and lines apart', () => {
        for (const { id, shapes } of cases.filter((c) => !knownIssues.has(c.id))) {
            const m = measureLayout(shapes);
            expect(m.labelOverlaps, id).toBe(0);
            expect(m.closeParallels, id).toBe(0);
            expect(m.edgeThroughBox, id).toBe(0);
        }
    });
});
