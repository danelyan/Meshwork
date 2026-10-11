import { describe, expect, it } from 'vitest';

import { SETTINGS, SETTING_KEYS } from '@/server/admin/settings/registry';
import { COMPLAINT_SANCTIONS, SALARY_LIMITS, companyTrust, complaintWindowStart, detectRedFlags, invitationSanction } from '@/server/employer/antifraud';
import { DAILY_INVITATION_LIMIT } from '@/server/employer/weights';
import { GRADE_CHANGE_INTERVAL_DAYS, RETAKE_SAME_GRADE_DAYS } from '@/server/recommend/weights';

describe('реестр настроек: схемы', () => {
  it('умолчания из кода совпадают с прежними константами', () => {
    expect(SETTINGS['test.gradeChangeIntervalDays'].default()).toBe(30);
    expect(SETTINGS['test.gradeChangeIntervalDays'].default()).toBe(GRADE_CHANGE_INTERVAL_DAYS);
    expect(SETTINGS['test.retakeSameGradeDays'].default()).toBe(RETAKE_SAME_GRADE_DAYS);
    expect(SETTINGS['employer.dailyInvitationLimit'].default()).toBe(DAILY_INVITATION_LIMIT);
    expect(SETTINGS['employer.complaintSanctions'].default()).toEqual({ reducedAt: 3, reducedLimit: 5, blockedAt: 5 });
    expect(SETTINGS['employer.complaintTrustPenalty'].default()).toEqual({ perComplaint: 10, max: 40 });
    expect(SETTINGS['employer.salaryLimits'].default()).toEqual({ minFrom: 25_000, maxTo: 1_000_000, maxRatio: 3 });
    expect(SETTINGS['employer.trustWeights'].default()).toEqual({ profile: 35, inn: 25, age: 15, declines: 25 });
  });

  it('умолчания проходят собственные схемы (кроме зависящих от env)', () => {
    for (const key of SETTING_KEYS.filter((k) => !/^(llm|call)\./.test(k))) {
      expect(SETTINGS[key].schema.safeParse(SETTINGS[key].default()).success, key).toBe(true);
    }
  });

  it('схемы отвергают мусор', () => {
    expect(SETTINGS['employer.dailyInvitationLimit'].schema.safeParse(0).success).toBe(false);
    expect(SETTINGS['employer.dailyInvitationLimit'].schema.safeParse('20').success).toBe(false);
    expect(SETTINGS['employer.dailyInvitationLimit'].schema.safeParse(1.5).success).toBe(false);
    expect(SETTINGS['employer.complaintSanctions'].schema.safeParse({ reducedAt: 6, reducedLimit: 5, blockedAt: 5 }).success).toBe(false);
    expect(SETTINGS['employer.trustWeights'].schema.safeParse({ profile: 60, inn: 30, age: 15, declines: 25 }).success).toBe(false);
    expect(SETTINGS['catalog.hiddenTaskTemplates'].schema.safeParse([1]).success).toBe(false);
  });
});

describe('чистые функции принимают параметры настроек', () => {
  it('invitationSanction: свои пороги', () => {
    expect(invitationSanction(2, 20, { reducedAt: 2, reducedLimit: 3, blockedAt: 4 })).toEqual({ level: 'reduced', complaints: 2, limit: 3 });
    expect(invitationSanction(4, 20, { reducedAt: 2, reducedLimit: 3, blockedAt: 4 }).level).toBe('blocked');
    expect(invitationSanction(3, 20)).toEqual(invitationSanction(3, 20, COMPLAINT_SANCTIONS));
  });

  it('detectRedFlags: своя вилка', () => {
    const texts = ['Ищем разработчика с опытом, команда из пяти человек, офис в центре, оформление по ТК и ДМС.'];
    const codes = (limits?: typeof SALARY_LIMITS) => detectRedFlags({ texts, salaryFrom: 60_000, salaryTo: 90_000 }, limits).map((f) => f.code);
    expect(codes()).not.toContain('salary_unrealistic');
    expect(codes({ minFrom: 100_000, maxTo: 1_000_000, maxRatio: 3 })).toContain('salary_unrealistic');
    expect(codes({ minFrom: 25_000, maxTo: 80_000, maxRatio: 3 })).toContain('salary_unrealistic');
  });

  it('companyTrust: веса и штрафы из настроек', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const c = { name: 'ООО Пример', description: 'О', industry: 'Ф', innValid: true, contact: '@hr', createdAt: new Date('2026-08-01T00:00:00Z'), invitationsSent: 2, invitationsDeclined: 0, now };
    expect(companyTrust(c).index).toBe(35 + 25 + 15 + 12);
    expect(companyTrust(c, { weights: { profile: 10, inn: 10, age: 10, declines: 10 } }).index).toBe(10 + 10 + 10 + 5);
    const base = companyTrust(c).index;
    expect(companyTrust({ ...c, complaints: 2 }, { complaintPenalty: { perComplaint: 5, max: 40 } }).index).toBe(base - 10);
  });

  it('complaintWindowStart: своё окно', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(complaintWindowStart(now, 7).toISOString()).toBe('2026-10-03T12:00:00.000Z');
    expect(complaintWindowStart(now).toISOString()).toBe('2026-09-10T12:00:00.000Z');
  });
});
