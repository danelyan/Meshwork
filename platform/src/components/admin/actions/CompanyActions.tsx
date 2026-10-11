'use client';

import { useState } from 'react';

import styles from '@/app/(admin)/admin/admin.module.css';

import { BlockBadge, type BlockView, blockedNow } from './BlockState';
import { ReasonAction } from './ReasonAction';

/** Действия в карточке компании (E-08 фаза 3): блокировка – приглашения не отправляются, вакансии скрыты. Право block_company. */
export function CompanyActions({ companyId, block: initial, canBlock }: { companyId: string; block: BlockView; canBlock: boolean }) {
  const [block, setBlock] = useState(initial);
  const blocked = blockedNow(block);
  const onDone = (r: unknown) => {
    const b = (r as { block: { blockedAt: string | null; blockedUntil: string | null } }).block;
    setBlock({ blockedAt: b.blockedAt, blockedUntil: b.blockedUntil });
  };
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <BlockBadge block={block} />
      </div>
      {canBlock && (
        <div className={styles.row}>
          {blocked ? (
            <ReasonAction label="Разблокировать компанию" url={`/api/admin/companies/${companyId}/block`} method="DELETE" description="Компания снова сможет отправлять приглашения, её вакансии вернутся кандидатам." onDone={onDone} />
          ) : (
            <ReasonAction label="Заблокировать компанию" danger withUntil url={`/api/admin/companies/${companyId}/block`} method="POST" description="Отправка приглашений закрывается сразу (проверка в транзакции отправки), вакансии компании скрываются от кандидатов." onDone={onDone} />
          )}
        </div>
      )}
    </div>
  );
}
