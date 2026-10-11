import { Button, Meter, Tag } from '@/components/ui';
import { toCsvHref } from '@/server/admin/metrics/links';
import { NEAR_CEILING_SHARE, llmByDay, llmByPurpose, nearCeiling } from '@/server/admin/metrics/llm-monitor';
import { acceptedByRank, matchingFunnel, type RankBucket } from '@/server/admin/metrics/matching-monitor';
import { parseDays } from '@/server/admin/metrics/period';
import { RECALIBRATION_RULES as R, testItemStats } from '@/server/admin/metrics/test-monitor';
import { requirePageStaff } from '@/server/admin/session';
import { getSetting } from '@/server/admin/settings';

import styles from '../admin.module.css';
import m from './metrics.module.css';

export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90] as const;
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const int = (x: number | null) => (x === null ? '–' : Math.round(x).toLocaleString('ru-RU'));
const RANK_LABEL: Record<RankBucket, string> = { top3: 'Ранг ≤ 3', top10: 'Ранг ≤ 10', over10: 'Ранг > 10', unknown: 'Без ранга' };
const bar = (share: number | null, max = 20) => (
  <div className={m.cell}>
    <Meter value={Math.round((share ?? 0) * max)} max={max} label={pct(share)} />
    <span className={styles.mono}>{pct(share)}</span>
  </div>
);

/** Качество механик и расходы (только owner): тест на грейд по заданиям, воронка подбора, LLM, выгрузка CSV. */
export default async function AdminMetricsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requirePageStaff('/admin/metrics', 'view_metrics');
  const days = parseDays((await searchParams).days);
  // Бюджет - из настройки админки (по умолчанию 0 = без лимита), как в assertBudget.
  const budget = await getSetting('llm.dailyTokenBudget');
  const [items, funnel, byRank, byPurpose, byDay, ceiling] = await Promise.all([testItemStats(days), matchingFunnel(days), acceptedByRank(days), llmByPurpose(days), llmByDay(days), nearCeiling(new Date(), budget)]);
  const maxDay = Math.max(1, ...byDay.map((d) => d.inputTokens + d.outputTokens));
  const flagged = items.filter((i) => i.flags.length > 0);

  return (
    <>
      <h1 className={styles.title}>Метрики</h1>
      <p className={styles.muted}>Живые данные за период. Выгрузки обезличены: только агрегаты, группы меньше 5 скрыты.</p>
      <div className={styles.row}>
        {PERIODS.map((p) => (
          <Button key={p} href={`/admin/metrics?days=${p}`} variant={p === days ? 'primary' : 'ghost'} size="sm">{p} дн.</Button>
        ))}
        <a href={toCsvHref('test', days)} download>CSV: тест</a>
        <a href={toCsvHref('matching', days)} download>CSV: подбор</a>
        <a href={toCsvHref('llm', days)} download>CSV: LLM</a>
      </div>

      <section className={m.section}>
        <h2 className={m.h2}>Тест на грейд: задания</h2>
        <p className={styles.muted}>
          Дискриминация – корреляция «ответ верен ↔ итоговая θ попытки» (грубая точечно-бисериальная; не 2PL-калибровка).
          Учитываются полные попытки, не демо. Нужна перекалибровка в списке ниже ({flagged.length} из {items.length}).
        </p>
        <ul className={m.rules}>
          <li>Правило срабатывает при ≥ {R.minAnswered} ответах на задание, иначе выводов нет.</li>
          <li>Слишком лёгкое: верных ≥ {pct(R.tooEasy)}; слишком трудное: верных ≤ {pct(R.tooHard)}.</li>
          <li>Слабо различает: корреляция &lt; {R.minCorrelation} при ≥ {R.minPairs} парах (ответ, θ).</li>
          <li>Расхождение с моделью: доля верных отличается от ожидаемой 2PL при θ = 0 больше чем на {pct(R.maxGapFromModel)}.</li>
        </ul>
        <div className={m.scroll}>
          <table className={styles.table}>
            <thead>
              <tr><th>Задание</th><th>Показов</th><th>Ответов</th><th>Верно</th><th>Корр.</th><th>Время, с (мед. / сред.)</th><th>Источник параметров</th><th>Вывод</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.templateId}>
                  <td><div>{i.title}</div><div className={styles.mono}>{i.templateId} · {i.specialization} · {i.grade}</div></td>
                  <td className={m.num}>{i.shown}</td>
                  <td className={m.num}>{i.answered}</td>
                  <td>{bar(i.correctShare)}</td>
                  <td className={m.num}>{i.discrimination === null ? '–' : i.discrimination.toFixed(2)}</td>
                  <td className={m.num}>{int(i.medianSec)} / {int(i.avgSec)}</td>
                  <td className={styles.mono}>{i.paramsSource}</td>
                  <td>
                    {i.flags.length > 0 ? <Tag tone="dashed">нужна перекалибровка</Tag> : i.answered < R.minAnswered ? <Tag tone="outline">мало данных</Tag> : <Tag>в норме</Tag>}
                    {i.flags.map((f) => <p key={f} className={m.flag}>{f}</p>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 && <p className={styles.muted}>За период заданий не показывали.</p>}
      </section>

      <section className={m.section}>
        <h2 className={m.h2}>Подбор: воронка приглашений по категориям</h2>
        <p className={styles.muted}>
          Категория – последняя категория кандидата. «Принято» = принято + нанят. Время до первого приглашения – от выдачи категории,
          медиана по кандидатам.
        </p>
        <div className={m.scroll}>
          <table className={styles.table}>
            <thead>
              <tr><th>Категория</th><th>Отправлено</th><th>Просмотрено</th><th>Принято</th><th>Отклонено</th><th>Доля принятых</th><th>Кандидатов</th><th>До 1-го приглашения, ч</th></tr>
            </thead>
            <tbody>
              {funnel.map((r) => (
                <tr key={`${r.specialization}/${r.grade}`}>
                  <td className={styles.mono}>{r.specialization} · {r.grade}</td>
                  <td className={m.num}>{r.sent}</td>
                  <td className={m.num}>{r.viewed}</td>
                  <td className={m.num}>{r.accepted}</td>
                  <td className={m.num}>{r.declined}</td>
                  <td>{bar(r.acceptedShare)}</td>
                  <td className={m.num}>{r.invitedCandidates}</td>
                  <td className={m.num}>{r.medianHoursToFirst === null ? '–' : r.medianHoursToFirst.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {funnel.length === 0 && <p className={styles.muted}>За период приглашений нет.</p>}
        <h3 className={m.h2}>Доля принятых по месту в подборке</h3>
        <p className={styles.muted}>
          Ранг – место кандидата в подборке, поиске или ленте помощника в момент отправки (1 = первый). «≤ 3» входит в «≤ 10».
          Без ранга – избранное, черновик помощника, приглашение на защиту и приглашения до появления поля.
        </p>
        <div className={m.scroll}>
          <table className={styles.table}>
            <thead>
              <tr><th>Место</th><th>Отправлено</th><th>Принято</th><th>Доля принятых</th></tr>
            </thead>
            <tbody>
              {byRank.map((r) => (
                <tr key={r.bucket}>
                  <td>{RANK_LABEL[r.bucket]}</td>
                  <td className={m.num}>{r.sent}</td>
                  <td className={m.num}>{r.accepted}</td>
                  <td>{bar(r.acceptedShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={m.section}>
        <h2 className={m.h2}>LLM: расходы и качество</h2>
        <div className={m.scroll}>
          <table className={styles.table}>
            <thead>
              <tr><th>Назначение</th><th>Вызовов</th><th>Токены вход</th><th>Токены выход</th><th>p50, мс</th><th>p95, мс</th><th>Невалидный JSON</th><th>Ретраев</th><th>Сбоев</th></tr>
            </thead>
            <tbody>
              {byPurpose.map((r) => (
                <tr key={r.purpose}>
                  <td className={styles.mono}>{r.purpose}</td>
                  <td className={m.num}>{r.runs}</td>
                  <td className={m.num}>{int(r.inputTokens)}</td>
                  <td className={m.num}>{int(r.outputTokens)}</td>
                  <td className={m.num}>{int(r.p50Ms)}</td>
                  <td className={m.num}>{int(r.p95Ms)}</td>
                  <td className={m.num}>{pct(r.invalidJsonShare)}</td>
                  <td className={m.num}>{r.retries}</td>
                  <td className={m.num}>{pct(r.failedShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {byPurpose.length === 0 && <p className={styles.muted}>За период вызовов нет.</p>}

        <h3 className={m.h2}>По дням (МСК)</h3>
        <table className={styles.table}>
          <thead><tr><th>День</th><th>Вызовов</th><th>Токенов (вход + выход)</th><th /></tr></thead>
          <tbody>
            {byDay.map((d) => {
              const t = d.inputTokens + d.outputTokens;
              return (
                <tr key={d.day}>
                  <td className={styles.mono}>{d.day}</td>
                  <td className={m.num}>{d.runs}</td>
                  <td className={m.num}>{int(t)}</td>
                  <td>{bar(t / maxDay)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h3 className={m.h2}>Кандидаты у потолка бюджета</h3>
        <p className={styles.muted}>
          От {pct(NEAR_CEILING_SHARE)} суточного бюджета ({budget > 0 ? int(budget) : 'лимит выключен'} токенов, скользящие 24 часа). Только идентификатор, без ПДн.
        </p>
        {ceiling.length > 0 ? (
          <table className={styles.table}>
            <thead><tr><th>Кандидат (id)</th><th>Токенов за 24 ч</th><th>Доля бюджета</th></tr></thead>
            <tbody>
              {ceiling.map((c) => (
                <tr key={c.candidateId}>
                  <td className={styles.mono}>{c.candidateId}</td>
                  <td className={m.num}>{int(c.tokens)}</td>
                  <td>{bar(Math.min(c.share, 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.muted}>Таких нет.</p>
        )}
      </section>
    </>
  );
}
