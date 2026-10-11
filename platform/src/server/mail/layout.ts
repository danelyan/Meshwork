/**
 * HTML-оболочка писем (docs/design-system.md, «Письма»). Почтовые клиенты не понимают CSS-переменные,
 * подключаемые шрифты и SVG, поэтому здесь таблицы, инлайн-стили и цвета – копии токенов из
 * `src/styles/tokens.css` (совпадение проверяет tests/unit/mail/templates.test.ts).
 * Все поля `MailView` – обычный текст: оболочка экранирует их сама, так что пользовательский текст
 * (название компании, вакансии) в разметку не попадает. Картинок и внешних ресурсов нет: письмо
 * выглядит одинаково при заблокированных изображениях.
 */
export const MAIL_COLORS = {
  ink: '#111111',
  paper: '#f1f1f3',
  muted: '#6b6b70',
  blue: '#402fff',
  employer: '#A3343F',
  white: '#ffffff',
} as const;

/** `--line` (чёрный 10 %) сплошным цветом: rgba почтовые клиенты поддерживают не все. Поверх белого и поверх `paper`. */
const LINE = '#e7e7e7';
const CARD_BORDER = '#dbdbdc';

const FONT = "'Golos Text', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export interface MailView {
  /** Тема письма – уходит в `<title>`. */
  subject: string;
  /** Строка предпросмотра в списке писем (в теле скрыта). */
  preheader: string;
  /** Служебная метка над заголовком, как `Kicker` в интерфейсе. */
  kicker: string;
  title: string;
  lead: string[];
  /** Одноразовый код: крупно, моноширинным. */
  code?: string;
  facts?: { label: string; value: string }[];
  action?: { label: string; href: string };
  /** Мелкий текст под основным блоком: срок действия кода, оговорки. */
  notes?: string[];
  /** Цвет акцента по адресату (Astra): кандидат – синий, работодатель – бордовый. */
  accent?: 'candidate' | 'employer';
  /** Адрес платформы для подписи. */
  siteUrl: string;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Текст → безопасная вставка в HTML: и в содержимое, и в значение атрибута. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

const C = MAIL_COLORS;
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

export function renderMailHtml(view: MailView): string {
  const e = escapeHtml;
  const accent = view.accent === 'employer' ? C.employer : C.blue;
  const p = (text: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${C.ink};">${e(text)}</p>`;
  const blocks: string[] = [...view.lead.map(p)];

  if (view.code) {
    // padding-left = letter-spacing: трекинг добавляет пустоту справа от последней цифры, без него код съезжает влево.
    blocks.push(
      `<table ${TABLE} width="100%" style="margin:20px 0 16px;"><tr>` +
        `<td align="center" style="border:1px solid ${C.ink};background:${C.paper};padding:18px 8px 18px 18px;` +
        `font-family:${MONO};font-size:32px;line-height:1.2;font-weight:700;letter-spacing:10px;color:${C.ink};">${e(view.code)}</td>` +
        `</tr></table>`,
    );
  }

  if (view.facts?.length) {
    const rows = view.facts.map(
      (f) =>
        `<tr><td style="padding:10px 16px 10px 0;border-top:1px solid ${LINE};font-size:13px;line-height:1.4;color:${C.muted};white-space:nowrap;vertical-align:top;">${e(f.label)}</td>` +
        `<td style="padding:10px 0;border-top:1px solid ${LINE};font-size:15px;line-height:1.4;font-weight:600;color:${C.ink};">${e(f.value)}</td></tr>`,
    );
    blocks.push(`<table ${TABLE} width="100%" style="margin:16px 0 8px;border-bottom:1px solid ${LINE};">${rows.join('')}</table>`);
  }

  if (view.action) {
    const href = e(view.action.href);
    // Кнопка – ячейка с заливкой: отступы у строчной ссылки десктопный Outlook игнорирует.
    blocks.push(
      `<table ${TABLE} style="margin:20px 0 12px;"><tr><td bgcolor="${C.ink}" style="background:${C.ink};">` +
        `<a href="${href}" style="display:inline-block;padding:14px 24px;font-size:15px;line-height:20px;font-weight:600;color:${C.white};text-decoration:none;">${e(view.action.label)}</a>` +
        `</td></tr></table>`,
      `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${C.muted};">Если кнопка не открывается, скопируйте ссылку:<br>` +
        `<a href="${href}" style="color:${C.muted};text-decoration:underline;word-break:break-all;">${href}</a></p>`,
    );
  }

  for (const note of view.notes ?? []) {
    blocks.push(`<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${C.muted};">${e(note)}</p>`);
  }

  const site = e(view.siteUrl);
  const host = e(new URL(view.siteUrl).host);
  return [
    '<!doctype html>',
    '<html lang="ru">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light only">',
    '<meta name="supported-color-schemes" content="light only">',
    `<title>${e(view.subject)}</title>`,
    '</head>',
    `<body style="margin:0;padding:0;background:${C.paper};font-family:${FONT};color:${C.ink};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${e(view.preheader)}</div>`,
    `<table ${TABLE} width="100%" bgcolor="${C.paper}" style="background:${C.paper};"><tr><td align="center" style="padding:32px 16px;">`,
    `<table ${TABLE} width="560" style="width:100%;max-width:560px;font-family:${FONT};">`,
    `<tr><td style="padding:0 0 16px;font-size:20px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:${C.ink};">ФСП` +
      `<span style="font-size:15px;font-weight:500;letter-spacing:0;color:${C.muted};">&nbsp;/карьера</span></td></tr>`,
    `<tr><td bgcolor="${C.white}" style="background:${C.white};border:1px solid ${CARD_BORDER};border-top:3px solid ${accent};padding:32px 32px 24px;">`,
    `<p style="margin:0 0 10px;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted};">${e(view.kicker)}</p>`,
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:${C.ink};">${e(view.title)}</h1>`,
    ...blocks,
    '</td></tr>',
    `<tr><td style="padding:16px 0 0;font-size:12px;line-height:1.5;color:${C.muted};">` +
      `MESHWORK · <a href="${site}" style="color:${C.muted};text-decoration:underline;">${host}</a><br>` +
      'Если вы не запрашивали это письмо, просто проигнорируйте его.</td></tr>',
    '</table>',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ].join('\n');
}
