import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, parseOperation } from '../src';
import { SKETCH_EXAMPLE } from '../src/prompts/sketchExample';

describe('buildSystemPrompt', () => {
    it('states what can and cannot be drawn, and how to lay out text', () => {
        const prompt = buildSystemPrompt();
        expect(prompt).toContain('There are no curves, polygons or rotation.');
        expect(prompt).toContain('use draw_sketch rather than composing ellipses');
        expect(prompt).toContain('1 × fontSize per CJK character');
    });

    it('shows a sketch example that passes validation', () => {
        expect(buildSystemPrompt()).toContain(JSON.stringify(SKETCH_EXAMPLE));
        expect(parseOperation('draw_sketch', SKETCH_EXAMPLE)).toMatchObject({ ok: true });
    });

    it('appends extra instructions at the end', () => {
        expect(buildSystemPrompt({ extra: 'Use a playful tone.' }).endsWith('\n\nUse a playful tone.')).toBe(true);
    });
});
