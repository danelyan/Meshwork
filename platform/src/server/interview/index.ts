// ИИнтервью (docs/competency-model.md): вид созвона `interview` на инфраструктуре call. Импорт модуля
// регистрирует драйвер (driver.ts) — call/index.ts импортирует его ради этого побочного эффекта.
export * from './model';
export * from './types';
export { INTERVIEW_LIMITS, QUESTION_BLOCKS, planInterviewNext, templateInterviewQuestion, stageOf, blockCounts, currentBlock, type InterviewTurn, type BlockPlan } from './plan';
export { buildInterviewSummary, interviewSummaryText, gradeFitLabel, gradeFitText, gradeFitShare, overallScore, INTERVIEW_MODEL_VERSION, INTERVIEW_DISCLAIMER, GRADE_FIT_BANDS } from './verdict';
export { loadInterviewContext, buildBlockPlan, testHintsFrom, orderTestBlock, type InterviewContext, type TestHint } from './context';
export { interviewDriver, interviewTurns } from './driver';
