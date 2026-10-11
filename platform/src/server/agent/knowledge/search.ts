// Лексический поиск по базе знаний без эмбеддингов: нормализация, лёгкий стемминг русских
// окончаний, BM25 по секциям (заголовок весит вдвое). Корпус – десятки секций, индекс
// строится один раз при первом запросе.
import { KNOWLEDGE_DOCS } from './corpus';
import type { KnowledgeDoc, KnowledgeSection } from './parse';

/** Сколько секций отдаём модели и сколько символов текста в каждой. */
export const KNOWLEDGE_TOP = 3;
export const KNOWLEDGE_TEXT_MAX = 1200;

// Окончания от длинных к коротким; отрезаем одно, если остаётся основа ≥ 4 букв.
const ENDINGS = [...new Set([
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией', 'ией', 'иях', 'ах', 'ях',
  'ость', 'ости', 'ий', 'ый', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ия', 'ие', 'ию',
  'ем', 'ом', 'ам', 'ям', 'ов', 'ев', 'ей', 'ет', 'ит', 'ут', 'ют', 'ат', 'ят', 'ть', 'ться', 'тся',
  'ся', 'сь', 'ешь', 'ишь', 'ал', 'ил', 'ла', 'ли', 'ло', 'а', 'я', 'о', 'е', 'и', 'ы', 'у', 'ю', 'ь', 'й',
])].sort((a, b) => b.length - a.length);

/** Основа ограничена 6 буквами: «приглашение» и «пригласят» дают одно «пригла». */
const STEM_MAX = 6;

const STOP = new Set([
  'и', 'в', 'во', 'на', 'не', 'что', 'как', 'а', 'но', 'или', 'по', 'к', 'ко', 'с', 'со', 'у', 'о', 'об', 'от', 'до', 'за',
  'из', 'для', 'это', 'ли', 'же', 'бы', 'то', 'я', 'ты', 'мы', 'вы', 'он', 'она', 'они', 'мне', 'меня', 'мой', 'моя',
  'моё', 'мое', 'мои', 'моих', 'тебя', 'тебе', 'твой', 'есть', 'ещё', 'еще', 'уже', 'так', 'там', 'тут', 'при', 'если',
  'чтобы', 'можно', 'нужно', 'какой', 'какая', 'какие', 'какое', 'сколько', 'почему', 'зачем', 'где', 'когда', 'будет',
  'будут', 'всё', 'все', 'кто', 'чем', 'чего', 'его', 'её', 'их', 'the', 'a', 'an', 'of', 'to', 'in', 'is',
]);

/** Синонимы запроса → слова, которыми это написано в базе. */
const SYNONYMS: Record<string, string[]> = {
  премиум: ['платных', 'подписок', 'продвижения'],
  подписка: ['платных', 'продвижения'],
  отклик: ['откликов', 'откликается'],
  откликнуться: ['откликов', 'откликается'],
  рейтинг: ['место', 'подборке'],
  выдача: ['подборке', 'место'],
  выдаче: ['подборке', 'место'],
  грейд: ['категория', 'грейд'],
  экзамен: ['тест'],
  пересдать: ['пересдача', 'пересдать'],
  резюме: ['резюме', 'цитата'],
  гитхаб: ['репозиторий', 'артефакт'],
  github: ['репозиторий', 'артефакт'],
  email: ['почта', 'письма'],
  уведомления: ['писем', 'уведомлений'],
};

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е');
}

export function stem(word: string): string {
  const w = normalize(word);
  if (!/[а-я]/.test(w)) return w;
  let base = w;
  for (const e of ENDINGS) {
    if (w.endsWith(e) && w.length - e.length >= 4) {
      base = w.slice(0, -e.length);
      break;
    }
  }
  return base.slice(0, STEM_MAX);
}

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of normalize(text).matchAll(/[\p{L}\p{N}+#]+/gu)) {
    const w = m[0];
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

interface Indexed {
  section: KnowledgeSection;
  tf: Map<string, number>;
  len: number;
}

interface Index {
  items: Indexed[];
  df: Map<string, number>;
  avgLen: number;
}

export function buildIndex(docs: KnowledgeDoc[]): Index {
  const items: Indexed[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const s of d.sections) {
      // Заголовок секции и документа – дважды: попадание в заголовок важнее упоминания в тексте.
      const toks = [...tokens(s.title), ...tokens(s.title), ...tokens(d.title), ...tokens(s.text)];
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
      items.push({ section: s, tf, len: toks.length });
    }
  }
  const avgLen = items.reduce((a, b) => a + b.len, 0) / Math.max(1, items.length);
  return { items, df, avgLen };
}

let cached: Index | undefined;

export interface KnowledgeHit {
  docId: string;
  sectionId: string;
  title: string;
  text: string;
  score: number;
}

/** Текст секции не длиннее max: режется по границе предложения, если она недалеко. */
export function clip(text: string, max = KNOWLEDGE_TEXT_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const dot = cut.lastIndexOf('. ');
  return `${dot > max * 0.6 ? cut.slice(0, dot + 1) : cut}…`;
}

/** BM25 (k1 = 1,2, b = 0,75) по секциям; секции без единого общего слова не возвращаются. */
export function searchKnowledge(query: string, opts: { top?: number; docs?: KnowledgeDoc[] } = {}): KnowledgeHit[] {
  const index = opts.docs ? buildIndex(opts.docs) : (cached ??= buildIndex(KNOWLEDGE_DOCS));
  const raw = normalize(query).match(/[\p{L}\p{N}+#]+/gu) ?? [];
  const extra = raw.flatMap((w) => SYNONYMS[w] ?? []);
  const q = [...new Set([...tokens(query), ...extra.flatMap(tokens)])];
  if (!q.length) return [];
  const n = index.items.length;
  const k1 = 1.2;
  const b = 0.75;
  const scored = index.items.map((it) => {
    let score = 0;
    for (const t of q) {
      const f = it.tf.get(t);
      if (!f) continue;
      const df = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * it.len) / index.avgLen));
    }
    return { it, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, opts.top ?? KNOWLEDGE_TOP)
    .map(({ it, score }) => ({
      docId: it.section.docId,
      sectionId: it.section.sectionId,
      title: it.section.title,
      text: clip(it.section.text),
      score: Math.round(score * 100) / 100,
    }));
}
