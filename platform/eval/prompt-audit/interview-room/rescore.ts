// Пересчёт проверок checks.ts по сохранённым транскриптам (сравнение «до/после» одной и той же линейкой).
// npx tsx eval/prompt-audit/interview-room/rescore.ts <result.json> [...]
import { readFileSync } from 'node:fs';

import { checkQuestion } from './checks';
import { expectFor, factsFor } from './scenarios';

interface Entry { k: number; question: string; heardQuestion?: string; answer?: string; done: boolean; meta: { block?: string; routedBy?: string | null; fallback?: boolean; interrupted?: unknown } }

for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, 'utf8')) as { results: { id: string; log: Entry[] }[] };
  const counts: Record<string, number> = {};
  let questions = 0;
  let flagged = 0;
  let fallback = 0;
  for (const s of r.results) {
    const prev: { question: string; answer: string | null; block?: string }[] = [];
    let tail: string | null = null;
    for (const e of s.log) {
      if (!e.question) continue;
      // Итоговая реплика при done в интервью не звучит (её заменяет INTERVIEW_CLOSING_LINE) — не считаем.
      if (e.done) continue;
      questions += 1;
      if (e.meta.fallback) fallback += 1;
      const expect = expectFor(s.id, e.k - 1);
      const c = checkQuestion({ question: e.question, index: e.k, done: e.done, block: e.meta.block ?? null, prev, lastAnswer: prev[prev.length - 1]?.answer ?? null, resumeFacts: factsFor(s.id), expect, signal: e.meta.routedBy ?? null, interruptedTail: tail });
      if (c.flags.length) flagged += 1;
      for (const f of c.flags) counts[f] = (counts[f] ?? 0) + 1;
      tail = e.heardQuestion ? e.question.slice(e.heardQuestion.replace(/\s*…\(.*\)$/, '').length).trim() || e.question : null;
      prev.push({ question: e.heardQuestion ?? e.question, answer: e.answer ?? null, block: e.meta.block });
    }
  }
  console.log(JSON.stringify({ file, questions, fallback, flagged, counts }));
}
