import { useId, useState, type FormEvent } from 'react';
import { EndpointField } from './EndpointField';
import { allEndpoints, loadCustomEndpoints, saveCustomEndpoints, type Endpoint } from './endpoints';
import { formatFromUrl, serviceName, type ApiFormat } from './modelRequest';
import type { AISettings } from './settings';
import { useLang, STRINGS } from './i18n';

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
    const lang = useLang();
    const t = STRINGS[lang];
    const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '');
    const [key, setKey] = useState('');
    const [model, setModel] = useState(settings?.model ?? '');
    const [format, setFormat] = useState<ApiFormat>(settings?.format ?? 'anthropic');
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
        onSave({ baseUrl: baseUrl.trim(), key: nextKey, model: model.trim(), format, remember });
        setKey('');
    };

    return (
        <form className="settings" onSubmit={submit} aria-labelledby={`${id}-title`}>
            <h2 id={`${id}-title`}>{t.connect}</h2>
            <p className="settings-intro">{t.settingsIntro}</p>

            <EndpointField
                value={baseUrl}
                onChange={(url, picked) => {
                    setBaseUrl(url);
                    const guessed = picked?.format ?? formatFromUrl(url);
                    if (guessed) setFormat(guessed);
                }}
                format={format}
                endpoints={allEndpoints(custom, lang)}
                onAdd={(e) => updateCustom([...custom, e])}
                onRemove={(url) => updateCustom(custom.filter((e) => e.url !== url))}
                autoFocus
            />

            <div className="settings-field">
                <span id={`${id}-format`}>{t.format}</span>
                <div className="segmented" role="radiogroup" aria-labelledby={`${id}-format`}>
                    {(
                        [
                            ['anthropic', t.formatAnthropic],
                            ['openai', t.formatOpenAI],
                        ] as const
                    ).map(([value, label]) => (
                        <button key={value} type="button" role="radio" aria-checked={format === value} onClick={() => setFormat(value)}>
                            {label}
                        </button>
                    ))}
                </div>
                <small className="settings-hint">
                    {format === 'openai'
                        ? t.formatHintOpenAI
                        : t.formatHintAnthropic}
                </small>
            </div>

            <label className="settings-field">
                <span>API key</span>
                <input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={keepsOldKey ? t.keyKept : t.keyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                />
            </label>

            <label className="settings-field">
                <span>{t.model}</span>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={format === 'openai' ? t.modelPlaceholderOpenAI : t.modelPlaceholder} spellCheck={false} />
            </label>

            <label className="settings-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t.remember}
            </label>
            <p className="settings-note">
                {remember ? t.remembered : t.tabOnly}
                {import.meta.env.DEV
                    ? // Dev-only text stays inline behind the DEV check, so the build drops it (see the deploy workflow).
                    lang === 'zh' ? '请求由本地开发服务器转发，它不保存也不打印 key。' : 'Requests go through the local dev server, which neither stores nor logs the key.'
                    : t.direct(baseUrl.trim() ? serviceName(baseUrl, custom, lang) : null)}
            </p>

            <div className="settings-actions">
                <button type="submit" className="button-primary" disabled={!complete}>
                    {t.save}
                </button>
                <button type="button" onClick={onClose}>
                    {t.cancel}
                </button>
                {settings && (
                    <button type="button" className="button-quiet" onClick={onClear}>
                        {import.meta.env.DEV && hasServerKey ? (lang === 'zh' ? '清除，改用 .env.local' : 'Clear and use .env.local') : t.clear}
                    </button>
                )}
            </div>
        </form>
    );
}
