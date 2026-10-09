'use client';

import { useState } from 'react';

import type { OnboardingView, StepOption, StepView } from '@/server/onboarding/types';

import { DoneLink, MessageCard, QuickReplies } from '../chat/Thread';
import { Notice, Tag } from '../ui';

import { type DocumentsAnswer, DocumentsStep } from './DocumentsStep';
import styles from './Onboarding.module.css';

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
 * Интерактив под репликой помощника по типу шага (StepKind): чипы, тогглы с «Готово»,
 * карточки в сообщении (ползунки, документы). Текстовые шаги отвечают полем ввода внизу ленты.
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
    case 'range':
      return <RangeCard step={step} busy={busy} onAnswer={onAnswer} />;
    case 'files':
      return (
        <MessageCard label="Документы">
          <DocumentsStep
            busy={busy}
            onDone={(v: DocumentsAnswer) => onAnswer(v, `Материалы: ${v.uploadIds.length + v.urls.length}, утверждений найдено: ${v.claims}`)}
          />
        </MessageCard>
      );
    case 'consent':
      return <QuickReplies items={[{ value: 'yes', label: 'Согласен(на)' }]} disabled={busy} onPick={() => onAnswer({ version: props.consentVersion }, 'Согласен(на)')} />;
    default:
      return null;
  }
}

function RangeCard({ step, busy, onAnswer }: Pick<StepControlsProps, 'step' | 'busy' | 'onAnswer'>) {
  const spec = step.range!;
  const prev = step.value as { from: number; to: number } | undefined;
  const [from, setFrom] = useState(prev?.from ?? spec.defaults.from);
  const [to, setTo] = useState(prev?.to ?? spec.defaults.to);
  const bad = from > to;
  return (
    <MessageCard label={step.label}>
      <div className={styles.range}>
        {[
          { label: spec.fromLabel, v: from, set: setFrom },
          { label: spec.toLabel, v: to, set: setTo },
        ].map((r) => (
          <label key={r.label} className={styles.rangeRow}>
            <span className={styles.rangeLabel}>{r.label}</span>
            <output className={styles.rangeValue}>
              {r.v}
              <small>{spec.unit}</small>
            </output>
            <input
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={r.v}
              onChange={(e) => r.set(Number(e.target.value))}
              disabled={busy}
              aria-label={`${r.label}, ${spec.unit}`}
            />
          </label>
        ))}
      </div>
      {bad && <Notice tone="error">«{spec.fromLabel}» не может быть больше «{spec.toLabel}».</Notice>}
      <div>
        <DoneLink disabled={busy || bad} onClick={() => onAnswer({ from, to }, `${from}–${to} ${spec.unit}`)}>
          Готово
        </DoneLink>
      </div>
    </MessageCard>
  );
}

/** Итог «вот что я понял» — карточкой в сообщении помощника. */
export function SummaryCard({ view }: { view: OnboardingView }) {
  const s = view.summary!;
  return (
    <MessageCard label="Что я узнал">
      <dl className={styles.summary}>
        {s.items.map((it) => (
          <div key={it.stepId}>
            <dt>{it.label}</dt>
            <dd>{it.value}</dd>
          </div>
        ))}
      </dl>
      {s.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      {s.skipped.length > 0 && <p className={styles.sub}>Пропущено: {s.skipped.map((it) => it.label).join(', ')} — можно ответить сейчас или позже.</p>}
    </MessageCard>
  );
}
