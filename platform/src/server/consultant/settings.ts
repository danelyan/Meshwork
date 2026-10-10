import { prisma } from '../db';
import { normalizeSkills, type ConsultantSettingsData } from './skills';

// Настройки консультанта кандидата (таблица ConsultantSettings): чтение для правой колонки и хода, запись из API.

export const EMPTY_SETTINGS: ConsultantSettingsData = { skills: [], custom: '' };

export async function loadConsultantSettings(candidateId: string): Promise<ConsultantSettingsData> {
  const row = await prisma.consultantSettings.findUnique({ where: { candidateId }, select: { skills: true, custom: true } });
  if (!row) return { ...EMPTY_SETTINGS };
  return { skills: normalizeSkills(row.skills), custom: row.custom ?? '' };
}

/** Сохраняет как есть (без экранирования — экранирует блок хода); пустой текст — null. */
export async function saveConsultantSettings(candidateId: string, input: { skills: string[]; custom?: string | null }): Promise<ConsultantSettingsData> {
  const skills = normalizeSkills(input.skills);
  const custom = (input.custom ?? '').replace(/\r\n?/g, '\n').trim() || null;
  const row = await prisma.consultantSettings.upsert({
    where: { candidateId },
    create: { candidateId, skills, custom },
    update: { skills, custom },
    select: { skills: true, custom: true },
  });
  return { skills: row.skills, custom: row.custom ?? '' };
}

/** Для хода: сбой чтения не ломает ответ — консультант работает по умолчанию. */
export async function settingsForTurn(candidateId: string): Promise<ConsultantSettingsData | null> {
  return loadConsultantSettings(candidateId).catch(() => null);
}
