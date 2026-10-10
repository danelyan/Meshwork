'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import { SPEC_LABEL, SPECIALIZATIONS, specLabel, subcategoriesFor } from '@/lib/directions';
import { ApiError } from '@/lib/api';
import { createVacancyApi, updateVacancyApi, type VacancyBody } from '@/lib/employer-api';
import type { CatalogEntry } from '@/server/claims/types';
import { detectRedFlags } from '@/server/employer/antifraud';
import { gradeWeight } from '@/server/recommend/weights';

import { Button, Chip, Field, Notice, Panel } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';
import { RedFlagNotice } from './RedFlagNotice';
import { GRADE_LABEL, GRADES } from '@/lib/grades';

export type CatalogOption = Pick<CatalogEntry, 'id' | 'specialization' | 'statement' | 'grades' | 'weight' | 'weights'>;

export interface VacancyFormProps {
  catalog: CatalogOption[];
  /** Редактирование: id и текущие значения. */
  vacancyId?: string;
  /** Черновик (подсказка ассистента) может прийти без подкатегории — её выбирают в форме. */
  initial?: Omit<VacancyBody, 'subcategoryId'> & { subcategoryId?: string | null };
}

type Spec = VacancyBody['specialization'];
type Grade = VacancyBody['grade'];

/** Требования, ожидаемые в грейде (вес по каталогу § 7), по убыванию веса. */
function optionsFor(catalog: CatalogOption[], spec: Spec, grade: Grade) {
  return catalog
    .filter((e) => e.specialization === spec || e.specialization === 'common')
    .map((e) => ({ e, w: gradeWeight(e as CatalogEntry, spec, grade) }))
    .filter((x): x is { e: CatalogOption; w: number } => x.w !== null && x.w > 0)
    .sort((a, b) => b.w - a.w || a.e.id.localeCompare(b.e.id));
}

const DEFAULT_PICK = 6;

/** Потребность (R-E-02): кто нужен, чем занимается команда, стек, специализация, грейд, вилка, требования из каталога. */
export function VacancyForm({ catalog, vacancyId, initial }: VacancyFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [spec, setSpec] = useState<Spec>(initial?.specialization ?? 'backend');
  const [grade, setGrade] = useState<Grade>(initial?.grade ?? 'junior');
  const [subcategory, setSubcategory] = useState(initial?.subcategoryId ?? '');
  const [salaryFrom, setSalaryFrom] = useState(initial?.salaryFrom ? String(initial.salaryFrom) : '');
  const [salaryTo, setSalaryTo] = useState(initial?.salaryTo ? String(initial.salaryTo) : '');
  const [team, setTeam] = useState(initial?.teamDescription ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [stack, setStack] = useState((initial?.stack ?? []).join(', '));
  const flags = useMemo(
    () =>
      detectRedFlags({ texts: [title, team, description], salaryFrom: Number(salaryFrom.replace(/\s/g, '')), salaryTo: Number(salaryTo.replace(/\s/g, '')) }).filter(
        (f) => f.code !== 'vague_text' && f.code !== 'no_salary',
      ),
    [title, team, description, salaryFrom, salaryTo],
  );
  const options = useMemo(() => optionsFor(catalog, spec, grade), [catalog, spec, grade]);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(initial ? initial.needs.map((n) => n.catalogId) : optionsFor(catalog, 'backend', 'junior').slice(0, DEFAULT_PICK).map((x) => x.e.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  function changeTrack(nextSpec: Spec, nextGrade: Grade) {
    setSpec(nextSpec);
    setGrade(nextGrade);
    if (nextSpec !== spec) setSubcategory('');
    // Смена специализации — требования другого каталога: подставляем самые весомые заново.
    if (nextSpec !== spec || picked.size === 0) setPicked(new Set(optionsFor(catalog, nextSpec, nextGrade).slice(0, DEFAULT_PICK).map((x) => x.e.id)));
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const from = Number(salaryFrom.replace(/\s/g, ''));
    const to = Number(salaryTo.replace(/\s/g, ''));
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = 'Назови потребность (не короче 3 символов)';
    if (!Number.isInteger(from) || from <= 0) next.salaryFrom = 'Укажи нижнюю границу в рублях';
    if (!Number.isInteger(to) || to <= 0) next.salaryTo = 'Укажи верхнюю границу в рублях';
    else if (to < from) next.salaryTo = 'Верхняя граница меньше нижней';
    const needs = options.filter((o) => picked.has(o.e.id)).map((o) => ({ catalogId: o.e.id, weight: Math.min(3, Math.max(1, o.w)) }));
    if (needs.length === 0) next.needs = 'Выбери хотя бы одно требование';
    if (!subcategory) next.subcategory = 'Выбери подкатегорию: подборка ищет по ней';
    setErrs(next);
    if (Object.keys(next).length) return;
    const body: VacancyBody = {
      title: title.trim(),
      specialization: spec,
      grade,
      salaryFrom: from,
      salaryTo: to,
      teamDescription: team.trim() || null,
      description: description.trim() || null,
      stack: stack.split(',').map((s) => s.trim()).filter(Boolean),
      subcategoryId: subcategory,
      needs,
    };
    setBusy(true);
    setError(null);
    try {
      const r = vacancyId ? await updateVacancyApi(vacancyId, body) : await createVacancyApi(body);
      router.push(`/employer/needs/${encodeURIComponent(r.id)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить потребность');
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Panel className={styles.form}>
        <Field label="Кого ищешь" hint="Например: «Backend-разработчик платежей»" error={errs.title}>
          <input className={ui.input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className={styles.row}>
          <Field label="Направление">
            <select className={ui.input} value={spec} onChange={(e) => changeTrack(e.target.value as Spec, grade)}>
              {SPECIALIZATIONS.map((s) => (
                <option key={s} value={s}>
                  {SPEC_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Подкатегория" hint="Своя подкатегория - выше в подборке, соседние - ниже" error={errs.subcategory}>
            <select className={ui.input} value={subcategory} onChange={(e) => setSubcategory(e.target.value)} required>
              <option value="" disabled>
                выбери
              </option>
              {subcategoriesFor(spec).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.status === 'planned' ? ' (тест в плане)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Грейд">
            <select className={ui.input} value={grade} onChange={(e) => changeTrack(spec, e.target.value as Grade)}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABEL[g]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Зарплата от, ₽" error={errs.salaryFrom}>
            <input className={ui.input} inputMode="numeric" value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value)} />
          </Field>
          <Field label="Зарплата до, ₽" error={errs.salaryTo}>
            <input className={ui.input} inputMode="numeric" value={salaryTo} onChange={(e) => setSalaryTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Чем занимается команда" hint="Кандидат увидит это в приглашении">
          <textarea className={ui.input} rows={3} maxLength={2000} value={team} onChange={(e) => setTeam(e.target.value)} />
        </Field>
        <Field label="Стек" hint="Через запятую: Go, PostgreSQL, Kafka. Ищется в подтверждённых цитатах кандидатов">
          <input className={ui.input} value={stack} onChange={(e) => setStack(e.target.value)} />
        </Field>
        <Field label="Комментарий (необязательно)">
          <textarea className={ui.input} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </Panel>
      <Panel className={styles.form} aria-labelledby="needs-title">
        <div>
          <h2 id="needs-title" className={styles.sectionTitle}>
            Требования
          </h2>
          <p className={styles.lead}>
            Из каталога навыков для {specLabel(spec)} · {GRADE_LABEL[grade]}. По ним считается подборка: вес требования - из каталога для грейда.
            Выбрано: {picked.size}.
          </p>
        </div>
        <div className={styles.chips} role="group" aria-label="Требования из каталога">
          {options.map(({ e, w }) => (
            <Chip key={e.id} pressed={picked.has(e.id)} onClick={() => toggle(e.id)} title={`Вес в грейде: ${w}`}>
              {e.statement}
            </Chip>
          ))}
        </div>
        {options.length === 0 && <Notice>Для этого направления в каталоге навыков пока нет требований - потребность сохранить не получится.</Notice>}
        {errs.needs && <Notice tone="error">{errs.needs}</Notice>}
      </Panel>
      <RedFlagNotice flags={flags} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" variant="cta" loading={busy}>
          {vacancyId ? 'Сохранить' : 'Создать и показать подборку'}
        </Button>
        <Button href={vacancyId ? `/employer/needs/${encodeURIComponent(vacancyId)}` : '/employer'}>Отмена</Button>
      </div>
    </form>
  );
}
