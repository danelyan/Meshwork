// Матрица инструментов консультанта на живой модели: пользователи × ситуации × файлы в чате.
// Ход идёт через тот же runTurn, файлы — через POST-обработчик /api/uploads (тот же код, что у браузера:
// подписанная кука, разбор, хранение оригинала, дедупликация).
//
//   cd platform && set -a && . ./.env && set +a && export LLM_DAILY_TOKEN_BUDGET=0
//   npx tsx eval/tools-matrix/run.ts --smoke --label smoke      # 4 сценария
//   npx tsx eval/tools-matrix/run.ts --label full --parallel 2  # все сценарии (~60 ходов)
//   npx tsx eval/tools-matrix/run.ts --only t06-profile,f03-docx --label x
//   npx tsx eval/tools-matrix/run.ts --rescore eval/results/tools-matrix-full-….json   # проверки заново по сохранённым ответам
//
// Для каждого сценария создаётся временный кандидат (клон демо-кандидата или пустой), в конце он удаляется
// вместе с разговором, загрузками (и оригиналами на диске), журналом LLM. Демо-данные не трогаются.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import './preload';
import { POST as uploadsPost } from '../../src/app/api/uploads/route';
import { runTurn } from '../../src/server/agent/loop';
import { CONSULTANT_PROMPT_VERSION } from '../../src/server/agent/prompt';
import { prisma } from '../../src/server/db';
import { getEnv } from '../../src/server/env';
import { sessionCookie } from '../../src/server/session';
import { uploadRoot } from '../../src/server/uploads/storage';
import { validateUploadFile } from '../../src/lib/api';
import { Prisma } from '@prisma/client';

import { evaluateTurn, type ToolCallObs, type TurnObs, type UploadObs } from './checks';
import { ALL_TOOLS, SCENARIOS, USERS, type FileSpec, type Scenario, type Turn, type UserKey } from './cases';
import { buildReport, renderMarkdown, type TurnRecord } from './report';

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = join(here, '..');
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const flag = (n: string) => argv.includes(`--${n}`);
const LABEL = opt('label', 'run');
const PARALLEL = Math.max(1, Math.min(2, Number(opt('parallel', '1'))));
const ONLY = opt('only', '');
const TURN_TIMEOUT_MS = Number(opt('timeout', '240000'));
const RESCORE = opt('rescore', '');

// Тот же запрет, что в композере: сама функция композера, а не её копия.
const clientValidate = (name: string, size: number): string | null => validateUploadFile({ name, size });

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

// ---------- временные пользователи ----------

const rid = () => Math.random().toString(36).slice(2, 10);

async function cloneFrom(baseId: string, opts: { claims?: number; fspState?: 'no_achievements'; categories?: boolean; invitation?: boolean; name: string }): Promise<string> {
  const base = await prisma.candidate.findUniqueOrThrow({ where: { id: baseId }, include: { claims: true, categories: true, profile: true } });
  const id = `evaltm-${rid()}`;
  await prisma.candidate.create({
    data: {
      id,
      email: `${id}@example.test`,
      name: opts.name,
      specialization: base.specialization,
      consentAt: new Date(),
      fspState: opts.fspState ?? base.fspState,
    },
  });
  if (base.profile) {
    await prisma.candidateProfile.create({ data: { ...base.profile, candidateId: id, updatedAt: undefined } });
  }
  for (const c of base.claims.slice(0, opts.claims ?? base.claims.length)) {
    await prisma.claim.create({
      data: {
        candidateId: id,
        catalogId: c.catalogId,
        statement: c.statement,
        level: c.level,
        quote: c.quote,
        sourceRef: c.sourceRef,
        sourceKind: c.sourceKind,
        confidence: c.confidence,
        limits: c.limits,
        suggestedProof: c.suggestedProof as Prisma.InputJsonValue,
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });
  }
  if (opts.categories !== false) {
    for (const c of base.categories) {
      await prisma.candidateCategory.create({ data: { candidateId: id, specialization: c.specialization, grade: c.grade, source: c.source, subcategoryId: c.subcategoryId } });
    }
  }
  if (opts.invitation) {
    await prisma.invitation.create({
      data: {
        candidateId: id,
        vacancyId: 'demo-vac-be-m-1',
        companyId: 'demo-co-northstream',
        salaryFrom: 250000,
        salaryTo: 320000,
        message: 'Здравствуйте! Нам нужен backend-разработчик на платежи. Давайте обсудим.',
      },
    });
  }
  return id;
}

async function fresh(name: string, spec: 'backend' | null, stack: string[]): Promise<string> {
  const id = `evaltm-${rid()}`;
  await prisma.candidate.create({ data: { id, email: `${id}@example.test`, name, specialization: spec, consentAt: new Date(), fspState: 'not_linked' } });
  await prisma.candidateProfile.create({ data: { candidateId: id, stack, workFormats: ['remote'], city: 'Казань' } });
  return id;
}

async function makeUser(u: UserKey): Promise<string> {
  switch (u) {
    case 'newbie':
      return cloneFrom('demo-pool-be-j-2', { claims: 2, fspState: 'no_achievements', categories: false, name: 'Ольга Тестова' });
    case 'mid':
      return cloneFrom('demo-pool-be-m-pay', { name: 'Игорь Тестов' });
    case 'fejr':
      return cloneFrom('demo-pool-fe-j-1', { name: 'Тимофей Тестов' });
    case 'invited':
      return cloneFrom('demo-pool-be-m-pay', { invitation: true, name: 'Глеб Тестов' });
    case 'nonit':
      return fresh('Марина Тестова', null, ['бухгалтерия', '1С']);
    case 'empty':
      return fresh('Анна Тестова', null, []);
  }
}

async function dropUser(id: string): Promise<void> {
  await prisma.agentRun.deleteMany({ where: { candidateId: id } }).catch(() => undefined);
  await prisma.candidate.delete({ where: { id } }).catch((e) => console.warn('cleanup candidate', id, e instanceof Error ? e.message : e));
  try {
    rmSync(join(uploadRoot(), id), { recursive: true, force: true });
  } catch {
    /* нет каталога */
  }
}

// ---------- файлы ----------

function readFile(f: FileSpec): { name: string; buf: Buffer } {
  const buf = readFileSync(join(evalDir, f.path));
  return { name: f.asName ?? basename(f.path), buf };
}

async function upload(candidateId: string, f: FileSpec): Promise<UploadObs> {
  const { name, buf } = readFile(f);
  const cookie = sessionCookie(candidateId);
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(buf)], name, { type: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream' }));
  fd.set('kind', 'resume');
  const res = await uploadsPost(new Request('http://localhost:3000/api/uploads', { method: 'POST', body: fd, headers: { cookie: `${cookie.name}=${cookie.value}` } }));
  const body = (await res.json().catch(() => ({}))) as { uploadId?: string; doc?: { lines?: number; flags?: Record<string, unknown> }; error?: { message?: string }; message?: string };
  const ui = clientValidate(name, buf.length);
  return {
    file: name,
    status: res.status,
    ...(body.uploadId ? { uploadId: body.uploadId } : {}),
    ...(res.status >= 300 ? { error: body.error?.message ?? body.message ?? JSON.stringify(body).slice(0, 200) } : {}),
    ...(body.doc ? { lines: body.doc.lines ?? 0, flags: body.doc.flags ?? {} } : {}),
    ...(ui ? { uiBlocked: ui } : {}),
  } as UploadObs;
}

/** Текст файла для корпуса «что реально было в данных» (текстовые форматы читаем как есть). */
function plainText(f: FileSpec): string {
  const ext = extname(f.path).toLowerCase();
  return ['.md', '.txt', '.csv'].includes(ext) ? readFileSync(join(evalDir, f.path), 'utf8') : '';
}

// ---------- ход ----------

interface Row {
  role: string;
  content: string;
  toolCalls: unknown;
  toolCallId: string | null;
}

async function runScenario(s: Scenario): Promise<TurnRecord[]> {
  const candidateId = await makeUser(s.user);
  const conv = await prisma.conversation.create({ data: { candidateId }, select: { id: true } });
  const records: TurnRecord[] = [];
  let seen = 0;
  try {
    for (const [ti, t] of s.turns.entries()) {
      const uploads: UploadObs[] = [];
      const ids: string[] = [];
      let filesText = '';
      let text = t.text;
      for (const [i, f] of (t.preUpload ?? []).entries()) {
        const u = await upload(candidateId, f);
        text = text.replace(`{id${i}}`, u.uploadId ?? 'нет');
      }
      for (const f of t.files ?? []) {
        filesText += plainText(f);
        const u = await upload(candidateId, f);
        uploads.push(u);
        // Композер не даёт отправить файл, не прошедший его проверку; с сервера — только успешные.
        if (u.uploadId && u.status < 300 && !u.uiBlocked) ids.push(u.uploadId);
      }
      if (t.confirmClaims) await prisma.claim.updateMany({ where: { candidateId, status: 'proposed' }, data: { status: 'confirmed', confirmedAt: new Date() } });

      const t0 = new Date();
      const events: { type: string; [k: string]: unknown }[] = [];
      const ac = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, TURN_TIMEOUT_MS);
      let crashed: string | undefined;
      try {
        await runTurn(
          { candidateId, conversationId: conv.id, text, ...(ids.length ? { uploadIds: ids } : {}), ...(t.urls?.length ? { urls: t.urls } : {}) },
          (e) => events.push(e as { type: string }),
          ac.signal,
          { dailyTokenBudget: 0 },
        );
      } catch (err) {
        crashed = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      } finally {
        clearTimeout(timer);
      }
      const ms = Date.now() - t0.getTime();

      const rows = (await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' }, select: { role: true, content: true, toolCalls: true, toolCallId: true } })) as Row[];
      const mine = rows.slice(seen);
      seen = rows.length;
      const obs = collect(mine, events, uploads, text, filesText, ms);
      const runs = await prisma.agentRun.findMany({ where: { candidateId, createdAt: { gte: t0 } }, select: { inputTokens: true, outputTokens: true } });
      obs.inTokens = runs.reduce((a, r) => a + r.inputTokens, 0);
      obs.outTokens = runs.reduce((a, r) => a + r.outputTokens, 0);
      if (crashed) obs.crashed = crashed;
      if (timedOut) obs.timedOut = true;
      // Корпус: что платформа знает — включая карточки, которые конвейер только что создал.
      const claims = await prisma.claim.findMany({ where: { candidateId }, select: { statement: true, quote: true, catalogId: true, sourceRef: true } });
      const uploadsDb = ids.length ? await prisma.upload.findMany({ where: { id: { in: ids } }, select: { extracted: true } }) : [];
      obs.corpus += `\n${claims.map((c) => `${c.statement} ${c.quote} ${c.catalogId} ${c.sourceRef}`).join('\n')}\n${uploadsDb.map((u) => JSON.stringify(u.extracted)).join('\n')}`;

      const verdict = evaluateTurn(t, obs);
      const rec: TurnRecord = { scenario: s.id, user: s.user, turn: ti + 1, text: t.text, fmt: (t.files ?? []).map((f) => f.fmt), expect: t.expect ?? [], none: Boolean(t.none), injection: Boolean(t.injection), obs: { ...obs, corpus: '' }, verdict };
      records.push(rec);
      console.log(`${verdict.pass ? 'PASS' : 'FAIL'} ${s.id}#${ti + 1} ${ms}ms [${obs.calls.map((c) => c.name).join(',') || '—'}] ${obs.inTokens + obs.outTokens}tok${verdict.pass ? '' : ` — ${verdict.fails.join(' | ').slice(0, 300)}`}`);
    }
  } finally {
    await prisma.conversation.delete({ where: { id: conv.id } }).catch(() => undefined);
    await dropUser(candidateId);
  }
  return records;
}

function collect(rows: Row[], events: { type: string; [k: string]: unknown }[], uploads: UploadObs[], userText: string, filesText: string, ms: number): TurnObs {
  const names = new Map<string, { name: string; args: string }>();
  const calls: ToolCallObs[] = [];
  let corpus = `${userText}\n${filesText}\n`;
  for (const r of rows) {
    if (r.role === 'assistant' && Array.isArray(r.toolCalls)) {
      for (const tc of r.toolCalls as { id: string; name: string; arguments: unknown }[]) {
        names.set(tc.id, { name: tc.name, args: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) });
      }
    }
    if (r.role === 'tool') {
      corpus += `${r.content}\n`;
      const meta = names.get(r.toolCallId ?? '');
      const err = /^\{"error":\{"code":"([^"]*)","message":"((?:[^"\\]|\\.)*)"/.exec(r.content);
      calls.push({ name: meta?.name ?? '?', args: meta?.args ?? '', ok: !err, ...(err ? { errorCode: err[1], errorMessage: err[2]?.slice(0, 200) } : {}) });
    }
  }
  // Вызовы без записанного результата (terminal: ask_user) — тоже вызовы.
  const withResult = new Set(rows.filter((r) => r.role === 'tool').map((r) => r.toolCallId));
  for (const [id, m] of names) if (!withResult.has(id)) calls.push({ name: m.name, args: m.args, ok: true });
  const asks = events.filter((e) => e.type === 'ask').map((e) => [e.question, ...((e.options as string[] | undefined) ?? [])].join(' | '));
  const finals = rows.filter((r) => r.role === 'assistant' && !(Array.isArray(r.toolCalls) && r.toolCalls.length));
  const text = [finals.at(-1)?.content ?? '', ...asks].filter(Boolean).join('\n');
  const proposed = events.filter((e) => e.type === 'claims').reduce((a, e) => a + ((e.proposed as unknown[] | undefined)?.length ?? 0), 0);
  corpus += asks.join('\n');
  return { text, calls, corpus, uploads, proposed, ms, inTokens: 0, outTokens: 0 };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

function save(records: TurnRecord[], label: string) {
  const model = getEnv().OPENAI_CHAT_MODEL ?? getEnv().LLM_PROVIDER;
  const report = buildReport(records, ALL_TOOLS, USERS);
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', dateStyle: 'short' }).format(new Date());
  const base = join(evalDir, 'results', `tools-matrix-${label}-${stamp}`);
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify({ label, model, prompt: CONSULTANT_PROMPT_VERSION, summary: report, records }, null, 2));
  writeFileSync(`${base}.md`, renderMarkdown(label, String(model), CONSULTANT_PROMPT_VERSION, report, records));
  console.log(`\n→ ${base}.json / .md`);
}

async function main() {
  if (RESCORE) {
    const saved = JSON.parse(readFileSync(RESCORE, 'utf8')) as { label: string; records: TurnRecord[] };
    const { evaluateTurn: ev } = await import('./checks');
    const scen = new Map(SCENARIOS.map((s) => [s.id, s]));
    const records = saved.records.map((r) => {
      const t: Turn | undefined = scen.get(r.scenario)?.turns[r.turn - 1];
      // corpus не сохраняется (размер) — проверку «нет в данных» при пересчёте пропускаем.
      const v = ev({ ...(t ?? {}) }, { ...r.obs, corpus: r.obs.text });
      return { ...r, verdict: v };
    });
    save(records, `${saved.label}-rescored`);
    return;
  }
  if (getEnv().LLM_PROVIDER === 'stub') {
    console.log('LLM_PROVIDER=stub — матрица проверяет живую модель, прогон пропущен.');
    return;
  }
  let list = SCENARIOS;
  if (flag('smoke')) list = list.filter((s) => s.smoke);
  if (ONLY) list = list.filter((s) => ONLY.split(',').includes(s.id));
  console.log(`prompt ${CONSULTANT_PROMPT_VERSION}; ${list.length} сценариев, ${list.reduce((a, s) => a + s.turns.length, 0)} ходов; параллельно ${PARALLEL}`);
  const all: TurnRecord[] = [];
  await pool(list, PARALLEL, async (s) => {
    try {
      all.push(...(await runScenario(s)));
    } catch (err) {
      console.error(`сценарий ${s.id} сорвался:`, err instanceof Error ? err.message : err);
    }
  });
  all.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.turn - b.turn);
  save(all, LABEL);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
