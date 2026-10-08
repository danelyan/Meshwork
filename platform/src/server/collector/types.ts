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
}

export interface ExtractedDoc {
  sourceKind: SourceKind;
  title: string;
  /** имя файла или URL */
  origin: string;
  lines: DocLine[];
  text: string;
  flags: {
    hiddenText?: { count: number; sample: string[] };
    truncated?: boolean;
    injectionSuspect?: boolean;
  };
  fetchedAt: string;
}

export type ProfileKind = 'github' | 'codeforces' | 'stackoverflow' | 'fsp';
