import type { MatchResult } from '@/server/employer/matching';
import { filtersToQuery } from '@/server/employer/schemas';

import { Notice } from '../ui';

import { MatchExplorer } from './MatchExplorer';
import styles from './Employer.module.css';
import { FilterForm, filtersLabel } from './FilterForm';
import { RefinementHistory } from './RefinementHistory';

/** Выдача: фильтры, прежние выдачи, карточки. Общая для подборки по потребности и поиска по базе. */
export function MatchResults({ result, basePath, favoriteScope }: { result: MatchResult; basePath: string; favoriteScope?: string }) {
  const query = filtersToQuery(result.filters);
  const vacancy = result.vacancy;
  return (
    <>
      <FilterForm action={basePath} filters={result.filters} />
      <RefinementHistory basePath={basePath} query={query} label={filtersLabel(result.filters)} />
      <p className={styles.meta} role="status">
        Найдено: {result.total}
        {result.items.length < result.total ? `, показаны первые ${result.items.length}` : ''}. Фильтры: {filtersLabel(result.filters)}.
      </p>
      {result.items.length === 0 ? (
        <Notice>
          Под эти условия нет кандидатов с подтверждёнными карточками. Ослабь фильтры или сбрось их - прежние выдачи
          остались в списке выше.
        </Notice>
      ) : (
        <MatchExplorer items={result.items} vacancyId={vacancy?.id ?? null} vacancyTitle={vacancy?.title} defaultSalary={vacancy ? { from: vacancy.salaryFrom, to: vacancy.salaryTo } : undefined} favoriteScope={favoriteScope} />
      )}
    </>
  );
}
