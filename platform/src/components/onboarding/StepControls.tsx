'use client';

import type { StepOption, StepView } from '@/server/onboarding/types';
import type { ReactNode } from 'react';

import { DoneLink, MessageCard, type QuickReply } from '../chat/Thread';

import styles from './Onboarding.module.css';
import { salaryChips, salaryText } from './salary';

function QuickReplies({ items, onPick, disabled, label = 'Варианты ответа', after }: { items: QuickReply[]; onPick: (value: string) => void; disabled?: boolean; label?: string; after?: ReactNode }) {
  return <div className={styles.options} role="group" aria-label={label} data-testid="quick-replies">{items.map((item, index) => <button type="button" key={item.value} className={styles.option} aria-pressed={Boolean(item.pressed)} disabled={disabled || item.disabled} onClick={() => onPick(item.value)}><b aria-hidden="true">{String(index + 1).padStart(2, '0')}</b><span>{item.label}{item.note && <small>{item.note}</small>}</span></button>)}{after}</div>;
}

/** Как ответ звучит пузырём пользователя в ленте. */
export const optionText = (o: StepOption) => o.answered ?? o.label;

export interface StepControlsProps {
  step: StepView;
  busy: boolean;
  consentVersion: string;
  /** Выбор мультишагов (many, chips) — у родителя: свой вариант приходит из поля ввода внизу. */
  sel: string[];
  extra: string[];
  onToggle: (value: string) => void;
  /** Ответ: значение для сервера и текст пузыря. */
  onAnswer: (value: unknown, text: string) => void;
}

/**
 * Интерактив под репликой помощника по типу шага (StepKind): чипы и тогглы с «Готово» — это ответ
 * в чат, не форма. Текст, документы (файлы и ссылки) и зарплата числом — в общем композере внизу.
 * Проверку ответа повторяет сервер (engine.validateAnswer).
 */
export function StepControls(props: StepControlsProps) {
  const { step, busy, onAnswer } = props;
  const opts = step.options ?? [];
  switch (step.kind) {
    case 'role':
    case 'one':
      return (
        <>
          <QuickReplies
            items={opts.map((o) => ({ value: o.value, label: o.label, note: o.note, disabled: o.disabled, pressed: step.value === o.value }))}
            disabled={busy}
            onPick={(v) => {
              const o = opts.find((x) => x.value === v)!;
              // Вход во внешний сервис (ФСП ID): переход, ответ запишет сервер по возврату.
              if (o.href) window.location.assign(o.href);
              else onAnswer(o.value, optionText(o));
            }}
          />
        </>
      );
    case 'many':
    case 'chips': {
      const base = opts.map((o) => ({ value: o.value, label: o.label, note: o.note, disabled: o.disabled }));
      const all = [...base, ...props.extra.map((v) => ({ value: v, label: v }))];
      const labelOf = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
      return (
        <QuickReplies
          label="Можно выбрать несколько"
          items={all.map((o) => ({ ...o, pressed: props.sel.includes(o.value) }))}
          disabled={busy}
          onPick={props.onToggle}
          after={
            <DoneLink disabled={busy || props.sel.length === 0} onClick={() => onAnswer(props.sel, props.sel.map(labelOf).join(', '))}>
              {props.sel.length ? `Готово · ${props.sel.length}` : 'Готово'}
            </DoneLink>
          }
        />
      );
    }
    case 'consents': {
      // Согласия (ADR 0005): карточки-галочки с полным текстом. Главная кнопка — согласиться (со всем или с отмеченным),
      // «без согласий» — второстепенная ссылка (владелец 11.10: «не видно, как согласиться»).
      const labelOf = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
      const all = opts.map((o) => o.value);
      const n = props.sel.length;
      return (
        <MessageCard label="Согласия">
          <div role="group" aria-label="Согласия" className={styles.consentList} data-testid="consent-checks">
            {opts.map((o) => (
              <label key={o.value} className={styles.consentItem} data-checked={props.sel.includes(o.value) || undefined}>
                <input type="checkbox" checked={props.sel.includes(o.value)} disabled={busy} onChange={() => props.onToggle(o.value)} />
                <span>
                  <b>{o.label}</b>
                  {o.note && <small>{o.note}</small>}
                </span>
              </label>
            ))}
          </div>
          <div className={styles.consentActions}>
            {n > 0 ? (
              <button type="button" className={styles.consentGo} disabled={busy} onClick={() => onAnswer(props.sel, props.sel.map(labelOf).join('; '))}>
                Согласиться с отмеченным · {n}
              </button>
            ) : (
              <button type="button" className={styles.consentGo} disabled={busy} onClick={() => onAnswer(all, all.map(labelOf).join('; '))}>
                Согласиться со всем
              </button>
            )}
            <DoneLink disabled={busy} onClick={() => onAnswer([], 'Без дополнительных согласий')}>Продолжить без согласий</DoneLink>
          </div>
        </MessageCard>
      );
    }
    case 'range': {
      const spec = step.range!;
      const prev = step.value as { from: number; to: number } | undefined;
      return (
        <QuickReplies
          label="Вилки"
          items={salaryChips(spec).map((r) => ({ value: `${r.from}-${r.to}`, label: `${r.from}–${r.to} тыс`, pressed: prev?.from === r.from && prev?.to === r.to }))}
          disabled={busy}
          onPick={(v) => {
            const [from, to] = v.split('-').map(Number) as [number, number];
            onAnswer({ from, to }, salaryText({ from, to }, spec));
          }}
        />
      );
    }
    case 'files':
      return null; // файлы и ссылки — в композере, разбор — в ленте (DocumentsRun)
    case 'consent':
      return <QuickReplies items={[{ value: 'yes', label: 'Согласен(на)' }]} disabled={busy} onPick={() => onAnswer({ version: props.consentVersion }, 'Согласен(на)')} />;
    default:
      return null;
  }
}
