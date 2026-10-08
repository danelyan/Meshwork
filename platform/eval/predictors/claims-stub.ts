// Предсказатель eval «claims-stub»: полный путь extractClaims → verifyClaims на заглушке LLM.
// Заглушка (purpose 'extractor') «отвечает как модель»: читает строки L<n> из блока <document>
// и размечает их словарём маркеров. Это проверка конвейера (промпт, схема, разбор JSON,
// номера строк → ref, проверка цитат), а не качества LLM: цифры совпадают с catalog-keywords
// с точностью до фильтров extractor'а.
//   npx tsx eval/run.ts --predictor claims-stub
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { extractClaims } from '../../src/server/claims/extractor';
import { extractByMarkers } from '../../src/server/claims/markers';
import { verifyClaims } from '../../src/server/claims/verifier';
import type { ExtractedDoc } from '../../src/server/collector/types';
import { createStubProvider, registerStubResponse } from '../../src/server/llm/providers/stub';
import type { Predict } from '../run';
import { textToDoc } from './doc';

const catalog = catalogFromFile();
const llm = createStubProvider();

registerStubResponse('extractor', (req) => {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const block = /<document[^>]*>\n([\s\S]*?)\n<\/document>/.exec(user)?.[1] ?? '';
  const rows = block.split('\n').map((r) => /^L(\d+): ([\s\S]*)$/.exec(r)).filter((m): m is RegExpExecArray => m !== null);
  const doc: ExtractedDoc = {
    sourceKind: 'resume', title: 'stub', origin: 'stub', flags: {}, fetchedAt: '',
    lines: rows.map((m) => ({ ref: `L${m[1]}`, text: m[2] as string })),
    text: rows.map((m) => m[2]).join('\n'),
  };
  const claims = extractByMarkers(doc, catalog).map((c) => ({
    catalogId: c.catalogId,
    line: Number(c.sourceRef.slice(1)),
    quote: c.quote,
    confidence: c.confidence,
  }));
  return { json: { claims } };
});

const predict: Predict = async (text, ctx) => {
  const doc = textToDoc(text, ctx.id);
  const proposed = await extractClaims(doc, catalog, llm);
  return verifyClaims(proposed, [doc], catalog).accepted;
};

export default predict;
