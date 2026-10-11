'use client';

import { useState } from 'react';

import styles from '@/app/(admin)/admin/admin.module.css';
import { Tag } from '@/components/ui';

import { ReasonAction } from './ReasonAction';

/** Действия в карточке вакансии (E-08 фаза 3): скрыть от кандидатов или вернуть. Право hide_vacancy. */
export function VacancyActions({ vacancyId, hidden: initial, canHide }: { vacancyId: string; hidden: boolean; canHide: boolean }) {
  const [hidden, setHidden] = useState(initial);
  const onDone = (r: unknown) => setHidden((r as { hidden: boolean }).hidden);
  return (
    <div className={styles.form}>
      <div className={styles.row}>{hidden ? <Tag tone="dashed">скрыта модератором</Tag> : <Tag tone="outline">видна кандидатам</Tag>}</div>
      {canHide && (
        <div className={styles.row}>
          {hidden ? (
            <ReasonAction label="Вернуть вакансию" url={`/api/admin/vacancies/${vacancyId}/hide`} method="POST" body={{ hidden: false }} description="Вакансия снова появится у кандидатов (если не в архиве и компания не заблокирована)." onDone={onDone} />
          ) : (
            <ReasonAction label="Скрыть вакансию" danger url={`/api/admin/vacancies/${vacancyId}/hide`} method="POST" body={{ hidden: true }} description="Кандидаты не увидят вакансию и не смогут откликнуться. Работодатель не обойдёт скрытие разархивированием." onDone={onDone} />
          )}
        </div>
      )}
    </div>
  );
}
