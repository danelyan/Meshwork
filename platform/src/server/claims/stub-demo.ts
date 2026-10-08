import type { StubFixture } from '../llm/providers/stub';
import { registerStubResponse } from '../llm/providers/stub';
import type { ExtractedDoc } from '../collector/types';
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
  const rows = block
    .split('\n')
    .map((r) => /^L(\d+): ([\s\S]*)$/.exec(r))
    .filter((m): m is RegExpExecArray => m !== null);
  const doc: ExtractedDoc = {
    sourceKind: 'resume',
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

let registered = false;

/** Один раз на процесс: включить словарный извлекатель на заглушке LLM. */
export function registerExtractorDemoStub(): void {
  if (registered) return;
  registered = true;
  registerStubResponse('extractor', extractorDictionaryStub);
}
