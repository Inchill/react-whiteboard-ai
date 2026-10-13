import { useId, useState, type FormEvent } from 'react';
import { EndpointField } from './EndpointField';
import { allEndpoints, loadCustomEndpoints, saveCustomEndpoints, type Endpoint } from './endpoints';
import { serviceName } from './modelRequest';
import type { AISettings } from './settings';

type Props = {
    settings: AISettings | null;
    /** True when .env.local already provides a key (dev server only). */
    hasServerKey: boolean;
    onSave: (s: AISettings) => void;
    onClear: () => void;
    onClose: () => void;
};

export function SettingsPanel({ settings, hasServerKey, onSave, onClear, onClose }: Props) {
    const id = useId();
    const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '');
    const [key, setKey] = useState('');
    const [model, setModel] = useState(settings?.model ?? '');
    const [remember, setRemember] = useState(settings?.remember ?? false);
    const [custom, setCustom] = useState<Endpoint[]>(loadCustomEndpoints);
    const updateCustom = (list: Endpoint[]) => {
        saveCustomEndpoints(list);
        setCustom(list);
    };
    // The saved key stays usable as long as it goes to the same endpoint.
    const keepsOldKey = Boolean(settings) && settings?.baseUrl === baseUrl.trim() && !key.trim();
    const nextKey = key.trim() || (keepsOldKey ? settings?.key ?? '' : '');
    const complete = Boolean(baseUrl.trim() && nextKey && model.trim());

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!complete) return;
        onSave({ baseUrl: baseUrl.trim(), key: nextKey, model: model.trim(), remember });
        setKey('');
    };

    return (
        <form className="settings" onSubmit={submit} aria-labelledby={`${id}-title`}>
            <h2 id={`${id}-title`}>连接模型</h2>
            <p className="settings-intro">支持 Anthropic 消息格式的接口都能用，比如 Claude、DeepSeek、千问、智谱、豆包。</p>

            <EndpointField
                value={baseUrl}
                onChange={setBaseUrl}
                endpoints={allEndpoints(custom)}
                onAdd={(e) => updateCustom([...custom, e])}
                onRemove={(url) => updateCustom(custom.filter((e) => e.url !== url))}
                autoFocus
            />

            <label className="settings-field">
                <span>API key</span>
                <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={keepsOldKey ? '已保存，留空则继续使用' : '这个接口的 key'}
                    autoComplete="off"
                    spellCheck={false}
                />
            </label>

            <label className="settings-field">
                <span>模型</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 deepseek-v4-pro、glm-5.2" spellCheck={false} />
            </label>

            <label className="settings-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                在这个浏览器里记住
            </label>
            <p className="settings-note">
                {remember ? 'key 会留在这个浏览器里，下次打开还能用。' : 'key 只留在这个标签页，关掉就清除。'}
                {import.meta.env.DEV
                    ? '请求由本地开发服务器转发，它不保存也不打印 key。'
                    : `请求从你的浏览器直接发到 ${baseUrl.trim() ? serviceName(baseUrl, custom) : '这个接口'}，不经过其他服务器。`}
            </p>

            <div className="settings-actions">
                <button type="submit" className="button-primary" disabled={!complete}>
                    保存
                </button>
                <button type="button" onClick={onClose}>
                    取消
                </button>
                {settings && (
                    <button type="button" className="button-quiet" onClick={onClear}>
                        {import.meta.env.DEV && hasServerKey ? '清除，改用 .env.local' : '清除'}
                    </button>
                )}
            </div>
        </form>
    );
}
