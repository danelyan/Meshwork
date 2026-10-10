// Грейд Senior (ADR 0003, дополнение 10.10 16:15; ADR-0002 «Senior и пул по подкатегориям»): порог, основная фаза
// только по Senior-пулу, дозадавание Middle и Middle в один клик.
import { poolFor } from '@/server/test/generators';
import { estimateTheta, type Response } from '@/server/test/irt';
import {
  decide,
  explainDecision,
  GRADE_CUT,
  nextStep,
  phasePool,
  probeGrade,
  selectNext,
  SENIOR_CUT,
  START_THETA,
  type AttemptPhase,
  type SelectableTemplate,
  type Step,
} from '@/server/test/policy';
import { deriveSeed } from '@/server/test/rng';
import type { Grade } from '@/server/types';

const pool: SelectableTemplate[] = poolFor('ai', 'ai.mlops')!.generators.map((g) => ({ id: g.id, a: g.a, b: g.b, catalogIds: g.catalogIds, grade: g.grade }));

/** Цикл сервиса: старт с START_THETA, дальше θ̂ по ответам, фаза из nextStep. */
function play(grade: Grade, seed: number, answer: (t: SelectableTemplate) => boolean) {
  const shown: SelectableTemplate[] = [];
  const responses: Response[] = [];
  const phases: AttemptPhase[] = [];
  let phase: AttemptPhase = 'main';
  let step: Step | null = null;
  for (let i = 0; i < 40; i++) {
    const theta = responses.length ? estimateTheta(responses).theta : START_THETA[grade];
    const next = selectNext(phasePool(pool, phase, grade), { shown, theta, seed: deriveSeed(seed, 1000 + i) });
    if (!next) break;
    shown.push(next);
    phases.push(phase);
    responses.push({ a: next.a, b: next.b, correct: answer(next) });
    step = nextStep({ pool, shown, responses, grade });
    if (step.stop) break;
    phase = step.phase;
  }
  return { shown, responses, phases, step: step!, d: decide(responses, grade) };
}

describe('Senior', () => {
  it('порог выше Middle; грейд дозадавания: Senior → Middle, остальные → Junior', () => {
    expect(GRADE_CUT.senior).toBe(SENIOR_CUT);
    expect(GRADE_CUT.senior).toBeGreaterThan(GRADE_CUT.middle);
    expect(probeGrade('senior')).toBe('middle');
    expect(probeGrade('middle')).toBe('junior');
    expect(probeGrade('junior')).toBe('junior');
  });

  it('заявка Senior: основная фаза — только Senior-задания, не дольше Senior-пула; Middle — весь пул', () => {
    const seniorCount = pool.filter((t) => t.grade === 'senior').length;
    for (let seed = 1; seed <= 50; seed++) {
      for (const answer of [() => true, () => false, (t: SelectableTemplate) => t.grade !== 'senior']) {
        const r = play('senior', seed, answer);
        r.phases.forEach((p, i) => {
          if (p === 'main') expect(r.shown[i]!.grade).toBe('senior');
        });
        expect(r.phases.filter((p) => p === 'main').length).toBeLessThanOrEqual(seniorCount);
      }
      // Middle-заявка видит и Junior-, и Middle-задания, Senior — тоже (пул подкатегории целиком).
      expect(new Set(play('middle', seed, () => true).shown.map((t) => t.grade)).size).toBeGreaterThan(1);
    }
    expect(nextStep({ pool, shown: [], responses: [], grade: 'senior' }).maxItems).toBe(seniorCount);
  });

  it('всё верно → Senior подтверждён; Senior-задания неверно, остальное верно → Senior не подтверждён, предложен Middle', () => {
    let confirmed = 0;
    let offered = 0;
    for (let seed = 1; seed <= 100; seed++) {
      if (play('senior', seed, () => true).d.confirmed) confirmed++;
      const r = play('senior', seed, (t) => t.grade !== 'senior');
      expect(r.d.confirmed).toBe(false);
      if (r.d.juniorOffered) {
        expect(r.d.offeredGrade).toBe('middle');
        offered++;
      }
    }
    expect(confirmed).toBeGreaterThanOrEqual(90);
    expect(offered).toBeGreaterThanOrEqual(85);
  });

  it('дозадавание Senior → только Middle-задания; объяснение называет Middle', () => {
    let probed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      // Неуверенный профиль: Senior неверно, Middle — через одно.
      let k = 0;
      const r = play('senior', seed, (t) => (t.grade === 'senior' ? false : t.grade === 'middle' ? k++ % 2 === 0 : true));
      r.phases.forEach((p, i) => {
        if (p === 'middle_probe') expect(r.shown[i]!.grade).toBe('middle');
        expect(p).not.toBe('junior_probe');
      });
      if (r.phases.includes('middle_probe')) probed++;
    }
    expect(probed).toBeGreaterThan(0);
    const d = decide([{ a: 1.2, b: 1.3, correct: false }, ...Array.from({ length: 8 }, () => ({ a: 1.2, b: 0.3, correct: true }))], 'senior');
    if (d.juniorOffered) expect(explainDecision(d, 'senior', 9, 8)).toMatch(/можно подтвердить Middle/);
  });
});
