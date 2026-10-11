// Живой прогон аудита consultant-safety через тот же код агента (runTurn), как eval/prompt-traps.
//
//   cd platform && set -a && . ./.env && set +a  (+ OPENAI_CHAT_* = LLM_CALL_*, модель стенда)
//   npx tsx eval/prompt-audit/consultant-safety/run.ts --label v21 [--cases s01-url-injection,...] [--repeats 3]
//   npx tsx eval/prompt-audit/consultant-safety/run.ts --rescore eval/results/prompt-audit-consultant-safety-….json
//
// Нужна БД с сидом (кандидат demo-pool-be-m-infra). Разговоры прогона удаляются после хода, карточки,
// созданные моделью, — в конце. Итог — eval/results/prompt-audit-consultant-safety-<label>-<МСК>.json.
import '../../tools-matrix/preload'; // заглушка server-only — до модулей из src/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { prisma } from '../../../src/server/db';
import { getEnv } from '../../../src/server/env';
import { runTurn } from '../../../src/server/agent/loop';
import { CONSULTANT_PROMPT_VERSION } from '../../../src/server/agent/prompt';
import { tools as consultantTools } from '../../../src/server/agent/tools';
import type { AgentTool } from '../../../src/server/agent/types';
import type { ToolOverride } from '../../prompt-traps/cases';
import type { TurnOutput } from '../../prompt-traps/checks';

import { CASES, verdict, type SafetyCase } from './cases';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const REPEATS = Number(opt('repeats', '3'));
const PARALLEL = Math.max(1, Math.min(2, Number(opt('parallel', '2'))));
const LABEL = opt('label', 'run');
const ONLY = opt('cases', '');
const CANDIDATE_ID = opt('candidate', 'demo-pool-be-m-infra');
const RESCORE = opt('rescore', '');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = AgentTool<any, any, any>;

function withOverrides(registry: AnyTool[], overrides: Record<string, ToolOverride> | undefined): AnyTool[] {
  if (!overrides) return registry;
  return registry.map((t) => {
    const o = overrides[t.name];
    if (!o) return t;
    return {
      ...t,
      input: z.any(),
      output: z.any(),
      async handler() {
        if (o.kind === 'error') throw new Error(o.message);
        return o.value;
      },
    } as AnyTool;
  });
}

async function turn(c: SafetyCase): Promise<TurnOutput> {
  const conv = await prisma.conversation.create({ data: { candidateId: CANDIDATE_ID }, select: { id: true } });
  const asks: string[] = [];
  try {
    const t0 = Date.now() - 60_000;
    for (const [i, h] of (c.history ?? []).entries()) {
      await prisma.message.create({ data: { conversationId: conv.id, role: h.role, content: h.content, createdAt: new Date(t0 + i * 1000) } });
    }
    const seeded = c.history?.length ?? 0;
    await runTurn(
      { candidateId: CANDIDATE_ID, conversationId: conv.id, text: c.text },
      (e) => {
        if (e.type === 'ask') asks.push([e.question, ...(e.options ?? [])].join(' | '));
      },
      undefined,
      { tools: withOverrides(consultantTools as AnyTool[], c.tools), dailyTokenBudget: 0 },
    );
    const rows = (await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true, toolCalls: true } })).slice(seeded);
    const calls: string[] = [];
    const callArgs: string[] = [];
    for (const r of rows) {
      if (r.role !== 'assistant' || !Array.isArray(r.toolCalls)) continue;
      for (const tc of r.toolCalls as { name: string; arguments: unknown }[]) {
        calls.push(tc.name);
        callArgs.push(`${tc.name} ${typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)}`);
      }
    }
    const finals = rows.filter((r) => r.role === 'assistant' && !(Array.isArray(r.toolCalls) && r.toolCalls.length));
    return { text: [finals.at(-1)?.content ?? '', ...asks].filter(Boolean).join('\n'), calls, callArgs };
  } finally {
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => undefined);
  }
}

interface Run {
  id: string;
  topic: string;
  repeat: number;
  pass: boolean;
  ownPass: boolean;
  commonPass: boolean;
  why: string;
  text: string;
  calls: string[];
  callArgs: string[];
  ms: number;
}

function score(c: SafetyCase, out: TurnOutput) {
  const v = verdict(c, out);
  const why = [v.own.pass ? '' : v.own.why, v.common.pass ? '' : `[общее] ${v.common.why}`].filter(Boolean).join('; ') || 'ok';
  return { pass: v.own.pass && v.common.pass, ownPass: v.own.pass, commonPass: v.common.pass, why };
}

async function runOne(c: SafetyCase, repeat: number): Promise<Run> {
  const t0 = Date.now();
  let out: TurnOutput = { text: '', calls: [], callArgs: [] };
  let s;
  for (let attempt = 1; ; attempt++) {
    try {
      out = await turn(c);
      s = score(c, out);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 3 && /429|rate|timeout/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 15_000 * attempt));
        continue;
      }
      s = { pass: false, ownPass: false, commonPass: false, why: `сбой прогона: ${msg}` };
      break;
    }
  }
  const ms = Date.now() - t0;
  console.log(`${s.pass ? 'PASS' : 'FAIL'} ${c.id} #${repeat} ${ms}ms${s.pass ? '' : ` — ${s.why}`}`);
  return { id: c.id, topic: c.topic, repeat, ...s, text: out.text, calls: out.calls, callArgs: out.callArgs, ms };
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
  if (RESCORE) {
    const saved = JSON.parse(readFileSync(RESCORE, 'utf8')) as { label: string; prompt: string; model: string; runs: Run[] };
    const runs = saved.runs.map((r) => {
      const c = CASES.find((x) => x.id === r.id)!;
      const s = score(c, { text: r.text, calls: r.calls, callArgs: r.callArgs });
      if (!s.pass) console.log(`FAIL ${r.id} #${r.repeat} — ${s.why}`);
      return { ...r, ...s };
    });
    report(runs, `${saved.label}-rescored`, saved.prompt, saved.model);
    return;
  }
  if (getEnv().LLM_PROVIDER === 'stub') {
    console.log('LLM_PROVIDER=stub — прогон проверяет живую модель, пропущен.');
    return;
  }
  const cases = ONLY ? CASES.filter((c) => ONLY.split(',').includes(c.id)) : CASES;
  const claimsBefore = new Set((await prisma.claim.findMany({ where: { candidateId: CANDIDATE_ID }, select: { id: true } })).map((r) => r.id));
  const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, (_, r) => ({ c, r: r + 1 })));
  console.log(`prompt: ${CONSULTANT_PROMPT_VERSION}; model: ${getEnv().OPENAI_CHAT_MODEL}; ${cases.length} сценариев × ${REPEATS}, параллельно ${PARALLEL}`);
  const runs = await pool(jobs, PARALLEL, ({ c, r }) => runOne(c, r));
  const created = await prisma.claim.findMany({ where: { candidateId: CANDIDATE_ID }, select: { id: true } });
  const extra = created.map((r) => r.id).filter((id) => !claimsBefore.has(id));
  if (extra.length) await prisma.claim.deleteMany({ where: { id: { in: extra } } });
  report(runs, LABEL, CONSULTANT_PROMPT_VERSION, getEnv().OPENAI_CHAT_MODEL ?? '');
}

function report(runs: Run[], label: string, prompt: string, model: string) {
  const ids = [...new Set(runs.map((r) => r.id))];
  const byCase = ids.map((id) => {
    const rs = runs.filter((r) => r.id === id);
    return { id, topic: rs[0]!.topic, pass: rs.filter((r) => r.pass).length, own: rs.filter((r) => r.ownPass).length, common: rs.filter((r) => r.commonPass).length, n: rs.length };
  });
  console.log('\nсценарий                    всё  своё  общее');
  for (const b of byCase) console.log(`${b.id.padEnd(26)} ${b.pass}/${b.n}  ${b.own}/${b.n}  ${b.common}/${b.n}`);
  const sum = (k: 'pass' | 'own' | 'common') => byCase.reduce((a, b) => a + b[k], 0);
  const n = runs.length;
  const summary = { pass: sum('pass'), own: sum('own'), common: sum('common'), n };
  console.log(`\nитого: всё ${summary.pass}/${n}, своя проверка ${summary.own}/${n}, общие (стиль/род/утечка) ${summary.common}/${n}`);
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(/[: ]/g, '-');
  const file = join(here, '..', '..', 'results', `prompt-audit-consultant-safety-${label}-${stamp}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ label, prompt, model, repeats: REPEATS, summary, byCase, runs }, null, 2));
  console.log(`\n→ ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
