import { useId, useState, type FormEvent } from 'react';
import { ENDPOINTS, messagesUrl } from './modelRequest';
import { PROVIDERS, type AISettings, type Provider } from './settings';

type Props = {
    settings: AISettings | null;
    /** True when .env.local already provides a key. */
    hasServerKey: boolean;
    /** The page calls the provider from the browser (static hosting) rather than through the dev server. */
    direct: boolean;
    onSave: (s: AISettings) => void;
    onClear: () => void;
    onClose: () => void;
};

export function SettingsPanel({ settings, hasServerKey, direct, onSave, onClear, onClose }: Props) {
    const id = useId();
    const [provider, setProvider] = useState<Provider>(settings?.provider ?? 'deepseek');
    const [key, setKey] = useState('');
    const [model, setModel] = useState(settings?.model ?? '');
    const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '');
    const [remember, setRemember] = useState(settings?.remember ?? false);
    const keepsOldKey = settings?.provider === provider && !key.trim();

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const nextKey = key.trim() || (keepsOldKey ? settings?.key : '');
        if (!nextKey) return;
        onSave({ provider, key: nextKey, model: model.trim(), baseUrl: baseUrl.trim(), remember });
        setKey('');
    };

    return (
        <form className="settings" onSubmit={submit} aria-labelledby={`${id}-title`}>
            <h2 id={`${id}-title`}>连接模型</h2>

            <fieldset className="settings-providers">
                <legend>服务商</legend>
                <div className="segmented">
                    {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                        <label key={p} className={p === provider ? 'is-on' : undefined}>
                            <input type="radio" name={`${id}-provider`} value={p} checked={p === provider} onChange={() => setProvider(p)} />
                            {PROVIDERS[p].label}
                        </label>
                    ))}
                </div>
            </fieldset>

            <label className="settings-field">
                <span>API key</span>
                <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={keepsOldKey ? '已保存，留空则继续使用' : PROVIDERS[provider].keyHint}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                />
            </label>

            <label className="settings-field">
                <span>模型</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`默认 ${PROVIDERS[provider].defaultModel}`} spellCheck={false} />
            </label>

            <label className="settings-field">
                <span>接口地址（选填）</span>
                <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={ENDPOINTS[provider].base}
                    spellCheck={false}
                    inputMode="url"
                />
            </label>

            <label className="settings-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                在这个浏览器里记住
            </label>
            <p className="settings-note">
                {remember ? 'key 会留在这个浏览器里，下次打开还能用。' : 'key 只留在这个标签页，关掉就清除。'}
                {direct
                    ? `请求从你的浏览器直接发到 ${hostOf(provider, baseUrl)}，不经过其他服务器。`
                    : '请求由本地开发服务器转发，它不保存也不打印 key。'}
            </p>

            <div className="settings-actions">
                <button type="submit" className="button-primary" disabled={!key.trim() && !keepsOldKey}>
                    保存
                </button>
                <button type="button" onClick={onClose}>
                    取消
                </button>
                {settings && (
                    <button type="button" className="button-quiet" onClick={onClear}>
                        {hasServerKey ? '清除，改用 .env.local' : '清除 key'}
                    </button>
                )}
            </div>
        </form>
    );
}

function hostOf(provider: Provider, baseUrl: string) {
    try {
        return new URL(messagesUrl({ provider, baseUrl })).host;
    } catch {
        return '你填写的接口地址';
    }
}
