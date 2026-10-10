import type { DepthMapItem } from '@/server/call/types';
import { competencyById } from '@/server/interview/model';
import { buildInterviewSummary, gradeFitLabel, gradeFitShare, interviewSummaryText, overallScore } from '@/server/interview/verdict';

const item = (topic: string, over: Partial<DepthMapItem>): DepthMapItem => ({
  topic,
  catalogId: null,
  claimed: false,
  claimStatement: null,
  probed: 1,
  maxLevel: 2,
  confirmed: true,
  status: 'confirmed',
  scores: { depth: 2, why: 2, boundary: 1, completion: 1 },
  total: 6,
  quote: 'цитата',
  runs: [],
  ...over,
});
const byTitle = (title: string) => ['backend.code', 'backend.data', 'backend.design', 'common.context', 'common.teamwork'].map((id) => competencyById(id)!).find((c) => c.title === title) ?? null;

describe('результат ИИнтервью: оси, соответствие грейду, итог', () => {
  const depthMap = [
    item('Код и язык', { maxLevel: 3, total: 7, scores: { depth: 2, why: 2, boundary: 2, completion: 1 } }),
    item('Данные и хранение', { maxLevel: 1, total: 5, scores: { depth: 2, why: 1, boundary: 1, completion: 1 } }),
    item('Проектирование сервисов', { status: 'not_confirmed', confirmed: false, total: 3, scores: { depth: 1, why: 0, boundary: 1, completion: 1 } }),
    item('Контекст и роль', { total: 6 }),
    item('Работа в команде', { status: 'not_probed', confirmed: false, probed: 0, total: 0, scores: { depth: 0, why: 0, boundary: 0, completion: 0 } }),
  ];
  const s = buildInterviewSummary({ depthMap, competencyOf: byTitle, claimedGrade: 'middle', blocks: ['intro', 'test', 'systems'] });

  it('продемонстрированный уровень — по глубине вопроса, только у подтверждённых', () => {
    const c = Object.fromEntries(s.competencies.map((x) => [x.id, x]));
    expect(c['backend.code']!.demonstrated).toBe('senior');
    expect(c['backend.data']!.demonstrated).toBe('junior');
    expect(c['backend.design']!.demonstrated).toBeNull();
    expect(c['common.teamwork']!.status).toBe('not_probed');
  });

  it('оси: среднее total/8 по проверенным; непроверенная ось — null', () => {
    const ax = Object.fromEntries(s.axes.map((a) => [a.axis, a]));
    expect(ax.technical!.score).toBe(Math.round(((7 + 5) / 16) * 100));
    expect(ax.systems!.score).toBe(Math.round((3 / 8) * 100));
    expect(ax.communication!.score).toBe(75);
    expect(ax.communication!.probed).toBe(1);
    const empty = buildInterviewSummary({ depthMap: [], competencyOf: byTitle, claimedGrade: null, blocks: [] });
    expect(empty.axes.every((a) => a.score === null)).toBe(true);
    expect(empty.overall).toBeNull();
    expect(empty.gradeFit.label).toBe('unknown');
    expect(interviewSummaryText(empty)).toBe('Ответов для оценки не было.');
  });

  it('соответствие грейду: доля технических и системных на уровне ≥ заявленного', () => {
    // Middle: code (senior) ✓, data (junior) ✗, design (не подтверждена) ✗ → 1/3.
    expect(gradeFitShare(s.competencies, 'middle')).toBeCloseTo(1 / 3);
    expect(s.gradeFit.label).toBe('below');
    expect(s.gradeFit.text).toContain('Middle');
    expect(gradeFitShare(s.competencies, 'junior')).toBeCloseTo(2 / 3);
    expect(gradeFitLabel(2 / 3)).toBe('partial');
    expect(gradeFitLabel(0.67)).toBe('match');
    expect(gradeFitLabel(null)).toBe('unknown');
  });

  it('итог — взвешенное среднее доступных осей; сильные стороны и зона роста — по названиям', () => {
    expect(s.overall).toBe(overallScore(s.axes));
    expect(s.overall).toBeGreaterThan(0);
    expect(s.strengths).toEqual(['Код и язык', 'Контекст и роль', 'Данные и хранение']);
    expect(s.growth).toEqual(['Проектирование сервисов']);
    expect(interviewSummaryText(s)).toContain('Подтверждено компетенций: 3 из 4');
    expect(overallScore([{ axis: 'technical', score: 50, probed: 1, confirmed: 1 }])).toBe(50);
  });
});
