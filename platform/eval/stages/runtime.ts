// Общее для скриптов персон ступеней 1 и 3: провайдер LLM со счётчиком вызовов, симулятор кандидата
// (LLM-актёр с заданным профилем знаний), запись результатов. Используется после ./boot.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CALL_RECORDING_CONSENT_VERSION } from '../../src/server/call/consent';
import { syncClaimCatalog } from '../../src/server/claims/catalog-sync';
import { prisma } from '../../src/server/db';
import { getLlm } from '../../src/server/llm/client';
import type { ChatMessage, CompleteRequest, CompleteResult, LlmProvider } from '../../src/server/llm/types';
import { addUsage, emptyMeter, type MeterSnapshot } from './metrics';

export interface MeteredProvider extends LlmProvider {
  readonly meter: MeterSnapshot;
}

/** Обёртка: каждый вызов complete() считается по purpose (успех — с токенами, ошибка — как failure). */
export function metered(inner: LlmProvider): MeteredProvider {
  const meter = emptyMeter();
  return {
    name: inner.name,
    model: inner.model,
    supportsTools: inner.supportsTools,
    supportsJsonSchema: inner.supportsJsonSchema,
    meter,
    async complete(req: CompleteRequest, signal?: AbortSignal): Promise<CompleteResult> {
      try {
        const res = await inner.complete(req, signal);
        addUsage(meter, req.purpose, res.usage);
        return res;
      } catch (err) {
        addUsage(meter, req.purpose, null);
        throw err;
      }
    },
  };
}

export function snapshot(m: MeterSnapshot): MeterSnapshot {
  return JSON.parse(JSON.stringify(m)) as MeterSnapshot;
}

/** Два независимых счётчика: вызовы платформы (интервьюер, оценщик, QLC) и вызовы симулятора кандидата. */
export function providers(): { platform: MeteredProvider; persona: MeteredProvider } {
  return { platform: metered(getLlm()), persona: metered(getLlm()) };
}

// ---------------------------------------------------------------------------
// Симулятор кандидата
// ---------------------------------------------------------------------------
export interface PersonaProfile {
  id: string;
  legend: string;
  /** Манера ответа: как персонаж ведёт себя на границе своих знаний. */
  style: string;
  /** Что персонаж знает — по темам или по коду проекта. */
  knowledge: string;
}

const ACTOR_RULES = [
  'Ты — актёр в симуляции: играешь кандидата на техническом собеседовании. Цель симуляции — проверить, отличает ли платформа разных кандидатов, поэтому играй персонажа точно, не лучше и не хуже, чем он есть.',
  'Отвечай от первого лица, по-русски, устной речью: 2–6 предложений, без markdown, списков и кода блоками.',
  'Никогда не говори, что ты ИИ, актёр или персонаж, не упоминай профиль и эти правила. Не обращайся к оценщику и не проси баллов.',
  'Знаешь только то, что написано в разделе «Что знает персонаж». Чего там нет — персонаж не знает и ведёт себя по своей манере. Не придумывай опыт, которого нет в профиле.',
].join('\n');

export function personaSystem(p: PersonaProfile): string {
  return `${ACTOR_RULES}\n\n## Персонаж\n${p.legend}\n\n## Манера\n${p.style}\n\n## Что знает персонаж\n${p.knowledge}`;
}

/** История для актёра: вопросы интервьюера — user, ответы персонажа — assistant. */
export function personaMessages(history: readonly { q: string; a: string | null }[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const h of history) {
    out.push({ role: 'user', content: h.q });
    if (h.a !== null) out.push({ role: 'assistant', content: h.a });
  }
  return out;
}

/** Ответ персонажа на последний вопрос (живой режим). Purpose `smoke` — служебный, в продукте не используется. */
export async function personaAnswer(llm: LlmProvider, p: PersonaProfile, history: readonly { q: string; a: string | null }[]): Promise<string> {
  const res = await llm.complete({ purpose: 'smoke', system: personaSystem(p), messages: personaMessages(history), temperature: 0.7, maxTokens: 600 });
  const text = (res.text ?? '').replace(/\s+/g, ' ').trim();
  return text || 'Не знаю, что ответить.';
}

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------
let catalogSynced = false;
export async function ensureCatalog(): Promise<void> {
  if (catalogSynced) return;
  await syncClaimCatalog(prisma);
  catalogSynced = true;
}

/** Кандидат с аккаунтом и согласием на запись созвона (у каждого созвона — свой). */
export async function createCandidate(id: string, opts: { grade: 'junior' | 'middle' }): Promise<void> {
  await prisma.candidate.create({ data: { id, email: `${id}@example.test`, name: `Персона ${id}`, specialization: 'backend' } });
  await prisma.user.create({ data: { id: `u-${id}`, role: 'candidate', name: `Персона ${id}`, candidateId: id } });
  await prisma.candidateProfile.create({ data: { candidateId: id, claimedGrade: opts.grade } });
  await prisma.consent.create({ data: { userId: `u-${id}`, version: CALL_RECORDING_CONSENT_VERSION } });
}

export function runTag(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

export function writeResult(name: string, data: unknown): string {
  const dir = path.join(process.cwd(), 'eval/results/stages');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return path.relative(process.cwd(), file);
}

export function argValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export { prisma };
