// Brier калиброванной вероятности по РЕАЛЬНЫМ исходам приглашений (читает БД из DATABASE_URL, ничего не пишет).
//   npx tsx eval/matching/outcomes.ts [--min 30]
// Для каждого приглашения по потребности: балл подбора пересчитывается по текущему профилю кандидата
// (scoreCandidate, как в кабинете) -> scoreToProbability -> сравнение с исходом. Пока приглашений мало – «нет данных».
// ОГРАНИЧЕНИЕ: балл на момент отправки в БД не хранится (нет колонки Invitation.matchScore), поэтому берётся
// текущий; профиль мог измениться после приглашения. Исход «принял» зависит и от зарплаты, а не только от соответствия,
// поэтому это ПРОКСИ для P(подойдёт), а не она сама; сильнее всего сигнал – «созвон состоялся» и «вышел».
import { prisma } from '../../src/server/db';
import { loadCatalog } from '../../src/server/recommend/evidence';
import { scoreToProbability } from '../../src/server/employer/calibration';
import { loadPool } from '../../src/server/employer/matching';
import { scoreCandidate, dropUncovered } from '../../src/server/employer/ranking';
import { getVacancy } from '../../src/server/employer/vacancies';

import { brier, calibrationCurve, ece } from './calib-math';

const minArg = process.argv.indexOf('--min');
const MIN = minArg >= 0 ? Number(process.argv[minArg + 1]) : 30;

type Outcome = { name: string; label: string; pick: (i: Row) => boolean | null };
interface Row { status: string; callDone: boolean; p: number }

const OUTCOMES: Outcome[] = [
  { name: 'accepted', label: 'ответил согласием (accepted/hired) среди ответивших', pick: (r) => (['accepted', 'hired', 'declined'].includes(r.status) ? ['accepted', 'hired'].includes(r.status) : null) },
  { name: 'call', label: 'созвон (живая защита) состоялся среди ответивших согласием', pick: (r) => (['accepted', 'hired'].includes(r.status) ? r.callDone : null) },
  { name: 'hired', label: 'вышел (hired) среди принявших', pick: (r) => (['accepted', 'hired'].includes(r.status) ? r.status === 'hired' : null) },
];

async function main() {
  const invs = await prisma.invitation.findMany({
    where: { vacancyId: { not: null }, companyId: { not: null }, status: { in: ['accepted', 'declined', 'hired'] } },
    select: { id: true, status: true, vacancyId: true, companyId: true, candidateId: true, liveDefenses: { select: { status: true } } },
  });
  console.log(`Приглашений по потребности с итоговым ответом: ${invs.length}`);
  if (invs.length === 0) { console.log('Нет данных: исходов приглашений пока нет. Скрипт сработает, когда они появятся.'); return; }
  const catalog = await loadCatalog();
  const rows: Row[] = [];
  const poolCache = new Map<string, Awaited<ReturnType<typeof loadPool>>>();
  for (const inv of invs) {
    try {
      const v = await getVacancy(inv.companyId!, inv.vacancyId!);
      if (!poolCache.has(inv.companyId!)) poolCache.set(inv.companyId!, await loadPool(catalog, inv.companyId!));
      const row = poolCache.get(inv.companyId!)!.find((p) => p.evidence.id === inv.candidateId);
      if (!row) continue; // кандидат скрыт или нанят другой компанией – балла нет
      const r = scoreCandidate(row.evidence, { vacancyId: v.id, specialization: v.specialization, subcategoryId: v.subcategoryId, grade: v.grade, needs: v.needs, stack: v.stack }, catalog);
      if (!r || dropUncovered([r]).length === 0) continue;
      rows.push({ status: inv.status, callDone: inv.liveDefenses.some((d) => d.status === 'done'), p: scoreToProbability(r.score) });
    } catch (e) {
      console.warn(`пропуск ${inv.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`С баллом подбора: ${rows.length}`);
  for (const o of OUTCOMES) {
    const sub = rows.map((r) => ({ r, y: o.pick(r) })).filter((x): x is { r: Row; y: boolean } => x.y !== null);
    if (sub.length < MIN) { console.log(`\n${o.label}: нет данных (n = ${sub.length} < ${MIN})`); continue; }
    const ps = sub.map((x) => x.r.p), ys = sub.map((x) => (x.y ? 1 : 0));
    const base = ys.reduce<number>((s, y) => s + y, 0) / ys.length;
    console.log(`\n${o.label}: n = ${sub.length}, доля ${(base * 100).toFixed(1)} %`);
    console.log(`Brier ${brier(ps, ys).toFixed(3)} (константа «средняя доля»: ${brier(ps.map(() => base), ys).toFixed(3)}), ECE ${ece(calibrationCurve(ps, ys)).toFixed(3)}`);
    for (const b of calibrationCurve(ps, ys, 5)) if (b.n) console.log(`  ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}  прогноз ${b.meanScore!.toFixed(2)}  факт ${b.share!.toFixed(2)}  n = ${b.n}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
