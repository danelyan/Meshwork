import type { ExtractedDoc } from './types';

/** Любой URL через SSRF-фильтры (ssrf.ts). Заблокированный адрес → ошибка с кодом `blocked_url`. */
export async function fetchUrl(url: string): Promise<ExtractedDoc> {
  void url;
  throw new Error('not implemented: collector');
}
