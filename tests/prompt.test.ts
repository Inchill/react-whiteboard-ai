import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src';

describe('buildSystemPrompt', () => {
    it('states what can and cannot be drawn, and how to lay out text', () => {
        const prompt = buildSystemPrompt();
        expect(prompt).toContain('There are no curves, polygons or rotation.');
        expect(prompt).toContain('Animals, people, plants');
        expect(prompt).toContain('1 × fontSize per CJK character');
    });

    it('appends extra instructions at the end', () => {
        expect(buildSystemPrompt({ extra: 'Use a playful tone.' }).endsWith('\n\nUse a playful tone.')).toBe(true);
    });
});
