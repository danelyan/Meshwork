import { HTMLElement, NodeType, parse, type Node } from 'node-html-parser';

import { buildDoc, type RawLine } from './doc';
import type { ExtractedDoc, SourceKind } from './types';

/**
 * Основной текст HTML-страницы: без script/style/шаблонов/форм, с разбиением на
 * строки по блочным элементам. Невидимое человеку (`hidden`, `aria-hidden`,
 * `display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`/< 4px, прозрачный
 * цвет, вынос за экран, `clip`, правила из `<style>` по классу/id) — строки с
 * `hidden: true`; HTML-комментарии — во флаг скрытого текста. meta description,
 * атрибуты title/alt — только в проверку на инъекцию.
 */

const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'title', 'meta', 'link', 'svg', 'canvas', 'iframe', 'object', 'embed', 'head',
  'input', 'select', 'textarea', 'button', 'option', 'datalist', 'map', 'audio', 'video', 'math',
]);
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
  'html', 'br', 'caption',
]);

const px = (v: string): number | null => {
  const m = /^(-?\d*\.?\d+)(px|pt|em|rem|%|vw|vh)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'pt':
      return n * (4 / 3);
    case 'em':
    case 'rem':
      return n * 16;
    case undefined:
    case 'px':
      return n;
    default:
      return n === 0 ? 0 : null;
  }
};

/** Стиль (inline или из правила) прячет содержимое от глаза? */
export function hiddenByStyle(style: string): boolean {
  const decls = new Map<string, string>();
  for (const part of style.toLowerCase().split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    decls.set(part.slice(0, i).trim(), part.slice(i + 1).replace(/!important/, '').trim());
  }
  const get = (k: string) => decls.get(k) ?? '';
  if (get('display') === 'none') return true;
  if (['hidden', 'collapse'].includes(get('visibility'))) return true;
  const opacity = get('opacity');
  if (opacity && (opacity === '0' || Number(opacity.replace('%', '')) === 0)) return true;
  const fs = get('font-size');
  if (fs) {
    const v = px(fs);
    if (v !== null && v < 4) return true;
  }
  const color = get('color').replace(/\s+/g, '');
  if (color === 'transparent' || /^rgba\(.*,0(\.0+)?\)$/.test(color) || /^hsla\(.*,0(\.0+)?\)$/.test(color)) return true;
  if (/^#[0-9a-f]{6}00$|^#[0-9a-f]{3}0$/.test(color)) return true;
  const pos = get('position');
  if (pos === 'absolute' || pos === 'fixed') {
    for (const side of ['left', 'top', 'right', 'bottom']) {
      const v = px(get(side));
      if (v !== null && v <= -500) return true;
    }
  }
  const indent = px(get('text-indent'));
  if (indent !== null && indent <= -500) return true;
  const clip = get('clip').replace(/\s+/g, '');
  if (/^rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)$/.test(clip)) return true;
  if (/inset\(50%\)|circle\(0/.test(get('clip-path'))) return true;
  if (/scale\(0(\.0+)?\)/.test(get('transform'))) return true;
  const overflowHidden = get('overflow') === 'hidden';
  const w = px(get('width'));
  const h = px(get('height'));
  const mh = px(get('max-height'));
  if (overflowHidden && (w === 0 || h === 0 || (w !== null && w <= 1 && h !== null && h <= 1) || mh === 0)) return true;
  return false;
}

/** Простые правила из `<style>`: `.cls`, `#id`, `tag.cls` с прячущими декларациями. */
export function hiddenSelectors(css: string): { classes: Set<string>; ids: Set<string> } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of noComments.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!hiddenByStyle(m[2]!)) continue;
    for (const sel of m[1]!.split(',')) {
      const s = sel.trim();
      const last = s.split(/[\s>+~]+/).pop() ?? '';
      if (/:(hover|focus|active|before|after)/.test(last)) continue;
      for (const c of last.matchAll(/\.([\w-]+)/g)) classes.add(c[1]!);
      for (const i of last.matchAll(/#([\w-]+)/g)) ids.add(i[1]!);
    }
  }
  return { classes, ids };
}

interface Seg {
  text: string;
  hidden: boolean;
}

const BREAK: Seg = { text: '\n', hidden: false };

export interface HtmlExtractOptions {
  sourceKind?: SourceKind;
  /** Префикс ссылок на строки; по умолчанию — сам URL. */
  refPrefix?: string;
  title?: string;
}

export function extractHtml(html: string, origin: string, opts: HtmlExtractOptions = {}): ExtractedDoc {
  const root = parse(html, {
    comment: true,
    lowerCaseTagName: true,
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  });
  const css = root
    .querySelectorAll('style')
    .map((s) => s.rawText)
    .join('\n');
  const rules = hiddenSelectors(css);
  const suspect: string[] = [];
  const comments: string[] = [];

  for (const meta of root.querySelectorAll('meta')) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase();
    if (/description|keywords|title|author/.test(name)) suspect.push(meta.getAttribute('content') ?? '');
  }

  const isHidden = (el: HTMLElement): boolean => {
    const a = el.attributes;
    if ('hidden' in a) return true;
    if ((a['aria-hidden'] ?? '').toLowerCase() === 'true') return true;
    if ((a['type'] ?? '').toLowerCase() === 'hidden') return true;
    if (a['style'] && hiddenByStyle(a['style'])) return true;
    if (a['id'] && rules.ids.has(a['id'])) return true;
    if (a['class'] && a['class'].split(/\s+/).some((c) => rules.classes.has(c))) return true;
    return false;
  };

  const segs: Seg[] = [];
  const walk = (node: Node, hidden: boolean) => {
    if (node.nodeType === NodeType.COMMENT_NODE) {
      const text = node.rawText.trim();
      if (!/^\[if|^\[endif|^<!\[endif/i.test(text)) comments.push(text);
      return;
    }
    if (node.nodeType === NodeType.TEXT_NODE) {
      segs.push({ text: node.text, hidden });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = (node.rawTagName ?? '').toLowerCase();
    if (SKIP.has(tag)) return;
    const a = node.attributes;
    for (const attr of ['title', 'alt', 'aria-label', 'data-instructions']) if (a[attr]) suspect.push(a[attr]);
    const h = hidden || isHidden(node);
    const block = BLOCK.has(tag);
    if (block) segs.push(BREAK);
    for (const child of node.childNodes) walk(child, h);
    if (block) segs.push(BREAK);
  };
  const body = root.querySelector('body') ?? root;
  walk(body, false);

  const prefix = opts.refPrefix ?? origin;
  const lines: RawLine[] = [];
  let lineNo = 0;
  let current: Seg[] = [];
  const flush = () => {
    const merged: Seg[] = [];
    for (const s of current) {
      const last = merged.at(-1);
      if (last && last.hidden === s.hidden) last.text += s.text;
      else merged.push({ ...s });
    }
    for (const m of merged) {
      const text = m.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lineNo += 1;
      lines.push({ ref: `${prefix}#l${lineNo}`, text, ...(m.hidden ? { hidden: true } : {}) });
    }
    current = [];
  };
  for (const s of segs) {
    if (s === BREAK) flush();
    else current.push(s);
  }
  flush();

  const meaningful = comments.filter((c) => (c.match(/\p{L}{2,}/gu) ?? []).length >= 3);
  const title =
    opts.title ?? (root.querySelector('title')?.text.trim() || root.querySelector('h1')?.text.trim() || origin);

  return buildDoc({
    sourceKind: opts.sourceKind ?? 'url',
    title,
    origin,
    lines,
    extraSuspectText: [...suspect, ...comments],
    extraHidden: meaningful.length ? { count: meaningful.length, sample: meaningful } : undefined,
  });
}

export interface MarkdownRaw {
  lines: RawLine[];
  suspect: string[];
  /** HTML-комментарии со смыслом (≥ 3 слов) — скрытый текст. */
  hidden: string[];
}

/**
 * Markdown (README) → строки `refPrefix:lN`. HTML-комментарии — скрытый текст (во флаг),
 * HTML-скрытое в строке — отдельная строка `…h` с hidden, title ссылок — только в
 * проверку на инъекцию. Разметка снимается.
 */
export function markdownToRaw(md: string, refPrefix: string): MarkdownRaw {
  const comments: string[] = [];
  const suspect: string[] = [];
  const stripped = md.replace(/<!--([\s\S]*?)-->/g, (_m, c: string) => {
    comments.push(c.trim());
    return '';
  });
  for (const m of stripped.matchAll(/\]\([^)\s]+\s+"([^"]+)"\)/g)) suspect.push(m[1]!);
  suspect.push(...comments);
  const lines: RawLine[] = [];
  const clean = (t: string) =>
    t
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/[*_`]{1,3}/g, '');
  stripped.split(/\r?\n/).forEach((raw, i) => {
    const ref = `${refPrefix}:l${i + 1}`;
    if (!/<[a-z][^>]*>/i.test(raw)) {
      lines.push({ ref, text: clean(raw) });
      return;
    }
    const doc = extractHtml(`<div>${raw}</div>`, refPrefix, { refPrefix: 'x' });
    suspect.push(...doc.lines.map((l) => l.text));
    lines.push({ ref, text: clean(doc.text.replace(/\n/g, ' ')) });
    const hiddenText = doc.lines.filter((l) => l.hidden).map((l) => l.text).join(' ');
    if (hiddenText) lines.push({ ref: `${ref}h`, text: hiddenText, hidden: true });
  });
  const hidden = comments.filter((c) => (c.match(/\p{L}{2,}/gu) ?? []).length >= 3);
  return { lines, suspect, hidden };
}

export function extractMarkdown(md: string, origin: string, refPrefix: string, sourceKind: SourceKind = 'github'): ExtractedDoc {
  const raw = markdownToRaw(md, refPrefix);
  return buildDoc({
    sourceKind,
    title: refPrefix,
    origin,
    lines: raw.lines,
    extraSuspectText: raw.suspect,
    extraHidden: raw.hidden.length ? { count: raw.hidden.length, sample: raw.hidden } : undefined,
  });
}
