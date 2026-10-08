// Предсказатель eval «catalog-keywords»: словарь маркеров каталога (план В, без LLM) + verifyClaims.
//   npx tsx eval/run.ts --predictor catalog-keywords
import { catalogFromFile } from '../../src/server/claims/catalog-file';
import { extractByMarkers } from '../../src/server/claims/markers';
import { verifyClaims } from '../../src/server/claims/verifier';
import type { Predict } from '../run';
import { textToDoc } from './doc';

const catalog = catalogFromFile();

const predict: Predict = (text, ctx) => {
  const doc = textToDoc(text, ctx.id);
  const { accepted } = verifyClaims(extractByMarkers(doc, catalog), [doc], catalog);
  return accepted;
};

export default predict;
