/**
 * Маскирование контактов кандидата до того, как текст уйдёт в LLM и в БД
 * (152-ФЗ, E-01 § 6). Заменяем на `[скрыто]`: телефоны, email, ссылки и ники
 * мессенджеров, почтовые адреса (улица/дом/квартира, индекс). Город не трогаем —
 * он нужен для подбора (релокация, офис).
 */
export const MASK = '[скрыто]';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Мессенджеры: ссылки t.me / telegram.me / wa.me / api.whatsapp.com / viber, а также
// «telegram: @nick», «tg @nick», «телеграм — @nick».
const MESSENGER_LINK =
  /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|viber\.click)\/[^\s,;)]+/gi;
const MESSENGER_HANDLE =
  /((?<![\p{L}\d_])(?:telegram|телеграм|телеграмм|tg|тг|whatsapp|вотсап|ватсап|viber|вайбер)(?:\s*:\s*@?|\s+[\-—–]\s*@?|\s*@))[A-Za-z0-9_]{4,32}\b/giu;

// Телефоны: +7 / 8 / 7 и 10 цифр с любыми разделителями; международные с «+» и 10–15 цифрами.
const PHONE_RU = /(?<![\d\w])(?:\+\s?7|8|7)[\s\-–.(]*\d{3}[\s\-–.)]*\d{3}[\s\-–.]*\d{2}[\s\-–.]*\d{2}(?!\d)/g;
const PHONE_INTL = /(?<![\d\w])\+\d[\d\s\-–.()]{8,18}\d(?!\d)/g;

// Адреса: «ул. Ленина, д. 5, кв. 12», «проспект Мира 10-25», «д. 5, корп. 2», индекс + город.
const STREET = String.raw`(?:ул\.|улица|пр-т|пр\.|проспект|пер\.|переулок|ш\.|шоссе|б-р|бульвар|наб\.|набережная|пл\.|площадь|проезд|мкр\.?|микрорайон)`;
const HOUSE = String.raw`(?:д\.|дом|корп\.|корпус|к\.|стр\.|строение|кв\.|квартира|оф\.|офис)\s*\d+[\wа-яА-Я/-]*`;
const ADDRESS_STREET = new RegExp(
  String.raw`${STREET}\s+[^\n,;]{1,40}?(?:,?\s*\d+[\wа-я/-]*)?(?:,?\s*${HOUSE})*(?=[\s,;.)]|$)`,
  'giu',
);
const ADDRESS_HOUSE = new RegExp(String.raw`(?<![\wа-яА-Я])${HOUSE}(?:,?\s*${HOUSE})*`, 'giu');
const POSTCODE = /(?<!\d)\d{6},\s*(?=(?:г\.|город|[А-ЯЁ]))/g;

function digits(s: string): number {
  return s.replace(/\D/g, '').length;
}

export function maskContacts(text: string): { text: string; masked: number } {
  let masked = 0;
  const replace = (re: RegExp, s: string, fn?: (m: string, ...g: string[]) => string | null): string =>
    s.replace(re, (m: string, ...rest: unknown[]) => {
      const out = fn ? fn(m, ...(rest.filter((x) => typeof x === 'string') as string[])) : MASK;
      if (out === null) return m;
      masked += 1;
      return out;
    });

  let out = text;
  out = replace(MESSENGER_LINK, out);
  out = replace(EMAIL, out);
  out = replace(MESSENGER_HANDLE, out, (_m, prefix) => `${prefix ?? ''}${MASK}`);
  out = replace(PHONE_RU, out, (m) => (digits(m) === 11 || digits(m) === 10 ? MASK : null));
  out = replace(PHONE_INTL, out, (m) => (digits(m) >= 10 && digits(m) <= 15 ? MASK : null));
  out = replace(POSTCODE, out, () => `${MASK}, `);
  out = replace(ADDRESS_STREET, out);
  out = replace(ADDRESS_HOUSE, out);
  return { text: out, masked };
}
