// Правила самоотклика (R-C-12, R-E-07): когда открываются контакты и что принимает форма.
import { APPLICATION_MESSAGE_MAX, ApplicationAnswer, ApplicationInput, DAILY_APPLICATION_LIMIT } from '@/server/employer/application-schemas';
import { applicationContactsOpen } from '@/server/employer/applications';

describe('applicationContactsOpen', () => {
  it('контакты открыты только при accepted и действующем раскрытии', () => {
    expect(applicationContactsOpen('accepted', true)).toBe(true);
    expect(applicationContactsOpen('accepted', false)).toBe(false);
    for (const s of ['sent', 'viewed', 'declined'] as const) expect(applicationContactsOpen(s, true)).toBe(false);
  });
});

describe('ApplicationInput', () => {
  it('сообщение необязательно и не длиннее лимита', () => {
    expect(ApplicationInput.parse({ disclosureVersion: 'v' })).toEqual({ disclosureVersion: 'v' });
    expect(ApplicationInput.safeParse({ message: 'x'.repeat(APPLICATION_MESSAGE_MAX) }).success).toBe(true);
    expect(ApplicationInput.safeParse({ message: 'x'.repeat(APPLICATION_MESSAGE_MAX + 1) }).success).toBe(false);
    expect(ApplicationInput.parse({ message: '  привет  ' }).message).toBe('привет');
  });
  it('ответ работодателя — только accept | decline', () => {
    expect(ApplicationAnswer.safeParse({ action: 'accept' }).success).toBe(true);
    expect(ApplicationAnswer.safeParse({ action: 'hire' }).success).toBe(false);
  });
  it('лимит в сутки — положительный', () => expect(DAILY_APPLICATION_LIMIT).toBeGreaterThan(0));
});
