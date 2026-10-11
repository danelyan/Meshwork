'use client';

import Link from 'next/link';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { onboardingAct, readError, request } from '@/lib/api';
import type { KnownFact, SceneAsideData } from '@/server/consultant/aside';

import { CompanyPreview, ViewTabs, fieldVisibility } from '../onboarding/OnboardingDraft';
import { useSoftGo } from '../onboarding/soft-nav';
import { useAsideRefresh } from './aside-refresh';
import aside from './SceneAside.module.css';
import styles from './MemoryCard.module.css';

const SOURCE_LABEL = { onboarding: 'знакомство', chat: 'из чата', user: 'добавлено вручную' } as const;
/** Короткие метки видимости для узкой карточки; полная формулировка – в title. */
const SEEN_SHORT: Record<string, string> = { 'только тебе': 'только тебе', 'в анонимной карточке': 'видит компания', 'после принятия приглашения': 'после «да»' };
/** Сколько держится подсветка «новое» у пункта, который консультант запомнил из чата. */
export const NEW_HIGHLIGHT_MS = 6_000;
/** Пока сервер извлекает факты, колонка перечитывается с этим шагом, не больше MAX_PENDING_POLLS раз. */
export const PENDING_POLL_MS = 1_500;
export const MAX_PENDING_POLLS = 8;
const TEXT_MAX = 200;
/** «4 факта»: ответы знакомства и заметки памяти вместе (пропущенные вопросы сюда не попадают – knownFacts). */
const factsWord = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'факт' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'факта' : 'фактов'}`;

const json = { 'content-type': 'application/json' };
const addMemory = (text: string) => request('/api/consultant/memory', { method: 'POST', headers: json, body: JSON.stringify({ text }) });
const editMemory = (id: string, text: string) => request(`/api/consultant/memory/${encodeURIComponent(id)}`, { method: 'PATCH', headers: json, body: JSON.stringify({ text }) });
async function removeMemory(id: string): Promise<void> {
  const res = await fetch(`/api/consultant/memory/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw await readError(res);
}

/**
 * «Изменить» у ответа знакомства и «+ дополнить»: шаг открывается в ленте (тот же goto, что «изменить» у ответа
 * в ленте). На /consultant – мягкое обновление без перезагрузки (владелец 11.10: «почему страница перезагружается?»).
 */
async function gotoStep(stepId: string, go: (path: string) => void) {
  await onboardingAct({ action: 'goto', stepId });
  go('/consultant');
}

function Editor({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSave(t);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') onCancel();
  };
  return (
    <form className={styles.editor} onSubmit={(e) => void submit(e)}>
      <input className={styles.input} aria-label={label} value={text} maxLength={TEXT_MAX} autoFocus disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <span className={styles.actions}>
        <button type="submit" className={styles.action} disabled={busy || !text.trim()}>
          сохранить
        </button>
        <button type="button" className={styles.action} onClick={onCancel} disabled={busy}>
          отмена
        </button>
      </span>
    </form>
  );
}

/**
 * «Что я о тебе знаю»: ответы знакомства (изменить = вернуться к шагу в ленте) и память консультанта –
 * то, что он запомнил из чата, и добавленное вручную (изменить и удалить здесь же). Новый пункт из чата
 * коротко подсвечен. Пока сервер извлекает факты из последней реплики (memoryPending), колонка
 * перечитывается ещё несколько раз через AsideProvider.
 */
export function MemoryCard({ facts, role, pending, limit, fill, minimal = false }: { facts: KnownFact[]; role: SceneAsideData['role']; pending?: boolean; limit?: number; fill?: SceneAsideData['fill']; minimal?: boolean }) {
  const refresh = useAsideRefresh();
  const softGo = useSoftGo();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const seen = useRef<Set<string> | null>(null);
  const polls = useRef(0);

  // Подсветка «новое»: пункты из чата, которых не было при прошлом рендере (первый рендер – всё «старое»).
  useEffect(() => {
    const ids = new Set(facts.map((f) => f.id));
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    const added = facts.filter((f) => f.source === 'chat' && !seen.current!.has(f.id)).map((f) => f.id);
    seen.current = ids;
    if (!added.length) return;
    setFresh((s) => new Set([...s, ...added]));
    const t = setTimeout(() => setFresh((s) => new Set([...s].filter((id) => !added.includes(id)))), NEW_HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [facts]);

  // Извлечение идёт фоном после ответа: перечитать колонку, пока сервер не закончит (с потолком).
  useEffect(() => {
    if (!pending) {
      polls.current = 0;
      return;
    }
    if (polls.current >= MAX_PENDING_POLLS) return;
    const t = setTimeout(() => {
      polls.current += 1;
      refresh();
    }, PENDING_POLL_MS);
    return () => clearTimeout(t);
  }, [pending, facts, refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Повтори.');
      return false;
    }
  };

  const visible = facts.filter((f) => !removed.has(f.id));
  const memoryCount = visible.filter((f) => f.source !== 'onboarding').length;
  const full = limit !== undefined && memoryCount >= limit;
  const title = `${role === 'employer' ? 'Что я знаю о компании' : 'Что я о тебе знаю'}${visible.length ? ` · ${factsWord(visible.length)}` : ''}`;

  return (
    <section className={aside.card} data-open={open} data-testid="aside-known">
      <h2 className={aside.cardHead}>
        <button type="button" className={aside.cardToggle} aria-expanded={open} aria-controls="aside-known-body" onClick={() => setOpen((o) => !o)}>
          {title}
          <span className={aside.chevron} aria-hidden="true" />
        </button>
      </h2>
      <div id="aside-known-body" className={aside.cardBody}>
        {/* «Для компании» – превью из ответов знакомства; без них вкладки не о чем */}
        {visible.some((f) => f.source === 'onboarding') && <ViewTabs employer={role === 'employer'} company={company} onChange={setCompany} compact />}
        {company ? (
          <CompanyPreview employer={role === 'employer'} answer={(id) => visible.find((f) => f.source === 'onboarding' && f.stepId === id)?.value} />
        ) : visible.length === 0 && !adding ? (
          // Пустой блок – это заметки из разговора, а не профиль: навыки, категория, компания и вакансии лежат в своих разделах.
          <p className={aside.muted} data-testid="memory-empty">
            Заметок из разговора пока нет.{' '}
            {role === 'employer' ? (
              <>
                Данные компании - в <Link href="/employer/company" className={styles.link}>профиле компании</Link>, вакансии - в разделе <Link href="/employer/vacancies" className={styles.link}>«Вакансии»</Link>.
              </>
            ) : (
              <>
                Навыки и категория хранятся в <Link href="/profile" className={styles.link}>профиле</Link>.
              </>
            )}{' '}
            Здесь появятся ответы знакомства и то, что я запомню из чата, - на них я буду опираться.
          </p>
        ) : (
          <ul className={styles.list}>
            {visible.map((f) => (
              <li key={f.id} className={styles.item} data-source={f.source} data-new={fresh.has(f.id) || undefined} data-testid={`memory-${f.id}`}>
                <span className={styles.source}>
                  <span className={styles.sourceName}>{f.source === 'onboarding' ? f.label : SOURCE_LABEL[f.source]}</span>
                  {f.source === 'onboarding' && role === 'candidate' && f.stepId && (
                    <span className={styles.seen} title={fieldVisibility(f.stepId)}>
                      {SEEN_SHORT[fieldVisibility(f.stepId)] ?? fieldVisibility(f.stepId)}
                    </span>
                  )}
                  {fresh.has(f.id) && <span className={styles.badge}>новое</span>}
                </span>
                {editing === f.id ? (
                  <Editor
                    initial={f.value}
                    label="Поправить заметку"
                    onCancel={() => setEditing(null)}
                    onSave={async (text) => {
                      if (await run(() => editMemory(f.id, text))) setEditing(null);
                    }}
                  />
                ) : (
                  <>
                    <span className={styles.text} title={f.value}>
                      {f.value}
                    </span>
                    <span className={styles.actions}>
                      {f.source === 'onboarding' ? (
                        f.editable && f.stepId ? (
                          <button type="button" className={styles.action} onClick={() => void run(() => gotoStep(f.stepId!, softGo))} title="Откроется этот шаг знакомства в ленте">
                            изменить
                          </button>
                        ) : null
                      ) : (
                        <>
                          <button type="button" className={styles.action} onClick={() => setEditing(f.id)} aria-label={`Изменить: ${f.value}`}>
                            изменить
                          </button>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label={`Удалить: ${f.value}`}
                            onClick={() =>
                              void run(async () => {
                                await removeMemory(f.id);
                                setRemoved((s) => new Set(s).add(f.id));
                              })
                            }
                          >
                            удалить
                          </button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {!company && fill && (
          <button type="button" className={styles.add} onClick={() => void run(() => gotoStep(fill.stepId, softGo))} title="Вопрос откроется в чате">
            + дополнить: {fill.label.toLowerCase()}
          </button>
        )}
        {company || minimal ? null : adding ? (
          <Editor
            initial=""
            label="Новая заметка"
            onCancel={() => setAdding(false)}
            onSave={async (text) => {
              if (await run(() => addMemory(text))) setAdding(false);
            }}
          />
        ) : (
          <button type="button" className={styles.add} onClick={() => setAdding(true)} disabled={full} title={full ? `В памяти уже ${limit} пунктов - удали лишнее` : undefined}>
            + добавить
          </button>
        )}
        {pending && <p className={styles.note}>запоминаю из разговора…</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
