import { beforeEach, describe, expect, it } from 'vitest';
import { allEndpoints, isListed, loadCustomEndpoints, normalizeEndpoint, saveCustomEndpoints } from '../demo/endpoints';
import { serviceName } from '../demo/modelRequest';

describe('custom endpoints', () => {
    beforeEach(() => localStorage.clear());

    it('accepts http(s) addresses only', () => {
        expect(normalizeEndpoint(' https://api.moonshot.cn/anthropic/ ')).toBe('https://api.moonshot.cn/anthropic');
        expect(normalizeEndpoint('ftp://example.com')).toBeNull();
        expect(normalizeEndpoint('moonshot')).toBeNull();
    });

    it('keeps names and addresses in the browser, after the built-in ones and without duplicates', () => {
        saveCustomEndpoints([
            { name: 'Kimi', url: 'https://api.moonshot.cn/anthropic', format: 'anthropic', custom: true },
            { name: '我的 DeepSeek', url: 'https://api.deepseek.com/anthropic/', format: 'anthropic', custom: true },
            { name: '公司网关', url: 'https://ai-gw.corp.example/v1', format: 'openai', custom: true },
        ]);
        expect(localStorage.getItem('react-whiteboard-ai-demo:endpoints')).toBe(
            '[{"name":"Kimi","url":"https://api.moonshot.cn/anthropic","format":"anthropic"},{"name":"我的 DeepSeek","url":"https://api.deepseek.com/anthropic/","format":"anthropic"},{"name":"公司网关","url":"https://ai-gw.corp.example/v1","format":"openai"}]',
        );
        const custom = loadCustomEndpoints();
        const list = allEndpoints(custom);
        expect(list.map((e) => e.name)).toEqual(['DeepSeek', '千问', '智谱', '豆包', 'Claude', 'Kimi', '公司网关']);
        expect(list.at(-1)).toEqual({ name: '公司网关', url: 'https://ai-gw.corp.example/v1', format: 'openai', custom: true });
        expect(isListed(list, 'https://api.moonshot.cn/anthropic/v1/messages')).toBe(true);
        expect(serviceName('https://api.moonshot.cn/anthropic', custom)).toBe('Kimi');
    });

    it('reads endpoints saved before formats existed as Anthropic format', () => {
        localStorage.setItem('react-whiteboard-ai-demo:endpoints', '[{"name":"Kimi","url":"https://api.moonshot.cn/anthropic"}]');
        expect(loadCustomEndpoints()).toEqual([{ name: 'Kimi', url: 'https://api.moonshot.cn/anthropic', format: 'anthropic', custom: true }]);
    });

    it('ignores broken stored data', () => {
        localStorage.setItem('react-whiteboard-ai-demo:endpoints', '[{"name":"","url":"https://x.com"},{"name":"ok","url":"nope"},3]');
        expect(loadCustomEndpoints()).toEqual([]);
        localStorage.setItem('react-whiteboard-ai-demo:endpoints', '{');
        expect(loadCustomEndpoints()).toEqual([]);
    });
});
