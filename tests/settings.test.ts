import { beforeEach, describe, expect, it } from 'vitest';
import { targetFromEnv } from '../demo/server';
import { loadSettings, settingsHeaders } from '../demo/settings';

describe('model settings', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('reads settings saved before formats existed as Anthropic format', () => {
        sessionStorage.setItem('react-whiteboard-ai-demo:settings', JSON.stringify({ baseUrl: 'https://api.deepseek.com/anthropic', key: 'k', model: 'm' }));
        expect(loadSettings()).toEqual({ baseUrl: 'https://api.deepseek.com/anthropic', key: 'k', model: 'm', format: 'anthropic', remember: false });
    });

    it('passes the format to the dev proxy', () => {
        expect(settingsHeaders({ baseUrl: 'https://gw/v1', key: 'k', model: 'm', format: 'openai', remember: false })['x-ai-format']).toBe('openai');
    });

    it('takes the format from .env.local', () => {
        const env = { AI_BASE_URL: 'https://gw/v1', AI_API_KEY: 'k', AI_MODEL: 'm' };
        expect(targetFromEnv(env)?.format).toBe('anthropic');
        expect(targetFromEnv({ ...env, AI_FORMAT: 'openai' })?.format).toBe('openai');
    });
});
