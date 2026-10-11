import { describe, expect, it } from 'vitest';

import { domainOf, FREE_MAIL, parseEvidence } from '@/server/admin/moderation/verification';

describe('admin/verification: основание проверки', () => {
  it('домен – из адреса, в нижнем регистре; мусор – null', () => {
    expect(domainOf('HR@NorthStream.RU ')).toBe('northstream.ru');
    expect(domainOf('нет-адреса')).toBeNull();
    expect(domainOf(null)).toBeNull();
  });

  it('бесплатные почтовые домены не подтверждают компанию', () => {
    for (const d of ['gmail.com', 'yandex.ru', 'mail.ru']) expect(FREE_MAIL.has(d)).toBe(true);
    expect(FREE_MAIL.has('northstream.ru')).toBe(false);
  });

  it('основание: JSON разбирается, старый текст – как выписка', () => {
    expect(parseEvidence(JSON.stringify({ method: 'email_domain', text: '', domain: 'x.ru', requestedBy: 'p' }))).toMatchObject({ method: 'email_domain', domain: 'x.ru' });
    expect(parseEvidence('ОГРН 123')).toMatchObject({ method: 'egrul', text: 'ОГРН 123' });
    expect(parseEvidence(null)).toBeNull();
  });
});
