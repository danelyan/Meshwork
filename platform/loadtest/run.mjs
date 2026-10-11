#!/usr/bin/env node
// Нагрузочный прогон только на чтение, без зависимостей (Node 20+, встроенный fetch).
// Запуск: LOAD_SITE_COOKIE='<значение куки site_access>' node platform/loadtest/run.mjs out.json
// Переменные: BASE_URL, STAGES ("10:120,25:120,50:120" = VU:секунды), WARMUP ("5:60", "" – без прогрева),
//   THINK_MIN/THINK_MAX (мс, 1000/4000), ABORT_RATE (0.05), EMPLOYER_ID (demo-employer), VACANCY_ID (demo-vac-be-m-1),
//   LOAD_SITE_COOKIE (значение куки site_access; без неё закрытый стенд отвечает 401).
// Пишет в БД стенда: только при первом входе демо-работодателя, если нет согласий (Consent: оферта и обязательство
// по данным; ensureConsents идемпотентен). Сессия – подписанная кука, строк сессии в БД нет. Поиск и подборка – чтение.

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const COOKIE_NAME = 'site_access';
const SITE_COOKIE = process.env.LOAD_SITE_COOKIE || '';
const EMPLOYER_ID = process.env.EMPLOYER_ID || 'demo-employer';
const VACANCY_ID = process.env.VACANCY_ID || 'demo-vac-be-m-1';
const THINK_MIN = Number(process.env.THINK_MIN || 1000);
const THINK_MAX = Number(process.env.THINK_MAX || 4000);
const ABORT_RATE = Number(process.env.ABORT_RATE || 0.05);
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS || 30000);
const OUT = process.argv[2] || '';

export const parseStages = (s) =>
  s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [vus, sec] = x.split(':').map(Number);
    if (!(vus > 0) || !(sec > 0)) throw new Error(`Плохая ступень "${x}", ожидается VU:секунды`);
    return { vus, sec };
  });

/** Перцентиль по методу «ближайший ранг» на отсортированном массиве. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export class Stats {
  constructor() { this.eps = new Map(); }
  add(ep, ms, code) {
    let e = this.eps.get(ep);
    if (!e) { e = { ms: [], codes: {}, errors: 0 }; this.eps.set(ep, e); }
    e.ms.push(ms);
    e.codes[code] = (e.codes[code] || 0) + 1;
    if (code === 'ERR' || Number(code) >= 400) e.errors++;
  }
  totals() {
    let n = 0, err = 0;
    for (const e of this.eps.values()) { n += e.ms.length; err += e.errors; }
    return { n, err, rate: n ? err / n : 0 };
  }
  summary(durationSec) {
    const out = {};
    for (const [ep, e] of this.eps) {
      const s = [...e.ms].sort((a, b) => a - b);
      out[ep] = {
        requests: s.length,
        rps: +(s.length / durationSec).toFixed(2),
        p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s[s.length - 1],
        errorPct: +((100 * e.errors) / s.length).toFixed(2),
        codes: e.codes,
      };
    }
    return out;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = () => THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN);

async function call(stats, ep, path, jar, init = {}) {
  const t0 = performance.now();
  let code = 'ERR', res = null;
  try {
    res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers || {}), cookie: jar.join('; ') },
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    });
    await res.arrayBuffer(); // дочитать тело: время до полного ответа
    code = String(res.status);
  } catch { /* таймаут/сеть: код ERR */ }
  stats.add(ep, Math.round(performance.now() - t0), code);
  return res;
}

const SEARCHES = [
  'spec=backend&limit=20',
  'spec=backend&grade=junior&limit=20',
  'spec=backend&grade=middle&stack=Go,PostgreSQL&limit=20',
  'spec=frontend&limit=20',
  'spec=frontend&grade=junior&stack=React&limit=20',
  'fsp=1&limit=20',
  'category=1&spec=backend&limit=20',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function login(stats) {
  const jar = SITE_COOKIE ? [`${COOKIE_NAME}=${SITE_COOKIE}`] : [];
  const res = await call(stats, 'login', '/api/demo/login', jar, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ employerUserId: EMPLOYER_ID }),
  });
  if (!res || res.status !== 200) return null;
  for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c.split(';')[0]);
  return jar;
}

async function vu(stats, stopAt) {
  const jar = await login(stats);
  if (!jar) { await sleep(Math.max(0, Math.min(5000, stopAt - Date.now()))); return; }
  while (Date.now() < stopAt) {
    await call(stats, 'health', '/api/health', jar);
    await sleep(think());
    if (Date.now() >= stopAt) break;
    await call(stats, 'search', `/api/employer/search?${pick(SEARCHES)}`, jar);
    await sleep(think());
    if (Date.now() >= stopAt) break;
    await call(stats, 'matches', `/api/employer/vacancies/${VACANCY_ID}/matches?limit=20`, jar);
    await sleep(think());
  }
}

/** Одна ступень; false – прервано из-за доли ошибок выше порога. */
async function runStage(label, { vus, sec }) {
  const stats = new Stats();
  const stopAt = Date.now() + sec * 1000;
  let aborted = false;
  const guard = setInterval(() => {
    const t = stats.totals();
    if (t.n >= 50 && t.rate > ABORT_RATE) { aborted = true; clearInterval(guard); }
  }, 5000);
  const pool = Array.from({ length: vus }, () => vu(stats, stopAt));
  // abort: ждём либо всех, либо флага
  await Promise.race([Promise.all(pool), (async () => { while (!aborted && Date.now() < stopAt + 40000) await sleep(500); })()]);
  clearInterval(guard);
  const t = stats.totals();
  if (t.n && t.rate > ABORT_RATE) aborted = true;
  console.log(`[${label}] ${vus} VU, ${sec} с: ${t.n} запросов, ошибок ${(t.rate * 100).toFixed(2)} %${aborted ? '  ABORT' : ''}`);
  return { stats, aborted, sec };
}

function table(summary) {
  const rows = [['endpoint', 'запросов', 'RPS', 'p50', 'p95', 'p99', 'max', 'ошибки %', 'коды']];
  for (const [ep, s] of Object.entries(summary)) {
    rows.push([ep, s.requests, s.rps, s.p50, s.p95, s.p99, s.max, s.errorPct, Object.entries(s.codes).map(([k, v]) => `${k}:${v}`).join(' ')].map(String));
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ')).join('\n');
}

async function main() {
  const stages = parseStages(process.env.STAGES || '10:120,25:120,50:120');
  const warm = process.env.WARMUP === undefined ? '5:60' : process.env.WARMUP;
  if (!SITE_COOKIE) console.warn('LOAD_SITE_COOKIE не задана: закрытый паролем стенд ответит 401');
  console.log(`BASE_URL=${BASE} employer=${EMPLOYER_ID} vacancy=${VACANCY_ID} think=${THINK_MIN}-${THINK_MAX} мс`);
  const startedAt = new Date().toISOString();
  for (const w of parseStages(warm)) await runStage('прогрев', w);
  const report = { startedAt, base: BASE, employerId: EMPLOYER_ID, vacancyId: VACANCY_ID, think: [THINK_MIN, THINK_MAX], abortRate: ABORT_RATE, stages: [], aborted: false };
  const all = new Stats();
  let totalSec = 0;
  for (const st of stages) {
    const r = await runStage(`${st.vus} VU`, st);
    for (const [ep, e] of r.stats.eps) {
      let a = all.eps.get(ep);
      if (!a) { a = { ms: [], codes: {}, errors: 0 }; all.eps.set(ep, a); }
      a.ms.push(...e.ms); a.errors += e.errors;
      for (const [k, v] of Object.entries(e.codes)) a.codes[k] = (a.codes[k] || 0) + v;
    }
    totalSec += r.sec;
    report.stages.push({ vus: st.vus, sec: st.sec, aborted: r.aborted, endpoints: r.stats.summary(r.sec) });
    console.log(table(r.stats.summary(r.sec)) + '\n');
    if (r.aborted) { report.aborted = true; break; }
  }
  report.total = all.summary(totalSec || 1);
  report.finishedAt = new Date().toISOString();
  console.log('ИТОГО по всем ступеням (без прогрева):\n' + table(report.total));
  if (OUT) { const fs = await import('node:fs'); fs.writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`JSON: ${OUT}`); }
  process.exit(report.aborted ? 2 : 0);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
