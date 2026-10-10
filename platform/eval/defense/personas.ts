// Валидация ступени 3 ADR 0003 — защита проекта: три персоны-кандидата защищают свои репозитории-фикстуры
// (tests/fixtures/defense/*) через сервисный слой defense-room (startDefenseRoom → candidateTurn →
// finishDefenseRoom). Вопросы QLC строятся из кода фикстуры, оценщик делает 3 прогона и берёт медиану.
// Сабмит проекта «сильный»: resultJson в формате lane project, tests.score = 0.95. Метрики: балл рубрики,
// флаг strong_project_weak_defense, разведение персон (a)/(b)/(c), повторяемость, вызовы LLM.
//
// Запуск из platform/ (отдельная БД, как у eval:call):
//   npm run eval:defense -- --stub        # детерминированно, без ключей
//   npm run eval:defense                  # живая модель из .env; uptime перед запуском
//   npm run eval:defense -- --defenses 1 --persona own
//
// Честная граница: персоны — LLM-актёры, не люди; три разных репозитория (персона и проект не разделены);
// n = 3 защиты на персону.
import { STUB } from '../stages/boot';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { buildSnapshot, candidateTurn, finishDefenseRoom, startDefenseRoom } from '../../src/server/defense-room/session';
import type { RepoSnapshot } from '../../src/server/defense-room/types';
import { defenseTables, defenseTuningTable, diffMeter, summarizeDefensePersona, type DefenseObs } from '../stages/metrics';
import { argValue, createCandidate, personaAnswer, prisma, providers, runTag, snapshot, writeResult, type PersonaProfile } from '../stages/runtime';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/defense');
/** Доля скрытых тестов проекта — «сильный проект» (порог флага в verdict.ts — 0.8). */
const PROJECT_SCORE = 0.95;

interface Fixture {
  id: string;
  title: string;
  repoUrl: string;
  commitSha: string;
  aiLog: string;
  commits: { sha: string; message: string; date: string }[];
  persona: { legend: string; style: string; knowledge: string; knownFiles: string[] };
}

const PERSONAS: { id: string; label: string }[] = [
  // Порядок задаёт направление AUC в таблице: (a) над (c), (a) над (b), (c) над (b).
  { id: 'own', label: '(a) сделал сам' },
  { id: 'partial', label: '(c) понимает частично' },
  { id: 'ai-only', label: '(b) ИИ целиком' },
];

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

function loadFixture(id: string): { fixture: Fixture; snapshot: RepoSnapshot } {
  const dir = path.join(FIXTURES, id);
  const raw = JSON.parse(readFileSync(path.join(dir, 'fixture.json'), 'utf8')) as Omit<Fixture, 'id'>;
  const repoDir = path.join(dir, 'repo');
  const tree = walk(repoDir).sort();
  const files = tree.map((p) => {
    const content = readFileSync(path.join(repoDir, p), 'utf8');
    return { path: p, content, size: Buffer.byteLength(content) };
  });
  return {
    fixture: { id, ...raw },
    snapshot: { repoUrl: raw.repoUrl, commitSha: raw.commitSha, tree, files, commits: raw.commits, truncated: { treeEntries: 0, files: 0 } },
  };
}

function profileFor(f: Fixture, snap: RepoSnapshot): PersonaProfile {
  const code = snap.files
    .filter((x) => f.persona.knownFiles.includes(x.path))
    .map((x) => `### ${x.path}\n${x.content}`)
    .join('\n');
  const commits = f.commits.map((c) => `${c.sha.slice(0, 7)} ${c.message}`).join('\n');
  return {
    id: f.id,
    legend: `${f.persona.legend} Проект: ${f.title}.`,
    style: f.persona.style,
    knowledge: `${f.persona.knowledge}\n\nКоммиты проекта:\n${commits}${code ? `\n\nКод, который ты знаешь:\n${code}` : ''}`,
  };
}

/** Детерминированный актёр для --stub: (a) объясняет, (b) общие слова, (c) объясняет только свои файлы. */
function stubAnswer(f: Fixture, question: string): string {
  if (f.id === 'own' || f.persona.knownFiles.some((p) => question.includes(p))) {
    return 'Этот код писал сам. Сделал так, потому что альтернатива с фиксированным окном пропускает двойной всплеск, а хранить каждую метку дороже по памяти. Не уверен, как поведёт себя при нескольких экземплярах, проверил бы нагрузочным тестом. В итоге тесты проходят и лимит держится.';
  }
  return 'Ну, там всё стандартно, так правильнее и надёжнее, это лучшие практики.';
}

const MAX_TURNS = 14;

/** Задание-потребность под сабмит (FK ProjectSubmission → ProjectTask): компания, потребность и шаблон — служебные. */
async function ensureEvalTask(fixtureId: string): Promise<string> {
  const taskId = `eval-task-${fixtureId}`;
  await prisma.company.upsert({ where: { id: 'eval-co' }, update: {}, create: { id: 'eval-co', name: 'Eval Co' } });
  await prisma.projectTemplate.upsert({
    where: { id: 'eval-tpl' },
    update: {},
    create: { id: 'eval-tpl', subcategoryId: 'backend.web-api', specialization: 'backend', grade: 'junior', title: 'eval', contractMd: '', dirRef: 'eval', hiddenTestsRef: 'eval', visibleTestsRef: 'eval', image: 'node20', timeBudgetMin: 60 },
  });
  await prisma.vacancy.upsert({
    where: { id: `eval-vac-${fixtureId}` },
    update: {},
    create: { id: `eval-vac-${fixtureId}`, companyId: 'eval-co', title: 'eval', specialization: 'backend', grade: 'junior', salaryFrom: 1, salaryTo: 2, needs: [], archivedAt: new Date() },
  });
  await prisma.projectTask.upsert({
    where: { id: taskId },
    update: {},
    create: { id: taskId, vacancyId: `eval-vac-${fixtureId}`, templateId: 'eval-tpl', specialization: 'backend', grade: 'junior', specJson: {}, rubricJson: {} },
  });
  return taskId;
}

async function runDefense(f: Fixture, snap: RepoSnapshot, n: number, tag: string, llm: ReturnType<typeof providers>): Promise<DefenseObs> {
  const id = `eval-${tag}-${f.id}${n}`;
  const before = { platform: snapshot(llm.platform.meter), persona: snapshot(llm.persona.meter) };
  const base = { persona: f.id, defense: n, sessionId: '', total: null, passed: null, runs: [] as number[], flags: [] as string[], answered: 0, followUps: 0, generator: '', projectScore: null };
  try {
    await createCandidate(id, { grade: 'junior' });
    await ensureEvalTask(f.id);
    const hidden = Array.from({ length: 20 }, (_, i) => ({ name: `hidden-${i + 1}`, passed: i < 19 }));
    const sub = await prisma.projectSubmission.create({
      data: {
        projectTaskId: `eval-task-${f.id}`,
        candidateId: id,
        repoUrl: f.repoUrl,
        commitSha: f.commitSha,
        aiLogText: f.aiLog,
        status: 'checked',
        // Формат lane project (project/schemas.ts ResultJson): tests — сводка, скрытые тесты — списком.
        resultJson: { tests: { passed: 19, total: 20, score: PROJECT_SCORE }, hiddenTests: hidden, visibleTests: [], lint: { status: 'skipped', note: '' } },
      },
    });
    const profile = profileFor(f, snap);
    const started = await startDefenseRoom(id, { mode: 'project', projectSubmissionId: sub.id }, llm.platform, { loadSnapshot: async () => snap });
    const sessionId = started.sessionId;
    const history: { q: string; a: string | null }[] = [];
    let question: string | null = started.snapshot.transcript[started.snapshot.transcript.length - 1]?.text ?? null;
    for (let turn = 0; turn < MAX_TURNS && question; turn++) {
      history.push({ q: question, a: null });
      const answer = STUB ? stubAnswer(f, question) : await personaAnswer(llm.persona, profile, history);
      history[history.length - 1]!.a = answer;
      const res = await candidateTurn(id, sessionId, answer.slice(0, 3900), llm.platform);
      question = res.done ? null : res.text;
    }
    const verdict = await finishDefenseRoom(id, sessionId, llm.platform);
    const snapAfter = await buildSnapshot(sessionId);
    const plan = await prisma.defenseRoomPlan.findUnique({ where: { callSessionId: sessionId }, select: { sourceJson: true } });
    return {
      ...base,
      sessionId,
      total: verdict.totalMean ?? verdict.total,
      passed: verdict.passed,
      items: (verdict.items ?? []).map((i) => ({ itemId: i.itemId, label: i.label, ref: i.ref, total: i.total, passed: i.passed, runs: i.runs })),
      runs: verdict.runs,
      flags: verdict.flags,
      answered: verdict.answered,
      followUps: snapAfter.transcript.filter((e) => e.defense?.kind === 'followup').length,
      generator: String((plan?.sourceJson as { generator?: string } | null)?.generator ?? ''),
      projectScore: verdict.projectScore,
      platform: diffMeter(llm.platform.meter, before.platform),
      persona_llm: diffMeter(llm.persona.meter, before.persona),
    };
  } catch (err) {
    return {
      ...base,
      platform: diffMeter(llm.platform.meter, before.platform),
      persona_llm: diffMeter(llm.persona.meter, before.persona),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const defenses = Number(argValue('defenses') ?? 3);
  const only = argValue('persona');
  const personas = PERSONAS.filter((p) => !only || only.split(',').includes(p.id));
  const tag = `${STUB ? 's' : 'l'}${runTag()}`;
  const llm = providers();
  console.log(`eval:defense — провайдер ${llm.platform.name}/${llm.platform.model}, персон ${personas.length}, защит на персону ${defenses}`);
  const obs: DefenseObs[] = [];
  for (const p of personas) {
    const { fixture, snapshot: snap } = loadFixture(p.id);
    for (let n = 1; n <= defenses; n++) {
      const t0 = Date.now();
      const o = await runDefense(fixture, snap, n, tag, llm);
      obs.push(o);
      console.log(
        `  ${p.id}${n}: ${o.error ? `ОШИБКА ${o.error}` : `сумма ${o.total} (прогоны ${o.runs.join('/')}) ${o.passed ? 'прошёл' : 'не прошёл'} · флаги ${o.flags.join(',') || '—'} · ответов ${o.answered}, уточнений ${o.followUps}, QLC ${o.generator}`} · LLM ${o.platform.calls}+${o.persona_llm.calls} · ${Math.round((Date.now() - t0) / 1000)} с`,
      );
    }
  }
  const summaries = personas.map((p) => summarizeDefensePersona(p.id, obs.filter((o) => o.persona === p.id), loadFixture(p.id).fixture.persona.knownFiles));
  const legends = Object.fromEntries(personas.map((p) => [p.id, p.label]));
  const md = `${defenseTables(summaries, legends)}\n\n${defenseTuningTable(summaries, legends)}`;
  const file = writeResult(`defense-${STUB ? 'stub' : 'live'}${argValue('out') ? `-${argValue('out')}` : ''}.json`, {
    stage: 3,
    provider: `${llm.platform.name}/${llm.platform.model}`,
    stub: STUB,
    runAt: new Date().toISOString(),
    defenses,
    projectScore: PROJECT_SCORE,
    summaries,
    observations: obs,
    totals: { platform: llm.platform.meter, persona: llm.persona.meter },
  });
  console.log(`\n${md}\n\nВсего вызовов LLM: платформа ${llm.platform.meter.calls} (ошибок ${llm.platform.meter.failures}), персоны ${llm.persona.meter.calls}; токены платформы ${llm.platform.meter.inputTokens} вх / ${llm.platform.meter.outputTokens} вых.`);
  console.log(`Результат: ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
