// Исходник corpus.ts из документов базы. Общий для генератора (scripts/build-prompts.ts) и
// теста, который сверяет сгенерированный файл с .md.
import { parseDoc, parseFacts, type KnowledgeDoc } from './parse';

export function buildCorpus(factsMd: string, docs: { docId: string; md: string }[]): KnowledgeDoc[] {
  return [parseFacts(factsMd), ...docs.map((d) => parseDoc(d.docId, d.md))];
}

export function buildCorpusSource(factsMd: string, docs: { docId: string; md: string }[]): { source: string; docs: number; sections: number } {
  const corpus = buildCorpus(factsMd, docs);
  const source = [
    '// Сгенерировано scripts/build-prompts.ts из agent/knowledge/docs/*.md и prompts/platform-facts.md — руками не править.',
    '// Файлы .md не читаются с диска в рантайме: в standalone-сборке Next.js их нет в бандле.',
    "import type { KnowledgeDoc } from './parse';",
    '',
    `export const KNOWLEDGE_DOCS: KnowledgeDoc[] = ${JSON.stringify(corpus, null, 2)};`,
    '',
  ].join('\n');
  return { source, docs: corpus.length, sections: corpus.reduce((a, d) => a + d.sections.length, 0) };
}
