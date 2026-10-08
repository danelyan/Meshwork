import type { RawLine } from './doc';
import type { RawPdfItem, RawPdfPage } from './parse-worker';

/**
 * Скрытый текст в PDF (research/10 § 4.6): то, что видит экстрактор, но не видит
 * человек. Признаки на элемент getTextContent:
 *  - цвет заливки белый/почти белый, альфа ≈ 0 или режим отрисовки 3/7 (невидимый) —
 *    считает поток разбора по операторам pdf.js (`inv` — доля таких глифов);
 *  - кегль < 4 пт (масштаб из transform, как `fontSize` в unpdf.extractTextItems);
 *  - точка начала вне видимой области страницы.
 * Белый текст на тёмной плашке тоже попадёт сюда (фон не анализируем) — это
 * ложноположительный случай, но безопасный: строка просто не станет цитатой.
 */
export const MIN_VISIBLE_FONT_PT = 4;
export const INVISIBLE_SHARE = 0.5;

export type HiddenReason = 'color' | 'tiny' | 'offpage';

export function itemFontSize(t: number[]): number {
  const c = t[2] ?? 0;
  const d = t[3] ?? 0;
  return Math.hypot(c, d);
}

export function hiddenReason(item: RawPdfItem, view: number[]): HiddenReason | null {
  if (item.inv >= INVISIBLE_SHARE) return 'color';
  const size = itemFontSize(item.t);
  if (size > 0 && size < MIN_VISIBLE_FONT_PT) return 'tiny';
  const [x0 = 0, y0 = 0, x1 = 612, y1 = 792] = view;
  const x = item.t[4] ?? 0;
  const y = item.t[5] ?? 0;
  const margin = Math.max(size, 1);
  if (x > x1 + margin || x < x0 - 2000 || y > y1 + margin || y < y0 - margin) return 'offpage';
  return null;
}

interface Seg {
  text: string;
  hidden: boolean;
}

/**
 * Элементы страниц → строки `file#pN:lM`. Строка разрывается по `hasEOL` или по смене
 * базовой линии; внутри строки соседние куски с разной видимостью становятся
 * отдельными строками, чтобы скрытое не «приклеилось» к видимой цитате.
 */
export function pdfPagesToLines(pages: RawPdfPage[], filename: string): RawLine[] {
  const out: RawLine[] = [];
  pages.forEach((page, pi) => {
    let lineNo = 0;
    let segs: Seg[] = [];
    let baseline: number | null = null;

    const flush = () => {
      // склеиваем соседние куски одинаковой видимости
      const merged: Seg[] = [];
      for (const s of segs) {
        const last = merged.at(-1);
        if (last && last.hidden === s.hidden) last.text += s.text;
        else merged.push({ ...s });
      }
      for (const m of merged) {
        const text = m.text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        lineNo += 1;
        out.push({ ref: `${filename}#p${pi + 1}:l${lineNo}`, text, ...(m.hidden ? { hidden: true } : {}) });
      }
      segs = [];
      baseline = null;
    };

    for (const item of page.items) {
      const y = item.t[5] ?? 0;
      const size = itemFontSize(item.t) || 10;
      if (item.s.trim() !== '') {
        if (baseline !== null && Math.abs(y - baseline) > size * 0.5) flush();
        if (baseline === null) baseline = y;
        segs.push({ text: item.s, hidden: hiddenReason(item, page.view) !== null });
      } else if (item.s.length > 0 && segs.length) {
        segs.push({ text: ' ', hidden: segs.at(-1)!.hidden });
      }
      if (item.eol) flush();
    }
    flush();
  });
  return out;
}
