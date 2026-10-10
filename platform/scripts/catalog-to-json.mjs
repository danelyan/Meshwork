#!/usr/bin/env node
// Конвертер каталога утверждений (Markdown владельца) → prisma/seed/claims-catalog.json.
// Перегенерировать после каждой правки каталога владельцем:
//   node scripts/catalog-to-json.mjs [путь/к/claims-catalog.md] [--check]
// По умолчанию ищет fsp/docs/product/claims-catalog.md выше по дереву.
// --check — не писать файл, а упасть, если JSON устарел (для CI/интегратора).
// Падает, если в таблице битая строка, повтор ID, неизвестный грейд/вес или
// ребро смежности ведёт на несуществующий ID.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const platform = resolve(here, '..');
const OUT = join(platform, 'prisma', 'seed', 'claims-catalog.json');

function findCatalog() {
  let dir = platform;
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'docs', 'product', 'claims-catalog.md');
    if (existsSync(p)) return p;
    dir = dirname(dir);
  }
  throw new Error('claims-catalog.md не найден: передайте путь аргументом');
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const srcPath = resolve(args.find((a) => !a.startsWith('--')) ?? findCatalog());
const md = readFileSync(srcPath, 'utf8');

const fail = (msg) => {
  throw new Error(`catalog-to-json: ${msg}`);
};
const cells = (line) => {
  const parts = line.trim().split('|');
  return parts.slice(1, -1).map((c) => c.trim());
};
const unTick = (s) => s.replace(/`/g, '').trim();
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());

function parseGrades(s, id) {
  if (s === 'J+M') return ['junior', 'middle'];
  if (s === 'J') return ['junior'];
  if (s === 'M') return ['middle'];
  return fail(`${id}: неизвестный грейд «${s}»`);
}
function parseWeightPair(s, id) {
  const m = /^(—|-|[1-3])\s*\/\s*(—|-|[1-3])$/.exec(s);
  if (!m) return fail(`${id}: вес «${s}» не вида J/M`);
  const v = (x) => (x === '—' || x === '-' ? null : Number(x));
  return { junior: v(m[1]), middle: v(m[2]) };
}
function parseStatement(s) {
  const m = /\s*`stack:\s*да`\s*(?:\(([^)]*)\))?\s*$/.exec(s);
  if (!m) return { statement: s.trim(), stack: null };
  return { statement: s.slice(0, m.index).trim().replace(/\.$/, ""), stack: { kind: (m[1] ?? '').trim() || null } };
}
function parseMarkers(s) {
  // запятые внутри скобок не делят маркер
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out
    .map((m) => m.replace(/[«»"`]/g, '').replace(/…/g, '').replace(/\.\.\./g, '').trim())
    .filter(Boolean);
}
function parseLimits(s) {
  const t = unTick(s).trim();
  if (!t) return '';
  // «Не доказывает: …» — колонка таблицы так и называется; первую букву строчной, кроме аббревиатур/латиницы
  const first = t[0];
  const second = t[1] ?? '';
  const keepCase = /[A-Za-z]/.test(first) || second === second.toUpperCase();
  // Префикс «Не доказывает:» добавляет UI — в данных его нет.
  return keepCase ? t : first.toLowerCase() + t.slice(1);
}

const lines = md.split('\n');
let header = null;
let section = null;
const entries = [];
const adjacency = [];
for (const line of lines) {
  if (/^##\s/.test(line)) {
    section = line;
    header = null;
  }
  if (!line.startsWith('|')) {
    header = line.trim() === '' ? header : null;
    continue;
  }
  const c = cells(line);
  if (c[0] === 'ID' || c[0] === 'Утверждение') {
    header = c;
    continue;
  }
  if (/^-+$/.test(c[0] ?? '')) continue;
  if (!header) continue;
  if (header[0] === 'Утверждение') {
    const from = unTick(c[0]);
    for (const to of ticks(c[1] ?? '')) adjacency.push([from, to]);
    continue;
  }
  if (header[0] !== 'ID') continue;
  const id = unTick(c[0]);
  const isCommon = header.length === 8;
  if (c.length !== header.length) fail(`${id}: ${c.length} колонок вместо ${header.length}`);
  const prefix = id.split('.')[0];
  // eng.* — раздел «Engineering» каталога-Markdown (лейн engineering, ADR 0003 дополнение 10.10).
  const specialization = { be: 'backend', fe: 'frontend', common: 'common', eng: 'engineering' }[prefix];
  if (!specialization) fail(`${id}: неизвестный префикс`);
  if (isCommon !== (specialization === 'common')) fail(`${id}: в таблице не своей специализации (${section})`);
  const parsed = parseStatement(c[1]);
  const statement = unTick(parsed.statement);
  const stack = parsed.stack;
  const grades = parseGrades(c[2], id);
  let weights;
  let rest;
  if (isCommon) {
    weights = { backend: parseWeightPair(c[3], id), frontend: parseWeightPair(c[4], id) };
    rest = c.slice(5);
  } else {
    weights = parseWeightPair(c[3], id);
    rest = c.slice(4);
  }
  const [proofCell, markersCell, limitsCell] = rest;
  const flat = isCommon
    ? [...Object.values(weights.backend), ...Object.values(weights.frontend)]
    : Object.values(weights);
  const nums = flat.filter((x) => x !== null);
  if (nums.length === 0) fail(`${id}: нет ни одного веса`);
  const proof = ticks(proofCell);
  if (proof.length === 0) fail(`${id}: нет пути доказательства`);
  entries.push({
    id,
    specialization,
    statement,
    grades,
    // CatalogEntry.weight (одно число 1..3) — максимум по грейдам и специализациям; полная форма — в weights
    weight: Math.max(...nums),
    weights,
    proof,
    markers: parseMarkers(markersCell),
    limits: parseLimits(limitsCell),
    stack,
    adjacent: [],
  });
}

const byId = new Map();
for (const e of entries) {
  if (byId.has(e.id)) fail(`повтор ID ${e.id}`);
  byId.set(e.id, e);
}
for (const [a, b] of adjacency) {
  if (!byId.has(a) || !byId.has(b)) fail(`ребро смежности ${a} — ${b}: ID нет в каталоге`);
  // рёбра «в обе стороны» (каталог § 6)
  if (!byId.get(a).adjacent.includes(b)) byId.get(a).adjacent.push(b);
  if (!byId.get(b).adjacent.includes(a)) byId.get(b).adjacent.push(a);
}

// Пользовательские тексты не показывают ID: «(см. be.x)» → «(см. «формулировка»)».
for (const e of entries) {
  e.limits = e.limits.replace(/\(см\. ((?:be|fe|common)\.[a-z0-9-]+)\)/g, (_, ref) => {
    const t = byId.get(ref);
    if (!t) fail(`${e.id}: ссылка «см. ${ref}» на несуществующий ID`);
    return `(см. «${t.statement}»)`;
  });
}

// Правки маркеров поверх личного каталога-Markdown (его не трогаем): scripts/catalog-marker-overrides.json.
const OVERRIDES = join(here, 'catalog-marker-overrides.json');
if (existsSync(OVERRIDES)) {
  for (const [id, markers] of Object.entries(JSON.parse(readFileSync(OVERRIDES, 'utf8')))) {
    if (id.startsWith('_')) continue;
    if (!byId.has(id)) fail(`override маркеров: ID ${id} нет в каталоге`);
    byId.get(id).markers = markers;
  }
}

const dateMatch = /(\d{2})\.(\d{2})\.(\d{4})/.exec(md.split('\n').find((l) => l.includes('Статус')) ?? '');
const version = dateMatch
  ? `claims-catalog-${/черновик/i.test(md.slice(0, 400)) ? 'draft-' : ''}${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
  : 'claims-catalog-unknown';
const counts = Object.fromEntries(
  ['backend', 'frontend', 'ai', 'engineering', 'common'].map((s) => [s, entries.filter((e) => e.specialization === s).length]),
);
const out = JSON.stringify({ version, counts, entries }, null, 2) + '\n';

if (check) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== out) {
    console.error(`${OUT} устарел относительно ${srcPath}: перегенерируйте`);
    process.exit(1);
  }
  console.log('claims-catalog.json актуален');
} else {
  writeFileSync(OUT, out);
  console.log(`${version}: backend ${counts.backend}, frontend ${counts.frontend}, ai ${counts.ai}, engineering ${counts.engineering}, common ${counts.common}, рёбер смежности ${adjacency.length} → ${OUT}`);
}
