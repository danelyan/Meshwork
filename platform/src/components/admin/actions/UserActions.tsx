'use client';

import { useState } from 'react';

import styles from '@/app/(admin)/admin/admin.module.css';

import { BlockBadge, type BlockView, blockedNow } from './BlockState';
import { ReasonAction } from './ReasonAction';

export interface UserActionsProps {
  userId: string;
  block: BlockView;
  /** Права роли сотрудника (`can(role, …)` на сервере): block_user, unblock_user, erase_account. */
  can: { block: boolean; unblock: boolean; erase: boolean };
}

/** Действия в карточке пользователя (E-08 фаза 3): блокировка входа, разблокировка, удаление по запросу субъекта ПДн. */
export function UserActions({ userId, block: initial, can }: UserActionsProps) {
  const [block, setBlock] = useState(initial);
  const [erased, setErased] = useState(false);
  if (erased) return <p className={styles.muted}>Аккаунт удалён по запросу субъекта ПДн. Запись – в журнале.</p>;
  const blocked = blockedNow(block);
  const onBlock = (r: unknown) => {
    const b = (r as { block: { blockedAt: string | null; blockedUntil: string | null } }).block;
    setBlock({ blockedAt: b.blockedAt, blockedUntil: b.blockedUntil });
  };
  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <BlockBadge block={block} />
      </div>
      <div className={styles.row}>
        {!blocked && can.block && (
          <ReasonAction label="Заблокировать" danger withUntil url={`/api/admin/users/${userId}/block`} method="POST" description="Вход будет закрыт, все активные сессии пользователя отозваны сразу. Кандидат выпадет из подборки и поиска." onDone={onBlock} />
        )}
        {blocked && can.unblock && (
          <ReasonAction label="Разблокировать" url={`/api/admin/users/${userId}/block`} method="DELETE" description="Вход снова откроется. Старые сессии не вернутся – пользователь войдёт заново." onDone={onBlock} />
        )}
        {can.erase && (
          <ReasonAction
            label="Удалить по запросу субъекта ПДн"
            danger
            confirmText={userId}
            submitLabel="Удалить навсегда"
            url={`/api/admin/users/${userId}/erase`}
            method="POST"
            description="Необратимо: профиль кандидата и работодателя, файлы и записи созвонов будут удалены (как при самоудалении). В журнал попадут только id и факт удаления."
            onDone={() => setErased(true)}
          />
        )}
      </div>
    </div>
  );
}
