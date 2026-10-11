'use client';

import { useCallback, useEffect, useState } from 'react';

import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Notice, Panel } from '@/components/ui';

import styles from './BlindEvaluate.module.css';

interface VacancyItem { id: string; title: string; specialization: string; grade: string; needsCount: number }
type Evidence = 'self_reported' | 'artifact' | 'third_party' | 'platform';
interface BlindCard {
  key: string;
  category: { label: string } | null;
  specialization: string | null;
  fsp: boolean;
  stack: string[];
  claims: { statement: string; evidence: Evidence }[];
}
interface Session {
  token: string;
  vacancy: { id: string; title: string; specialization: string; grade: string; needs: { statement: string; weight: number }[]; stack: string[] };
  cards: BlindCard[];
}
interface Method { meanRating: number; p3: number; ndcg3: number; cards: number }
interface Score { n: number; methods: { ours: Method; bm25: Method; random: Method }; verdict: string }

const RATES = [
  { v: 0, label: 'не подходит' },
  { v: 1, label: 'слабо' },
  { v: 2, label: 'подходит' },
  { v: 3, label: 'сильный' },
] as const;

const EVIDENCE_ORDER: { e: Evidence; label: string }[] = [
  { e: 'platform', label: 'Подтверждено платформой' },
  { e: 'third_party', label: 'Подтверждено третьей стороной' },
  { e: 'artifact', label: 'Есть артефакт' },
  { e: 'self_reported', label: 'Со слов кандидата' },
];

const num = (x: number) => x.toFixed(2).replace('.', ',');
const pct = (x: number) => `${Math.round(x * 100)} %`;

async function errText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? (res.status === 404 ? 'Не найдено (404)' : `Сервер ответил ${res.status}`);
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте сеть и повторите.');
  }
  if (!res.ok) throw new Error(await errText(res));
  return (await res.json()) as T;
}

/** Слепая разметка: потребность → до 8 карточек по одному → таблица «наш подбор / BM25 / случайный». Ничего не сохраняется. */
export function BlindEvaluate() {
  const [vacancies, setVacancies] = useState<VacancyItem[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState<Score | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVacancies = useCallback(() => {
    setError(null);
    setVacancies(null);
    call<{ vacancies: VacancyItem[] }>('/api/evaluate/blind/vacancies')
      .then((r) => setVacancies(r.vacancies))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadVacancies, [loadVacancies]);

  const start = useCallback(async (vacancyId: string) => {
    setBusy(true);
    setError(null);
    try {
      const s = await call<Session>('/api/evaluate/blind/start', { vacancyId });
      setSession(s);
      setRatings({});
      setIdx(0);
      setScore(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const finish = useCallback(async (s: Session, r: Record<string, number>) => {
    setBusy(true);
    setError(null);
    try {
      setScore(await call<Score>('/api/evaluate/blind/score', { token: s.token, ratings: r }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const total = session?.cards.length ?? 0;
  const answered = session !== null && idx >= total;

  const rate = useCallback(
    (v: number) => {
      if (!session || busy || idx >= session.cards.length) return;
      const next = { ...ratings, [session.cards[idx]!.key]: v };
      setRatings(next);
      if (idx + 1 >= session.cards.length) {
        setIdx(idx + 1);
        void finish(session, next);
      } else setIdx(idx + 1);
    },
    [session, busy, idx, ratings, finish],
  );

  useEffect(() => {
    if (!session || score || idx >= total) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '0' && e.key <= '3') rate(Number(e.key));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [session, score, idx, total, rate]);

  const reset = () => {
    setSession(null);
    setScore(null);
    setRatings({});
    setIdx(0);
    setError(null);
  };
  const again = () => {
    if (session) void start(session.vacancy.id);
  };

  return (
    <Container size="default" className={styles.page}>
      <PageTitle kicker="Слепая оценка" title="Разметьте кандидатов сами" lead="Чья карточка – не видно. Оцените 0–3, затем сравните порядок с нашим подбором." />
      {error && (
        <Notice tone="error" role="alert">
          {error}{' '}
          {!session && <Button size="sm" onClick={loadVacancies}>Повторить</Button>}
        </Notice>
      )}
      {!session && (
        <>
          <p className={styles.lead}>
            Покажем до 8 кандидатов по одному, вслепую: часть из верха нашего подбора, часть из верха BM25 по тексту, часть случайных. Чья карточка – не видно.
            Оцените 0–3. Ничего не сохраняется, займёт 2–3 минуты.
          </p>
          {vacancies === null && !error && <p className={styles.meta} role="status">Загрузка потребностей…</p>}
          {vacancies !== null && vacancies.length === 0 && <Notice>Список потребностей пуст: подбор пока не на чем показать.</Notice>}
          {vacancies !== null && vacancies.length > 0 && (
            <ul className={styles.list} aria-label="Потребности">
              {vacancies.map((v) => (
                <li key={v.id}>
                  <button type="button" className={styles.choice} disabled={busy} onClick={() => void start(v.id)}>
                    <span className={styles.choiceTitle}>{v.title}</span>
                    <span className={styles.meta}>{v.specialization} · {v.grade} · требований: {v.needsCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {session && (
        <>
          <section className={styles.need} aria-label="Потребность">
            <p className={styles.needTitle}>{session.vacancy.title} <span className={styles.meta}>{session.vacancy.specialization} · {session.vacancy.grade}</span></p>
            <ul className={styles.needList}>
              {session.vacancy.needs.map((n) => (
                <li key={n.statement}>{n.statement} <span className={styles.meta}>вес {n.weight}</span></li>
              ))}
            </ul>
            {session.vacancy.stack.length > 0 && <span className={styles.meta}>Стек: {session.vacancy.stack.join(', ')}</span>}
          </section>
          {!answered && <CardView card={session.cards[idx]!} idx={idx} total={total} value={ratings[session.cards[idx]!.key]} onRate={rate} onBack={() => setIdx(idx - 1)} />}
          {answered && !score && !error && <p className={styles.meta} role="status">Считаем итог…</p>}
          {answered && !score && error && <Button variant="primary" onClick={() => void finish(session, ratings)}>Повторить подсчёт</Button>}
          {score && (
            <Panel as="section" className={styles.card} aria-label="Итог">
              <p className={styles.verdict}>{score.verdict}</p>
              <table className={styles.table}>
                <thead>
                  <tr><th scope="col">Метод</th><th scope="col">Средняя оценка</th><th scope="col">Доля «≥ 2»</th><th scope="col">nDCG@3</th><th scope="col">Карточек</th></tr>
                </thead>
                <tbody>
                  {([['ours', 'Наш подбор'], ['bm25', 'BM25 по тексту'], ['random', 'Случайный']] as const).map(([k, name]) => {
                    const m = score.methods[k];
                    return (
                      <tr key={k}>
                        <th scope="row">{name}</th>
                        <td>{num(m.meanRating)}</td>
                        <td>{pct(m.p3)}</td>
                        <td>{num(m.ndcg3)}</td>
                        <td>{m.cards}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className={styles.note}>BM25 – та же базовая линия, что на /validation; карточка могла попасть в топ двух методов – тогда засчитана обоим.</p>
              <div className={styles.row}>
                <Button variant="primary" onClick={reset}>Другая потребность</Button>
                <Button onClick={again} loading={busy}>Повторить</Button>
                <a className={styles.link} href="/validation">Методика и цифры на /validation</a>
              </div>
            </Panel>
          )}
        </>
      )}
    </Container>
  );
}

function CardView({ card, idx, total, value, onRate, onBack }: { card: BlindCard; idx: number; total: number; value: number | undefined; onRate: (v: number) => void; onBack: () => void }) {
  return (
    <Panel as="article" className={styles.card} aria-label={`Карточка ${idx + 1}`}>
      <div className={styles.row}>
        <span className={styles.progress} aria-live="polite">{idx + 1} из {total}</span>
        {idx > 0 && <Button size="sm" onClick={onBack}>Назад</Button>}
      </div>
      <div className={styles.facts}>
        <span>Категория: <b>{card.category?.label ?? 'без теста'}</b></span>
        {card.specialization && <span>Специализация: {card.specialization}</span>}
        <span>ФСП: <b>{card.fsp ? 'есть' : 'нет'}</b></span>
        {card.stack.length > 0 && <span>Стек: {card.stack.join(', ')}</span>}
      </div>
      {EVIDENCE_ORDER.map(({ e, label }) => {
        const items = card.claims.filter((c) => c.evidence === e);
        if (items.length === 0) return null;
        return (
          <div key={e} className={styles.group}>
            <span className={styles.groupTitle}>{label}</span>
            <ul className={styles.claims}>{items.map((c, i) => <li key={i}>{c.statement}</li>)}</ul>
          </div>
        );
      })}
      <div className={styles.rates} role="group" aria-label="Оценка кандидата">
        {RATES.map((r) => (
          <button key={r.v} type="button" className={styles.rate} aria-pressed={value === r.v} onClick={() => onRate(r.v)}>
            <span className={styles.rateNum}>{r.v}</span>
            <span className={styles.rateLabel}>{r.label}</span>
          </button>
        ))}
      </div>
      <span className={styles.meta}>Клавиши 0–3</span>
    </Panel>
  );
}
