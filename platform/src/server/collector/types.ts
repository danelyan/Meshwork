// Контракт сборщика (лейн collector). E-01-plan.md § «Контракты».

export type SourceKind =
  | 'resume'
  | 'document'
  | 'url'
  | 'github'
  | 'codeforces'
  | 'stackoverflow'
  | 'fsp'
  | 'chat';

/** ref: "cv.pdf#p2:l14", "github:user/repo#README:l3" */
export interface DocLine {
  ref: string;
  text: string;
  /**
   * Строка невидима человеку (белый/прозрачный текст, кегль < 4 пт, вне страницы,
   * `display:none`, HTML-комментарий…). Её нет в `ExtractedDoc.text`, и она не может
   * быть цитатой утверждения (claims/verifier обязан её пропускать).
   */
  hidden?: true;
}

export interface ExtractedDoc {
  sourceKind: SourceKind;
  title: string;
  /** имя файла или URL */
  origin: string;
  lines: DocLine[];
  /** Только видимые строки, через `\n`. Контакты замаскированы. */
  text: string;
  flags: {
    hiddenText?: { count: number; sample: string[] };
    truncated?: boolean;
    injectionSuspect?: boolean;
    /** Сколько контактов заменено на `[скрыто]` (mask.ts). */
    maskedContacts?: number;
  };
  fetchedAt: string;
  /** Служебные сведения источника: страницы PDF, статус ФСП, демо-данные, кэш. */
  meta?: Record<string, unknown>;
}

export type ProfileKind = 'github' | 'codeforces' | 'stackoverflow' | 'fsp';
