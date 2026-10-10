import { proofLabels, recommendationTargetLabel } from '@/components/candidate/CandidateSkills';
import type { RecommendationsView } from '@/lib/api';

it('labels actual recommended vacancy rather than candidate specialization and grade', () => {
  const recs = { target: 'vacancy:frontend-role', targets: [{ vacancyId: 'frontend-role', companyName: 'Компания', title: 'Frontend Junior' }] } as RecommendationsView;
  expect(recommendationTargetLabel(recs)).toBe('Компания · Frontend Junior');
});
it('labels actual category target and handles absent target without inventing current category', () => {
  expect(recommendationTargetLabel({ target: 'category:frontend:middle' })).toBe('Frontend · Middle');
  expect(recommendationTargetLabel({ target: 'vacancy:outside', targets: [] })).toBe('Требования выбранной вакансии');
  expect(recommendationTargetLabel({})).toBe('Цель не выбрана');
});
it('translates machine proof identifiers and deduplicates generic types', () => {
  expect(proofLabels(['task:find-bug', 'task:code-output', 'interview:defend', 'registry:fsp-algo', 'artifact:repo'])).toBe('Практическое задание, Защита у консультанта, Достижения ФСП, Артефакт: код или материал работы');
  expect(proofLabels(['other:opaque'])).toBe('Подтверждающий материал');
  expect(proofLabels([])).toBe('Обсудить с консультантом');
});
