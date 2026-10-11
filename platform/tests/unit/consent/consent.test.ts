import { describe, expect, it } from 'vitest';

import { objectionDueAt } from '@/server/consent/objections';
import { retentionCutoff } from '@/server/consent/recordings';
import { consentState, pickActive } from '@/server/consent/service';
import { CANDIDATE_ONBOARDING_KINDS, CONSENT_KINDS, CONSENT_TEXTS, EMPLOYER_ONBOARDING_KINDS, OPERATOR, consentVersion } from '@/server/consent/texts';

const at = (iso: string) => new Date(iso);
const row = (o: Partial<{ kind: string; version: string; acceptedAt: Date; revokedAt: Date | null; context: unknown }> = {}) => ({
  kind: 'ai_assessment' as const,
  version: consentVersion('ai_assessment'),
  acceptedAt: at('2026-10-11T10:00:00Z'),
  revokedAt: null as Date | null,
  context: null as unknown,
  ...o,
}) as { kind: 'ai_assessment'; version: string; acceptedAt: Date; revokedAt: Date | null; context: unknown };

describe('активное согласие (ADR 0005)', () => {
  it('нет строк – none; есть действующая текущей версии – active', () => {
    expect(consentState([], 'ai_assessment')).toBe('none');
    expect(consentState([row()], 'ai_assessment')).toBe('active');
  });
  it('последняя без revokedAt; все отозваны – revoked', () => {
    const old = row({ acceptedAt: at('2026-10-01T00:00:00Z') });
    const fresh = row({ acceptedAt: at('2026-10-05T00:00:00Z') });
    expect(pickActive([old, fresh])).toBe(fresh);
    expect(pickActive([old, { ...fresh, revokedAt: at('2026-10-06T00:00:00Z') }])).toBe(old);
    expect(consentState([{ ...old, revokedAt: at('2026-10-06T00:00:00Z') }], 'ai_assessment')).toBe('revoked');
  });
  it('действующая на прежнюю версию текста – outdated (спросить заново)', () => {
    expect(consentState([row({ version: '2026-01-01-old' })], 'ai_assessment')).toBe('outdated');
  });
  it('раскрытие – по приглашению, версия не переподтверждается', () => {
    const d = (inv: string, revoked: Date | null = null) => ({ ...row({ version: 'legacy-accepted-invitation', revokedAt: revoked, context: { invitationId: inv } }), kind: 'identity_disclosure' as const });
    const rows = [d('i1'), d('i2', at('2026-10-11T12:00:00Z'))];
    expect(consentState(rows, 'identity_disclosure', 'i1')).toBe('active');
    expect(consentState(rows, 'identity_disclosure', 'i2')).toBe('revoked');
    expect(consentState(rows, 'identity_disclosure', 'i3')).toBe('none');
  });
  it('строки чужого вида не влияют', () => {
    expect(consentState([{ ...row(), kind: 'research' } as never], 'ai_assessment')).toBe('none');
  });
});

describe('срок хранения записей и возражений', () => {
  it('граница срока: now − N дней', () => {
    expect(retentionCutoff(at('2026-10-11T00:00:00Z'), 90).toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });
  it('срок ответа на возражение – 30 дней', () => {
    expect(objectionDueAt(at('2026-10-11T00:00:00Z')).toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('тексты и версии', () => {
  it('у каждого вида – текст, своя версия с пометкой draft и заглушка оператора там, где назван оператор', () => {
    const versions = CONSENT_KINDS.map((k) => CONSENT_TEXTS[k].version);
    expect(new Set(versions).size).toBe(CONSENT_KINDS.length);
    for (const k of CONSENT_KINDS) {
      expect(CONSENT_TEXTS[k].kind).toBe(k);
      expect(CONSENT_TEXTS[k].version).toMatch(/draft$/);
      expect(CONSENT_TEXTS[k].paragraphs.length).toBeGreaterThan(0);
    }
    expect(CONSENT_TEXTS.pd_processing.paragraphs.join(' ')).toContain(OPERATOR);
    expect(OPERATOR).toBe('[Оператор: наименование, ИНН, адрес]');
  });
  it('Г1 обещает отзыв той же кнопкой, что удаляет аккаунт, а не письмом', () => {
    const t = CONSENT_TEXTS.pd_processing.paragraphs.join(' ');
    expect(t).toContain('«Отозвать согласие и удалить данные»');
    expect(t).not.toMatch(/письм/);
    expect(CONSENT_TEXTS.pd_processing.revoke).toBe('erase');
  });
  it('Г5 говорит, что полученные работодателем данные отозвать нельзя; Г3 – про возражение и 30 дней', () => {
    expect(CONSENT_TEXTS.identity_disclosure.paragraphs.join(' ')).toContain('отозвать невозможно');
    expect(CONSENT_TEXTS.ai_assessment.paragraphs.join(' ')).toMatch(/Оспорить.*30 дней/);
    expect(CONSENT_TEXTS.call_recording.paragraphs.join(' ')).toContain('90 дней');
  });
  it('галочки онбординга: кандидат Г3/Г4/Г6/Г7, работодатель – оферта и обязательство', () => {
    expect([...CANDIDATE_ONBOARDING_KINDS]).toEqual(['ai_assessment', 'employer_visibility', 'research', 'marketing']);
    expect([...EMPLOYER_ONBOARDING_KINDS]).toEqual(['employer_offer', 'employer_data_obligation']);
    expect(CONSENT_TEXTS.employer_offer.docUrl).toBe('/employer-terms');
  });
});
