'use client';

import { useState } from 'react';
import { companyDisplayName } from '@/lib/company-brand';

import { Button, Notice, Panel, Tag } from '@/components/ui';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

import { ReasonAction } from './actions/ReasonAction';

export interface DemoData {
  showDemo: boolean;
  users: { id: string; role: string; kind: 'guest' | 'shared'; label: string; createdAt: string; blocked: boolean }[];
  companies: { id: string; name: string; vacancies: number }[];
  junk: { vacancies: { id: string; title: string; company: string }[]; companies: { id: string; name: string; guestUserIds: string[] }[] };
}

/** /admin/demo: переключатель показа демо в подборке, мусор e2e, списки демо-аккаунтов и компаний. */
export function DemoManager({ initial }: { initial: DemoData }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => {
    try {
      setData(await adminFetch<DemoData>('/api/admin/demo'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };
  const junkCount = data.junk.vacancies.length + data.junk.companies.length;

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <Panel className={styles.form}>
        <h2 className={styles.title}>Демо-кандидаты в подборке</h2>
        <div className={styles.row}>
          {data.showDemo ? <Tag>показываются</Tag> : <Tag tone="dashed">скрыты</Tag>}
          <ReasonAction
            label={data.showDemo ? 'Скрыть демо из подборки' : 'Показывать демо в подборке'}
            url="/api/admin/demo"
            method="POST"
            body={{ action: 'show_demo', value: !data.showDemo }}
            description={data.showDemo ? 'Работодатели перестанут видеть демо-кандидатов в подборке и поиске (на стенде это почти весь пул).' : 'Демо-кандидаты вернутся в подборку и поиск.'}
            onDone={() => void reload()}
          />
        </div>
      </Panel>

      <Panel className={styles.form}>
        <h2 className={styles.title}>Мусор e2e: {junkCount}</h2>
        {junkCount === 0 ? (
          <p className={styles.muted}>Не найдено: вакансий «E2E …» у демо-компаний и гостевых компаний-маркеров нет.</p>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Что</th>
                  <th>Название</th>
                  <th>id</th>
                </tr>
              </thead>
              <tbody>
                {data.junk.vacancies.map((v) => (
                  <tr key={v.id}>
                    <td>вакансия · {companyDisplayName(v.company)}</td>
                    <td>{v.title}</td>
                    <td className={styles.mono}>{v.id}</td>
                  </tr>
                ))}
                {data.junk.companies.map((c) => (
                  <tr key={c.id}>
                    <td>компания гостя (удалится с гостевым аккаунтом: {c.guestUserIds.length})</td>
                    <td>{companyDisplayName(c.name)}</td>
                    <td className={styles.mono}>{c.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.row}>
              <ReasonAction
                label="Удалить показанное"
                danger
                submitLabel="Удалить"
                url="/api/admin/demo"
                method="POST"
                body={{ action: 'cleanup', vacancyIds: data.junk.vacancies.map((v) => v.id), companyIds: data.junk.companies.map((c) => c.id) }}
                description="Удалятся только перечисленные строки и только если они всё ещё подходят под маркеры e2e. Приглашения и отклики вакансий удалятся каскадом."
                onDone={() => void reload()}
              />
            </div>
          </>
        )}
      </Panel>

      <Panel className={styles.form}>
        <div className={styles.row}>
          <h2 className={styles.title}>Демо-аккаунты: {data.users.length}</h2>
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            Обновить
          </Button>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Аккаунт</th>
              <th>Тип</th>
              <th>Роль</th>
              <th>Создан</th>
              <th>id</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.label} {u.blocked && <Tag tone="dashed">заблокирован</Tag>}
                </td>
                <td>{u.kind === 'guest' ? 'гость с /demo' : 'персона сида'}</td>
                <td>{u.role}</td>
                <td>{new Date(u.createdAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
                <td className={styles.mono}>{u.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className={styles.form}>
        <h2 className={styles.title}>Демо-компании: {data.companies.length}</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Компания</th>
              <th>Вакансий</th>
              <th>id</th>
            </tr>
          </thead>
          <tbody>
            {data.companies.map((c) => (
              <tr key={c.id}>
                <td>{companyDisplayName(c.name)}</td>
                <td>{c.vacancies}</td>
                <td className={styles.mono}>{c.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
