import { describeMailError } from '@/server/mail';

describe('describeMailError', () => {
  it('AggregateError с пустым message (ECONNREFUSED по двум адресам) — коды вложенных ошибок', () => {
    const a = Object.assign(new Error('connect ECONNREFUSED ::1:1025'), { code: 'ECONNREFUSED' });
    const b = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1025'), { code: 'ECONNREFUSED' });
    const agg = new AggregateError([a, b], '');
    expect(describeMailError(agg)).toBe('connect ECONNREFUSED ::1:1025; connect ECONNREFUSED 127.0.0.1:1025');
  });
  it('ошибка без message — код или имя', () => {
    expect(describeMailError(Object.assign(new Error(''), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
    expect(describeMailError(new Error(''))).toBe('Error');
  });
  it('не Error и пустая строка — не пустая причина', () => {
    expect(describeMailError(undefined)).toBe('неизвестная ошибка');
    expect(describeMailError('')).toBe('неизвестная ошибка');
  });
  it('обычная SMTP-ошибка — как есть', () => {
    expect(describeMailError(new Error('SMTP: ответ 535 на AUTH'))).toBe('SMTP: ответ 535 на AUTH');
  });
});
