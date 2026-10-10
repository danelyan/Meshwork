import { createHash } from 'node:crypto';

import { z } from 'zod';

import { tag } from '../defense/prompt-utils';
import { responseJsonSchema } from '../llm/schema';
import type { ChatMessage, LlmProvider } from '../llm/types';
import { extractFragments, fragmentRef } from './fragments';
import { loadRoomPrompt } from './prompts';
import { QLC_TYPES, type CodeFragment, type QlcQuestion, type QlcType, type RepoSnapshot } from './types';

/**
 * Генератор вопросов по коду кандидата (QLC, ADR 0003 ступень 3). Код выделяет фрагменты, модель
 * (`LlmPurpose.defense_qlc`) выбирает 3–5 и формулирует вопросы четырёх типов + один «смени
 * ограничение». Ответ модели проверяет код: id фрагмента должен существовать, тип — из списка,
 * вопрос — по-русски. Модель недоступна или ответ не прошёл проверку → детерминированные вопросы
 * по тем же фрагментам (stub-провайдер всегда попадает сюда).
 */

export const QLC_LIMITS = { minCode: 3, maxCode: 5, aiLogChars: 2000, fragmentChars: 2400, commitChars: 1200, commits: 5 } as const;

const QuestionSchema = z.object({
  fragmentId: z.string().max(10),
  type: z.enum(QLC_TYPES),
  question: z.string().min(15).max(500),
  expectedPoints: z.array(z.string().max(200)).max(6),
});
export const QlcOutput = z.object({ questions: z.array(QuestionSchema).min(1).max(8) });
export type QlcOutput = z.infer<typeof QlcOutput>;
const QLC_JSON_SCHEMA = responseJsonSchema(QlcOutput) as object;

/** Сводка проверки проекта для модели и вердикта: доля тестов, упавшие тесты, замечания. */
export interface ProjectResultSummary {
  /** Доля пройденных скрытых тестов 0…1; null — тестов в результате нет. */
  score: number | null;
  passed: number;
  total: number;
  failed: string[];
  notes: string[];
}

/**
 * resultJson сабмита (lane project): ждём `tests: [{name, passed}]`, допускаем `score` 0…1 или 0…100
 * и `rubric/lint` как замечания. Формат ещё не зафиксирован — читаем терпимо, остальное игнорируем.
 */
export function summarizeProjectResult(result: unknown): ProjectResultSummary | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const tests = Array.isArray(r.tests) ? (r.tests as unknown[]) : [];
  const parsed = tests
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({ name: String(t.name ?? 'test').slice(0, 120), passed: t.passed === true }));
  const notes: string[] = [];
  for (const key of ['lint', 'rubric', 'static']) {
    const v = r[key];
    if (v && typeof v === 'object') notes.push(`${key}: ${JSON.stringify(v).slice(0, 300)}`);
  }
  let score: number | null = null;
  if (parsed.length) score = parsed.filter((t) => t.passed).length / parsed.length;
  else if (typeof r.score === 'number' && Number.isFinite(r.score)) score = r.score > 1 ? Math.min(1, r.score / 100) : Math.max(0, r.score);
  if (score === null && !notes.length) return null;
  return {
    score,
    passed: parsed.filter((t) => t.passed).length,
    total: parsed.length,
    failed: parsed.filter((t) => !t.passed).map((t) => t.name).slice(0, 5),
    notes,
  };
}

export interface QlcInput {
  snapshot: RepoSnapshot;
  projectResult: ProjectResultSummary | null;
  aiLogText: string | null;
}

export interface QlcResult {
  questions: QlcQuestion[];
  generator: 'llm' | 'fallback';
  fragments: number;
}

interface CommitRef {
  id: string;
  sha: string;
  message: string;
  patch: string;
}

function commitRefs(snapshot: RepoSnapshot): CommitRef[] {
  return snapshot.commits
    .filter((c) => c.message.trim())
    .slice(0, QLC_LIMITS.commits)
    .map((c, i) => ({
      id: `C${i + 1}`,
      sha: c.sha.slice(0, 7),
      message: c.message.split('\n')[0]!.slice(0, 160),
      patch: (c.files ?? []).map((f) => `--- ${f.path}\n${f.patch}`).join('\n').slice(0, QLC_LIMITS.commitChars),
    }));
}

export function buildQlcMessages(input: QlcInput, fragments: CodeFragment[], commits: CommitRef[]): ChatMessage[] {
  const frag = fragments
    .map((f) => `<fragment id="${f.id}" ref="${fragmentRef(f)}" name="${f.name}">\n${tag('code', f.code.slice(0, QLC_LIMITS.fragmentChars))}\n</fragment>`)
    .join('\n');
  const com = commits.map((c) => `<commit id="${c.id}" sha="${c.sha}">\n${tag('message', c.message)}\n${c.patch ? tag('diff', c.patch) : ''}\n</commit>`).join('\n');
  const pr = input.projectResult;
  const result = pr
    ? tag(
        'project_result',
        [
          pr.total ? `Скрытые тесты: ${pr.passed} из ${pr.total}.` : '',
          pr.failed.length ? `Упали: ${pr.failed.join(', ')}.` : '',
          ...pr.notes,
        ]
          .filter(Boolean)
          .join('\n'),
      )
    : '<project_result>(нет данных)</project_result>';
  const log = input.aiLogText?.trim() ? tag('ai_log', input.aiLogText.trim().slice(0, QLC_LIMITS.aiLogChars)) : '<ai_log>(не указан)</ai_log>';
  return [
    {
      role: 'user',
      content: `<fragments>\n${frag || '(фрагментов нет)'}\n</fragments>\n\n<commits>\n${com || '(нет)'}\n</commits>\n\n${result}\n\n${log}\n\nСоставь вопросы. Ответ — только JSON по схеме.`,
    },
  ];
}

const CYRILLIC = /[а-яё]/i;

/** Проверка ответа модели кодом: существующие id, типы, ровно один constraint, 3–5 вопросов по коду. */
export function validateQlc(out: QlcOutput, fragments: CodeFragment[], commits: CommitRef[]): QlcQuestion[] | null {
  const byId = new Map<string, string>([
    ...fragments.map((f) => [f.id, fragmentRef(f)] as const),
    ...commits.map((c) => [c.id, `commit:${c.sha}`] as const),
  ]);
  const code: QlcQuestion[] = [];
  let constraint: QlcQuestion | null = null;
  const usedRefs = new Set<string>();
  for (const q of out.questions) {
    const text = q.question.trim();
    if (!CYRILLIC.test(text)) continue;
    if (q.type === 'constraint') {
      constraint ??= { id: 'q-constraint', type: 'constraint', question: text, ref: null, expectedPoints: q.expectedPoints };
      continue;
    }
    const ref = byId.get(q.fragmentId.trim());
    if (!ref || usedRefs.has(ref) || code.length >= QLC_LIMITS.maxCode) continue;
    usedRefs.add(ref);
    code.push({ id: `q${code.length + 1}`, type: q.type, question: text, ref, expectedPoints: q.expectedPoints });
  }
  if (code.length < QLC_LIMITS.minCode) return null;
  if (new Set(code.map((q) => q.type)).size < 2) return null;
  return [...code, constraint ?? fallbackConstraint(seedOf(out.questions.map((q) => q.question).join('|')))];
}

const seedOf = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);

const CONSTRAINTS: { question: string; points: string[] }[] = [
  {
    question: 'Смени ограничение: сервис теперь работает в трёх экземплярах за балансировщиком. Что в твоём решении перестанет работать и что ты переделаешь первым?',
    points: ['состояние в памяти процесса', 'общее хранилище или блокировки', 'идемпотентность между экземплярами'],
  },
  {
    question: 'Смени ограничение: нагрузка выросла в сто раз, а ответ нужен быстрее чем за 100 миллисекунд. Где у тебя первое узкое место и как ты его найдёшь?',
    points: ['измерение до правки', 'узкое место по коду', 'кэш, очередь или пакетная обработка'],
  },
  {
    question: 'Смени ограничение: внешней базы больше нет, процесс перезапускается раз в час. Как ты сохранишь корректность — что потеряется и как это компенсировать?',
    points: ['что хранится в памяти', 'потеря при перезапуске', 'журнал, снимки или повтор'],
  },
  {
    question: 'Смени ограничение: входные данные приходят от недоверенного клиента и могут быть повторены или подделаны. Что в коде надо проверить и где?',
    points: ['валидация на границе', 'повторы и идемпотентность', 'что нельзя доверять клиенту'],
  },
];

function fallbackConstraint(seed: number): QlcQuestion {
  const c = CONSTRAINTS[seed % CONSTRAINTS.length]!;
  return { id: 'q-constraint', type: 'constraint', question: c.question, ref: null, expectedPoints: c.points };
}

const TEMPLATES: Record<Exclude<QlcType, 'constraint'>, (name: string, ref: string) => { question: string; points: string[] }> = {
  what: (name, ref) => ({
    question: `Открой «${name}» (${ref}). Расскажи своими словами, что делает этот код и какой путь проходят данные от входа до результата.`,
    points: ['вход и выход', 'ключевые ветки', 'побочные эффекты'],
  }),
  why: (name, ref) => ({
    question: `Почему «${name}» (${ref}) устроен именно так? Какую альтернативу ты рассматривал и чем пришлось заплатить за выбранный вариант?`,
    points: ['альтернатива', 'цена решения', 'когда выбор был бы другим'],
  }),
  what_breaks: (name, ref) => ({
    question: `Что сломается в «${name}» (${ref}), если вход придёт пустым, дважды подряд или в десять раз больше по объёму? Где первое слабое место?`,
    points: ['граничные входы', 'повторный вызов', 'рост объёма'],
  }),
  change: (name, ref) => ({
    question: `Как изменить «${name}» (${ref}), чтобы при сбое зависимости он не падал, а возвращал вызывающему понятный результат? Какие места кода затронет правка?`,
    points: ['где ловить ошибку', 'контракт для вызывающего', 'что проверить тестом'],
  }),
};
const ROTATION: Exclude<QlcType, 'constraint'>[] = ['what', 'why', 'what_breaks', 'change'];

/** Детерминированные вопросы: лучшие фрагменты (по одному на файл, пока хватает), типы по кругу, коммит — «почему». */
export function fallbackQlc(snapshot: RepoSnapshot, fragments: CodeFragment[], commits: CommitRef[]): QlcQuestion[] {
  const chosen: CodeFragment[] = [];
  const files = new Set<string>();
  for (const f of fragments) {
    if (chosen.length >= 4) break;
    if (files.has(f.path)) continue;
    chosen.push(f);
    files.add(f.path);
  }
  for (const f of fragments) {
    if (chosen.length >= 4) break;
    if (!chosen.includes(f)) chosen.push(f);
  }
  const out: QlcQuestion[] = chosen.map((f, i) => {
    const type = ROTATION[i % ROTATION.length]!;
    const t = TEMPLATES[type](f.name, fragmentRef(f));
    return { id: `q${i + 1}`, type, question: t.question, ref: fragmentRef(f), expectedPoints: t.points };
  });
  const commit = commits.find((c) => !/^(initial|init|first)\b/i.test(c.message)) ?? commits[0];
  if (commit && out.length < QLC_LIMITS.maxCode) {
    out.push({
      id: `q${out.length + 1}`,
      type: 'why',
      question: `Коммит ${commit.sha} «${commit.message}». Зачем понадобилось это изменение и что было не так до него?`,
      ref: `commit:${commit.sha}`,
      expectedPoints: ['проблема до коммита', 'почему такое исправление', 'как проверил'],
    });
  }
  // Кода почти нет (пустой репозиторий) — вопросы по проекту в целом, чтобы защита всё равно состоялась.
  while (out.length < QLC_LIMITS.minCode) {
    const generic = [
      'Расскажи, как устроен твой проект: из каких частей он состоит и как они связаны между собой?',
      'Какое решение в проекте было самым трудным и почему ты выбрал именно его?',
      'Как ты проверял, что проект работает? Что пошло не так по ходу и как ты это исправил?',
    ][out.length]!;
    out.push({ id: `q${out.length + 1}`, type: out.length === 1 ? 'why' : 'what', question: generic, ref: null, expectedPoints: [] });
  }
  return [...out, fallbackConstraint(seedOf(snapshot.commitSha))];
}

export async function generateQlc(input: QlcInput, llm: LlmProvider, signal?: AbortSignal): Promise<QlcResult> {
  const fragments = extractFragments(input.snapshot.files);
  const commits = commitRefs(input.snapshot);
  if (fragments.length + commits.length >= QLC_LIMITS.minCode) {
    try {
      const res = await llm.complete(
        {
          purpose: 'defense_qlc',
          system: loadRoomPrompt('qlc'),
          messages: buildQlcMessages(input, fragments, commits),
          schema: { name: 'defense_qlc', jsonSchema: QLC_JSON_SCHEMA },
          temperature: 0.3,
          maxTokens: 1800,
        },
        signal,
      );
      const parsed = QlcOutput.safeParse(res.kind === 'json' ? res.json : undefined);
      const valid = parsed.success ? validateQlc(parsed.data, fragments, commits) : null;
      if (valid) return { questions: valid, generator: 'llm', fragments: fragments.length };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn('[defense-room] qlc fallback:', err instanceof Error ? err.message : err);
    }
  }
  return { questions: fallbackQlc(input.snapshot, fragments, commits), generator: 'fallback', fragments: fragments.length };
}
