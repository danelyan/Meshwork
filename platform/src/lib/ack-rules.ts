import { isBackchannel } from './sentences';

/**
 * Когда Кире стоит мгновенно отреагировать на фразу кандидата («Та-ак…», «Угу…»), пока идут STT + LLM + TTS.
 * Лишние поддакивания хуже тишины (uncanny valley), поэтому у «listen» вероятность ниже, а многие фразы — null.
 */
export interface AckDecision {
  kind: 'think' | 'listen' | null;
  p: number;
  why: string;
}

const no = (why: string): AckDecision => ({ kind: null, p: 0, why });

const QUESTION_START = /^(что|как|почему|зачем|сколько|можно|а если|какой|какая|какие|какое|где|когда|кто|ли|есть ли|правда ли|расскажи|объясни)(?=\s|$)/;
const LINK_CHECK = ['алло', 'вы тут', 'ты тут', 'слышно', 'слышите', 'слышишь', 'на связи', 'меня слышн'];
const FAREWELL = ['до свидания', 'всего доброго', 'пока пока', 'всего хорошего', 'до связи'];
const THANKS = ['спасибо', 'спасибо большое', 'большое спасибо', 'благодарю'];
const GREETING = new Set(['здравствуйте', 'здрасте', 'привет', 'добрый', 'доброе', 'день', 'вечер', 'утро']);
const STOP = ['стоп', 'хватит', 'подожди', 'погоди', 'не надо', 'остановись'];

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s?-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyAck(text: string): AckDecision {
  const t = norm(text);
  if (!t) return no('пусто');
  const q = t.includes('?');
  const plain = t.replace(/\?/g, '').replace(/\s+/g, ' ').trim();
  const words = plain.split(' ').filter(Boolean);
  const n = words.length;
  if (n === 0) return no('пусто');

  if (n <= 5 && LINK_CHECK.some((s) => plain.includes(s))) return no('проверка связи');
  if (FAREWELL.some((s) => (n <= 6 && plain.includes(s)) || plain.endsWith(s))) return no('прощание');
  if (!q && THANKS.some((s) => plain.endsWith(s))) return no('благодарность');
  if (words.every((w) => GREETING.has(w))) return no('приветствие');
  if (!q && STOP.some((s) => plain === s || plain.startsWith(`${s} `) || plain.endsWith(` ${s}`))) return no('стоп-команда');
  if (n === 1 && isBackchannel(plain)) return no('поддакивание');

  if (q || QUESTION_START.test(plain)) return { kind: 'think', p: 0.8, why: 'вопрос' };
  return { kind: 'listen', p: n >= 6 ? 0.6 : 0.35, why: n >= 6 ? 'длинная реплика' : 'короткая реплика' };
}
