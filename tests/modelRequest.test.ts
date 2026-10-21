import { describe, expect, it } from 'vitest';
import { messagesUrl, serviceName } from '../demo/modelRequest';

describe('messagesUrl', () => {
    it('maps DeepSeek\'s OpenAI-style address to its Anthropic endpoint', () => {
        for (const base of ['https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/v1']) {
            expect(messagesUrl(base)).toBe('https://api.deepseek.com/anthropic/v1/messages');
        }
    });

    it('accepts a base, a base ending in /v1, or a full URL', () => {
        expect(messagesUrl(' https://open.bigmodel.cn/api/anthropic/ ')).toBe('https://open.bigmodel.cn/api/anthropic/v1/messages');
        expect(messagesUrl('https://gw.example.com/v1')).toBe('https://gw.example.com/v1/messages');
        expect(messagesUrl('https://gw.example.com/v1/messages')).toBe('https://gw.example.com/v1/messages');
    });
});

describe('serviceName', () => {
    it('names known services and falls back to the host', () => {
        expect(serviceName('https://api.deepseek.com')).toBe('DeepSeek');
        expect(serviceName('https://open.bigmodel.cn/api/anthropic')).toBe('智谱');
        expect(serviceName('https://ws-1.cn-beijing.maas.aliyuncs.com/apps/anthropic')).toBe('千问');
        expect(serviceName('https://gw.example.com/anthropic')).toBe('gw.example.com');
        expect(serviceName('not a url')).toBe('接口地址');
    });

    it('names known services in English when asked', () => {
        expect(serviceName('https://open.bigmodel.cn/api/anthropic', [], 'en')).toBe('GLM');
        expect(serviceName('https://ws-1.cn-beijing.maas.aliyuncs.com/apps/anthropic', [], 'en')).toBe('Qwen');
        expect(serviceName('not a url', [], 'en')).toBe('endpoint');
    });
});
