// Что кандидат видит об индексе честности (аудит 11.10, п. 4): в режиме silent - ничего, кроме попытки, чью категорию
// выдача работодателя не учитывает (rankingHold); уровня и причин в представлении нет никогда.
import { resetEnvCache } from '@/server/env';
import { integrityView, type StoredIntegrity } from '@/server/test/service';

const HIGH: StoredIntegrity = {
  level: 'high', reasons: [{ code: 'fast_correct_series', group: 'time', detail: 'серия' }], version: 'integrity-v2', notes: [], lzStar: null, flaggedItems: [1, 2],
  blocking: false, confirmGrade: null, confirmedBy: null, computedAt: '2026-10-11T10:00:00Z',
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('integrityView', () => {
  it('silent: пройденная попытка без rankingHold - null; с rankingHold - только флаг и подтверждающая попытка, без уровня и причин', () => {
    vi.stubEnv('TEST_INTEGRITY_ACTION', 'silent');
    resetEnvCache();
    expect(integrityView({ status: 'passed' }, HIGH, null)).toBeNull();
    expect(integrityView({ status: 'passed' }, HIGH, null, false)).toBeNull();
    const v = integrityView({ status: 'passed' }, HIGH, 'conf-1', true);
    expect(v).toEqual({ needsConfirmation: false, confirmGrade: null, confirmAttemptId: 'conf-1', confirmedBy: null, rankingHold: true });
    expect(JSON.stringify(v)).not.toMatch(/level|reasons|flaggedItems|fast_correct/);
  });

  it('confirm: needs_confirmation видна и без rankingHold; подтверждённая исходная показывает confirmedBy', () => {
    vi.stubEnv('TEST_INTEGRITY_ACTION', 'confirm');
    resetEnvCache();
    expect(integrityView({ status: 'needs_confirmation' }, { ...HIGH, blocking: true, confirmGrade: 'middle' }, null)).toEqual({
      needsConfirmation: true, confirmGrade: 'middle', confirmAttemptId: null, confirmedBy: null, rankingHold: false,
    });
    expect(integrityView({ status: 'needs_confirmation' }, { ...HIGH, confirmedBy: 'conf-1' }, 'conf-1')).toMatchObject({ needsConfirmation: false, confirmedBy: 'conf-1' });
  });

  it('без сохранённого индекса - null при любых флагах', () => {
    expect(integrityView({ status: 'passed' }, null, null, true)).toBeNull();
  });
});
