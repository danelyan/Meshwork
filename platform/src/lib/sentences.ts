/**
 * Реплика ИИ → предложения для озвучки и перебивания. Общий модуль клиента и сервера: клиент озвучивает
 * реплику по предложениям и считает, сколько прозвучало; сервер по тому же разбиению обрезает реплику
 * до услышанного (POST /api/call/{id}/interrupt). Разбиение детерминировано – счёт сходится.
 * Принцип – moko/backend/app/meetup/sentences.py: короткие куски клеятся к следующему, длинный текст
 * без знаков конца предложения режется принудительно.
 */

/** Предложение короче – клеим к следующему: «Да.» отдельным вызовом TTS не окупается. */
export const MIN_SENTENCE_CHARS = 12;
/** Кусок без знаков конца предложения длиннее – режем по последнему пробелу. */
export const MAX_SENTENCE_CHARS = 160;

const BOUNDARY_RE = /(?<=[.!?…])\s+/u;

/**
 * Сокращения, после которых предложение не кончается никогда: «т.е.», «т.к.», «напр.», «см.», одиночная буква
 * с точкой («т. е.» без пробела режется на «т.» и «е.»). «т.д.», «т.п.», «др.» могут стоять в конце фразы –
 * их склеивает только правило строчной буквы ниже.
 */
const NEVER_FINAL_RE = /(?:^|[\s(«"])(?:т\.\s?е|т\.\s?к|т\.\s?н|напр|см|ср|им|г|ул|[а-яё])\.$/iu;
/** Следующий кусок со строчной буквы – это продолжение предложения («и т.д. и всё такое»). */
const LOWER_START_RE = /^[a-zа-яё]/u;

/** Куски между концами предложений с учётом сокращений; последний может быть недописан (поток). */
function rawParts(text: string): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(BOUNDARY_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (NEVER_FINAL_RE.test(prev) || LOWER_START_RE.test(p))) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

/** Клейка коротких кусков (буфер) и принудительная резка длинных: общая для полной и потоковой нарезки. */
function group(parts: readonly string[]): { out: string[]; buf: string } {
  const out: string[] = [];
  let buf = '';
  for (const p of parts) {
    buf = buf ? `${buf} ${p}` : p;
    if (buf.length >= MIN_SENTENCE_CHARS) {
      out.push(...forceSplit(buf));
      buf = '';
    }
  }
  return { out, buf };
}

export function splitSentences(text: string): string[] {
  const { out, buf } = group(rawParts(text));
  if (buf) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${buf}`;
    else out.push(buf);
  }
  return out;
}

/**
 * Потоковая нарезка: предложения начала недописанного текста, которые уже не изменятся, сколько бы текста ни
 * пришло дальше. Гарантия: результат – всегда префикс `splitSentences(prefix + любое продолжение)`, поэтому
 * клиент, озвучивший их до прихода всей реплики, считает услышанное так же, как сервер (POST /interrupt).
 * Последний кусок считается недописанным (за концом предложения ещё не было пробела и следующего слова), а
 * последнее готовое предложение отдаётся, только когда хвост уже не короче MIN_SENTENCE_CHARS – иначе
 * короткий хвост в конце реплики приклеился бы к нему.
 */
export function stableSentences(prefix: string): string[] {
  const parts = rawParts(prefix);
  const pending = parts.pop() ?? '';
  const { out, buf } = group(parts);
  const tail = buf ? `${buf} ${pending}`.trim() : pending;
  return tail.length >= MIN_SENTENCE_CHARS ? out : out.slice(0, -1);
}

function forceSplit(s: string): string[] {
  if (s.length <= MAX_SENTENCE_CHARS) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_SENTENCE_CHARS);
    const at = cut > MAX_SENTENCE_CHARS / 2 ? cut : MAX_SENTENCE_CHARS;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Услышанная часть реплики: первые `heard` предложений. */
export function heardPrefix(text: string, heard: number): { heard: string; tail: string; total: number } {
  const s = splitSentences(text);
  const n = Math.max(0, Math.min(heard, s.length));
  return { heard: s.slice(0, n).join(' '), tail: s.slice(n).join(' '), total: s.length };
}

/** Пометка перебитой реплики в транскрипте (как в moko: «…(перебит)»). */
export const INTERRUPTED_MARK = '…(перебит)';
export const UNHEARD_MARK = '…(не прозвучало: кандидат заговорил раньше)';

/** Короткие поддакивания: такое «перебивание» – не ответ, озвучка продолжается (moko director fast-path). */
const BACKCHANNEL = new Set(['угу', 'ага', 'да', 'да-да', 'ну да', 'ок', 'окей', 'хм', 'мм', 'понял', 'поняла', 'понятно', 'ясно', 'хорошо', 'так', 'продолжай', 'продолжайте', 'дальше', 'угу-угу', 'ясно-ясно']);
const BACKCHANNEL_MAX_CHARS = 18;

export function isBackchannel(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s-]+/gu, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > BACKCHANNEL_MAX_CHARS) return false;
  return BACKCHANNEL.has(t) || t.split(' ').every((w) => BACKCHANNEL.has(w));
}

/** Жёсткое перебивание: команда замолчать, а не ответ – перебивает Киру всегда и не уходит ходом. */
const HARD_INTERRUPT = new Set(['стоп', 'стой', 'стойте', 'подожди', 'подождите', 'погоди', 'погодите', 'хватит', 'не надо', 'не нужно', 'секунду', 'минуту', 'помолчи', 'тише', 'перестань']);

export function isHardInterrupt(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (HARD_INTERRUPT.has(t)) return true;
  const [a = '', b] = t.split(' ');
  return HARD_INTERRUPT.has(a) || (b !== undefined && HARD_INTERRUPT.has(`${a} ${b}`));
}
