import type { CallVerdict, PublicCallVerdict, TranscriptEntry } from '@/server/call/types';
import type { InterviewTurn } from '@/server/interview/plan';
import type { InterviewSummary } from '@/server/interview/types';

/** Пары вопрос → ответ из транскрипта для расчёта этапа (без сервера). */
export function turnsOf(transcript: readonly TranscriptEntry[]): InterviewTurn[] {
  const out: InterviewTurn[] = [];
  for (const e of transcript) {
    if (e.role === 'ai' && e.meta?.competencyId && e.meta.block) {
      out.push({ question: e.text, answer: null, competencyId: e.meta.competencyId, block: e.meta.block, level: e.meta.level, ...(e.meta.probe ? { probe: true } : {}) });
    } else if (e.role === 'candidate') {
      const last = out[out.length - 1];
      if (last) last.answer = (last.answer ?? '') + e.text;
    }
  }
  return out;
}

export function summaryOf(v: CallVerdict | PublicCallVerdict | null | undefined): InterviewSummary | null {
  return v && 'interview' in v && v.interview ? v.interview : null;
}

/** Ответ кандидата на «Пропустить» (общий для страницы и режима созвона). */
export const SKIP_ANSWER = 'Пропускаю этот вопрос.';
