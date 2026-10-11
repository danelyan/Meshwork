/** Лимиты сборщика (E-01 фаза 1, research/10 § 4.6). */
export const LIMITS = {
  /** Файл резюме/документа. */
  fileMaxBytes: 5 * 1024 * 1024,
  pdfMaxPages: 20,
  /** Картинка для Vision OCR: ≤ 20 Мпикс (ширина × высота) — дока Yandex Vision, «Требования к изображениям». */
  ocrMaxPixels: 20_000_000,
  /** Разбор файла в worker_threads. */
  parseTimeoutMs: 15_000,
  parseMaxHeapMb: 384,
  /** Чтение URL. */
  urlMaxBytes: 2 * 1024 * 1024,
  urlTimeoutMs: 8_000,
  urlMaxRedirects: 3,
  urlMaxLength: 2048,
  /** Сколько текста отдаём дальше (в модель). Больше — `flags.truncated`. */
  docMaxChars: 60_000,
  docMaxLines: 3_000,
  /** Образцы скрытого текста во флаге. */
  hiddenSamples: 3,
  hiddenSampleChars: 160,
} as const;
