import type { CompleteRequest } from '@/server/llm';

const complete = vi.fn();
let provider = 'openai-chat';
vi.mock('@/server/env', () => ({ getEnv: () => ({ LLM_PROVIDER: provider }) }));
vi.mock('@/server/llm', () => ({ getLlm: () => ({ complete }) }));

const { leadFor } = await import('@/server/onboarding/phrase');
const { findStep } = await import('@/server/onboarding/scenario');

const ctx = { answers: { role: 'candidate', goal: 'job_search' }, facts: { role: 'candidate' as const, consent: true, name: 'Иван', fspState: null, specialization: null } };
const prev = { step: findStep('goal')!, value: 'job_search', label: 'Ищу работу' };

afterEach(() => {
  complete.mockReset();
  provider = 'openai-chat';
});

it('с моделью: реплика от модели, системный промпт онбординга, имя и прошлый ответ во входе', async () => {
  complete.mockResolvedValue({ kind: 'text', text: 'Иван, тогда начнём с резюме.' });
  expect(await leadFor(findStep('documents')!, ctx, prev)).toBe('Иван, тогда начнём с резюме.');
  const req = complete.mock.calls[0]![0] as CompleteRequest;
  expect(req.system).toMatch(/помощник онбординга/);
  expect(JSON.parse(req.messages[0]!.content)).toMatchObject({ name: 'Иван', previous: { answer: 'Ищу работу' } });
});

it('ошибка модели или негодный текст — шаблон', async () => {
  complete.mockRejectedValue(new Error('timeout'));
  expect(await leadFor(findStep('documents')!, ctx, prev)).toMatch(/компании найдут вас сами/);
  complete.mockResolvedValue({ kind: 'text', text: '## Список\n\n- раз' });
  expect(await leadFor(findStep('documents')!, ctx, prev)).toMatch(/компании найдут вас сами/);
});

it('stub (демо) — модель не вызывается', async () => {
  provider = 'stub';
  expect(await leadFor(findStep('documents')!, ctx, prev)).toMatch(/компании найдут вас сами/);
  expect(complete).not.toHaveBeenCalled();
});
