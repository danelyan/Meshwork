import type { StubFixture } from '../llm/providers/stub';
import { registerStubResponse } from '../llm/providers/stub';
import type { ExtractedDoc, SourceKind } from '../collector/types';
import { catalogFromFile } from './catalog-file';
import { extractByMarkers } from './markers';

/**
 * Заглушка извлекателя «как модель» для LLM_PROVIDER=stub: читает строки `L<n>:` из
 * блока <document> промпта и размечает их словарём маркеров каталога. Проверяет
 * конвейер (промпт, схема, номера строк → ref, проверка цитат), а не качество LLM.
 * Используют eval (`--predictor claims-stub`) и демо-стенд без ключей (LLM_STUB_DEMO=true).
 */
export const extractorDictionaryStub: StubFixture = (req) => {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const block = /<document[^>]*>\n([\s\S]*?)\n<\/document>/.exec(user)?.[1] ?? '';
  // kind из тега: у резюме первые строки – шапка, у профиля GitHub – нет (как в extractByMarkers).
  const kind = (/<document[^>]*\skind="([a-z]+)"/.exec(user)?.[1] ?? 'resume') as SourceKind;
  // часть > 1 – продолжение документа, шапки в ней нет.
  const part = Number(/<document[^>]*\spart="(\d+)\//.exec(user)?.[1] ?? '1');
  const rows = block
    .split('\n')
    .map((r) => /^L(\d+): ([\s\S]*)$/.exec(r))
    .filter((m): m is RegExpExecArray => m !== null);
  const doc: ExtractedDoc = {
    sourceKind: part > 1 && (kind === 'resume' || kind === 'document') ? 'url' : kind,
    title: 'stub',
    origin: 'stub',
    flags: {},
    fetchedAt: '',
    lines: rows.map((m) => ({ ref: `L${m[1]}`, text: m[2] as string })),
    text: rows.map((m) => m[2]).join('\n'),
  };
  const claims = extractByMarkers(doc, catalogFromFile()).map((c) => ({
    catalogId: c.catalogId,
    line: Number(c.sourceRef.slice(1)),
    quote: c.quote,
    confidence: c.confidence,
  }));
  return { json: { claims } };
};

let unregister: (() => void) | null = null;

/** Включить словарный извлекатель на заглушке LLM; повторный вызов не плодит дублей. */
export function registerExtractorDemoStub(): void {
  unregister?.();
  unregister = registerStubResponse('extractor', extractorDictionaryStub);
}
