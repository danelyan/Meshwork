import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resetEnvCache } from '@/server/env';
import { MAIL_COLORS, escapeHtml, renderMailHtml } from '@/server/mail/layout';
import { alreadyRegisteredMail, invitationAnswerMail, invitationMail, resetCodeMail, verifyCodeMail } from '@/server/mail/templates';

const APP_URL = 'https://career.example.test';

/** Текст, который увидит читатель HTML-письма: без тегов, сущности раскрыты. */
const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('шаблоны писем', () => {
  const before = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = APP_URL;
    resetEnvCache();
  });
  afterAll(() => {
    if (before === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = before;
    resetEnvCache();
  });

  const all = () => [
    verifyCodeMail('ivan@example.test', '123456'),
    resetCodeMail('ivan@example.test', '654321'),
    alreadyRegisteredMail('ivan@example.test'),
    invitationMail('irina@example.test', { companyName: 'ООО Ромашка', vacancyTitle: 'Бэкенд-разработчик', salaryFrom: 250_000, salaryTo: 300_000 }),
    invitationAnswerMail('hr@romashka.test', { accepted: true, vacancyTitle: 'Бэкенд-разработчик' }),
    invitationAnswerMail('hr@romashka.test', { accepted: false, vacancyTitle: null }),
  ];

  it('у каждого письма есть текст и HTML-документ с темой в title и подписью платформы', () => {
    for (const mail of all()) {
      expect(mail.text.length, mail.kind).toBeGreaterThan(20);
      expect(mail.html, mail.kind).toMatch(/^<!doctype html>/);
      expect(mail.html).toContain(`<title>${escapeHtml(mail.subject)}</title>`);
      expect(mail.html).toContain(`href="${APP_URL}"`);
      expect(visible(mail.html!)).toContain('ФСП /карьера');
    }
  });

  it('HTML самодостаточен: ни картинок, ни скриптов, ни внешних стилей, ссылки только на платформу', () => {
    for (const mail of all()) {
      expect(mail.html, mail.kind).not.toMatch(/<(?:img|script|link|style|iframe|form)\b|url\(|\son[a-z]+=/i);
      const hrefs = [...mail.html!.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
      expect(hrefs.length, mail.kind).toBeGreaterThan(0);
      for (const href of hrefs) expect(href.startsWith(APP_URL), `${mail.kind}: ${href}`).toBe(true);
    }
  });

  it('код подтверждения и сброса — в теме, в тексте и в HTML отдельным блоком', () => {
    for (const [mail, code] of [[verifyCodeMail('a@b.test', '123456'), '123456'], [resetCodeMail('a@b.test', '654321'), '654321']] as const) {
      expect(mail.subject).toContain(code);
      expect(mail.text).toContain(code);
      expect(mail.html).toContain(`>${code}</td>`);
      expect(visible(mail.html!)).toContain('15 минут');
    }
  });

  it('приглашение: компания, позиция и зарплата в обоих вариантах, кнопка ведёт в кабинет', () => {
    const mail = invitationMail('irina@example.test', { companyName: 'ООО Ромашка', vacancyTitle: 'Бэкенд-разработчик', salaryFrom: 250_000, salaryTo: 300_000 });
    const seen = visible(mail.html!);
    for (const piece of ['ООО Ромашка', 'Бэкенд-разработчик', 'от 250', 'до 300', 'только если вы примете приглашение']) {
      expect(mail.text, piece).toContain(piece);
      expect(seen, piece).toContain(piece);
    }
    expect(mail.html).toContain(`href="${APP_URL}/invitations"`);
    expect(mail.html).toContain(MAIL_COLORS.blue);

    const noVacancy = invitationMail('irina@example.test', { companyName: 'ООО Ромашка', vacancyTitle: null, salaryFrom: 100_000, salaryTo: 100_000 });
    expect(visible(noVacancy.html!)).not.toContain('Позиция');
    expect(visible(noVacancy.html!)).toContain('к разговору о работе');
  });

  it('ответ на приглашение — работодателю: бордовый акцент и ссылка в его кабинет', () => {
    const accepted = invitationAnswerMail('hr@romashka.test', { accepted: true, vacancyTitle: 'Бэкенд-разработчик' });
    expect(accepted.html).toContain(`href="${APP_URL}/employer/invitations"`);
    expect(accepted.html).toContain(MAIL_COLORS.employer);
    expect(accepted.html).not.toContain(MAIL_COLORS.blue);
    const declined = invitationAnswerMail('hr@romashka.test', { accepted: false, vacancyTitle: null });
    expect(declined.html).toContain(`href="${APP_URL}/employer"`);
    expect(visible(declined.html!)).toContain('Кандидат отклонил ваше приглашение.');
  });

  it('пользовательский текст в HTML экранируется и разметкой не становится', () => {
    const companyName = '<img src=x onerror=alert(1)> & "Ко"';
    const vacancyTitle = `</td><script>alert('x')</script>`;
    const mail = invitationMail('irina@example.test', { companyName, vacancyTitle, salaryFrom: 1, salaryTo: 2 });
    expect(mail.html).not.toMatch(/<img|<script|onerror=alert\(1\)>/);
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Ко&quot;');
    expect(mail.html).toContain('&lt;/td&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
    // Читатель видит ровно то, что ввёл работодатель.
    expect(visible(mail.html!)).toContain(companyName);
    expect(visible(mail.html!)).toContain(vacancyTitle);
    expect(mail.text).toContain(companyName);
    const answer = invitationAnswerMail('hr@romashka.test', { accepted: true, vacancyTitle });
    expect(answer.html).not.toContain('<script');
  });

  it('оболочка экранирует каждое поле, включая адрес в атрибуте href', () => {
    const bad = '"><b>x</b>';
    const html = renderMailHtml({
      subject: bad,
      preheader: bad,
      kicker: bad,
      title: bad,
      lead: [bad],
      code: bad,
      facts: [{ label: bad, value: bad }],
      action: { label: bad, href: `${APP_URL}/?q=${bad}` },
      notes: [bad],
      siteUrl: APP_URL,
    });
    expect(html).not.toContain('<b>');
    // 9 полей по разу, значение факта и адрес кнопки: href кнопки, href запасной ссылки и её текст.
    expect(html.split(escapeHtml(bad)).length - 1).toBe(13);
  });

  it('цвета письма совпадают с токенами интерфейса', () => {
    const css = readFileSync(join(__dirname, '../../../src/styles/tokens.css'), 'utf8');
    const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim().toLowerCase();
    expect(token('ink')).toBe(MAIL_COLORS.ink);
    expect(token('paper')).toBe(MAIL_COLORS.paper);
    expect(token('muted')).toBe(MAIL_COLORS.muted);
    expect(token('blue')).toBe(MAIL_COLORS.blue);
    expect(token('employer-accent')).toBe(MAIL_COLORS.employer.toLowerCase());
    expect(token('on-ink')).toBe(MAIL_COLORS.white);
  });
});
