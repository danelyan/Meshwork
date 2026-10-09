// Пересобирает prompt.ts консультанта, помощника работодателя и онбординга из .md и общего
// файла фактов (src/server/agent/prompts/platform-facts.md). Запуск из platform/:
//   npx tsx scripts/build-prompts.ts
// Тесты сверяют, что сгенерированное совпадает с источником.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assemblePrompt, promptVersion } from '../src/server/agent/prompts/assemble';

const root = process.cwd();
const dir = join(root, 'src/server/agent/prompts');
const facts = readFileSync(join(dir, 'platform-facts.md'), 'utf8');

const targets = [
  { md: 'consultant.md', out: 'src/server/agent/prompt.ts', name: 'CONSULTANT', from: 'prompts/consultant.md' },
  { md: 'employer.md', out: 'src/server/agent/employer/prompt.ts', name: 'EMPLOYER', from: 'prompts/employer.md' },
  { md: 'onboarding.md', out: 'src/server/onboarding/prompt.ts', name: 'ONBOARDING', from: 'agent/prompts/onboarding.md' },
];

for (const t of targets) {
  const md = readFileSync(join(dir, t.md), 'utf8');
  const text = assemblePrompt(md, facts);
  const src = [
    `// Сгенерировано scripts/build-prompts.ts из ${t.from} и prompts/platform-facts.md — руками не править.`,
    '// Файл .md не читается с диска в рантайме: в standalone-сборке Next.js его нет в бандле.',
    '',
    `export const ${t.name}_PROMPT_VERSION = '${promptVersion(md)}';`,
    '',
    `export const ${t.name}_PROMPT = ${JSON.stringify(text)};`,
    '',
  ].join('\n');
  writeFileSync(join(root, t.out), src);
  console.log(`${t.out}: ${promptVersion(md)}, ${text.length} символов`);
}
