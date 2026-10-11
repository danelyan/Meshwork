import Link from 'next/link';

import type { MatchResult } from '@/server/employer/matching';
import type { RelaxHint } from '@/server/employer/relax';
import { filtersToQuery, loadMoreLinks } from '@/server/employer/schemas';

import { Button, Notice } from '../ui';

import { MatchExplorer } from './MatchExplorer';
import { CandidateSearchRows } from './CandidateSearchRows';
import styles from './Employer.module.css';
import { FilterForm, filtersLabel } from './FilterForm';
import { RefinementHistory } from './RefinementHistory';

/** Выдача: фильтры, прежние выдачи, карточки. Общая для подборки по потребности и поиска по базе. */
export function MatchResults({ result, basePath, favoriteScope, companyName }: { result: MatchResult; basePath: string; favoriteScope?: string; companyName?: string }) {
  const query = filtersToQuery(result.filters);
  const vacancy = result.vacancy;
  // Поиск по базе: остальная выдача догружается ростом limit в адресе, фильтры те же.
  const more = vacancy ? null : loadMoreLinks(basePath, result.filters, result.items.length, result.total);
  return (
    <>
      {vacancy ? <details className={styles.evidenceDetails}><summary>Уточнить подборку</summary><FilterForm action={basePath} filters={result.filters} /><RefinementHistory basePath={basePath} query={query} label={filtersLabel(result.filters)} /></details> : <><FilterForm action={basePath} filters={result.filters} /><RefinementHistory basePath={basePath} query={query} label={filtersLabel(result.filters)} /></>}
      {!vacancy && <p className={styles.meta} role="status">
        Найдено: {result.total}
        {result.items.length < result.total ? `, показаны первые ${result.items.length}` : ''}. Фильтры: {filtersLabel(result.filters)}.
      </p>}
      {result.hints && result.hints.length > 0 && <RelaxHints hints={result.hints} basePath={basePath} />}
      {result.items.length === 0 ? (
        <Notice>
          Под эти условия нет кандидатов с подтверждёнными карточками. Ослабь фильтры или сбрось их - прежние выдачи
          остались в списке выше.
        </Notice>
      ) : !vacancy ? (
        <>
          <CandidateSearchRows items={result.items} scope={favoriteScope} total={result.total} moreHref={(more?.all ?? more?.next)?.href} />
          {result.items.length < result.total && (
            <nav className={styles.loadMore} aria-label="Остальные кандидаты выдачи">
              <span>Показано {result.items.length} из {result.total}.</span>
              {more?.next && <Button href={more.next.href} scroll={false} prefetch={false} variant="ghost">Показать ещё {more.next.add}</Button>}
              {more?.all && <Button href={more.all.href} scroll={false} prefetch={false} variant="ghost">{more.all.count < result.total ? `Показать первые ${more.all.count}` : `Показать всех ${more.all.count}`}</Button>}
              {!more?.next && <span>Больше страница не показывает - сузь выдачу фильтрами выше.</span>}
            </nav>
          )}
        </>
      ) : (
        <MatchExplorer items={result.items} vacancyId={vacancy?.id ?? null} vacancyTitle={vacancy?.title} companyName={companyName} defaultSalary={vacancy ? { from: vacancy.salaryFrom, to: vacancy.salaryTo } : undefined} favoriteScope={favoriteScope} />
      )}
    </>
  );
}

/** Подсказки ослабления (R-M-04): одиночные шаги, которые добавят кандидатов; текущая выдача остаётся в истории выше. */
export function RelaxHints({ hints, basePath }: { hints: RelaxHint[]; basePath: string }) {
  return (
    <p className={styles.history} aria-label="Как расширить подборку">
      <span>Как расширить подборку:</span>
      {hints.map((h) => {
        const text = `${h.label} - +${h.gain} ${plural(h.gain)}`;
        if (!h.filters) return <Link key={h.kind} href={`${basePath}/edit`}>{text}</Link>;
        const q = filtersToQuery(h.filters);
        return <Link key={`${h.kind}:${h.label}`} href={q ? `${basePath}?${q}` : basePath}>{text}</Link>;
      })}
    </p>
  );
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'кандидат';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'кандидата';
  return 'кандидатов';
}
