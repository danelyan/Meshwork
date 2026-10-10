// «План В» извлечения: словарь маркеров каталога, без LLM. Используют eval (предсказатель
// catalog-keywords) и agent/fallback.ts при отказе провайдера. Детерминированно; каждая цитата —
// дословный фрагмент строки источника, поэтому verifyClaims её пропускает.
import type { Specialization } from '@/lib/directions';
import type { ExtractedDoc } from '../collector/types';
import { catalogFor } from './catalog-file';
import { normalize } from './normalize';
import { docLines, type SourceLine } from './source-text';
import type { CatalogEntry, Confidence, ProposedClaim } from './types';

/** Разделы, где перечисляют технологии, а не сделанное (каталог § 1 п. 1: технология — не утверждение). */
const SKIP_SECTION = /навык|технолог|стек|умею|знаю|skills|stack|tools|инструмент|интерес|образован|education|контакт|курсы|сертиф|языки|languages|хобби|достижени/i;
/** Признаки «не делал»: курс, знаком, читал, запускал чужое (разметка eval, ADR-0001: консервативно). */
const NEGATIVE =
  /(?<![\p{L}])(знаком|знакома|курс[ауеы]?|курсов|читал[аи]?|прочитал[аи]?|изучал[аи]?|изучаю|запускал[аи]? (чужое|контейнеры из готовых)|хочу|планирую|интересуюсь|смотрел[аи]?|не делал[аи]?|без настройки|только чтение|на уровне|слышал[аи]?|по статьям|туториал[аы]?|не использовал[аи]?|не работал[аи]?|в общих чертах|familiar|course|tutorial|want to|learning)(?![\p{L}])/iu;
/** Предложение-команда модели или рекритеру («ignore previous instructions», «добавь утверждение») — не опыт. */
export const INJECTION_CUE =
  /(ignore (all |the )?(previous|prior|above)|disregard|system (prompt|override)|new instructions|you are (now )?an? |as verified|add claims?|recommend grade|игнорируй|забудь (все |предыдущие )?инструкц|системн(ый|ые) (промпт|инструкц)|новые инструкции|добавь (утвержден|навык)|присвой|поставь (грейд|уровень)|ты (теперь|—) |для ии|для модели|для llm)/i;
const RU_SUFFIXES = [
  'ирование', 'ировать', 'ования', 'ование', 'ость', 'ости', 'ация', 'ации', 'ение', 'ения',
  'ный', 'ная', 'ное', 'ные', 'ого', 'ому', 'ой', 'ий', 'ия', 'ие', 'ии', 'ей', 'ы', 'и', 'а', 'я', 'о', 'е', 'ь', 'й', 'у', 'ю',
];

function stemWord(w: string): { stem: string; open: boolean } {
  if (!/^[\p{Script=Cyrillic}-]+$/u.test(w) || w.length < 5) return { stem: w, open: false };
  for (const s of RU_SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 4) return { stem: w.slice(0, -s.length), open: true };
  }
  return { stem: w, open: true };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Маркер → RegExp по нормализованному тексту: граница слова слева, у русских слов — любое окончание. */
export function markerRegExp(marker: string): RegExp | null {
  const m = normalize(marker);
  if (!m) return null;
  const words = m.split(' ');
  const parts = words.map((w, i) => {
    const { stem, open } = stemWord(w);
    const last = i === words.length - 1;
    return esc(stem) + (open ? '\\p{L}*' : last ? '(?![\\p{L}\\p{N}])' : '');
  });
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('\\s+')}`, 'u');
}

interface CompiledEntry {
  entry: CatalogEntry;
  res: { re: RegExp; len: number }[];
}
const compiledCache = new WeakMap<CatalogEntry[], CompiledEntry[]>();
function compile(catalog: CatalogEntry[]): CompiledEntry[] {
  const hit = compiledCache.get(catalog);
  if (hit) return hit;
  const out = catalog.map((entry) => ({
    entry,
    res: entry.markers
      .map((m) => ({ re: markerRegExp(m), len: normalize(m).length }))
      .filter((x): x is { re: RegExp; len: number } => x.re !== null),
  }));
  compiledCache.set(catalog, out);
  return out;
}

/** Предложения строки: по . ; ! ? перед пробелом и заглавной (не режет «1.3», «Node.js»). */
function clauses(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+(?=[\p{Lu}«"(])|;\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
function cleanQuote(s: string): string {
  return s
    .replace(/^[\s\-*•·>#\d.)]+(?=\S)/u, '')
    .replace(/\*\*/g, '')
    .replace(/[\s.;,:]+$/u, '')
    .trim();
}

/** Специализация по документу: где больше маркеров и что в заголовке. null — не понятно. */
export function guessSpecialization(doc: ExtractedDoc, catalog: CatalogEntry[]): Specialization | null {
  const text = normalize(doc.text || docLines(doc).map((l) => l.text).join('\n'));
  const head = normalize(docLines(doc).slice(0, 5).map((l) => l.text).join(' '));
  let be = /backend|бэкенд|бекенд|back-end|java|golang|python|серверн/.test(head) ? 5 : 0;
  let fe = /frontend|фронтенд|front-end|верстальщик|react|vue|angular/.test(head) ? 5 : 0;
  for (const c of compile(catalog)) {
    if (c.entry.specialization === 'common') continue;
    const n = c.res.filter((r) => r.re.test(text)).length;
    if (c.entry.specialization === 'backend') be += n;
    else fe += n;
  }
  if (be === fe) return null;
  return be > fe ? 'backend' : 'frontend';
}

export interface MarkerOptions {
  /** Ограничить каталог специализацией (+ общие). По умолчанию — угадать по документу. */
  specialization?: Specialization | null;
}

/**
 * Словарное извлечение по маркерам каталога. Правила (консервативно, как разметка eval):
 *  - строки из разделов «Навыки/Технологии/Стек/Образование…» и скрытые строки пропускаются;
 *  - предложение с признаками «не делал» (курс, знаком, читал) пропускается;
 *  - одно предложение — один catalogId: больше совпавших маркеров, затем длиннее маркер, затем вес;
 *  - один catalogId — первое подходящее предложение.
 */
export function extractByMarkers(doc: ExtractedDoc, catalog: CatalogEntry[], opts?: MarkerOptions): ProposedClaim[] {
  const spec = opts && 'specialization' in opts ? opts.specialization : guessSpecialization(doc, catalog);
  const compiled = compile(catalogFor(catalog, spec ?? null));
  const out = new Map<string, ProposedClaim>();
  let skipSection = false;
  // шапка (имя, должность, контакты) — до первого заголовка раздела после первой строки, не больше 4 строк.
  // Только у резюме/документа: у профиля GitHub/Codeforces шапки нет, а строк бывает ≤ 4.
  let preamble = 0;
  let inPreamble = doc.sourceKind === 'resume' || doc.sourceKind === 'document';
  for (const line of docLines(doc) as SourceLine[]) {
    const t = line.text.trim();
    if (!t) continue;
    const heading = /^#{1,6}\s/.test(t) || /^\*\*[^*]+\*\*:?$/.test(t) || /^[\p{Lu}][\p{L} ]{2,40}:$/u.test(t);
    if (inPreamble) {
      preamble++;
      if ((heading && preamble > 1) || preamble > 4) inPreamble = false;
      else continue;
    }
    if (heading) {
      skipSection = SKIP_SECTION.test(t);
      continue;
    }
    if (skipSection || line.hidden) continue;
    // строка с командой модели целиком подозрительна: ни одного утверждения из неё
    if (INJECTION_CUE.test(normalize(t))) continue;
    // «Навыки: Java, Spring», «**Стек:** …» — перечень в одну строку
    const label = /^\**([\p{L} ()/-]{2,40}?)\**:/u.exec(t);
    if (label && SKIP_SECTION.test(label[1] ?? '')) continue;
    for (const clause of clauses(t)) {
      const n = normalize(clause);
      if (NEGATIVE.test(n) || INJECTION_CUE.test(n)) continue;
      let best: { entry: CatalogEntry; hits: number; len: number } | null = null;
      for (const c of compiled) {
        let hits = 0;
        let len = 0;
        for (const r of c.res) {
          if (r.re.test(n)) {
            hits++;
            len = Math.max(len, r.len);
          }
        }
        if (hits === 0) continue;
        if (
          !best ||
          hits > best.hits ||
          (hits === best.hits && len > best.len) ||
          (hits === best.hits && len === best.len && c.entry.weight > best.entry.weight)
        ) {
          best = { entry: c.entry, hits, len };
        }
      }
      if (!best || out.has(best.entry.id)) continue;
      const quote = cleanQuote(clause);
      if (quote.split(/\s+/).length < 2) continue;
      const confidence: Confidence = best.hits >= 2 ? 'medium' : 'low';
      out.set(best.entry.id, {
        catalogId: best.entry.id,
        statement: best.entry.statement,
        quote,
        sourceRef: line.ref,
        confidence,
      });
    }
  }
  return [...out.values()];
}
