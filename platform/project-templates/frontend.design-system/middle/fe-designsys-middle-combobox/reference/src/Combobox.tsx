// Эталон: Combobox по контракту.
import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  label: string;
  options: Option[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  name?: string;
  disabled?: boolean;
}

export function Combobox({ label, options, value, defaultValue = null, onChange, name, disabled }: ComboboxProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const optId = (v: string) => `${uid}-opt-${options.findIndex((o) => o.value === v)}`;

  const [inner, setInner] = useState<string | null>(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const raw = value !== undefined ? value : inner;
  const selected = raw !== null && options.some((o) => o.value === raw) ? raw : null;
  const selectedLabel = options.find((o) => o.value === selected)?.label ?? '';

  const shown = query === null ? options : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const enabled = shown.filter((o) => !o.disabled);
  const listVisible = open && shown.length > 0;
  const activeValue = open && active !== null && enabled.some((o) => o.value === active) ? active : null;

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(null);
  };

  const choose = (o: Option) => {
    if (o.disabled) return;
    if (o.value !== selected) {
      if (value === undefined) setInner(o.value);
      onChange?.(o.value);
    }
    close();
  };

  const move = (dir: 1 | -1) => {
    if (enabled.length === 0) return;
    const i = enabled.findIndex((o) => o.value === activeValue);
    const next = i === -1 ? (dir === 1 ? 0 : enabled.length - 1) : (i + dir + enabled.length) % enabled.length;
    setActive(enabled[next]!.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          const pick = enabled.find((o) => o.value === selected) ?? (e.key === 'ArrowDown' ? enabled[0] : enabled[enabled.length - 1]);
          setActive(pick?.value ?? null);
        } else {
          move(e.key === 'ArrowDown' ? 1 : -1);
        }
        break;
      }
      case 'Home':
      case 'End':
        if (open && enabled.length) {
          e.preventDefault();
          setActive(enabled[e.key === 'Home' ? 0 : enabled.length - 1]!.value);
        }
        break;
      case 'Enter':
        if (open) {
          e.preventDefault();
          const o = enabled.find((x) => x.value === activeValue);
          if (o) choose(o);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      default:
    }
  };

  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={listVisible ? 'true' : 'false'}
        aria-controls={listVisible ? listId : undefined}
        aria-activedescendant={listVisible && activeValue !== null ? optId(activeValue) : undefined}
        disabled={disabled}
        value={query ?? selectedLabel}
        onClick={() => !disabled && setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      {name ? <input type="hidden" name={name} value={selected ?? ''} readOnly /> : null}
      {listVisible ? (
        <ul id={listId} role="listbox" aria-label={label}>
          {shown.map((o) => (
            <li
              key={o.value}
              id={optId(o.value)}
              role="option"
              aria-selected={o.value === selected ? 'true' : 'false'}
              aria-disabled={o.disabled ? 'true' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
      {open && shown.length === 0 ? <div role="status">Ничего не найдено</div> : null}
    </div>
  );
}
