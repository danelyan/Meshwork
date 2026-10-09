/**
 * Текст реплики компаньона → текст для синтеза речи. Общий для клиента (обрезка перед запросом)
 * и сервера (`/api/tts` чистит ещё раз — клиенту не доверяем). Markdown, ссылки и код вслух не читаем:
 * ссылка звучит как «ссылка», блок кода выпадает, маркеры списков и выделения снимаются.
 */
export const TTS_MAX_CHARS = 1000;

const END = /[.!?…:;]$/;

export function cleanForSpeech(input: string): string {
  let t = input.replace(/\r\n?/g, '\n');
  t = t.replace(/```[\s\S]*?(```|$)/g, ' '); // блоки кода (и незакрытый хвост)
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // картинки → подпись
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // ссылки → текст ссылки
  t = t.replace(/<\/?[a-z][^>]*>/gi, ' '); // html-теги
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/\bhttps?:\/\/\S+/gi, 'ссылка');
  t = t.replace(/\bwww\.\S+/gi, 'ссылка');
  t = t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '');
  const lines = t
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '') // заголовки
        .replace(/^\s*>+\s?/, '') // цитаты
        .replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, '') // маркеры списков
        .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/, '') // разделитель таблицы
        .replace(/\s*\|\s*/g, ', ')
        .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
        .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
        .replace(/^[,\s]+|[,\s]+$/g, '')
        .trim(),
    )
    .filter(Boolean);
  // Перевод строки без знака препинания в конце — пауза: ставим точку.
  const joined = lines.map((l, i) => (i < lines.length - 1 && !END.test(l) ? `${l}.` : l)).join(' ');
  return joined.replace(/[ \t]+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
}

/** Не длиннее `max`: режем по концу предложения, если он не слишком близко к началу, иначе по слову. */
export function truncateForSpeech(text: string, max = TTS_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1);
  const cut = head.slice(0, max - 1); // место под «…»
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/** То, что реально уйдёт в синтез: чистка + обрезка. Пустая строка — озвучивать нечего. */
export function speechText(input: string, max = TTS_MAX_CHARS): string {
  return truncateForSpeech(cleanForSpeech(input), max);
}
