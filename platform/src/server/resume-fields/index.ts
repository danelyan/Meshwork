// lane resume-fields (R-C-01/02): поля профиля из резюме.
//  - пустое поле профиля заполняется само (status applied, в профиле — пометка «из резюме»);
//  - заполненное кандидатом не перетирается: остаётся предложение «в резюме указано иначе» (suggested);
//  - кандидат принимает или отклоняет предложение и правит любое поле сам (POST /api/profile/resume-fields).
// ФИО и контакт — только кандидату; работодатель до принятия приглашения их не видит (employer/privacy.ts).
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { normalizeContact } from '../contact';
import { prisma as defaultPrisma } from '../db';
import { errors } from '../errors';
import type { ExtractedDoc } from '../collector/types';
import { rawContactLines } from '../collector/doc';
import { RESUME_FIELD_KEYS, cleanRole, parseResumeFields, type ParsedResumeField, type ResumeFieldKey, type ResumeFieldValue } from './parse';

export { RESUME_FIELD_KEYS, parseResumeFields, parseResumeText, cleanRole, SOFT_SKILLS } from './parse';
export type { ParsedResumeField, ResumeFieldKey, ResumeFieldValue } from './parse';

type Db = Pick<PrismaClient, 'candidate' | 'candidateProfile' | 'resumeField'>;

interface Current {
  email: string;
  values: Record<ResumeFieldKey, ResumeFieldValue | null>;
}

/** Имя-заглушка: пусто, локальная часть почты (регистрация без имени) или «Демо-гость N». */
export function isPlaceholderName(name: string, email: string): boolean {
  const n = name.trim();
  return !n || n.toLowerCase() === email.split('@')[0]?.toLowerCase() || /^Демо-гость\b/u.test(n);
}

async function loadCurrent(db: Db, candidateId: string): Promise<Current> {
  const c = await db.candidate.findUnique({
    where: { id: candidateId },
    select: { name: true, email: true, contact: true, profile: { select: { experienceYears: true, roles: true, softSkills: true } } },
  });
  if (!c) throw errors.notFound('Кандидат не найден');
  return {
    email: c.email,
    values: {
      name: isPlaceholderName(c.name, c.email) ? null : c.name,
      contact: c.contact?.trim() || null,
      experienceYears: c.profile?.experienceYears ?? null,
      roles: c.profile?.roles?.length ? c.profile.roles : null,
      softSkills: c.profile?.softSkills?.length ? c.profile.softSkills : null,
    },
  };
}

const norm = (v: ResumeFieldValue | null | undefined): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return [...new Set(v.map((x) => x.trim().toLowerCase()))].sort().join('|');
  return String(v).trim().toLowerCase().replace(/ё/g, 'е');
};
export const sameValue = (a: ResumeFieldValue | null | undefined, b: ResumeFieldValue | null | undefined) => norm(a) === norm(b);

async function writeValue(db: Db, candidateId: string, key: ResumeFieldKey, value: ResumeFieldValue): Promise<void> {
  if (key === 'name') await db.candidate.update({ where: { id: candidateId }, data: { name: String(value) } });
  else if (key === 'contact') await db.candidate.update({ where: { id: candidateId }, data: { contact: String(value) } });
  else {
    const data = key === 'experienceYears' ? { experienceYears: Number(value) } : { [key]: value as string[] };
    await db.candidateProfile.upsert({ where: { candidateId }, update: data, create: { candidateId, ...data } });
  }
}

export interface ApplySummary {
  applied: ResumeFieldKey[];
  suggested: ResumeFieldKey[];
}

/**
 * Применить распознанные поля к профилю. Пустое — записать (applied); совпадает — ничего; отличается —
 * предложение (suggested), если кандидат не отклонил ровно это значение раньше.
 */
export async function applyResumeFields(
  candidateId: string,
  uploadId: string | null,
  fields: ParsedResumeField[],
  opts: { db?: Db; keys?: readonly ResumeFieldKey[] } = {},
): Promise<ApplySummary> {
  const db = opts.db ?? defaultPrisma;
  const cur = await loadCurrent(db, candidateId);
  const rows = new Map((await db.resumeField.findMany({ where: { candidateId } })).map((r) => [r.key, r]));
  const out: ApplySummary = { applied: [], suggested: [] };
  for (const f of fields) {
    if (opts.keys && !opts.keys.includes(f.key)) continue;
    const now = cur.values[f.key];
    const row = rows.get(f.key);
    const base = { uploadId, value: f.value as Prisma.InputJsonValue, quote: f.quote, sourceRef: f.sourceRef };
    let status: 'applied' | 'suggested';
    if (now === null) {
      await writeValue(db, candidateId, f.key, f.value);
      status = 'applied';
    } else if (sameValue(now, f.value)) {
      // Совпадает со значением профиля: обновить источник, если поле уже было «из резюме».
      if (row?.status === 'applied') await db.resumeField.update({ where: { id: row.id }, data: base });
      continue;
    } else if (row?.status === 'dismissed' && sameValue(row.value as ResumeFieldValue, f.value)) {
      continue;
    } else status = 'suggested';
    await db.resumeField.upsert({
      where: { candidateId_key: { candidateId, key: f.key } },
      create: { candidateId, key: f.key, status, ...base },
      update: { status, ...base },
    });
    out[status].push(f.key);
  }
  return out;
}

/** Из свежезагруженного резюме (вызов из POST /api/uploads). Контакт берётся из немаскированных строк того же разбора. */
export async function applyFromUpload(candidateId: string, uploadId: string, doc: ExtractedDoc): Promise<ApplySummary> {
  return applyResumeFields(candidateId, uploadId, parseResumeFields(doc, rawContactLines(doc)));
}

export interface ResumeFieldView {
  key: ResumeFieldKey;
  /** Значение в профиле сейчас */
  current: ResumeFieldValue | null;
  /** Значение из резюме и строка-источник */
  resume: ResumeFieldValue;
  quote: string;
  sourceRef: string;
  /** true — значение профиля взято из резюме и не менялось (пометка «из резюме») */
  fromResume: boolean;
  /** true — в резюме указано иначе, ждёт решения кандидата */
  suggestion: boolean;
}

/** Для кандидата: что взято из резюме и где резюме расходится с профилем. Работодателю не отдаётся. */
export async function resumeFieldsView(candidateId: string, db: Db = defaultPrisma): Promise<ResumeFieldView[]> {
  const [cur, rows] = await Promise.all([loadCurrent(db, candidateId), db.resumeField.findMany({ where: { candidateId } })]);
  return RESUME_FIELD_KEYS.flatMap((key) => {
    const r = rows.find((x) => x.key === key);
    if (!r || r.status === 'dismissed') return [];
    const resume = r.value as ResumeFieldValue;
    const current = cur.values[key];
    const fromResume = r.status === 'applied' && sameValue(current, resume);
    const suggestion = r.status === 'suggested' && !sameValue(current, resume);
    if (!fromResume && !suggestion) return [];
    return [{ key, current, resume, quote: r.quote, sourceRef: r.sourceRef, fromResume, suggestion }];
  });
}

const Name = z.string().trim().min(2).max(120);
const Years = z.coerce.number().int().min(0).max(60);
const List = z.array(z.string().trim().min(1).max(60)).max(10);

export const ResumeFieldAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), key: z.enum(RESUME_FIELD_KEYS) }),
  z.object({ action: z.literal('dismiss'), key: z.enum(RESUME_FIELD_KEYS) }),
  /** Правка кандидатом. Контакт — через POST /api/profile/contact (та же нормализация). */
  z.object({ action: z.literal('set'), key: z.enum(['name', 'experienceYears', 'roles', 'softSkills']), value: z.unknown() }),
]);
export type ResumeFieldActionInput = z.infer<typeof ResumeFieldAction>;

function validated(key: ResumeFieldKey, value: unknown): ResumeFieldValue | null {
  if (key === 'name') return Name.parse(value);
  if (key === 'experienceYears') return value === null || value === '' ? null : Years.parse(value);
  if (key === 'contact') {
    const c = normalizeContact(String(value ?? ''));
    if (!c) throw errors.badRequest('Контакт: почта или Telegram');
    return c;
  }
  const list = List.parse(value);
  // Роль — без компании: «Backend в Яндексе» → «Backend» (то же правило, что при разборе резюме).
  return key === 'roles' ? list.map((r) => cleanRole(r) ?? r.replace(/\s+(?:в|во|at)\s+.*$/iu, '').trim()).filter(Boolean) : list;
}

export async function actOnResumeField(candidateId: string, input: ResumeFieldActionInput, db: Db = defaultPrisma): Promise<ResumeFieldView[]> {
  const row = await db.resumeField.findUnique({ where: { candidateId_key: { candidateId, key: input.key } } });
  if (input.action === 'accept') {
    if (!row || row.status !== 'suggested') throw errors.badRequest('Нет предложения из резюме для этого поля');
    await writeValue(db, candidateId, input.key, validated(input.key, row.value) as ResumeFieldValue);
    await db.resumeField.update({ where: { id: row.id }, data: { status: 'applied' } });
  } else if (input.action === 'dismiss') {
    if (!row) throw errors.badRequest('Нет значения из резюме для этого поля');
    await db.resumeField.update({ where: { id: row.id }, data: { status: 'dismissed' } });
  } else {
    const v = validated(input.key, input.value);
    if (input.key === 'experienceYears' && v === null) {
      await db.candidateProfile.upsert({ where: { candidateId }, update: { experienceYears: null }, create: { candidateId } });
    } else if (v !== null) await writeValue(db, candidateId, input.key, v);
  }
  return resumeFieldsView(candidateId, db);
}
