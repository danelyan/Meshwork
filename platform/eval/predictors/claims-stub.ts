// Предсказатель eval «claims-stub»: полный путь extractClaims → verifyClaims на заглушке LLM.
// Заглушка (purpose 'extractor') «отвечает как модель»: читает строки L<n> из блока <document>
// и размечает их словарём маркеров. Это проверка конвейера (промпт, схема, разбор JSON,
// номера строк → ref, проверка цитат), а не качества LLM: цифры совпадают с catalog-keywords
// с точностью до фильтров extractor'а.
//   npx tsx eval/run.ts --predictor claims-stub
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { extractClaims } from '../../src/server/claims/extractor';
import { extractorDictionaryStub } from '../../src/server/claims/stub-demo';
import { verifyClaims } from '../../src/server/claims/verifier';
import { createStubProvider, registerStubResponse } from '../../src/server/llm/providers/stub';
import type { Predict } from '../run';
import { textToDoc } from './doc';

const catalog = catalogFromFile();
const llm = createStubProvider();

registerStubResponse('extractor', extractorDictionaryStub);

const predict: Predict = async (text, ctx) => {
  const doc = textToDoc(text, ctx.id);
  const proposed = await extractClaims(doc, catalog, llm);
  return verifyClaims(proposed, [doc], catalog).accepted;
};

export default predict;
