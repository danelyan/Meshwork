// Детерминированный ответ заглушки для ИИнтервью (purpose interview_interviewer): разбирает тот же JSON
// `<call_context>`, что видит модель; сигнал — эвристика по длине ответа, вопрос — шаблон по плану кода.
import type { InterviewerPayload } from '../../interview/interviewer';
import { templateInterviewQuestion } from '../../interview/plan';
import { competencyById } from '../../interview/model';
import { heuristicSignal } from '../../call/plan';
import { parseContextBlock } from '../../call/prompt-utils';
import type { QuestionLevel } from '../../call/types';
import type { ChatMessage, CompleteRequest } from '../types';

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return messages[i]!.content;
  return '';
}

export function stubInterviewInterviewer(req: CompleteRequest): { kind: 'json'; json: unknown } | undefined {
  const p = parseContextBlock<InterviewerPayload>(lastUserText(req.messages));
  if (!p) return undefined;
  const last = p.turns[p.turns.length - 1];
  const signal = last ? heuristicSignal(last.answer) : 'none';
  const planned = signal === 'strong' ? p.next.ifStrong : signal === 'weak' ? p.next.ifWeak : p.next.ifNone;
  const c = competencyById(planned.competencyId);
  const level = planned.level as QuestionLevel;
  const block = planned.block === 'summary' ? 'test' : planned.block;
  const question = c ? templateInterviewQuestion(c, block, level, p.turns.length === 0) : `Расскажи подробнее про «${planned.title}».`;
  return {
    kind: 'json',
    json: { answerSignal: signal, competencyId: planned.competencyId, question: `[stub] ${p.next.probe ? 'Ещё вопрос. ' : ''}${question}`, done: planned.done },
  };
}
