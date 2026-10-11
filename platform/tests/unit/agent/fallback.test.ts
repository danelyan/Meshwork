
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
        alreadyKnown: 0,
        rejectSummary: '2 без цитаты в источнике',
        hiddenText: 1,
        injectionSuspect: false,
        degraded: true,
      },
    });
    expect(text).toContain('Прочитала: резюме cv.pdf');
    expect(text).toContain('скрытый текст');
    expect(text).toContain('Нашла 1 утверждение, 2 отбросила');
    expect(text).toContain('Backend, Junior');
    expect(text).toContain('Категорию даёт только тест');
  });

  it('всё найденное уже в профиле → честное сообщение вместо «не нашёл»', async () => {
    const text = await fallbackReply({
      candidateId: 'c',
      text: '',
      reason: 'llm_unavailable',
      pipeline: { docs: [{ label: 'резюме', origin: 'cv.pdf', sourceKind: 'resume', lines: 5 }], failed: [], proposed: [], rejected: 0, merged: 0, alreadyKnown: 3, rejectSummary: '', hiddenText: 0, injectionSuspect: false, degraded: false },
    });
    expect(text).toContain('Новых утверждений нет: 3 уже в твоём профиле');
    expect(text).not.toContain('/profile');
    expect(text).not.toContain('не нашла');
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
