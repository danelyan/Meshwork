// Генерация PDF из Markdown-резюме без зависимостей: PDF 1.4, шрифт TrueType встраивается
// (кириллица, ToUnicode для корректного извлечения текста). Скрытый текст атак – белый, 1 пт.
//
// Шрифт не хранится в репозитории (лицензия): укажите --font /путь/к/Font.ttf или переменную
// EVAL_PDF_FONT. По умолчанию ищутся Arial (macOS) и DejaVu/Liberation (Linux).
// Запуск: node scripts/make-pdfs.mjs [--font FILE] [--out DIR]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const outDir = opt('--out') || join(root, 'pdf');
const fontPath = [opt('--font'), process.env.EVAL_PDF_FONT,
  '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf']
  .find((p) => p && existsSync(p));
if (!fontPath) { console.error('Не найден TTF-шрифт с кириллицей: --font FILE или EVAL_PDF_FONT'); process.exit(1); }

// ---- разбор TTF (head, hhea, hmtx, cmap format 4) ----
const ttf = readFileSync(fontPath);
const tables = {};
for (let i = 0, n = ttf.readUInt16BE(4); i < n; i++) {
  const o = 12 + i * 16;
  tables[ttf.toString('latin1', o, o + 4)] = { off: ttf.readUInt32BE(o + 8), len: ttf.readUInt32BE(o + 12) };
}
const head = tables.head.off, hhea = tables.hhea.off;
const upm = ttf.readUInt16BE(head + 18);
const sc = (v) => Math.round((v * 1000) / upm);
const bbox = [ttf.readInt16BE(head + 36), ttf.readInt16BE(head + 38), ttf.readInt16BE(head + 40), ttf.readInt16BE(head + 42)].map(sc);
const ascent = sc(ttf.readInt16BE(hhea + 4)), descent = sc(ttf.readInt16BE(hhea + 6));
const nHM = ttf.readUInt16BE(hhea + 34);
const advance = (gid) => sc(ttf.readUInt16BE(tables.hmtx.off + Math.min(gid, nHM - 1) * 4));
const cmap = new Map();
{
  const base = tables.cmap.off;
  let sub = -1;
  for (let i = 0, n = ttf.readUInt16BE(base + 2); i < n; i++) {
    const o = base + 4 + i * 8;
    if (ttf.readUInt16BE(o) === 3 && ttf.readUInt16BE(o + 2) === 1) sub = base + ttf.readUInt32BE(o + 4);
  }
  if (sub < 0 || ttf.readUInt16BE(sub) !== 4) throw new Error('нужен cmap (3,1) format 4');
  const segX2 = ttf.readUInt16BE(sub + 6), endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = ttf.readUInt16BE(endO + s * 2), start = ttf.readUInt16BE(startO + s * 2);
    const delta = ttf.readInt16BE(deltaO + s * 2), ro = ttf.readUInt16BE(rangeO + s * 2);
    for (let c = start; c <= end && c < 0xffff; c++) {
      let g = ro === 0 ? (c + delta) & 0xffff : ttf.readUInt16BE(rangeO + s * 2 + ro + (c - start) * 2);
      if (g && ro !== 0) g = (g + delta) & 0xffff;
      if (g) cmap.set(c, g);
    }
  }
}
const gidOf = (ch) => cmap.get(ch.codePointAt(0)) ?? cmap.get(0x3f) ?? 0;
const used = new Map(); // gid -> unicode
const hex = (s) => [...s].map((ch) => { const g = gidOf(ch); used.set(g, ch.codePointAt(0)); return g.toString(16).padStart(4, '0'); }).join('');
const width = (s, pt) => ([...s].reduce((a, ch) => a + advance(gidOf(ch)), 0) * pt) / 1000;

// ---- Markdown -> строки ----
function toBlocks(md) {
  const out = [];
  for (let raw of md.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    let pt = 10, text = raw.trimEnd(), gap = 0;
    const h = text.match(/^(#{1,6})\s+(.*)$/);
    if (h) { pt = h[1].length === 1 ? 16 : h[1].length === 2 ? 13 : 11; text = h[2]; gap = 6; }
    else if (/^\s*[-*•]\s+/.test(text)) text = '• ' + text.replace(/^\s*[-*•]\s+/, '');
    else if (/^---+$/.test(text.trim())) text = '';
    text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    out.push({ text, pt, gap });
  }
  return out;
}
function layout(blocks, hidden) {
  const W = 595, H = 842, M = 50, maxW = W - 2 * M;
  const pages = [[]];
  let y = H - M;
  const put = (text, pt, color) => {
    const lh = pt * 1.3;
    if (y - lh < M && color === 'k') { pages.push([]); y = H - M; }
    y -= lh;
    pages.at(-1).push({ text, pt, y, color });
  };
  for (const b of blocks) {
    y -= b.gap;
    if (b.text === '') { y -= 6; continue; }
    let line = '';
    for (const word of b.text.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (width(t, b.pt) > maxW && line) { put(line, b.pt, 'k'); line = '  ' + word; } else line = t;
    }
    if (line) put(line, b.pt, 'k');
  }
  if (hidden) put(hidden, 1, 'w'); // белый, 1 пт: невидим глазу, виден экстрактору
  return pages;
}

// ---- сборка PDF ----
function buildPdf(pages) {
  used.clear();
  const objs = [];
  const add = (b) => objs.push(b) && objs.length;
  const streamObj = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
  const contents = pages.map((p) => {
    const ops = p.map((l) => `${l.color === 'w' ? '1 1 1' : '0 0 0'} rg BT /F1 ${l.pt} Tf 50 ${l.y.toFixed(2)} Td <${hex(l.text)}> Tj ET`).join('\n');
    return deflateSync(Buffer.from(ops, 'latin1'));
  });
  // 1 Catalog, 2 Pages, 3 Type0, 4 CIDFont, 5 Descriptor, 6 FontFile2, 7 ToUnicode, затем страницы
  const nPages = pages.length, firstPage = 8;
  add(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'));
  add(Buffer.from(`<< /Type /Pages /Count ${nPages} /Kids [${pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>`));
  add(Buffer.from('<< /Type /Font /Subtype /Type0 /BaseFont /EvalFont /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 7 0 R >>'));
  const ws = [...used.keys()].sort((a, b) => a - b).map((g) => `${g} [${advance(g)}]`).join(' ');
  add(Buffer.from(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /EvalFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /CIDToGIDMap /Identity /DW 600 /W [${ws}] >>`));
  add(Buffer.from(`<< /Type /FontDescriptor /FontName /EvalFont /Flags 4 /FontBBox [${bbox.join(' ')}] /ItalicAngle 0 /Ascent ${ascent} /Descent ${descent} /CapHeight ${ascent} /StemV 80 /FontFile2 6 0 R >>`));
  add(streamObj(`/Filter /FlateDecode /Length1 ${ttf.length}`, deflateSync(ttf)));
  const bf = [...used.entries()].sort((a, b) => a[0] - b[0]).map(([g, u]) => `<${g.toString(16).padStart(4, '0')}> <${g.toString(16).padStart(4, '0')}> <${u.toString(16).padStart(4, '0')}>`);
  const chunks = []; for (let i = 0; i < bf.length; i += 100) chunks.push(`${Math.min(100, bf.length - i)} beginbfrange\n${bf.slice(i, i + 100).join('\n')}\nendbfrange`);
  const cm = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
  add(streamObj('/Filter /FlateDecode', deflateSync(Buffer.from(cm))));
  for (let i = 0; i < nPages; i++) {
    add(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`));
    add(streamObj('/Filter /FlateDecode', contents[i]));
  }
  const parts = [Buffer.from('%PDF-1.4\n')], offs = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => { offs.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); parts.push(b); pos += b.length; });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

// ---- что генерируем ----
const jobs = [];
for (const f of readdirSync(join(root, 'resumes')).filter((x) => x.endsWith('.md'))) jobs.push({ name: f.replace(/\.md$/, ''), md: join(root, 'resumes', f) });
for (const f of readdirSync(join(root, 'attacks')).filter((x) => /^atk-resume-\d\.md$/.test(x))) jobs.push({ name: f.replace(/\.md$/, ''), md: join(root, 'attacks', f), meta: join(root, 'attacks', f.replace(/\.md$/, '.meta.json')) });
for (const d of readdirSync(join(root, 'demo'))) if (existsSync(join(root, 'demo', d, 'resume.md'))) jobs.push({ name: d, md: join(root, 'demo', d, 'resume.md'), meta: join(root, 'demo', d, 'hidden.json') });
mkdirSync(outDir, { recursive: true });
for (const j of jobs) {
  const meta = j.meta && existsSync(j.meta) ? JSON.parse(readFileSync(j.meta, 'utf8')) : {};
  const pdf = buildPdf(layout(toBlocks(readFileSync(j.md, 'utf8')), meta.hidden ? meta.hiddenText : ''));
  writeFileSync(join(outDir, `${j.name}.pdf`), pdf);
}
console.log(`PDF: ${jobs.length} -> ${outDir} (шрифт ${fontPath})`);
