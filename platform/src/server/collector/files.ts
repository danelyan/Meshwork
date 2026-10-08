import type { ExtractedDoc } from './types';

/** PDF (unpdf) и DOCX (mammoth) ≤ 5 МБ, ≤ 20 стр.; координаты `file#pN:lM`. */
export async function extractFile(buf: Buffer, filename: string, mime: string): Promise<ExtractedDoc> {
  void buf;
  void filename;
  void mime;
  throw new Error('not implemented: collector');
}
