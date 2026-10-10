/** Юридический документ: разделы с заголовками и абзацами. Тексты — заготовки, не юридическая консультация. */
export interface LegalSection {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDoc {
  slug: 'privacy' | 'terms' | 'employer-terms' | 'ai';
  title: string;
  version: string;
  /** Дата редакции, ISO. */
  date: string;
  lead: string;
  sections: LegalSection[];
}

export const OPERATOR = '[Оператор: наименование, ИНН, адрес]';
export const CONTACT = '[адрес для запросов]';
export const DRAFT_NOTICE =
  'Черновик для демонстрации на хакатоне, не юридический текст; при запуске заполняется оператором и проверяется юристом.';
export const LEGAL_DATE = '2026-10-11';

/** Страницы подвала и шапки документов. */
export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Политика обработки данных' },
  { href: '/terms', label: 'Соглашение кандидата' },
  { href: '/employer-terms', label: 'Условия для работодателя' },
  { href: '/ai', label: 'Как работает ИИ' },
  { href: '/consent', label: 'Согласие на обработку данных' },
] as const;
