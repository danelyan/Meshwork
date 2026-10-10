// Повторная оценка сохранённых транскриптов валидации 10.10 (eval:call / eval:defense) новыми оценщиками —
// на тех же ответах, без новых созвонов: так сравнение «до/после» не смешивается с разбросом актёра.
//   ступень 1: вид оценщика `question` (текст вопроса, пересказ профиля вырезан) против `type` (только уровень);
//   ступень 3: балл по каждому вопросу (defense-room/verdict.ts) против одного балла на транскрипт.
// Запуск из platform/ (БД, где лежат созвоны валидации; читается, не пишется):
//   EVAL_DATABASE_URL=…/fsp_validation npx tsx eval/stages/reeval.ts [--stage call|defense] [--views question,type]
//   [--from defense-live-tuned.json] [--from-call call-live-tuned.json] — переоценить защиты другого замера (его БД — в EVAL_DATABASE_URL); [--out метка]
import { STUB } from './boot';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { questionTurns } from '../../src/server/call/drivers';
import { evaluateCall, type EvalTopic, type EvaluatorView } from '../../src/server/call/evaluator';
import type { QuestionLevel, TranscriptEntry as CallEntry } from '../../src/server/call/types';
import { asTranscript } from '../../src/server/defense-room/store';
import type { PlanItem } from '../../src/server/defense-room/types';
import { evaluateDefenseRoom } from '../../src/server/defense-room/verdict';
import { mean, separation, spread } from './metrics';
import { argValue, prisma, providers, writeResult } from './runtime';

const RESULTS = path.join(process.cwd(), 'eval/results/stages');
const r2 = (x: number | null) => (x === null ? '—' : x.toFixed(2).replace('.', ','));
const n1 = (x: number | null) => (x === null ? '—' : x.toFixed(1).replace('.', ','));

interface CallLiveObs {
  persona: string;
  sessionId: string;
  topics: { catalogId: string | null; expected: boolean | null; confirmed: boolean; total: number }[];
}

async function reevalCalls(llm: ReturnType<typeof providers>['platform'], views: EvaluatorView[], from = 'call-live.json') {
  const live = JSON.parse(readFileSync(path.join(RESULTS, from), 'utf8')) as { observations: CallLiveObs[] };
  const rows: { persona: string; view: EvaluatorView; catalogId: string; expected: boolean | null; status: string; total: number; why: number; runs: number; spread: number; before: boolean; beforeTotal: number }[] = [];
  for (const o of live.observations) {
    const s = await prisma.callSession.findUnique({ where: { id: o.sessionId }, select: { transcriptJson: true, candidateId: true } });
    if (!s) continue;
    const claims = await prisma.claim.findMany({ where: { candidateId: s.candidateId }, select: { statement: true, quote: true } });
    const redact = claims.flatMap((c) => [c.statement, c.quote]);
    const turns = questionTurns(s.transcriptJson as unknown as CallEntry[]).filter((t) => t.answer !== null);
    const byTopic = new Map<string, EvalTopic>();
    for (const t of turns) {
      const cur = byTopic.get(t.topic) ?? { topic: t.topic, catalogId: t.catalogId, claimed: true, claimStatement: null, maxLevel: 1 as QuestionLevel, qa: [] };
      cur.qa.push({ question: t.question, answer: t.answer ?? '', level: t.level });
      cur.maxLevel = Math.max(cur.maxLevel, t.level) as QuestionLevel;
      byTopic.set(t.topic, cur);
    }
    for (const view of views) {
      const ev = await evaluateCall('backend', [...byTopic.values()], llm, { redact, view });
      for (const d of ev.depthMap) {
        const prev = o.topics.find((t) => t.catalogId === d.catalogId);
        rows.push({
          persona: o.persona,
          view,
          catalogId: d.catalogId ?? d.topic,
          expected: prev?.expected ?? null,
          status: d.status,
          total: d.total,
          why: d.scores.why,
          runs: d.runs.length,
          spread: spread(d.runs.map((r) => r.depth + r.why + r.boundary + r.completion)),
          before: prev?.confirmed ?? false,
          beforeTotal: prev?.total ?? 0,
        });
      }
      console.log(`  call ${o.persona} ${o.sessionId.slice(-6)} [${view}]: ${ev.depthMap.map((d) => `${d.catalogId}:${d.status === 'inconclusive' ? '?' : d.confirmed ? '✓' : '✗'}${d.total}`).join(' ')} · прогонов ${ev.runs}`);
    }
  }
  const lines = [
    '| Вид оценщика | Совпало с ожиданием (решённые) | Ошибок решения | Не определено | «Почему так» у ожидаемых «да» (ср.) | «Почему так» у ожидаемых «нет» (ср.) | Сумма: «да» / «нет» (ср.) | Прогонов на созвон (ср.) |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const before = rows.filter((r) => r.view === views[0]);
  const bJudged = before.filter((r) => r.expected !== null);
  lines.push(
    `| до доработки (один прогон × 3, сохранённое решение) | ${bJudged.filter((r) => r.before === r.expected).length}/${bJudged.length} | ${bJudged.filter((r) => r.before !== r.expected).length} | — | — | — | ${n1(mean(bJudged.filter((r) => r.expected).map((r) => r.beforeTotal)))} / ${n1(mean(bJudged.filter((r) => r.expected === false).map((r) => r.beforeTotal)))} | 3 |`,
  );
  for (const view of views) {
    const v = rows.filter((r) => r.view === view && r.expected !== null);
    const decided = v.filter((r) => r.status !== 'inconclusive');
    const yes = v.filter((r) => r.expected);
    const no = v.filter((r) => r.expected === false);
    lines.push(
      `| ${view === 'question' ? 'вопрос + ответ (пересказ профиля вырезан)' : 'тип вопроса + ответ'} | ${decided.filter((r) => (r.status === 'confirmed') === r.expected).length}/${decided.length} | ${decided.filter((r) => (r.status === 'confirmed') !== r.expected).length} | ${v.length - decided.length} | ${n1(mean(yes.map((r) => r.why)))} | ${n1(mean(no.map((r) => r.why)))} | ${n1(mean(yes.map((r) => r.total)))} / ${n1(mean(no.map((r) => r.total)))} | ${n1(mean(v.map((r) => r.runs)))} |`,
    );
  }
  return { rows, table: lines.join('\n') };
}

interface DefenseLiveObs {
  persona: string;
  sessionId: string;
  total: number | null;
}

async function reevalDefense(llm: ReturnType<typeof providers>['platform'], from = 'defense-live.json') {
  const live = JSON.parse(readFileSync(path.join(RESULTS, from), 'utf8')) as { observations: DefenseLiveObs[] };
  const out: { persona: string; sessionId: string; before: number | null; after: number | null; passed: boolean | null; flags: string[]; items: { label: string; total: number; runs: number[] }[] }[] = [];
  for (const o of live.observations) {
    const s = await prisma.callSession.findUnique({ where: { id: o.sessionId }, select: { transcriptJson: true } });
    const plan = await prisma.defenseRoomPlan.findUnique({ where: { callSessionId: o.sessionId }, select: { itemsJson: true, sourceJson: true } });
    if (!s || !plan) continue;
    const v = await evaluateDefenseRoom(
      {
        projectTitle: String((plan.sourceJson as { projectTitle?: string }).projectTitle ?? 'проект'),
        transcript: asTranscript(s.transcriptJson),
        plan: plan.itemsJson as unknown as PlanItem[],
        projectScore: 0.95,
        employerAsked: 0,
        employerAnswered: 0,
      },
      llm,
    );
    out.push({ persona: o.persona, sessionId: o.sessionId, before: o.total, after: v.totalMean ?? v.total, passed: v.passed, flags: v.flags, items: (v.items ?? []).map((i) => ({ label: i.label, total: i.total, runs: i.runs })) });
    console.log(`  defense ${o.persona} ${o.sessionId.slice(-6)}: было ${o.total} → ${v.totalMean} [${(v.items ?? []).map((i) => `${i.label.split(' · ')[1] ?? i.label}=${i.total}`).join(', ')}] · ${v.flags.join(',')}`);
  }
  const by = (p: string, k: 'before' | 'after') => out.filter((x) => x.persona === p && x[k] !== null).map((x) => x[k] as number);
  const personas = ['own', 'partial', 'ai-only'];
  const table = [
    '| Персона | Было: сумма по транскрипту | Стало: среднее по вопросам | uneven_understanding | strong_project_weak_defense |',
    '|---|---|---|---|---|',
    ...personas.map((p) => {
      const xs = out.filter((x) => x.persona === p);
      return `| ${p} | ${by(p, 'before').join(' / ')} | ${by(p, 'after').map((x) => n1(x)).join(' / ')} | ${xs.filter((x) => x.flags.includes('uneven_understanding')).length}/${xs.length} | ${xs.filter((x) => x.flags.includes('strong_project_weak_defense')).length}/${xs.length} |`;
    }),
    '',
    '| Разведение (AUC) | Было | Стало |',
    '|---|---|---|',
    ...[
      ['own', 'partial'],
      ['own', 'ai-only'],
      ['partial', 'ai-only'],
    ].map(([a, b]) => `| ${a} над ${b} | ${r2(separation(by(a!, 'before'), by(b!, 'before')))} | ${r2(separation(by(a!, 'after'), by(b!, 'after')))} |`),
  ].join('\n');
  return { out, table };
}

async function main(): Promise<void> {
  const stage = argValue('stage') ?? 'all';
  const views = (argValue('views') ?? 'question,type').split(',') as EvaluatorView[];
  const llm = providers();
  console.log(`reeval — провайдер ${llm.platform.name}/${llm.platform.model}${STUB ? ' (stub)' : ''}`);
  const result: Record<string, unknown> = { runAt: new Date().toISOString(), provider: `${llm.platform.name}/${llm.platform.model}` };
  if (stage === 'all' || stage === 'defense') {
    const d = await reevalDefense(llm.platform, argValue('from') ?? undefined);
    result.defense = d.out;
    console.log(`\n${d.table}\n`);
  }
  if (stage === 'all' || stage === 'call') {
    const c = await reevalCalls(llm.platform, views, argValue('from-call') ?? undefined);
    result.call = c.rows;
    console.log(`\n${c.table}\n`);
  }
  result.meter = llm.platform.meter;
  console.log(`Вызовов платформы: ${llm.platform.meter.calls} (ошибок ${llm.platform.meter.failures}); токены ${llm.platform.meter.inputTokens} вх / ${llm.platform.meter.outputTokens} вых.`);
  console.log(`Результат: ${writeResult(`reeval-${stage}${argValue('out') ? `-${argValue('out')}` : ''}${STUB ? '-stub' : ''}.json`, result)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
