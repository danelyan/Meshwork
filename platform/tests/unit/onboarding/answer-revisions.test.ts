// Журнал редакций опроса (C05, аудит 11.10): записи только на изменившиеся ответы.
import { answerRevisions, revisionRows } from '@/server/onboarding/service';

describe('answerRevisions', () => {
  it('новый ответ, изменённый ответ и удалённый ответ дают по записи; одинаковое значение - нет', () => {
    const before = { goal: 'job_search', grade: 'junior', stack: ['Go', 'SQL'], salary: { from: 100, to: 150 } };
    const after = { goal: 'job_search', grade: 'middle', stack: ['Go', 'SQL'], city: 'Казань' };
    const rows = answerRevisions(before, after, 'user').sort((a, b) => a.stepId.localeCompare(b.stepId));
    expect(rows).toEqual([
      { stepId: 'city', previous: null, value: 'Казань', source: 'user' },
      { stepId: 'grade', previous: 'junior', value: 'middle', source: 'user' },
      { stepId: 'salary', previous: { from: 100, to: 150 }, value: null, source: 'user' },
    ]);
  });

  it('без изменений - пустой журнал; сброс пишет каждый стёртый ответ', () => {
    expect(answerRevisions({ goal: 'x' }, { goal: 'x' }, 'user')).toEqual([]);
    expect(answerRevisions({}, {}, 'reset')).toEqual([]);
    expect(answerRevisions({ goal: 'x', grade: 'junior' }, {}, 'reset').map((r) => [r.stepId, r.value, r.source])).toEqual([
      ['goal', null, 'reset'],
      ['grade', null, 'reset'],
    ]);
  });

  it('строки для БД: отсутствие ответа - DbNull, не JSON null', () => {
    const [row] = revisionRows('u1', [{ stepId: 'city', previous: null, value: 'Казань', source: 'user' }]);
    expect(row).toMatchObject({ userId: 'u1', stepId: 'city', value: 'Казань', source: 'user' });
    expect(typeof row!.previous).toBe('object');
    expect(JSON.stringify(row!.previous)).not.toBe('null');
  });
});
