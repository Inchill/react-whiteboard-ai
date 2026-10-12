import { describe, expect, it } from 'vitest';
import { messagesUrl } from '../demo/modelRequest';

describe('messagesUrl', () => {
    it('uses the provider endpoint by default', () => {
        expect(messagesUrl({ provider: 'deepseek' })).toBe('https://api.deepseek.com/anthropic/v1/messages');
        expect(messagesUrl({ provider: 'anthropic', baseUrl: ' ' })).toBe('https://api.anthropic.com/v1/messages');
    });

    it('maps DeepSeek\'s OpenAI-style address to its Anthropic endpoint', () => {
        for (const baseUrl of ['https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/v1']) {
            expect(messagesUrl({ provider: 'deepseek', baseUrl })).toBe('https://api.deepseek.com/anthropic/v1/messages');
        }
    });

    it('accepts a base, a base ending in /v1, or a full URL', () => {
        expect(messagesUrl({ provider: 'anthropic', baseUrl: 'https://gw.example.com/claude/' })).toBe('https://gw.example.com/claude/v1/messages');
        expect(messagesUrl({ provider: 'anthropic', baseUrl: 'https://gw.example.com/v1' })).toBe('https://gw.example.com/v1/messages');
        expect(messagesUrl({ provider: 'anthropic', baseUrl: 'https://gw.example.com/v1/messages' })).toBe('https://gw.example.com/v1/messages');
    });
});
