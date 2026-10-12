import { useState, type FormEvent } from 'react';
import { modelLabel, PROVIDERS, type AISettings, type Provider } from './settings';

type Props = {
    settings: AISettings | null;
    /** Model configured in .env.local, shown when no key is set on the page. */
    serverModel: string | null | undefined;
    onSave: (s: AISettings) => void;
    onClear: () => void;
};

export function Settings({ settings, serverModel, onSave, onClear }: Props) {
    const [editing, setEditing] = useState(!settings && !serverModel);
    const [provider, setProvider] = useState<Provider>(settings?.provider ?? 'deepseek');
    const [key, setKey] = useState('');
    const [model, setModel] = useState(settings?.model ?? '');
    const [remember, setRemember] = useState(settings?.remember ?? false);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const trimmed = key.trim() || settings?.key;
        if (!trimmed) return;
        onSave({ provider, key: trimmed, model: model.trim(), remember });
        setKey('');
        setEditing(false);
    };

    if (!editing) {
        return (
            <section className="demo-settings">
                <div className="demo-settings-summary">
                    <span>
                        {settings ? modelLabel(settings) : serverModel ? `${serverModel}（来自 .env.local）` : '未配置模型'}
                    </span>
                    <button type="button" onClick={() => setEditing(true)}>
                        {settings ? '修改' : '配置 API key'}
                    </button>
                    {settings && (
                        <button type="button" onClick={onClear}>
                            清除
                        </button>
                    )}
                </div>
            </section>
        );
    }

    return (
        <form className="demo-settings" onSubmit={submit}>
            <h2>模型设置</h2>
            <label>
                服务商
                <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                    {Object.entries(PROVIDERS).map(([id, p]) => (
                        <option key={id} value={id}>
                            {p.label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                API key
                <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={settings?.provider === provider ? '已保存，留空则不修改' : PROVIDERS[provider].keyHint}
                    autoComplete="off"
                    spellCheck={false}
                />
            </label>
            <label>
                模型（选填）
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={PROVIDERS[provider].defaultModel} spellCheck={false} />
            </label>
            <label className="demo-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                在此浏览器中记住
            </label>
            <p className="demo-muted">
                {remember
                    ? 'key 会存在本地浏览器里，下次打开仍可使用。同一地址端口上的其他本地项目也能读到它。'
                    : 'key 只保存在当前标签页，关闭后清除。'}
                请求经本地开发服务器转发，不会上传到其他地方。
            </p>
            <div className="demo-settings-actions">
                <button type="submit" disabled={!key.trim() && settings?.provider !== provider}>
                    保存
                </button>
                {(settings || serverModel) && (
                    <button type="button" onClick={() => setEditing(false)}>
                        取消
                    </button>
                )}
            </div>
        </form>
    );
}
