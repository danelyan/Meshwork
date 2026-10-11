// Аудит помощника работодателя на живой модели через тот же runEmployerTurn, что в продукте.
//
//   cd platform && set -a && . ./.env && set +a
//   export OPENAI_CHAT_BASE_URL="$LLM_CALL_BASE_URL" OPENAI_CHAT_API_KEY="$LLM_CALL_API_KEY" OPENAI_CHAT_MODEL="$LLM_CALL_MODEL" LLM_PROVIDER=openai-chat; unset OPENAI_CHAT_EXTRA_BODY
//   npx tsx eval/prompt-audit/employer/run.ts --repeats 2 [--cases e01-startup-search,e15-age-filter]
//
// Нужна локальная БД с сидом (работодатель demo-employer-northstream, кандидат demo-pool-be-m-infra).
// Разговор прогона удаляется после хода. Итог — eval/results/prompt-audit-employer-<МСК>.json.
import '../../tools-matrix/preload'; // заглушка server-only — до модулей из src/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { prisma } from '../../../src/server/db';
import { getEnv } from '../../../src/server/env';
import { runEmployerTurn } from '../../../src/server/agent/employer/loop';
import { EMPLOYER_PROMPT_VERSION } from '../../../src/server/agent/employer/prompt';
import { saveEmployerMessage } from '../../../src/server/agent/employer/store';
import { employerTools } from '../../../src/server/agent/employer/tools';
import type { EmployerTool } from '../../../src/server/agent/employer/tools/shared';
import { toolSpecs } from '../../../src/server/agent/spec';
import { pseudonym } from '../../../src/server/employer/privacy';

import { CAND, cases as buildCases, type EmpCase, type ToolOverride } from './cases';
import { common, type EmpTurn } from './checks';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const REPEATS = Number(opt('repeats', '2'));
const PARALLEL = Math.max(1, Math.min(2, Number(opt('parallel', '2'))));
const ONLY = opt('cases', '');
const EMPLOYER_ID = opt('employer', 'demo-employer-northstream');
/** Пересчитать проверки по сохранённому прогону (тексты те же, критерии текущие); пишет рядом *-rescored.json. */
const RESCORE = opt('rescore', '');

function withOverrides(registry: EmployerTool[], o: Record<string, ToolOverride> | undefined): EmployerTool[] {
  if (!o) return registry;
  return registry.map((t) => {
    const x = o[t.name];
    if (!x) return t;
    return {
      ...t,
      // Схема входа остаётся настоящей: иначе модель видит пустой spec и шлёт {} (так ведут себя ловушки prompt-traps).
      output: z.any(),
      async handler(ctx: Parameters<EmployerTool['handler']>[0]) {
        if (x.kind === 'error') throw new Error(x.message);
        const v = x.value as Record<string, unknown>;
        if (t.name === 'draft_invitation') ctx.emit({ type: 'invitation_draft', draft: v as never });
        return v;
      },
    } as EmployerTool;
  });
}

async function turn(c: EmpCase): Promise<EmpTurn> {
  const conv = await prisma.employerConversation.create({ data: { employerProfileId: EMPLOYER_ID }, select: { id: true } });
  const asks: string[] = [];
  const drafts: EmpTurn['drafts'] = [];
  try {
    for (const m of c.history ?? []) await saveEmployerMessage(conv.id, m);
    const seeded = c.history?.length ?? 0;
    await runEmployerTurn(
      { employerProfileId: EMPLOYER_ID, conversationId: conv.id, text: c.text, ...(c.page ? { page: c.page } : {}) },
      (e) => {
        if (e.type === 'ask') asks.push([e.question, ...(e.options ?? [])].join(' | '));
        if (e.type === 'invitation_draft') drafts.push({ salaryFrom: e.draft.salaryFrom, salaryTo: e.draft.salaryTo, blocked: e.draft.blocked });
      },
      undefined,
      { tools: withOverrides(employerTools, c.tools), dailyTokenBudget: 0 },
    );
    const rows = (await prisma.employerMessage.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true, toolCalls: true } }))
      .filter((r) => r.role !== 'system')
      .slice(seeded);
    const args: EmpTurn['args'] = [];
    for (const r of rows) {
      if (r.role !== 'assistant' || !Array.isArray(r.toolCalls)) continue;
      for (const tc of r.toolCalls as { name: string; arguments: unknown }[]) {
        const a = typeof tc.arguments === 'string' ? safeJson(tc.arguments) : (tc.arguments as Record<string, unknown>);
        args.push({ name: tc.name, args: a ?? {} });
      }
    }
    const finals = rows.filter((r) => r.role === 'assistant' && !(Array.isArray(r.toolCalls) && r.toolCalls.length));
    return {
      user: c.text,
      text: [finals.at(-1)?.content ?? '', ...asks].filter(Boolean).join('\n'),
      calls: args.map((a) => a.name),
      args,
      toolResults: rows.filter((r) => r.role === 'tool').map((r) => r.content),
      known: [...(c.history ?? []).map((m) => m.content), JSON.stringify(toolSpecs(employerTools))],
      drafts,
    };
  } finally {
    await prisma.employerConversation.delete({ where: { id: conv.id } }).catch(() => undefined);
  }
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
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

function rescore(file: string, names: string[]) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { summary: unknown; runs: (Record<string, unknown> & { id: string; text: string; calls: string[]; args: EmpTurn['args']; drafts: EmpTurn['drafts'] })[] };
  const byId = new Map(buildCases(pseudonym(CAND)).map((c) => [c.id, c]));
  saved.runs = saved.runs.map((r) => {
    const c = byId.get(r.id)!;
    const t: EmpTurn = { user: c.text, text: r.text, calls: r.calls, args: r.args, toolResults: [], drafts: r.drafts, known: [...(c.history ?? []).map((m) => m.content), JSON.stringify(toolSpecs(employerTools))] };
    const v = c.check(t);
    const x = common(t, names);
    const pass = v.pass && !x.leak;
    if (!pass) console.log(`FAIL ${r.id} #${String(r.repeat)} — ${x.leak ? `утечка: ${x.leak}` : v.why}`);
    // invented не пересчитываем: результатов инструментов в сохранённом прогоне нет.
    return { ...r, pass, why: x.leak ? `утечка: ${x.leak}` : v.why, factIds: x.factIds, gendered: x.gendered };
  });
  return saved;
}

async function main() {
  if (RESCORE) {
    const names = (await prisma.candidate.findMany({ select: { name: true } })).flatMap((r) => r.name.replace(/^демо:\s*/i, '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((w) => w.length >= 4));
    const saved = rescore(RESCORE, names);
    const runs = saved.runs as { cls: string; pass: boolean }[];
    const rate = (xs: typeof runs) => ({ pass: xs.filter((x) => x.pass).length, n: xs.length });
    saved.summary = { ...(saved.summary as object), refusal: rate(runs.filter((x) => x.cls === 'refusal')), tools: rate(runs.filter((x) => x.cls === 'tools')), grounding: rate(runs.filter((x) => x.cls === 'grounding')), total: rate(runs) };
    console.log(JSON.stringify(saved.summary));
    writeFileSync(RESCORE.replace(/\.json$/, '-rescored.json'), JSON.stringify(saved, null, 2));
    return;
  }
  if (getEnv().LLM_PROVIDER === 'stub') {
    console.log('LLM_PROVIDER=stub — аудит проверяет живую модель, прогон пропущен.');
    return;
  }
  const names = (await prisma.candidate.findMany({ select: { name: true } })).flatMap((r) =>
    r.name.replace(/^демо:\s*/i, '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((w) => w.length >= 4),
  );
  const all = buildCases(pseudonym(CAND));
  const selected = ONLY ? all.filter((c) => ONLY.split(',').includes(c.id)) : all;
  const jobs = selected.flatMap((c) => Array.from({ length: REPEATS }, (_, r) => ({ c, r: r + 1 })));
  console.log(`${EMPLOYER_PROMPT_VERSION}; модель ${getEnv().OPENAI_CHAT_MODEL ?? getEnv().LLM_PROVIDER}; ${selected.length} сценариев × ${REPEATS}`);

  const runs = await pool(jobs, PARALLEL, async ({ c, r }) => {
    const t0 = Date.now();
    let t: EmpTurn = { user: c.text, text: '', calls: [], args: [], toolResults: [], drafts: [] };
    let verdict;
    let extra: ReturnType<typeof common> = { invented: [], leak: null, factIds: false, gendered: null };
    try {
      t = await turn(c);
      verdict = c.check(t);
      extra = common(t, names);
    } catch (err) {
      verdict = { pass: false, why: `сбой прогона: ${err instanceof Error ? err.message : String(err)}` };
    }
    const pass = verdict.pass && !extra.leak;
    const why = extra.leak ? `утечка: ${extra.leak}` : verdict.why;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${c.id} #${r} ${Date.now() - t0}ms${pass ? '' : ` — ${why}`}${extra.invented.length ? ` [числа не из данных: ${extra.invented.join(', ')}]` : ''}${extra.factIds ? ' [метка F#]' : ''}${extra.gendered ? ` [род: ${extra.gendered}]` : ''}`);
    return { id: c.id, cls: c.cls, persona: c.persona, repeat: r, pass, why, invented: extra.invented, leak: extra.leak, factIds: extra.factIds, gendered: extra.gendered, text: t.text, calls: t.calls, args: t.args, drafts: t.drafts, ms: Date.now() - t0 };
  });

  const rate = (xs: typeof runs) => ({ pass: xs.filter((x) => x.pass).length, n: xs.length });
  const summary = {
    refusal: rate(runs.filter((x) => x.cls === 'refusal')),
    tools: rate(runs.filter((x) => x.cls === 'tools')),
    grounding: rate(runs.filter((x) => x.cls === 'grounding')),
    total: rate(runs),
    turnsWithInventedNumbers: runs.filter((x) => x.invented.length).length,
    leaks: runs.filter((x) => x.leak).length,
    turnsWithFactIds: runs.filter((x) => x.factIds).length,
    turnsWithGuessedGender: runs.filter((x) => x.gendered).length,
  };
  console.log(JSON.stringify(summary));
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(/[: ]/g, '-');
  const file = join(here, '..', '..', 'results', `prompt-audit-employer-${stamp}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ prompt: EMPLOYER_PROMPT_VERSION, model: getEnv().OPENAI_CHAT_MODEL, repeats: REPEATS, summary, runs }, null, 2));
  console.log(`→ ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
