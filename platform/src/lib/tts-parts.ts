/**
 * Реплика ИИ → части для озвучки (/api/tts): общий модуль комнаты ИИнтервью (useSentenceSpeech) и панели созвона
 * консультанта (components/call/useReplySpeech). Разбиение — то же, что у сервера (splitSentences по сырому
 * тексту), чтобы счёт услышанного сходился с POST /interrupt; чистка для синтеза — по каждому предложению.
 */
import { splitSentences } from './sentences';
import { speechText } from './speech-text';

/** Предложений на реплику в очереди TTS — не больше: лимит /api/tts — 20 запросов в минуту на сессию. */
export const MAX_TTS_PARTS = 4;

export interface TtsPart {
  /** Текст для синтеза (очищенный). */
  text: string;
  /** Сколько предложений сервера (lib/sentences.ts по сырому тексту) входит в часть. */
  sentences: number;
}

/** Предложения → не больше maxParts частей: при избытке соседние склеиваются, счёт предложений сохраняется. */
export function groupParts(raw: readonly string[], maxParts = MAX_TTS_PARTS): TtsPart[] {
  const per = Math.max(1, Math.ceil(raw.length / Math.max(1, maxParts)));
  const out: TtsPart[] = [];
  for (let i = 0; i < raw.length; i += per) {
    const group = raw.slice(i, i + per);
    out.push({ text: group.map((s) => speechText(s)).filter(Boolean).join(' '), sentences: group.length });
  }
  return out;
}

/** Реплика → части для озвучки (не больше MAX_TTS_PARTS). */
export function ttsParts(text: string): TtsPart[] {
  return groupParts(splitSentences(text));
}

/** Сколько предложений сервера прозвучало, если начали звучать первые `parts` частей. */
export function sentencesHeard(list: readonly TtsPart[], parts: number): number {
  return list.slice(0, Math.max(0, parts)).reduce((s, p) => s + p.sentences, 0);
}

export const keyOf = (index: number, part: number) => `u${index}:${part}`;
export function parseKey(key: string | null): { index: number; part: number } | null {
  const m = key && /^u(\d+):(\d+)$/.exec(key);
  return m ? { index: Number(m[1]), part: Number(m[2]) } : null;
}
