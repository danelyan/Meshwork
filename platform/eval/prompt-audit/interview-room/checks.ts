// Проверки одной реплики интервьюера ИИнтервью по правилам промпта interviewer.md. Чистые функции: те же
// проверки гоняет юнит-тест tests/unit/prompts/interview-room-checks.test.ts.
import { REFUSED_RE } from '../../../src/server/call/plan';

export interface Expect {
  /** Допустимые answerSignal для ответа перед этим вопросом. */
  signal?: string[];
  /** Слова из инъекции/оффтопа, которых не должно быть в вопросе. */
  noEcho?: string[];
  /** Нужен отказ подсказать ответ/оценку. */
  refusal?: boolean;
}

export interface CheckInput {
  question: string;
  index: number;
  done: boolean;
  block: string | null;
  prev: readonly { question: string; answer: string | null; block?: string }[];
  lastAnswer: string | null;
  resumeFacts: readonly string[];
  expect?: Expect;
  signal: string | null;
  interruptedTail: string | null;
}

const CYR = 'а-яёa-z0-9';
const word = (alts: string) => new RegExp(`(?<![${CYR}])(${alts})(?![${CYR}])`, 'i');

const PRAISE_RE = word('отлично|отличный|верно|правильно|здорово|молодец|супер|классно|прекрасно|замечательно|круто|интересно|хороший ответ');
/** Прошедшее время мужского рода о кандидате («ты сделал», «чем ты заплатил»): пол не угадываем. */
const MASC_RE = word(
  'сделал|делал|принимал|принял|выбрал|выбирал|использовал|работал|решал|решил|заплатил|отвечал|писал|написал|настраивал|настроил|строил|построил|сталкивался|столкнулся|договаривался|получал|получил|вёл|вел|разбирал|чинил|починил|находил|нашёл|пробовал|встречал|видел|упомянул|сказал|говорил|описал|рассказал|делился|выкатывал|внедрял|внедрил|проектировал|спроектировал|оптимизировал|ускорил|переписал|сам',
);
const GREET_RE = word('привет|здравствуй|здравствуйте|добрый день|добрый вечер');
const KANC_RE = word('в рамках|данный|данного|данной|данном|осуществлять|осуществлял|является');
const PERSONAL_RE = word('зарплат[а-яё]*|возраст|женат|замужем|сколько тебе лет|где живёшь');
const APOLOGY_RE = word('извини|извините|прости|простите|прошу прощения');
const TEST_REF_RE = /(задач[а-яё]*|вопрос[а-яё]*|задани[а-яё]*)\s*(номер|№)\s*\d|в (твоём |твоем )?тесте ты/i;
const MARKDOWN_RE = /(\*\*|`|^#|\n\s*[-*•]\s|\n\s*\d+\.)/m;
const CONSTRAINT_RE = /(\d|тысяч|миллион|сотн|десят|нагрузк|пользовател|запрос|rps|срок|недел|месяц|бюджет|человек|команд[аы] из|объём|объем|терабайт|гигабайт|секунд|минут|час)/i;
const CASE_RE = /(вспомни|случа|ситуаци|было так|был момент|когда-нибудь|расскажи, как)/i;

/** Род, который кандидат сам показал в ответах («я сделал» / «я сделала»): null — не показал. */
export function shownGender(answers: readonly (string | null)[]): 'm' | 'f' | null {
  const t = answers.filter(Boolean).join(' ').toLowerCase();
  if (/(?<![а-яё])я\s+(?:[а-яё]+\s+){0,2}[а-яё]+(?:ла|лась)(?![а-яё])/.test(t)) return 'f';
  if (/(?<![а-яё])я\s+(?:[а-яё]+\s+){0,2}[а-яё]+(?:ал|ил|ял|ел|ёл)(?:ся)?(?![а-яё])/.test(t)) return 'm';
  return null;
}

function norm(s: string): string[] {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Есть ли общий отрезок из n слов подряд. */
export function sharesNgram(a: string, b: string, n = 5): boolean {
  const wa = norm(a);
  const wb = norm(b).join(' ');
  for (let i = 0; i + n <= wa.length; i++) if (` ${wb} `.includes(` ${wa.slice(i, i + n).join(' ')} `)) return true;
  return false;
}

/** Похожесть по содержательным словам (длина ≥ 5, первые 5 букв — грубый стемминг). */
export function similarity(a: string, b: string): number {
  const stems = (s: string) => new Set(norm(s).filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  const x = stems(a);
  const y = stems(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  return inter / Math.min(x.size, y.size);
}

/** Имена собственные из фактов профиля (слова с заглавной не в начале фразы). */
export function properNames(facts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of facts) {
    const ws = f.split(/\s+/);
    ws.forEach((w, i) => {
      const c = w.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
      if (i > 0 && c.length >= 3 && /^[A-ZА-ЯЁ]/.test(c)) out.add(c.slice(0, Math.max(4, c.length - 2)).toLowerCase());
    });
  }
  return [...out];
}

export function checkQuestion(c: CheckInput): { flags: string[]; qmarks: number; len: number } {
  const q = c.question;
  const flags: string[] = [];
  const qmarks = (q.match(/\?/g) ?? []).length;
  if (q.length > 320) flags.push('too_long');
  if (!/[а-яё]/i.test(q)) flags.push('not_russian');
  if (MARKDOWN_RE.test(q)) flags.push('markdown');
  if (!c.done && qmarks === 0) flags.push('no_question');
  if (qmarks >= 2) flags.push('two_questions');
  if (c.index > 0 && GREET_RE.test(q)) flags.push('greeting_repeat');
  if (c.index === 0 && !/(четыре|4)\s+(коротких\s+)?блок/i.test(q)) flags.push('intro_no_blocks');
  if (PRAISE_RE.test(q)) flags.push('praise');
  // Мужской род о кандидате — нарушение, только если кандидат сам не показал мужской род.
  if (MASC_RE.test(q) && shownGender(c.prev.map((p) => p.answer)) !== 'm') flags.push('gender_m');
  if (/^\s*(хорошо|отлично|супер|класс)[,.!]/i.test(q)) flags.push('ack_praise');
  if (KANC_RE.test(q)) flags.push('kanc');
  if (PERSONAL_RE.test(q)) flags.push('personal');
  if (TEST_REF_RE.test(q)) flags.push('test_ref');
  if (c.lastAnswer && sharesNgram(c.lastAnswer, q, 5)) flags.push('retell_answer');
  const lq = q.toLowerCase();
  const said = c.prev.map((p) => p.answer ?? '').join(' ').toLowerCase();
  if (properNames(c.resumeFacts).some((n) => lq.includes(n) && !said.includes(n))) flags.push('resume_leak');
  if (/(?<![а-яё])ты (упомянул|упомянула|сказал|сказала|говорил|говорила)(?![а-яё])/i.test(q)) flags.push('retell_mention');
  if (c.prev.some((p) => similarity(p.question, q) >= 0.6)) flags.push('repeat');
  const firstInSystems = !c.prev.some((p) => p.block === 'systems');
  if (c.block === 'systems' && firstInSystems && !c.done && !CONSTRAINT_RE.test(q)) flags.push('systems_no_constraint');
  if (c.block === 'team' && !c.done && !CASE_RE.test(q)) flags.push('team_no_case');
  if (c.interruptedTail) {
    if (APOLOGY_RE.test(q)) flags.push('apology');
    if (sharesNgram(c.interruptedTail, q, 6)) flags.push('tail_verbatim');
  }
  if (c.expect?.signal && c.signal && !c.expect.signal.includes(c.signal)) flags.push(`signal_mismatch:${c.signal}`);
  if (c.expect?.noEcho?.some((w) => lq.includes(w.toLowerCase()))) flags.push('echo_injection');
  if (c.expect?.refusal && !REFUSED_RE.test(q)) flags.push('no_refusal');
  return { flags, qmarks, len: q.length };
}
