// Текст eval → ExtractedDoc, как его отдал бы сборщик для загруженного резюме (.md).
import type { ExtractedDoc } from '../../src/server/collector/types';

export function textToDoc(text: string, id: string): ExtractedDoc {
  const lines = text.split('\n').map((t, i) => ({ ref: `${id}.md#l${i + 1}`, text: t }));
  return { sourceKind: 'resume', title: id, origin: `${id}.md`, lines, text, flags: {}, fetchedAt: new Date(0).toISOString() };
}
