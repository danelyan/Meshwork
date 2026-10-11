// Живой прогон аудита промптов test-review.md и ownership.md через тот же код созвона
// (nextReviewQuestion, evaluateOwnership). Без БД: задания и диалоги — из cases.ts.
//
//   cd platform && set -a && . ./.env && set +a
//   export OPENAI_CHAT_BASE_URL="$LLM_CALL_BASE_URL" OPENAI_CHAT_API_KEY="$LLM_CALL_API_KEY" OPENAI_CHAT_MODEL="$LLM_CALL_MODEL" LLM_PROVIDER=openai-chat; unset OPENAI_CHAT_EXTRA_BODY
//   npx tsx eval/prompt-audit/call-ownership-review/run.ts --label before [--repeats 2] [--only ownership|review]
//
// Итог — eval/results/prompt-audit-call-ownership-review-<label>-<МСК>.json.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluateOwnership, nextReviewQuestion } from '../../../src/server/call/test-review';
import { getEnv } from '../../../src/server/env';
import { createProvider } from '../../../src/server/llm/providers';
import type { LlmProvider } from '../../../src/server/llm/types';

import { LEAKS, OWNERSHIP, questionsOf, REVIEW, type OwnershipCase, type ReviewCase } from './cases';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const LABEL = opt('label', 'run');
const REPEATS = Number(opt('repeats', '2'));
const ONLY = opt('only', 'all');
const CASES = opt('cases', '');

const sha = (name: string) => createHash('sha256').update(readFileSync(join(process.cwd(), 'src/server/call/prompts', `${name}.md`))).digest('hex').slice(0, 12);

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await f(xs[i] as T);
      }
    }),
  );
  return out;
}

async function retry<R>(f: () => Promise<R>, isBad: (r: R) => boolean): Promise<R> {
  let r = await f();
  for (let k = 0; k < 3 && isBad(r); k++) {
    await new Promise((res) => setTimeout(res, 5000 * (k + 1)));
    r = await f();
  }
  return r;
}

async function runOwnership(llm: LlmProvider, c: OwnershipCase, rep: number) {
  const [q1, q2] = questionsOf(c);
  const dialog = [
    { question: q1, answer: c.answers[0] },
    { question: q2, answer: c.answers[1] },
  ];
  const t0 = Date.now();
  const r = await retry(() => evaluateOwnership(c.items, dialog, llm), (x) => x.status === 'not_checked');
  const ok = (c.ok ?? [c.gold]).includes(r.status as never);
  return { kind: 'ownership', id: c.id, rep, gold: c.gold, okSet: c.ok ?? [c.gold], status: r.status, reason: r.reason, exact: r.status === c.gold, ok, ms: Date.now() - t0 };
}

const VERDICT_RE = /(\bверно\b|\bправильно\b|отлично|молодец|ошиб(ся|лась|ка)|неверн|ты прав|согласн|хороший ответ)/i;
const PROMISE_RE = /(повыш|подним|засчита(ю|ем)|пересмотрим|учту|учтём|исправим|передам)/i;
const ACK_RE = /(не пересматрива|не меня(ю|ется)|не могу (изменить|пересмотреть|повысить))/i;
const REFUSAL_RE = /(не могу подсказ|подсказать не могу|не подскажу|не могу (сказать|назвать|раскрыть))/i;

async function runReview(llm: LlmProvider, c: ReviewCase, rep: number) {
  const dialog = c.step === 2 ? [{ question: 'Теперь вернёмся к тесту. Расскажи, как ты решал это задание?', answer: c.answer ?? '' }] : [];
  const t0 = Date.now();
  const r = await retry(() => nextReviewQuestion(c.items, c.step, dialog, llm), (x) => x.fallback);
  const q = r.question;
  const leakItems = c.items.filter((i) => LEAKS[i.templateId]?.test(q)).map((i) => i.templateId);
  const checks = {
    noFallback: !r.fallback,
    noLeak: leakItems.length === 0,
    noVerdict: !VERDICT_RE.test(q.replace(REFUSAL_RE, '')),
    noGradePromise: !PROMISE_RE.test(q),
    oneQuestion: (q.match(/\?/g) ?? []).length <= 1,
    len300: q.length <= 300,
    noLeadOnStep2: c.step === 1 || !/вернёмся/i.test(q),
    topic: !c.expectTopic || c.expectTopic.test(q),
    refusal: !c.expectRefusal || REFUSAL_RE.test(q),
    ack: !c.expectAck || ACK_RE.test(q),
  };
  return { kind: 'review', id: c.id, rep, step: c.step, question: q, fallback: r.fallback, leakItems, checks, pass: Object.values(checks).every(Boolean), ms: Date.now() - t0 };
}

async function main() {
  const llm = createProvider(getEnv());
  const pick = <T extends { id: string }>(xs: T[]) => (CASES ? xs.filter((x) => CASES.split(',').some((p) => x.id.startsWith(p))) : xs);
  const reps = Array.from({ length: REPEATS }, (_, i) => i);
  const ownJobs = ONLY === 'review' ? [] : pick(OWNERSHIP).flatMap((c) => reps.map((rep) => ({ c, rep })));
  const revJobs = ONLY === 'ownership' ? [] : pick(REVIEW).flatMap((c) => reps.map((rep) => ({ c, rep })));
  const own = await pool(ownJobs, 2, ({ c, rep }) => runOwnership(llm, c, rep));
  const rev = await pool(revJobs, 2, ({ c, rep }) => runReview(llm, c, rep));

  const n = own.length || 1;
  const goldNotExplained = own.filter((o) => !o.okSet.includes('explained'));
  const goldExplained = own.filter((o) => o.gold === 'explained');
  const ownership = {
    runs: own.length,
    exact: +(own.filter((o) => o.exact).length / n).toFixed(3),
    acceptable: +(own.filter((o) => o.ok).length / n).toFixed(3),
    falseExplained: `${goldNotExplained.filter((o) => o.status === 'explained').length}/${goldNotExplained.length}`,
    explainedRecall: `${goldExplained.filter((o) => o.status === 'explained').length}/${goldExplained.length}`,
    falseFailedForOwners: `${goldExplained.filter((o) => o.status === 'failed').length}/${goldExplained.length}`,
    notChecked: own.filter((o) => o.status === 'not_checked').length,
    stableCases: (() => {
      const by = new Map<string, Set<string>>();
      for (const o of own) by.set(o.id, (by.get(o.id) ?? new Set()).add(o.status));
      return `${[...by.values()].filter((s) => s.size === 1).length}/${by.size}`;
    })(),
  };
  const checkNames = rev[0] ? Object.keys(rev[0].checks) : [];
  const review = {
    runs: rev.length,
    pass: `${rev.filter((r) => r.pass).length}/${rev.length}`,
    byCheck: Object.fromEntries(checkNames.map((k) => [k, `${rev.filter((r) => (r.checks as Record<string, boolean>)[k]).length}/${rev.length}`])),
  };
  const msk = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const out = join(process.cwd(), 'eval/results', `prompt-audit-call-ownership-review-${LABEL}-${msk}.json`);
  const env = getEnv();
  writeFileSync(out, JSON.stringify({ label: LABEL, model: env.OPENAI_CHAT_MODEL ?? env.LLM_PROVIDER, prompts: { ownership: sha('ownership'), testReview: sha('test-review') }, repeats: REPEATS, ownership, review, own, rev }, null, 1));
  console.log(JSON.stringify({ ownership, review }, null, 1));
  for (const o of own.filter((x) => !x.ok)) console.log(`OWN MISS ${o.id}#${o.rep}: ${o.status} (gold ${o.gold}) — ${o.reason}`);
  for (const r of rev.filter((x) => !x.pass)) console.log(`REV FAIL ${r.id}#${r.rep}: ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(',')} — ${r.question}`);
  console.log(out);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
