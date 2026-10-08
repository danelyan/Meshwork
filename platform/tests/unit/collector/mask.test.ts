import { MASK, maskContacts } from '@/server/collector/mask';

describe('collector/mask', () => {
  it.each([
    ['+7 (999) 123-45-67'],
    ['+79991234567'],
    ['8 999 123 45 67'],
    ['8-999-123-45-67'],
    ['8(999)1234567'],
    ['+7.999.123.45.67'],
    ['+44 20 7946 0958'],
    ['ivan.petrov+cv@mail.example.ru'],
    ['https://t.me/ivan_petrov'],
    ['t.me/ivan_petrov'],
    ['wa.me/79991234567'],
    ['Telegram: @ivan_petrov'],
    ['tg @ivan_petrov'],
    ['Телеграм — ivan_petrov'],
    ['ул. Ленина, д. 5, кв. 12'],
    ['проспект Мира 10'],
    ['д. 5, корп. 2, кв. 7'],
  ])('маскирует %s', (src) => {
    const r = maskContacts(`Контакт: ${src}.`);
    expect(r.text).toContain(MASK);
    expect(r.masked).toBeGreaterThan(0);
    // ни одной длинной цифровой последовательности/почты не осталось
    expect(r.text).not.toMatch(/\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
    expect(r.text).not.toMatch(/@\w/);
  });

  it('индекс перед городом скрывается, город остаётся', () => {
    const r = maskContacts('Адрес: 123456, г. Казань');
    expect(r.text).toBe(`Адрес: ${MASK}, г. Казань`);
  });

  it.each([
    'Go, PostgreSQL, Docker',
    'Опыт 2019–2023, 3 года',
    'Telegram-бот на Python',
    'Telegram bots на aiogram',
    'Codeforces rating 1650, 120 задач',
    'github.com/ivan-petrov',
    'Москва, готов к релокации',
    'React 18, TypeScript 5.4, Node.js 22',
    'ИНН не указываю, СНИЛС тоже',
    'Обработал 1000000 запросов',
  ])('не трогает обычный текст: %s', (src) => {
    const r = maskContacts(src);
    expect(r).toEqual({ text: src, masked: 0 });
  });

  it('считает все замены', () => {
    const r = maskContacts('a@b.ru, c@d.ru, +7 999 000-00-00');
    expect(r.masked).toBe(3);
  });
});
