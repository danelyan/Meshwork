/**
 * Генерирует синтетический реестр и реалм Keycloak:
 *   npx tsx scripts/generate.ts            → data/dataset.json, keycloak/fsp-id-realm.json
 * Детерминировано (seed в generator/build.ts); tests/generator.test.ts сверяет файлы с генерацией.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDataset } from '../src/generator/build.js';
import { buildRealm } from '../src/generator/realm.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATASET_PATH = resolve(root, 'data/dataset.json');
export const REALM_PATH = resolve(root, 'keycloak/fsp-id-realm.json');

export function renderFiles(): { dataset: string; realm: string } {
  const dataset = buildDataset();
  return {
    dataset: `${JSON.stringify(dataset, null, 2)}\n`,
    realm: `${JSON.stringify(buildRealm(dataset), null, 2)}\n`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = renderFiles();
  mkdirSync(dirname(DATASET_PATH), { recursive: true });
  mkdirSync(dirname(REALM_PATH), { recursive: true });
  writeFileSync(DATASET_PATH, files.dataset);
  writeFileSync(REALM_PATH, files.realm);
  const ds = JSON.parse(files.dataset) as Record<string, unknown[]>;
  for (const key of ['athletes', 'events', 'teams', 'results', 'achievements', 'ranks', 'consents']) {
    console.log(`${key}: ${ds[key]!.length}`);
  }
}
