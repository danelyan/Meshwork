'use client';

import type { StepOption, StepView } from '@/server/onboarding/types';
import type { ReactNode } from 'react';

import { DoneLink, MessageCard, type QuickReply } from '../chat/Thread';
import { Tag } from '../ui';

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
          {step.fspDemo && step.fspDemo.length > 0 && (
            <MessageCard label="Демо-достижения ФСП">
              <Tag tone="dashed">демо: API ФСП не предоставлен</Tag>
              <p className={styles.sub}>При привязке в профиль попадут демонстрационные достижения:</p>
              <ul className={styles.list}>
                {step.fspDemo.map((a) => (
                  <li key={`${a.event}-${a.year}`}>
                    {a.event}, {a.year}: {a.result}
                  </li>
                ))}
              </ul>
            </MessageCard>
          )}
          <QuickReplies
            items={opts.map((o) => ({ value: o.value, label: o.label, note: o.note, disabled: o.disabled, pressed: step.value === o.value }))}
            disabled={busy}
            onPick={(v) => {
              const o = opts.find((x) => x.value === v)!;
              onAnswer(o.value, optionText(o));
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
      // Согласия (ADR 0005): отдельные неотмеченные галочки с полным текстом; продолжить можно и без них.
      const labelOf = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
      return (
        <MessageCard label="Согласия">
          <div role="group" aria-label="Согласия" data-testid="consent-checks">
            {opts.map((o) => (
              <label key={o.value} className={styles.sub} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                <input type="checkbox" checked={props.sel.includes(o.value)} disabled={busy} onChange={() => props.onToggle(o.value)} />
                <span>
                  <b>{o.label}</b>
                  {o.note && <small style={{ display: 'block' }}>{o.note}</small>}
                </span>
              </label>
            ))}
          </div>
          <DoneLink disabled={busy} onClick={() => onAnswer(props.sel, props.sel.length ? props.sel.map(labelOf).join('; ') : 'Без дополнительных согласий')}>
            {props.sel.length ? `Сохранить · ${props.sel.length}` : 'Продолжить без согласий'}
          </DoneLink>
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
