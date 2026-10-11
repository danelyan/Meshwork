// Живой прогон сценариев consultant-careers на модели из env (по умолчанию модель стенда).
// Без БД: тот же системный промпт (buildSystem + journeyPromptBlock на синтетическом состоянии),
// те же схемы инструментов (toolSpecs), тот же dispatchToolCall и напоминание о вопросе; данные
// инструментов кандидата — из персоны сценария; search_knowledge — настоящий (корпус в репо).
//
//   cd platform && set -a && . ./.env && set +a && export OPENAI_CHAT_...=… LLM_PROVIDER=openai-chat
//   npx tsx eval/prompt-audit/consultant-careers/run.ts --repeats 2 [--only id1,id2] [--label base]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { getEnv } from '../../../src/server/env';
import { createProvider } from '../../../src/server/llm/providers';
import type { ChatMessage, LlmProvider } from '../../../src/server/llm/types';
import { buildSystem, TURN_MAX_TOKENS } from '../../../src/server/agent/loop';
import { journeyPromptBlock, type JourneyState } from '../../../src/server/agent/journey';
import { CONSULTANT_PROMPT_VERSION } from '../../../src/server/agent/prompt';
import { dispatchToolCall } from '../../../src/server/agent/dispatch';
import { withQuestionReminder } from '../../../src/server/agent/reminder';
import { toolSpecs } from '../../../src/server/agent/spec';
import { tools as realTools } from '../../../src/server/agent/tools';
import { MAX_TOOL_CALLS_PER_TURN, type AgentTool, type ToolContext } from '../../../src/server/agent/types';
import type { TurnOutput } from '../../prompt-traps/checks';

import { SCENARIOS, type Persona, type Scenario } from './scenarios';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const REPEATS = Number(opt('repeats', '2'));
const PARALLEL = Math.max(1, Math.min(2, Number(opt('parallel', '2'))));
const LABEL = opt('label', 'run');
const ONLY = opt('only', '');
/** Предложенный блок промпта (A/B без правки consultant.md): вставляется перед <examples>. */
const PATCH = opt('patch', '');
const patchText = PATCH ? readFileSync(PATCH, 'utf8').trim() : '';
/** С патчем — и правка устаревшей фразы <path> (созвон после теста доступен без утверждений: journey.ts CALL_NO_SOURCES_HINT). */
const PATH_OLD = 'если утверждений нет, перед созвоном предложи приложить резюме или ссылку (созвон открывается, только когда есть о чём говорить).';
const PATH_NEW = 'если утверждений нет, перед созвоном после теста предложи на выбор: сразу созвон (вопросы по компетенциям категории) или сначала резюме или ссылку, чтобы вопросы были ближе к опыту.';
const withPatch = (sys: string) => (patchText ? sys.replace('<examples>', `${patchText}\n\n<examples>`).replace(PATH_OLD, PATH_NEW) : sys);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = AgentTool<any, any, any>;

function journeyOf(p: Persona): JourneyState {
  const j = p.journey;
  return {
    steps: j.steps ?? { onboarding: true, test: false, call: false, project: false, ai_defense: false },
    counts: j.counts ?? { sources: 0, proposed: 0, confirmed: 0, pendingInvitations: 0, acceptedInvitations: 0 },
    hasCategory: j.hasCategory ?? Boolean(p.category),
    callNeedsSources: j.callNeedsSources ?? false,
    onboardedAt: new Date('2026-10-11T10:00:00Z'),
    name: p.name,
    hired: null,
    aiConsent: j.aiConsent ?? true,
    hidden: j.hidden ?? false,
    nextStep: j.nextStep,
    lastCall: null,
  };
}

const CONFIRMED_AT = '2026-10-11T12:00:00.000Z';

/** Данные инструментов кандидата из персоны — в форме ответов настоящих инструментов. */
function stubs(p: Persona): Record<string, (args: Record<string, unknown>) => unknown> {
  const js = journeyOf(p);
  const cat = p.category ? { ...p.category, confirmedAt: CONFIRMED_AT } : null;
  const confirmed = p.claims.filter((c) => c.status === 'confirmed');
  return {
    get_profile: () => ({
      candidate: { id: 'cand', name: p.name, specialization: p.specialization ?? p.category?.specialization ?? null, fspState: p.fsp },
      category: cat,
      claims: p.claims.map((c) => ({ ...c, wording: null, quote: '…', limits: '', suggestedProof: ['task', 'interview'] })),
      summary: { confirmed: confirmed.length, proposed: p.claims.length - confirmed.length, rejected: 0 },
    }),
    get_onboarding_status: () => ({
      specialization: p.specialization,
      fspState: p.fsp,
      profileAvailable: true,
      profile: { ...p.anketa, workFormats: [], salaryMin: null },
      intake: { experience: p.anketa.experience, experienceSummary: null, candidateIndustries: [] },
      onboarding: { finished: true, currentStep: null, skipped: [] },
      steps: js.steps,
      counts: js.counts,
      nextStep: js.nextStep,
      hiredCompany: null,
      hint: '',
      note: 'Анкета — для советов консультанта; на подборку не влияет (F4).',
    }),
    get_test_status: () => ({
      category: cat,
      history: cat ? [cat] : [],
      recommended: p.rec,
      testAvailable: true,
      testUrl: '/test',
      note: 'Тест выбирает кандидат; это рекомендация, не категория.',
    }),
    recommend_test: () => ({ ...p.rec, note: 'Категорию присваивает только тест; это предложение, кандидат выбирает сам.' }),
    recommend_targets: () => ({
      targets: p.targets.map((t) => ({ ...t, companyId: `co-${t.vacancyId}`, reason: 'По вакансиям на платформе' })),
      note: 'Это покрытие потребности по вакансиям платформы, не вероятность приглашения.',
    }),
    get_gap_map: () => ({ gaps: p.gaps.map((g, i) => ({ id: `g${i}`, ...g, suggestedProof: ['task'] })) }),
    recommend_tasks: () => ({ tasks: p.tasks.map((t) => ({ ...t, reason: 'Закрывает пробел из карты' })) }),
    get_invitations: () => ({ invitations: [], note: 'Приглашений нет.' }),
    explain_evidence: () => ({ level: 'self_reported', ways: ['task', 'interview'] }),
    suggest_call: () => ({
      offered: true,
      activeCallId: null,
      consentNeeded: false,
      kind: p.category ? 'interview' : 'qualifying',
      questions: p.category ? '5–7 вопросов, около 20 минут' : '4–6 вопросов по темам резюме',
      note: 'Кнопка «Созвониться» в поле ввода.',
    }),
    catalog_search: () => ({ entries: [] }),
    propose_claims: () => {
      throw new Error('в этом прогоне недоступно');
    },
    read_upload: () => {
      throw new Error('файл не найден');
    },
    fetch_url: () => {
      throw new Error('в этом прогоне недоступно');
    },
    fetch_profile: () => {
      throw new Error('в этом прогоне недоступно');
    },
    start_verification: () => ({ started: false, note: 'в этом прогоне недоступно' }),
    render_profile_pdf: () => ({ url: '/api/profile/pdf' }),
    web_search: () => ({ results: [], note: 'В этом прогоне веб-поиск выключен.' }),
  };
}

function registryFor(p: Persona): AnyTool[] {
  const s = stubs(p);
  return (realTools as AnyTool[]).map((t) => {
    if (t.name === 'search_knowledge' || t.name === 'ask_user') return t;
    const fn = s[t.name];
    if (!fn) return t;
    return { ...t, output: z.any(), async handler(_ctx: unknown, args: Record<string, unknown>) {
      return fn(args);
    } } as AnyTool;
  });
}

async function complete(llm: LlmProvider, req: Parameters<LlmProvider['complete']>[0]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await llm.complete(req);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (attempt < 4 && (status === 429 || (status ?? 0) >= 500)) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/** Один ход: та же схема, что runTurn (без БД). */
async function turn(llm: LlmProvider, registry: AnyTool[], journey: string, history: ChatMessage[], text: string): Promise<TurnOutput> {
  history.push({ role: 'user', content: text });
  const specs = toolSpecs(registry);
  const asks: string[] = [];
  const ctx = {
    candidateId: 'cand',
    conversationId: 'conv',
    emit: (e: { type: string; question?: string; options?: string[] }) => {
      if (e.type === 'ask') asks.push([e.question, ...(e.options ?? [])].join(' | '));
    },
    llm,
  } as unknown as ToolContext;
  const calls: string[] = [];
  const callArgs: string[] = [];
  let n = 0;
  for (;;) {
    const canCall = n < MAX_TOOL_CALLS_PER_TURN;
    const res = await complete(llm, {
      purpose: 'consultant',
      system: withPatch(buildSystem({ now: new Date(), toolsExhausted: !canCall, journey })),
      messages: withQuestionReminder(history, text),
      tools: specs,
      toolChoice: canCall ? 'auto' : 'none',
      maxTokens: TURN_MAX_TOKENS,
      temperature: 0.3,
    });
    const requested = res.kind === 'tool_calls' ? (res.toolCalls ?? []) : [];
    if (canCall && requested.length) {
      const batch = requested.slice(0, MAX_TOOL_CALLS_PER_TURN - n);
      history.push({ role: 'assistant', content: res.text ?? '', toolCalls: batch });
      let terminal = false;
      for (const call of batch) {
        n++;
        calls.push(call.name);
        callArgs.push(`${call.name} ${typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments)}`);
        const r = await dispatchToolCall(registry, ctx, call);
        history.push({ role: 'tool', content: r.content, toolCallId: call.id });
        if (r.terminal) terminal = true;
      }
      if (terminal) {
        const t = asks.join('\n');
        // ask_user закончил ход: в историю — как вопрос ассистента.
        history.push({ role: 'assistant', content: t });
        return { text: t, calls, callArgs };
      }
      continue;
    }
    const out = (res.text ?? '').trim();
    history.push({ role: 'assistant', content: out });
    return { text: [out, ...asks].filter(Boolean).join('\n'), calls, callArgs };
  }
}

interface RunTurn {
  n: number;
  user: string;
  text: string;
  calls: string[];
  callArgs: string[];
  pass: boolean;
  why: string;
}
interface Run {
  id: string;
  repeat: number;
  turns: RunTurn[];
  pass: boolean;
  ms: number;
  error?: string;
}

async function runScenario(llm: LlmProvider, sc: Scenario, repeat: number): Promise<Run> {
  const t0 = Date.now();
  const registry = registryFor(sc.persona);
  const journey = journeyPromptBlock(journeyOf(sc.persona));
  const history: ChatMessage[] = [];
  const outs: TurnOutput[] = [];
  const turns: RunTurn[] = [];
  try {
    for (const [i, t] of sc.turns.entries()) {
      const o = await turn(llm, registry, journey, history, t.text);
      outs.push(o);
      const v = t.check(o, outs);
      turns.push({ n: i + 1, user: t.text, text: o.text, calls: o.calls, callArgs: o.callArgs, pass: v.pass, why: v.why });
      console.log(`${v.pass ? 'PASS' : 'FAIL'} ${sc.id} #${repeat} ход ${i + 1}${v.pass ? '' : ` — ${v.why}`}`);
    }
    return { id: sc.id, repeat, turns, pass: turns.every((t) => t.pass), ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ERR  ${sc.id} #${repeat} — ${msg}`);
    return { id: sc.id, repeat, turns, pass: false, ms: Date.now() - t0, error: msg.slice(0, 300) };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

async function main() {
  const env = getEnv();
  if (env.LLM_PROVIDER === 'stub') {
    console.log('LLM_PROVIDER=stub — нужен живой провайдер.');
    return;
  }
  const llm = createProvider(env);
  const scs = ONLY ? SCENARIOS.filter((s) => ONLY.split(',').includes(s.id)) : SCENARIOS;
  if (PATCH && !withPatch(buildSystem({ now: new Date(), toolsExhausted: false })).includes(patchText)) throw new Error('патч не вставился');
  if (PATCH && withPatch(buildSystem({ now: new Date(), toolsExhausted: false })).includes(PATH_OLD)) throw new Error('фраза <path> не заменилась');
  console.log(`prompt ${CONSULTANT_PROMPT_VERSION}${PATCH ? ' + patch' : ''}, model ${llm.model}; ${scs.length} сценариев × ${REPEATS}, параллельно ${PARALLEL}`);
  const jobs = scs.flatMap((s) => Array.from({ length: REPEATS }, (_, r) => ({ s, r: r + 1 })));
  const runs = await pool(jobs, PARALLEL, ({ s, r }) => runScenario(llm, s, r));
  const turnsAll = runs.flatMap((r) => r.turns);
  const summary = {
    scenarios: scs.length,
    runs: runs.length,
    runsPass: runs.filter((r) => r.pass).length,
    turns: turnsAll.length,
    turnsPass: turnsAll.filter((t) => t.pass).length,
    errors: runs.filter((r) => r.error).length,
  };
  console.log(`\nсценарии: ${summary.runsPass}/${summary.runs} прогонов целиком; ходы ${summary.turnsPass}/${summary.turns}; ошибок ${summary.errors}`);
  for (const s of scs) {
    const rs = runs.filter((r) => r.id === s.id);
    console.log(`${s.id.padEnd(26)} ${rs.filter((r) => r.pass).length}/${rs.length}`);
  }
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(/[: ]/g, '-');
  const file = join(here, '..', '..', 'results', `prompt-audit-consultant-careers-${LABEL}-${stamp}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ label: LABEL, prompt: CONSULTANT_PROMPT_VERSION, patch: PATCH || null, model: llm.model, repeats: REPEATS, summary, scenarios: scs.map((s) => ({ id: s.id, topic: s.topic })), runs }, null, 2));
  console.log(`→ ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
