'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Notice, Tag } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

interface Sub {
  id: string;
  specialization: string;
  title: string;
  status: 'active' | 'planned';
  order: number;
}
interface Claim {
  id: string;
  specialization: string;
  statement: string;
  limits: string;
}
interface Template {
  kind: 'task' | 'project';
  id: string;
  title: string;
  specialization: string;
  grade: string;
  published: boolean;
}

/** Справочники: причина запрашивается через prompt, после записи страница перечитывается с сервера. */
export function CatalogsManager({ subcategories, claims, templates, q }: { subcategories: Sub[]; claims: Claim[]; templates: Template[]; q: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, string>>({});

  async function act(question: string, call: (reason: string) => Promise<unknown>) {
    const reason = window.prompt(`${question}\nПричина (попадёт в журнал):`);
    if (!reason) return;
    setError(null);
    try {
      await call(reason);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}

      <h2 className={styles.title}>Подкатегории</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Подкатегория</th>
            <th>Статус</th>
            <th>Порядок</th>
          </tr>
        </thead>
        <tbody>
          {subcategories.map((s) => (
            <tr key={s.id}>
              <td>
                {s.title}
                <div className={styles.mono}>{s.id}</div>
              </td>
              <td>
                <div className={styles.row}>
                  {s.status === 'active' ? <Tag tone="solid">active</Tag> : <Tag tone="dashed">planned</Tag>}
                  <Button size="sm" variant="ghost" onClick={() => void act(`Подкатегория ${s.id}: статус ${s.status === 'active' ? 'planned' : 'active'}?`, (reason) => adminFetch(`/api/admin/catalogs/subcategories/${s.id}`, { method: 'PATCH', body: { status: s.status === 'active' ? 'planned' : 'active', reason } }))}>
                    {s.status === 'active' ? 'Сделать planned' : 'Сделать active'}
                  </Button>
                </div>
              </td>
              <td>
                <div className={styles.row}>
                  <input className={ui.input} style={{ maxWidth: 90 }} type="number" min={0} aria-label={`Порядок ${s.id}`} value={orders[s.id] ?? String(s.order)} onChange={(e) => setOrders({ ...orders, [s.id]: e.target.value })} />
                  <Button size="sm" variant="ghost" disabled={orders[s.id] === undefined || orders[s.id] === String(s.order)} onClick={() => void act(`Подкатегория ${s.id}: порядок ${orders[s.id]}?`, (reason) => adminFetch(`/api/admin/catalogs/subcategories/${s.id}`, { method: 'PATCH', body: { order: Number(orders[s.id]), reason } }))}>
                    Сохранить
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={styles.title}>Шаблоны заданий и проектов</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Шаблон</th>
            <th>Тип</th>
            <th>Направление, грейд</th>
            <th>Публикация</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={`${t.kind}:${t.id}`}>
              <td>
                {t.title}
                <div className={styles.mono}>{t.id}</div>
              </td>
              <td>{t.kind === 'task' ? 'задание теста' : 'проект'}</td>
              <td>
                {t.specialization}, {t.grade}
              </td>
              <td>
                <div className={styles.row}>
                  {t.published ? <Tag tone="solid">опубликован</Tag> : <Tag tone="dashed">снят</Tag>}
                  <Button size="sm" variant={t.published ? 'danger' : 'ghost'} onClick={() => void act(`${t.published ? 'Снять с публикации' : 'Опубликовать'} ${t.id}?`, (reason) => adminFetch(`/api/admin/catalogs/templates/${t.kind}/${t.id}`, { method: 'PUT', body: { published: !t.published, reason } }))}>
                    {t.published ? 'Снять' : 'Опубликовать'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={styles.title}>Каталог утверждений</h2>
      <form className={styles.filters} action="/admin/catalogs" method="get">
        <input className={ui.input} name="q" defaultValue={q} aria-label="Поиск по id или тексту" placeholder="Поиск по id или тексту" />
        <Button size="sm" type="submit">
          Найти
        </Button>
      </form>
      <p className={styles.muted}>Показано {claims.length} (не больше 500). Меняется только текст и ограничения.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Утверждение</th>
            <th>Ограничения</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}>
              <td>
                {c.statement}
                <div className={styles.mono}>{c.id}</div>
              </td>
              <td>{c.limits}</td>
              <td>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const statement = window.prompt(`Текст утверждения ${c.id}:`, c.statement);
                    if (statement === null || statement.trim() === c.statement) return;
                    void act(`Изменить текст ${c.id}?`, (reason) => adminFetch(`/api/admin/catalogs/claims/${c.id}`, { method: 'PATCH', body: { statement, reason } }));
                  }}
                >
                  Изменить текст
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
