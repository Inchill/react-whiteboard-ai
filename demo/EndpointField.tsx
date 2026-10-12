import { useId, useState, type KeyboardEvent } from 'react';
import { isListed, normalizeEndpoint, type Endpoint } from './endpoints';

type Props = {
    value: string;
    onChange: (value: string) => void;
    /** Built-in endpoints and the user's own. */
    endpoints: Endpoint[];
    onAdd: (endpoint: Endpoint) => void;
    onRemove: (url: string) => void;
    autoFocus?: boolean;
};

const hostOf = (url: string) => {
    try {
        return new URL(url).host;
    } catch {
        return '';
    }
};

/**
 * The endpoint input with a list of endpoints to pick from. A styled combobox rather than a native
 * <datalist>, whose arrow and popup cannot be styled. Typing filters the list; anything can still be
 * typed in, and an address that is not in the list can be added to it under a name.
 */
export function EndpointField({ value, onChange, endpoints, onAdd, onRemove, autoFocus }: Props) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    /** The name being typed for a new endpoint, or null when not adding. */
    const [naming, setNaming] = useState<string | null>(null);

    const typed = value.trim();
    const listed = isListed(endpoints, typed);
    const query = typed.toLowerCase();
    // A value that already is one of the endpoints shows the whole list, so it can be swapped.
    const items = listed || !query ? endpoints : endpoints.filter((e) => e.url.toLowerCase().includes(query) || e.name.toLowerCase().includes(query));
    const shown = open && items.length > 0;
    const addable = !listed && normalizeEndpoint(typed) !== null;

    const pick = (url: string) => {
        onChange(url);
        setOpen(false);
        setActive(-1);
    };

    const add = () => {
        const url = normalizeEndpoint(typed);
        const name = naming?.trim() || hostOf(url ?? '');
        if (!url || !name) return;
        onAdd({ name, url, custom: true });
        onChange(url);
        setNaming(null);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!shown) {
                setOpen(true);
                setActive(0);
                return;
            }
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + step + items.length) % items.length);
        } else if (e.key === 'Enter' && shown && active >= 0) {
            e.preventDefault();
            pick(items[active].url);
        } else if (e.key === 'Escape' && shown) {
            // Close only the list, not the whole settings popover.
            e.stopPropagation();
            setOpen(false);
        }
    };

    const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            // Add the endpoint instead of submitting the settings form.
            e.preventDefault();
            add();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            setNaming(null);
        }
    };

    return (
        <div className="settings-field">
            <label htmlFor={`${id}-input`}>接口地址</label>
            <div className="combo">
                <input
                    id={`${id}-input`}
                    role="combobox"
                    aria-expanded={shown}
                    aria-controls={`${id}-list`}
                    aria-autocomplete="list"
                    aria-activedescendant={shown && active >= 0 ? `${id}-opt-${active}` : undefined}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setOpen(true);
                        setActive(-1);
                        setNaming(null);
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={() => setOpen(false)}
                    placeholder="https://api.deepseek.com/anthropic"
                    spellCheck={false}
                    autoComplete="off"
                    inputMode="url"
                    autoFocus={autoFocus}
                />
                <button
                    type="button"
                    className={`combo-toggle${shown ? ' is-open' : ''}`}
                    tabIndex={-1}
                    aria-label="常用接口"
                    // Keep focus in the input, so the list does not close on blur first.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setOpen(!shown)}
                >
                    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
                        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
                {shown && (
                    <ul className="combo-list" role="listbox" id={`${id}-list`} aria-label="常用接口">
                        {items.map((e, i) => (
                            <li
                                key={e.url}
                                id={`${id}-opt-${i}`}
                                role="option"
                                aria-selected={listed && e.url === typed}
                                className={i === active ? 'is-active' : undefined}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => pick(e.url)}
                            >
                                <span className="combo-name">{e.name}</span>
                                <span className="combo-url">{e.url}</span>
                                {e.custom && (
                                    <button
                                        type="button"
                                        className="combo-remove"
                                        tabIndex={-1}
                                        aria-label={`删除 ${e.name}`}
                                        title="从列表删除"
                                        onClick={(ev) => {
                                            ev.stopPropagation();
                                            onRemove(e.url);
                                        }}
                                    >
                                        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                                            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                        </svg>
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {addable && naming === null && (
                <button type="button" className="combo-add" onClick={() => setNaming(hostOf(normalizeEndpoint(typed) ?? ''))}>
                    ＋ 添加到常用接口
                </button>
            )}
            {addable && naming !== null && (
                <div className="combo-naming">
                    <input
                        value={naming}
                        onChange={(e) => setNaming(e.target.value)}
                        onKeyDown={onNameKey}
                        placeholder="名称，如 Kimi"
                        aria-label="新接口的名称"
                        maxLength={24}
                        autoFocus
                    />
                    <button type="button" className="button-primary" onClick={add} disabled={!naming.trim()}>
                        添加
                    </button>
                    <button type="button" onClick={() => setNaming(null)}>
                        取消
                    </button>
                </div>
            )}
        </div>
    );
}
