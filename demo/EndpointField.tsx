import { useId, useState, type KeyboardEvent } from 'react';
import { KNOWN_ENDPOINTS } from './modelRequest';

type Props = {
    value: string;
    onChange: (value: string) => void;
    autoFocus?: boolean;
};

/**
 * The endpoint input with a list of common endpoints to pick from. A styled combobox rather than
 * a native <datalist>, whose arrow and popup cannot be styled and look out of place in the popover.
 * Typing filters the list; anything can still be typed in.
 */
export function EndpointField({ value, onChange, autoFocus }: Props) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const query = value.trim().toLowerCase();
    const matches = KNOWN_ENDPOINTS.filter(
        (e) => !query || e.url.toLowerCase().includes(query) || e.name.toLowerCase().includes(query) || e.url === value.trim(),
    );
    // A typed value that already is one of the endpoints shows the whole list, so it can be swapped.
    const items = KNOWN_ENDPOINTS.some((e) => e.url === value.trim()) ? KNOWN_ENDPOINTS : matches;
    const shown = open && items.length > 0;

    const pick = (url: string) => {
        onChange(url);
        setOpen(false);
        setActive(-1);
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
                                aria-selected={e.url === value.trim()}
                                className={i === active ? 'is-active' : undefined}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => pick(e.url)}
                            >
                                <span className="combo-name">{e.name}</span>
                                <span className="combo-url">{e.url}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
