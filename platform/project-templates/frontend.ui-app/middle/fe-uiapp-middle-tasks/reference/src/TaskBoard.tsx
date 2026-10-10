// Эталонное решение (кандидату не выдаётся).
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type { Task, TasksApi } from './api';

type Filter = 'all' | 'active' | 'done';
const FILTERS: [Filter, string][] = [
  ['all', 'Все'],
  ['active', 'Активные'],
  ['done', 'Готовые'],
];

export function TaskBoard({ api }: { api: TasksApi }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [alert, setAlert] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(() => {
    setLoadError(false);
    setTasks(null);
    api.list().then(
      (list) => setTasks(list),
      () => setLoadError(true),
    );
  }, [api]);

  useEffect(load, [load]);

  const toggle = (t: Task) => {
    const done = !t.done;
    setAlert(null);
    setTasks((ts) => ts!.map((x) => (x.id === t.id ? { ...x, done } : x)));
    setPending((p) => new Set(p).add(t.id));
    api.setDone(t.id, done).then(
      (saved) => setTasks((ts) => ts!.map((x) => (x.id === t.id ? saved : x))),
      () => {
        setTasks((ts) => ts!.map((x) => (x.id === t.id ? { ...x, done: !done } : x)));
        setAlert('Не удалось сохранить изменение');
      },
    ).finally(() =>
      setPending((p) => {
        const n = new Set(p);
        n.delete(t.id);
        return n;
      }),
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
    const value = title.trim();
    if (!value) return setFormError('Введите название');
    if (value.length > 120) return setFormError('Не длиннее 120 символов');
    setFormError(null);
    setAlert(null);
    setCreating(true);
    api.create(value).then(
      (t) => {
        setTasks((ts) => [...(ts ?? []), t]);
        setTitle('');
      },
      () => setAlert('Не удалось добавить задачу'),
    ).finally(() => setCreating(false));
  };

  if (loadError) {
    return (
      <div>
        <p role="alert">Не удалось загрузить задачи</p>
        <button type="button" onClick={load}>
          Повторить
        </button>
      </div>
    );
  }
  if (!tasks) return <p role="status">Загрузка…</p>;

  const visible = tasks.filter((t) => filter === 'all' || (filter === 'done' ? t.done : !t.done));
  return (
    <div>
      {alert && <p role="alert">{alert}</p>}
      <form onSubmit={submit}>
        <label>
          Новая задача <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button type="submit" disabled={creating}>
          Добавить
        </button>
        {formError && <p>{formError}</p>}
      </form>
      <div>
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      <ul>
        {visible.map((t) => (
          <li key={t.id}>
            <label>
              <input type="checkbox" checked={t.done} disabled={pending.has(t.id)} onChange={() => toggle(t)} /> {t.title}
            </label>
          </li>
        ))}
      </ul>
      <p>Осталось: {tasks.filter((t) => !t.done).length}</p>
    </div>
  );
}
