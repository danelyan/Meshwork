
const recommend = vi.hoisted(() => ({
  recommendTargets: vi.fn(),
  recommendTest: vi.fn(),
}));
vi.mock('@/server/recommend', () => recommend);

import { fallbackReply } from '@/server/agent/fallback';

describe('fallbackReply', () => {
  beforeEach(() => {
    recommend.recommendTargets.mockReset();
    recommend.recommendTest.mockReset();
  });

  it('после конвейера: что прочитал, сколько нашёл, скрытый текст, предложение теста', async () => {
    recommend.recommendTest.mockResolvedValue({ specialization: 'backend', grade: 'junior', reason: 'по 3 утверждениям', allowed: true });
    const text = await fallbackReply({
      candidateId: 'c',
      text: '',
      reason: 'llm_unavailable',
      pipeline: {
        docs: [{ label: 'резюме cv.pdf (20 строк)', origin: 'cv.pdf', sourceKind: 'resume', lines: 20 }],
        failed: [],
        proposed: [{ id: '1', catalogId: 'be.framework', statement: 's', level: 'self_reported', sourceRef: 'r' }],
        rejected: 2,
        merged: 0,
        rejectSummary: '2 без цитаты в источнике',
        hiddenText: 1,
        injectionSuspect: false,
        degraded: true,
      },
    });
    expect(text).toContain('Прочитал: резюме cv.pdf');
    expect(text).toContain('скрытый текст');
    expect(text).toContain('Нашёл 1 утверждение, 2 отбросил');
    expect(text).toContain('Backend, Junior');
    expect(text).toContain('Категорию даёт только тест');
  });

  it('вопрос про вакансии → список по вакансиям платформы; модуль недоступен → честная фраза', async () => {
    recommend.recommendTargets.mockResolvedValue([
      { companyName: 'Альфа', title: 'Backend', covered: 4, total: 6, missing: [{ catalogId: 'x', statement: 'Kafka' }] },
    ]);
    const ok = await fallbackReply({ candidateId: 'c', text: 'Хочу в финтех, какие вакансии?', reason: 'timeout' });
    expect(ok).toContain('закрываешь 4 из 6, не хватает: Kafka');
    recommend.recommendTargets.mockRejectedValue(new Error('not implemented: recommend'));
    const bad = await fallbackReply({ candidateId: 'c', text: 'какие вакансии?', reason: 'timeout' });
    expect(bad).toContain('недоступен');
  });

  it('обычный вопрос → общий шаблон', async () => {
    const text = await fallbackReply({ candidateId: 'c', text: 'привет', reason: 'budget_exceeded' });
    expect(text).toContain('упрощённом режиме');
  });
});
