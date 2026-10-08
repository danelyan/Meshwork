// Сборка resumes/ и labels/ из размеченных исходников _src/resumes/*.md.
// Разметка в исходнике:  [[catalogId|дословная цитата]]  — подтверждённое утверждение;
//                        ((catalogId|текст|почему не утверждение))  — ловушка (notClaim).
// Метаданные первой строкой: <!--meta spec=backend grade=junior-->.
// Запуск: node scripts/build-dataset.mjs  (без зависимостей)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '_src', 'resumes');
mkdirSync(join(root, 'resumes'), { recursive: true });
mkdirSync(join(root, 'labels'), { recursive: true });

// Сверка ID с каталогом (если файл найден): неизвестный ID — ошибка, кроме префикса none. (вне каталога).
const catalogPath = process.env.CLAIMS_CATALOG || join(root, '..', '..', '..', '..', 'docs', 'product', 'claims-catalog.md');
let known = null;
try {
  known = new Set([...readFileSync(catalogPath, 'utf8').matchAll(/^\| `((?:be|fe|common)\.[a-z0-9-]+)`/gm)].map((x) => x[1]));
} catch {}
const CATALOG_VERSION = known ? 'claims-catalog-draft-2026-10-09' : 'draft-pending';
let total = 0;
const ids = new Set();
const jobs = readdirSync(src).filter((x) => x.endsWith('.md')).sort().map((f) => ({ f, dir: src, kind: 'resume' }));
const demoSrc = join(root, '_src', 'demo');
for (const f of readdirSync(demoSrc).filter((x) => x.endsWith('.md')).sort()) jobs.push({ f, dir: demoSrc, kind: 'demo' });
for (const { f, dir, kind } of jobs) {
  const id = f.replace(/\.md$/, '');
  let raw = readFileSync(join(dir, f), 'utf8');
  const m = raw.match(/^<!--meta spec=(\w+) grade=(\w+)-->\n?/);
  if (!m) throw new Error(`${f}: нет meta`);
  raw = raw.slice(m[0].length);
  const claims = [];
  const notClaims = [];
  const fsp = [];
  let text = raw.replace(/\{\{fsp\|(.+?)\}\}/g, (_, q) => {
    fsp.push({ quote: q });
    return q;
  });
  text = text.replace(/\[\[([a-z]+\.[a-z0-9-]+)\|(.+?)\]\]/g, (_, cid, q) => {
    claims.push({ catalogId: cid, quote: q });
    return q;
  });
  text = text.replace(/\(\(([a-z]+\.[a-z0-9-]+)\|(.+?)\|(.+?)\)\)/g, (_, cid, t, why) => {
    notClaims.push({ catalogId: cid, mention: t, why });
    return t;
  });
  if (/\[\[|\]\]|\(\(|\)\)/.test(text)) throw new Error(`${f}: незакрытая разметка`);
  for (const c of claims) {
    if (!text.includes(c.quote)) throw new Error(`${f}: цитата не подстрока: ${c.quote}`);
    if (c.quote.includes('\n')) throw new Error(`${f}: цитата с переводом строки`);
    ids.add(c.catalogId);
  }
  for (const c of notClaims) ids.add(c.catalogId);
  if (known) for (const cid of [...claims, ...notClaims].map((c) => c.catalogId)) if (!cid.startsWith('none.') && !known.has(cid)) throw new Error(`: ID вне каталога: `);
  if (text.trim() === '') text = '\n';
  const outDir = kind === 'demo' ? join(root, 'demo', id) : null;
  if (outDir) mkdirSync(outDir, { recursive: true });
  writeFileSync(kind === 'demo' ? join(outDir, 'resume.md') : join(root, 'resumes', `${id}.md`), text);
  const label = {
    id,
    specialization: m[1],
    gradeExpected: m[2],
    catalogVersion: CATALOG_VERSION,
    claims,
    notClaims,
    ...(fsp.length ? { fspAchievements: fsp } : {}),
  };
  writeFileSync(kind === 'demo' ? join(outDir, 'label.json') : join(root, 'labels', `${id}.json`), JSON.stringify(label, null, 2) + '\n');
  total++;
}
console.log(`resumes: ${total}; catalogIds: ${[...ids].sort().join(', ')}`);
