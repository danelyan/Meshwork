import { describe, expect, it } from 'vitest';

import { juryResult, JURY_REASON_LABEL } from '@/server/test/jury';

const INDEX = {
  level: 'high' as const,
  reasons: [{ code: 'canary_hit' as const, group: 'canary' as const, detail: 'совпал', item: 1 }],
  flaggedItems: [1, 4],
  lzStar: -2.1,
  notes: ['Подключён второй экран (пометка, не флаг)'],
};

describe('juryResult', () => {
  it('человеческие причины, номера заданий с 1, кандидат не видит ничего', () => {
    const j = juryResult(INDEX, { level: 'high', groups: ['time'], confirmedAgain: false }, true);
    expect(j.reasons[0]).toMatchObject({ code: 'canary_hit', item: 2, label: JURY_REASON_LABEL.canary_hit });
    expect(j.flaggedItems).toEqual([2, 5]);
    expect(j.candidateSees).toBe('ничего');
    expect(j.employerSees).toBe('тест под сомнением (время) - проверьте на созвоне');
  });

  it('категория не выдана - работодатель не видит ничего', () => {
    expect(juryResult(INDEX, null, false).employerSees).toContain('ничего');
  });
});
