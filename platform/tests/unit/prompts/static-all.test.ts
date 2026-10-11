// Статические проверки ВСЕХ системных промптов (src/server/**/prompts/*.md) — без сети и без LLM.
// Отчёт и найденные рассинхроны: docs/research/prompt-audit/static-all.md (папка владельца fsp/).
//
// Принцип «известных рассинхронов»: где промпт сейчас расходится с кодом, расхождение записано в KNOWN_*.
// Тест падает на НОВОМ расхождении, а исправленное известное просто исчезает из найденного (тест остаётся
// зелёным, запись из KNOWN_* после правки промпта надо убрать — это ловит проверка «KNOWN_* не устарели»).
// Сами промпты здесь не правятся: их правят лейны-владельцы.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { buildCorpusSource } from '@/server/agent/knowledge/build';
import { assemblePrompt, promptVersion } from '@/server/agent/prompts/assemble';
import { CallEvaluatorOutput, CallInterviewerOutput, CallOwnershipOutput, CallReviewQuestionOutput } from '@/server/call/schemas';
import { buildEvaluatorPayload } from '@/server/call/evaluator';
import { buildPayload as buildCallPayload } from '@/server/call/interviewer';
import { loadCallPrompt } from '@/server/call/prompt-utils';
import { catalogFromFile } from '@/server/claims/catalog-file';
import { extractorJsonSchema, extractorSystemPrompt } from '@/server/claims/extractor';
import { EvaluatorOutput as DefenseEvaluatorOutput } from '@/server/defense/evaluator';
import { InterviewerOutput as DefenseInterviewerOutput } from '@/server/defense/interviewer';
import { loadPrompt as loadDefensePrompt } from '@/server/defense/prompt-utils';
import { InterviewerOutput as RoomInterviewerOutput } from '@/server/defense-room/interviewer';
import { loadRoomPrompt } from '@/server/defense-room/prompts';
import { QlcOutput } from '@/server/defense-room/qlc';
import { buildItemsPayload, DefenseItemsOutput } from '@/server/defense-room/verdict';
import { buildBlockPlan } from '@/server/interview/context';
import { buildInterviewerPayload, InterviewerOutput as InterviewOutput, loadInterviewPrompt } from '@/server/interview/interviewer';
import { COMPETENCIES } from '@/server/interview/model';
import { INTERVIEW_LIMITS } from '@/server/interview/plan';
import { responseJsonSchema } from '@/server/llm/schema';
import { COMPANION_NAME } from '@/lib/persona';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const ALL_MD = walk('src')
  .filter((f) => f.split(path.sep).includes('prompts') && f.endsWith('.md'))
  .map((f) => f.split(path.sep).join('/'))
  .sort();

const FACTS = 'src/server/agent/prompts/platform-facts.md';
/** Собираются scripts/build-prompts.ts в prompt.ts (рантайм читает .ts, не .md). */
const GENERATED = [
  { md: 'src/server/agent/prompts/consultant.md', out: 'src/server/agent/prompt.ts', name: 'CONSULTANT', from: 'prompts/consultant.md' },
  { md: 'src/server/agent/prompts/employer.md', out: 'src/server/agent/employer/prompt.ts', name: 'EMPLOYER', from: 'prompts/employer.md' },
  { md: 'src/server/agent/prompts/onboarding.md', out: 'src/server/onboarding/prompt.ts', name: 'ONBOARDING', from: 'agent/prompts/onboarding.md' },
] as const;

/** Читаются с диска загрузчиком как есть (без сборки и подстановок). */
const RAW: { md: string; load: () => string }[] = [
  { md: 'src/server/call/prompts/interviewer.md', load: () => loadCallPrompt('interviewer') },
  { md: 'src/server/call/prompts/evaluator.md', load: () => loadCallPrompt('evaluator') },
  { md: 'src/server/call/prompts/test-review.md', load: () => loadCallPrompt('test-review') },
  { md: 'src/server/call/prompts/ownership.md', load: () => loadCallPrompt('ownership') },
  { md: 'src/server/defense/prompts/interviewer.md', load: () => loadDefensePrompt('interviewer') },
  { md: 'src/server/defense/prompts/evaluator.md', load: () => loadDefensePrompt('evaluator') },
  { md: 'src/server/defense-room/prompts/qlc.md', load: () => loadRoomPrompt('qlc') },
  { md: 'src/server/defense-room/prompts/interviewer.md', load: () => loadRoomPrompt('interviewer') },
  { md: 'src/server/defense-room/prompts/evaluator.md', load: () => loadRoomPrompt('evaluator') },
  { md: 'src/server/interview/prompts/interviewer.md', load: loadInterviewPrompt },
  { md: 'src/server/claims/prompts/extractor.md', load: extractorSystemPrompt },
];

/** Текст, который реально уходит модели (для generated — собранный, для raw — файл как есть). */
const facts = read(FACTS);
const sent = (md: string): string => (GENERATED.some((g) => g.md === md) ? assemblePrompt(read(md), facts) : read(md));
const shortName = (md: string) => md.replace('src/server/', '');

// ---------------------------------------------------------------------------
// Известные рассинхроны на 12.10.2026 (лейн static-all). Убирать запись, когда владелец промпта исправит.
// ---------------------------------------------------------------------------

/** Промпты без `<!-- version: … -->` в первой строке. Новые промпты обязаны иметь версию. */
const KNOWN_NO_VERSION = new Set([
  'call/prompts/evaluator.md',
  'call/prompts/interviewer.md',
  'claims/prompts/extractor.md',
  'defense-room/prompts/evaluator.md',
  'defense-room/prompts/interviewer.md',
  'defense-room/prompts/qlc.md',
  'defense/prompts/evaluator.md',
  'defense/prompts/interviewer.md',
  'interview/prompts/interviewer.md',
]);

/** Ссылки `next.x` в промпте, которых нет в данных `<call_context>` (research/42 для созвона). */
const KNOWN_DEAD_REFS = new Set([
  // Созвон: уровень приходит как next.levelIfStrong/levelIfWeak/levelIfNone/startLevel, поля level нет.
  'call/prompts/interviewer.md: next.level',
  // ИИнтервью: план лежит в next.ifStrong/ifWeak/ifNone.{block,…}, плоского next.block нет.
  'interview/prompts/interviewer.md: next.block',
]);

// ---------------------------------------------------------------------------

describe('реестр промптов', () => {
  it('каждый .md в prompts/ учтён: собирается генератором, читается загрузчиком или это факты', () => {
    const known = new Set([FACTS, ...GENERATED.map((g) => g.md), ...RAW.map((r) => r.md)]);
    expect(ALL_MD.filter((f) => !known.has(f))).toEqual([]);
    expect([...known].filter((f) => !ALL_MD.includes(f))).toEqual([]);
  });

  it('список генератора совпадает с scripts/build-prompts.ts', () => {
    const script = read('scripts/build-prompts.ts');
    for (const g of GENERATED) {
      expect(script).toContain(`md: '${path.basename(g.md)}', out: '${g.out}', name: '${g.name}', from: '${g.from}'`);
    }
    expect(script.match(/\{ md: '/g)).toHaveLength(GENERATED.length);
  });
});

describe('версия промпта', () => {
  it.each(ALL_MD.filter((f) => f !== FACTS).map((f) => [shortName(f)]))('%s: `<!-- version: … -->` в первой строке (или известный пропуск)', (name) => {
    const md = read(`src/server/${name}`);
    const has = /^<!--\s*version:\s*[\w.-]+\s*-->/.test(md);
    if (KNOWN_NO_VERSION.has(name)) return; // см. it.todo ниже
    expect(has, `${name}: нет строки <!-- version: … --> в начале`).toBe(true);
    expect(() => promptVersion(md)).not.toThrow();
  });

  it('KNOWN_NO_VERSION не устарел: у перечисленных версии действительно нет', () => {
    const stale = [...KNOWN_NO_VERSION].filter((n) => /^<!--\s*version:/.test(read(`src/server/${n}`)));
    expect(stale, 'версия появилась — уберите из KNOWN_NO_VERSION').toEqual([]);
  });

  for (const n of KNOWN_NO_VERSION) it.todo(`${n}: добавить <!-- version: … --> (и в лог LLM-вызова, как у консультанта)`);
});

describe('сгенерированные prompt.ts = пересборка из .md в памяти (файлы не перезаписываются)', () => {
  it.each(GENERATED.map((g) => [g.out, g]))('%s: файл байт в байт как вывел бы scripts/build-prompts.ts', (_, g) => {
    const md = read(g.md);
    const expected = [
      `// Сгенерировано scripts/build-prompts.ts из ${g.from} и prompts/platform-facts.md — руками не править.`,
      '// Файл .md не читается с диска в рантайме: в standalone-сборке Next.js его нет в бандле.',
      '',
      `export const ${g.name}_PROMPT_VERSION = '${promptVersion(md)}';`,
      '',
      `export const ${g.name}_PROMPT = ${JSON.stringify(assemblePrompt(md, facts))};`,
      '',
    ].join('\n');
    expect(read(g.out) === expected, `${g.out} устарел: npx tsx scripts/build-prompts.ts`).toBe(true);
  });

  it('корпус базы знаний (knowledge/corpus.ts) совпадает с пересборкой', () => {
    const kdir = 'src/server/agent/knowledge/docs';
    const kdocs = readdirSync(path.join(ROOT, kdir))
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ docId: f.replace(/\.md$/, ''), md: read(`${kdir}/${f}`) }));
    expect(read('src/server/agent/knowledge/corpus.ts') === buildCorpusSource(facts, kdocs).source, 'corpus.ts устарел: npx tsx scripts/build-prompts.ts').toBe(true);
  });
});

describe('загрузчики отдают текущий .md, без устаревших копий', () => {
  it.each(RAW.map((r) => [shortName(r.md), r]))('%s: загрузчик возвращает файл как есть', (_, r) => {
    expect(r.load()).toBe(read(r.md));
  });

  it('фрагменты промптов не продублированы строками в .ts (кроме сгенерированных prompt.ts и corpus.ts)', () => {
    const ts = walk('src').filter((f) => /\.tsx?$/.test(f) && !/(^|\/)prompt\.ts$/.test(f.split(path.sep).join('/')) && !f.endsWith('corpus.ts'));
    const sources = ts.map((f) => [f, read(f)] as const);
    const hits: string[] = [];
    for (const md of ALL_MD) {
      const frags = read(md)
        .split('\n')
        .flatMap((l) => l.replace(/^[\s-]+/, '').split(/[.!?]\s/))
        .filter((s) => s.length >= 45);
      for (const frag of frags) for (const [f, s] of sources) if (s.includes(frag)) hits.push(`${shortName(md)} → ${f}: ${frag.slice(0, 60)}`);
    }
    expect(hits).toEqual([]);
  });
});

describe('плейсхолдеры', () => {
  it.each(ALL_MD.filter((f) => f !== FACTS).map((f) => [shortName(f), f]))('%s: в тексте для модели нет {{…}} и ${…}', (_, md) => {
    const text = sent(md);
    expect(text.match(/\{\{[^}]*\}\}/g) ?? []).toEqual([]);
    expect(text.match(/\$\{[^}]*\}/g) ?? []).toEqual([]);
  });

  it('шаблонизатор assemblePrompt знает только platform_facts — других {{…}} в источниках нет', () => {
    for (const md of ALL_MD) {
      for (const m of read(md).matchAll(/\{\{([^}]*)\}\}/g)) expect(m[1], `${shortName(md)}: {{${m[1]}}}`).toMatch(/^platform_facts(:[F\d,\s]+)?$/);
    }
  });

  it('рендер на фикстуре фактов: все F-ссылки подставляются, плейсхолдеров не остаётся', () => {
    const fixture = '<!-- c -->\n<platform_facts>\nвводная\n\n' + Array.from({ length: 30 }, (_, i) => `F${i + 1}. факт ${i + 1}`).join('\n') + '\n</platform_facts>\n';
    for (const g of GENERATED) {
      const out = assemblePrompt(read(g.md), fixture);
      expect(out).not.toMatch(/\{\{|<!--/);
      const ids = /\{\{platform_facts:([F\d,\s]+)\}\}/.exec(read(g.md))![1]!.split(',').map((s) => s.trim());
      for (const id of ids) expect(out).toContain(`${id}. факт ${id.slice(1)}`);
    }
  });
});

describe('размер промптов (оценка токенов = символы / 4), порог — снимок 12.10 + ~20 %', () => {
  // Для русского текста реальный счёт токенов в 1,5–2 раза выше chars/4 — порог ловит рост, а не лимит модели.
  // Снимок снят с рабочего дерева 12.10 во время параллельной правки промптов 15 лейнами аудита: после их
  // слияния пересними (символы/4 из sent(md)) — запас 20 % рассчитан на эти правки.
  const BUDGET: Record<string, number> = {
    'agent/prompts/consultant.md': 6900, // снимок 5730
    'agent/prompts/employer.md': 4850, // снимок 4025
    'agent/prompts/onboarding.md': 2500, // снимок 2068
    'call/prompts/interviewer.md': 2050, // снимок 1690
    'call/prompts/evaluator.md': 1050, // снимок 851
    'call/prompts/test-review.md': 1150, // снимок 935
    'call/prompts/ownership.md': 850, // снимок 674
    'interview/prompts/interviewer.md': 2100, // снимок 1723
    'defense/prompts/interviewer.md': 900, // снимок 718
    'defense/prompts/evaluator.md': 1000, // снимок 828
    'defense-room/prompts/qlc.md': 1000, // снимок 816
    'defense-room/prompts/interviewer.md': 650, // снимок 503
    'defense-room/prompts/evaluator.md': 1200, // снимок 962
    'claims/prompts/extractor.md': 1550, // снимок 1277
  };
  it.each(ALL_MD.filter((f) => f !== FACTS).map((f) => [shortName(f), f]))('%s', (name, md) => {
    expect(BUDGET[name], `${name}: нет порога — добавьте в BUDGET`).toBeDefined();
    const tokens = Math.ceil(sent(md).length / 4);
    expect(tokens, `${name}: ${tokens} ток. > порога ${BUDGET[name]} — сократите или осознанно поднимите порог`).toBeLessThanOrEqual(BUDGET[name]!);
  });
});

// ---------------------------------------------------------------------------
// Стиль, где он заявлен в самом промпте
// ---------------------------------------------------------------------------

/** Тело <example>…</example> блоков. */
const examples = (md: string) => [...md.matchAll(/<example>\n([\s\S]*?)<\/example>/g)].map((m) => m[1]!);

/** Реплики ИИ в примерах: строка с префиксом говорящего (консультант/работодатель) или не-JSON строка (онбординг). */
const AI_LINES: Record<string, (ex: string) => string[]> = {
  'src/server/agent/prompts/consultant.md': (ex) => ex.split('\n').filter((l) => l.startsWith('Консультант:')).map((l) => l.slice('Консультант:'.length)),
  'src/server/agent/prompts/employer.md': (ex) => ex.split('\n').filter((l) => l.startsWith('Помощник:')).map((l) => l.slice('Помощник:'.length)),
  'src/server/agent/prompts/onboarding.md': (ex) => ex.split('\n').filter((l) => l.trim() && !l.startsWith('{')),
};
const DASH_RULE = /не используй длинные тире|Длинное тире «—» в твоём тексте запрещено/;

describe('стиль реплик ИИ в примерах', () => {
  it('правило «без длинного тире» заявлено ровно в трёх промптах чата', () => {
    expect(ALL_MD.filter((f) => DASH_RULE.test(read(f))).sort()).toEqual(Object.keys(AI_LINES).sort());
  });

  it.each(Object.keys(AI_LINES).map((f) => [shortName(f), f]))('%s: в примерах реплик ИИ нет «—», примеры найдены', (_, md) => {
    const lines = examples(read(md)).flatMap(AI_LINES[md]!);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((l) => l.includes('—'))).toEqual([]);
  });

  it('онбординг: реплики примеров ≤ 200 символов и не в «ёлочках» целиком (правило промпта)', () => {
    const md = 'src/server/agent/prompts/onboarding.md';
    expect(read(md)).toContain('не больше 200 символов');
    for (const l of examples(read(md)).flatMap(AI_LINES[md]!)) {
      expect(l.length, l.slice(0, 40)).toBeLessThanOrEqual(200);
      expect(l.trim()).not.toMatch(/^«[\s\S]*»$/);
    }
  });

  it.each([
    ['call/prompts/interviewer.md', 300],
    ['call/prompts/test-review.md', 300],
    ['interview/prompts/interviewer.md', 320],
  ] as const)('%s: вопросы в примерах укладываются в заявленный лимит %i символов', (name, limit) => {
    const md = read(`src/server/${name}`);
    expect(md).toContain(`до ${limit} символов`);
    const qs = jsonObjects(md).map((o) => (o as { question?: unknown }).question).filter((q): q is string => typeof q === 'string');
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) expect(q.length, q.slice(0, 40)).toBeLessThanOrEqual(limit);
  });

  it('имя помощницы в промптах совпадает с COMPANION_NAME (lib/persona.ts)', () => {
    for (const md of ALL_MD) {
      for (const m of read(md).matchAll(/Ты — ([А-ЯЁ][а-яё]+), ИИ-помощниц/g)) expect(m[1], shortName(md)).toBe(COMPANION_NAME);
    }
  });
});

// ---------------------------------------------------------------------------
// JSON-ответы: схема ↔ текст промпта ↔ данные <call_context>
// ---------------------------------------------------------------------------

/** Все JSON-объекты `{"…` в тексте (балансом скобок с учётом строк); не-JSON пропускается. */
function jsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let i = text.indexOf('{"');
  while (i !== -1) {
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    try {
      out.push(JSON.parse(text.slice(i, end + 1)));
      i = text.indexOf('{"', end + 1);
    } catch {
      i = text.indexOf('{"', i + 1);
    }
  }
  return out;
}

type JS = { type?: string | string[]; properties?: Record<string, JS>; required?: string[]; items?: JS; anyOf?: JS[]; oneOf?: JS[]; enum?: unknown[] };

function schemaKeys(s: JS, acc = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    acc.add(k);
    schemaKeys(v, acc);
  }
  if (s.items) schemaKeys(s.items, acc);
  for (const x of [...(s.anyOf ?? []), ...(s.oneOf ?? [])]) schemaKeys(x, acc);
  return acc;
}

/** Ошибки соответствия примера JSON-схеме: лишние/недостающие ключи, enum («…» — заглушка шаблона). Верхний уровень может быть фрагментом. */
function conform(v: unknown, s: JS, at: string, top: boolean): string[] {
  const alts = s.anyOf ?? s.oneOf;
  if (alts) {
    const res = alts.map((a) => conform(v, a, at, top));
    return res.some((r) => r.length === 0) ? [] : res[0]!;
  }
  if (s.enum && v !== '…' && !s.enum.includes(v)) return [`${at}: ${JSON.stringify(v)} не из enum ${JSON.stringify(s.enum)}`];
  if (s.properties && v && typeof v === 'object' && !Array.isArray(v)) {
    const errs: string[] = [];
    for (const k of Object.keys(v)) if (!(k in s.properties)) errs.push(`${at}.${k}: поля нет в схеме`);
    if (!top) for (const k of s.required ?? []) if (!(k in (v as object))) errs.push(`${at}.${k}: обязательное поле схемы отсутствует в примере`);
    for (const [k, x] of Object.entries(v)) if (s.properties[k]) errs.push(...conform(x, s.properties[k]!, `${at}.${k}`, false));
    return errs;
  }
  if (s.items && Array.isArray(v)) return v.flatMap((x, i) => conform(x, s.items!, `${at}[${i}]`, false));
  return [];
}

/** Все пути ключей значения: `next.levelIfStrong`, `topics.claim` (массивы прозрачны). */
function keyPaths(v: unknown, prefix = '', acc = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keyPaths(x, prefix, acc));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      keyPaths(x, p, acc);
    }
  return acc;
}
const leafNames = (paths: Set<string>) => new Set([...paths].map((p) => p.split('.').pop()!));

// Фикстуры данных, которые код кладёт в <call_context> (те же билдеры, что в рантайме).
const callTopics = [{ topic: 'Индексы в PostgreSQL', catalogId: 'be.sql-indexes', claimStatement: 'Настраиваю индексы', resumeFact: 'ускорил отчёты' }];
const callTurn = { question: 'Как выбираешь индекс?', answer: 'Смотрю EXPLAIN', topic: 'Индексы в PostgreSQL', catalogId: 'be.sql-indexes', level: 1 as const };
const callBase = { specialization: 'backend', claimedGrade: 'middle' as const, topics: callTopics, limits: { minQuestions: 4, maxQuestions: 6 } };
const interviewPlan = buildBlockPlan('backend', 'backend.web-api', [{ competencyId: 'backend.data', wrong: 1, right: 0 }]);
const interviewBase = {
  specialization: 'backend',
  subcategoryId: 'backend.web-api',
  claimedGrade: 'middle' as const,
  plan: interviewPlan,
  testHints: [{ competencyId: 'backend.data', wrong: 1, right: 0 }],
  resumeFacts: [],
  limits: INTERVIEW_LIMITS,
};
const interviewTurn = { question: 'Расскажи про проект', answer: 'Делал платежи', competencyId: 'common.context', block: 'intro' as const, level: 2 as const, interrupted: { heardSentences: 1, tail: 'хвост' } };

/** Пары промпт → схема ответа и (где есть) фикстуры данных <call_context>. */
const JSON_PROMPTS: { md: string; schema: JS; zod?: z.ZodType; payloads?: () => unknown[] }[] = [
  {
    md: 'call/prompts/interviewer.md',
    schema: responseJsonSchema(CallInterviewerOutput) as JS,
    zod: CallInterviewerOutput,
    payloads: () => [
      buildCallPayload({ ...callBase, turns: [] }),
      buildCallPayload({ ...callBase, turns: [callTurn] }),
      buildCallPayload({ ...callBase, turns: [callTurn], force: { topic: callTopics[0]!.topic, level: 2 } }),
    ],
  },
  {
    md: 'call/prompts/evaluator.md',
    schema: responseJsonSchema(CallEvaluatorOutput) as JS,
    zod: CallEvaluatorOutput,
    payloads: () => {
      const t = [{ topic: 'Индексы', catalogId: null, claimed: true, claimStatement: null, maxLevel: 2 as const, qa: [{ question: 'Как?', answer: 'Так', level: 1 as const }] }];
      return [buildEvaluatorPayload('backend', t, [], 'type'), buildEvaluatorPayload('backend', t, [], 'question')];
    },
  },
  { md: 'call/prompts/test-review.md', schema: responseJsonSchema(CallReviewQuestionOutput) as JS, zod: CallReviewQuestionOutput },
  { md: 'call/prompts/ownership.md', schema: responseJsonSchema(CallOwnershipOutput) as JS, zod: CallOwnershipOutput },
  {
    md: 'interview/prompts/interviewer.md',
    schema: responseJsonSchema(InterviewOutput) as JS,
    zod: InterviewOutput,
    payloads: () => [
      buildInterviewerPayload({ ...interviewBase, turns: [] }),
      buildInterviewerPayload({ ...interviewBase, turns: [interviewTurn] }),
      buildInterviewerPayload({ ...interviewBase, turns: [interviewTurn], force: { competency: interviewPlan.test[0]!, block: 'test', level: 2 } }),
    ],
  },
  { md: 'defense/prompts/interviewer.md', schema: responseJsonSchema(DefenseInterviewerOutput) as JS, zod: DefenseInterviewerOutput },
  { md: 'defense/prompts/evaluator.md', schema: responseJsonSchema(DefenseEvaluatorOutput) as JS, zod: DefenseEvaluatorOutput },
  { md: 'defense-room/prompts/qlc.md', schema: responseJsonSchema(QlcOutput) as JS, zod: QlcOutput },
  { md: 'defense-room/prompts/interviewer.md', schema: responseJsonSchema(RoomInterviewerOutput) as JS, zod: RoomInterviewerOutput },
  {
    md: 'defense-room/prompts/evaluator.md',
    schema: responseJsonSchema(DefenseItemsOutput) as JS,
    zod: DefenseItemsOutput,
    payloads: () => [
      buildItemsPayload('Проект', [{ itemId: 'q1', source: 'qlc', type: 'what', ref: 'F1', label: 'x', question: 'Что делает код?', qa: [{ question: 'Что делает код?', answer: 'Повторяет запрос' }] }]),
    ],
  },
  { md: 'claims/prompts/extractor.md', schema: extractorJsonSchema(catalogFromFile().map((e) => e.id)) as JS },
];

const section = (md: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(md)?.[1] ?? '';
const ticks = (text: string) => [...text.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]!);

describe('JSON-ответы: промпт согласован со схемой', () => {
  it('у каждого промпта с «JSON по схеме» есть пара в JSON_PROMPTS', () => {
    const jsonMd = ALL_MD.filter((f) => /JSON по схеме/.test(read(f))).map(shortName).sort();
    expect(jsonMd).toEqual(JSON_PROMPTS.map((p) => p.md).sort());
  });

  it.each(JSON_PROMPTS.map((p) => [p.md, p]))('%s: примеры JSON — только поля схемы, enum и вложенные обязательные поля', (_, p) => {
    const errs = jsonObjects(read(`src/server/${p.md}`)).flatMap((o, i) => conform(o, p.schema, `пример#${i + 1}`, true));
    expect(errs).toEqual([]);
  });

  it.each(JSON_PROMPTS.filter((p) => p.zod).map((p) => [p.md, p]))('%s: полные примеры (все поля верхнего уровня) проходят Zod', (_, p) => {
    const required = p.schema.required ?? [];
    const full = jsonObjects(read(`src/server/${p.md}`)).filter((o) => o && typeof o === 'object' && required.every((k) => k in (o as object)));
    for (const o of full) {
      const r = p.zod!.safeParse(o);
      expect(r.success, `${JSON.stringify(o).slice(0, 80)}: ${r.success ? '' : r.error.message}`).toBe(true);
    }
  });

  it.each(JSON_PROMPTS.map((p) => [p.md, p]))('%s: каждое обязательное поле верхнего уровня названо в промпте', (_, p) => {
    const md = read(`src/server/${p.md}`);
    for (const k of p.schema.required ?? []) expect(md.includes(`\`${k}\``) || md.includes(`"${k}"`), `${p.md}: поле ${k}`).toBe(true);
  });

  it.each(JSON_PROMPTS.map((p) => [p.md, p]))('%s: поля из <output> есть в схеме ответа или в данных <call_context>', (_, p) => {
    const md = read(`src/server/${p.md}`);
    const allowed = new Set([...schemaKeys(p.schema), ...(p.payloads ? leafNames(new Set(p.payloads().flatMap((x) => [...keyPaths(x)]))) : [])]);
    expect(ticks(section(md, 'output')).filter((k) => !allowed.has(k))).toEqual([]);
  });
});

describe('ссылки промпта на данные <call_context>', () => {
  const withPayload = JSON_PROMPTS.filter((p) => p.payloads);

  it.each(withPayload.map((p) => [p.md, p]))('%s: поля из <inputs> есть в данных', (_, p) => {
    const names = leafNames(new Set(p.payloads!().flatMap((x) => [...keyPaths(x)])));
    expect(ticks(section(read(`src/server/${p.md}`), 'inputs')).filter((k) => !names.has(k))).toEqual([]);
  });

  /** `next.x[.y]` из промпта, которых нет среди путей данных. */
  const deadRefs = (p: (typeof withPayload)[number]) => {
    const paths = new Set(p.payloads!().flatMap((x) => [...keyPaths(x)]));
    const refs = new Set([...read(`src/server/${p.md}`).matchAll(/\bnext\.([a-zA-Z]+(?:\.[a-zA-Z]+)?)/g)].map((m) => `next.${m[1]}`));
    return [...refs].filter((r) => !paths.has(r)).map((r) => `${p.md}: ${r}`);
  };

  it('`next.…` в промптах указывают на существующие поля (кроме известных рассинхронов)', () => {
    const dead = withPayload.flatMap(deadRefs);
    expect(dead.filter((d) => !KNOWN_DEAD_REFS.has(d))).toEqual([]);
  });

  it('KNOWN_DEAD_REFS не устарел: перечисленные ссылки действительно всё ещё мёртвые', () => {
    const dead = new Set(withPayload.flatMap(deadRefs));
    expect([...KNOWN_DEAD_REFS].filter((d) => !dead.has(d))).toEqual([]);
  });

  // Реальные рассинхроны: падают, пока владелец промпта не поправит (тогда убрать запись из KNOWN_DEAD_REFS и fails).
  it.fails('созвон: промпт не ссылается на несуществующий next.level (research/42)', () => {
    expect(deadRefs(withPayload.find((p) => p.md === 'call/prompts/interviewer.md')!)).toEqual([]);
  });
  it.fails('ИИнтервью: промпт не ссылается на плоский next.block (план — в next.ifStrong/ifWeak/ifNone)', () => {
    expect(deadRefs(withPayload.find((p) => p.md === 'interview/prompts/interviewer.md')!)).toEqual([]);
  });

  it('XML-теги из <inputs> реально выводит код сборки сообщений', () => {
    const builders: Record<string, string[]> = {
      'defense/prompts/interviewer.md': ['src/server/defense/interviewer.ts'],
      'defense/prompts/evaluator.md': ['src/server/defense/evaluator.ts'],
      'defense-room/prompts/qlc.md': ['src/server/defense-room/qlc.ts'],
      'defense-room/prompts/interviewer.md': ['src/server/defense-room/interviewer.ts'],
      'defense-room/prompts/evaluator.md': ['src/server/call/prompt-utils.ts'],
      'call/prompts/evaluator.md': ['src/server/call/prompt-utils.ts'],
      'call/prompts/interviewer.md': ['src/server/call/prompt-utils.ts'],
      'call/prompts/test-review.md': ['src/server/call/prompt-utils.ts'],
      'call/prompts/ownership.md': ['src/server/call/prompt-utils.ts'],
      'interview/prompts/interviewer.md': ['src/server/call/prompt-utils.ts'],
    };
    const missing: string[] = [];
    for (const [md, files] of Object.entries(builders)) {
      const src = files.map(read).join('\n');
      for (const m of section(read(`src/server/${md}`), 'inputs').matchAll(/`<([a-z_]+)>`/g)) {
        const t = m[1]!;
        if (!src.includes(`<${t}>`) && !src.includes(`'${t}'`) && !src.includes(`<${t} `)) missing.push(`${md}: <${t}>`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('поля test-review и ownership из <inputs> есть в коде сборки данных (call/test-review.ts)', () => {
    const src = read('src/server/call/test-review.ts');
    for (const md of ['call/prompts/test-review.md', 'call/prompts/ownership.md']) {
      for (const k of ticks(section(read(`src/server/${md}`), 'inputs'))) expect(src, `${md}: ${k}`).toMatch(new RegExp(`\\b${k}\\b\\s*[:,}]`));
    }
  });
});

describe('ID в примерах существуют', () => {
  const catalog = new Set(catalogFromFile().map((e) => e.id));
  const competencies = new Set(COMPETENCIES.map((c) => c.id));

  it('catalogId в примерах извлекателя и созвона — из каталога', () => {
    for (const md of ['claims/prompts/extractor.md', 'call/prompts/interviewer.md']) {
      const ids = jsonObjects(read(`src/server/${md}`))
        .flatMap((o) => [...JSON.stringify(o).matchAll(/"catalogId":\s*"([^"]+)"/g)].map((m) => m[1]!))
        .filter((id) => id !== '…');
      expect(ids.length, md).toBeGreaterThan(0);
      expect(ids.filter((id) => !catalog.has(id)), md).toEqual([]);
    }
  });

  it('competencyId в примерах ИИнтервью — из модели компетенций', () => {
    const ids = jsonObjects(read('src/server/interview/prompts/interviewer.md')).map((o) => (o as { competencyId?: string }).competencyId!);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !competencies.has(id))).toEqual([]);
  });
});
