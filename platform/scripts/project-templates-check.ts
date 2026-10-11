// Прогон скрытых тестов шаблонов проектов (lane project, ADR 0003) так же, как это делает runner:
// репозиторий = starter (+ reference поверх для эталона), тесты платформы – в .platform-tests/.
// Ожидание: эталон проходит весь скрытый набор, пустой starter – нет.
//
//   npx tsx scripts/project-templates-check.ts [--only <templateId>] [--suite hidden|visible]
//
// Окружение: TEMPLATE_NODE_DEPS – node_modules предустановленного набора runner (по умолчанию
// runner/sandbox/node/node_modules: `npm ci` в runner/sandbox/node); TEMPLATE_PYTHON – python с pytest
// (по умолчанию runner/sandbox/python/.venv/bin/python, иначе python3).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listTemplateManifests, templatesRoot, type LoadedTemplate } from '../src/server/project/templates';

const root = process.cwd();
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const suite = (args.includes('--suite') ? args[args.indexOf('--suite') + 1] : 'hidden') as 'hidden' | 'visible';

const nodeDeps = path.resolve(process.env.TEMPLATE_NODE_DEPS ?? path.join(root, 'runner/sandbox/node/node_modules'));
const venvPython = path.join(root, 'runner/sandbox/python/.venv/bin/python');
const python = process.env.TEMPLATE_PYTHON ?? (existsSync(venvPython) ? venvPython : 'python3');

// Копия runner/sandbox/node/vitest.job.config.mjs (lane runner): тот же include, окружение и отчёт.
const VITEST_CONFIG = `const env = process.env;
export default {
  root: env.FSP_REPO_DIR, cacheDir: env.FSP_CACHE_DIR, envDir: env.FSP_CACHE_DIR, logLevel: 'warn', clearScreen: false,
  css: { postcss: { plugins: [] } }, server: { watch: null },
  test: {
    include: ['.platform-tests/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}'],
    environment: env.FSP_TEST_ENV === 'jsdom' ? 'jsdom' : 'node',
    globals: false, watch: false, pool: 'forks', maxWorkers: 1, fileParallelism: false, isolate: true,
    testTimeout: 10000, hookTimeout: 10000, passWithNoTests: false, setupFiles: [], globalSetup: [],
    reporters: ['json'], outputFile: { json: env.FSP_REPORT_FILE },
  },
};
`;

interface Outcome {
  passed: number;
  total: number;
  failedNames: string[];
}

function runNode(t: LoadedTemplate, repo: string, tmp: string): Outcome {
  const report = path.join(tmp, 'report.json');
  const cfg = path.join(tmp, 'vitest.job.config.mjs');
  writeFileSync(cfg, VITEST_CONFIG);
  symlinkSync(nodeDeps, path.join(repo, 'node_modules'));
  const proc = spawnSync(process.execPath, [path.join(nodeDeps, 'vitest/vitest.mjs'), 'run', '--root', repo, '--config', cfg, '--configLoader', 'native'], {
    cwd: repo,
    env: {
      ...process.env,
      NODE_PATH: nodeDeps,
      FSP_REPO_DIR: repo,
      FSP_CACHE_DIR: path.join(tmp, '.vite'),
      FSP_TEST_ENV: t.manifest.testEnvironment,
      FSP_REPORT_FILE: report,
      CI: '1',
      TZ: 'Europe/Moscow',
    },
    encoding: 'utf8',
    timeout: t.manifest.timeLimitSec * 1000 * 2,
  });
  if (!existsSync(report)) return { passed: 0, total: 0, failedNames: [`(нет отчёта vitest) ${(proc.stderr + proc.stdout).slice(-1500)}`] };
  const json = JSON.parse(readFileSync(report, 'utf8')) as {
    numTotalTests: number;
    numPassedTests: number;
    testResults: { assertionResults: { fullName: string; status: string }[] }[];
  };
  const failedNames = json.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status !== 'passed').map((a) => a.fullName));
  if (!json.numTotalTests) failedNames.push(`(0 тестов) ${JSON.stringify(json.testResults.map((f) => (f as { message?: string }).message)).slice(0, 1500)}`);
  return { passed: json.numPassedTests, total: json.numTotalTests, failedNames };
}

function runPython(repo: string, tmp: string): Outcome {
  const report = path.join(tmp, 'report.xml');
  const ini = path.join(tmp, 'pytest.ini');
  writeFileSync(ini, '[pytest]\naddopts = -p no:cacheprovider\npython_files = *test*.py\n');
  spawnSync(python, ['-B', '-m', 'pytest', '-q', '-c', ini, '--rootdir', repo, `--junitxml=${report}`, path.join(repo, '.platform-tests')], {
    cwd: repo,
    env: { ...process.env, PYTHONPATH: repo, PYTHONDONTWRITEBYTECODE: '1', PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (!existsSync(report)) return { passed: 0, total: 0, failedNames: ['(нет отчёта pytest)'] };
  const xml = readFileSync(report, 'utf8');
  const cases = [...xml.matchAll(/<testcase [^>]*name="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)];
  const failedNames = cases.filter((c) => /<(failure|error)/.test(c[3] ?? '')).map((c) => c[1]!);
  return { passed: cases.length - failedNames.length, total: cases.length, failedNames };
}

export function checkTemplate(t: LoadedTemplate, withReference: boolean, which: 'hidden' | 'visible' = 'hidden'): Outcome {
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), `tpl-${t.manifest.id}-`)));
  const repo = path.join(tmp, 'repo');
  try {
    cpSync(path.join(t.dir, t.manifest.starterRef), repo, { recursive: true });
    if (withReference && t.manifest.referenceRef) cpSync(path.join(t.dir, t.manifest.referenceRef), repo, { recursive: true });
    for (const owned of t.manifest.platformOwned) rmSync(path.join(repo, owned.replace(/\/\*\*$/, '')), { recursive: true, force: true });
    const tests = which === 'hidden' ? t.manifest.hiddenTestsRef : t.manifest.visibleTestsRef;
    cpSync(path.join(t.dir, tests), path.join(repo, '.platform-tests', which === 'visible' ? 'visible' : ''), { recursive: true });
    return t.manifest.image === 'python312' ? runPython(repo, tmp) : runNode(t, repo, tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const templates = listTemplateManifests(templatesRoot(root)).filter((t) => !only || t.manifest.id === only);
  if (!templates.length) throw new Error('шаблоны не найдены');
  let bad = 0;
  console.log(`suite=${suite}; node deps: ${nodeDeps}; python: ${python}`);
  for (const t of templates) {
    const ref = checkTemplate(t, true, suite);
    const empty = checkTemplate(t, false, suite);
    const ok = ref.total > 0 && ref.passed === ref.total && empty.passed < empty.total;
    if (!ok) bad++;
    console.log(`${ok ? 'OK ' : 'BAD'} ${t.manifest.id.padEnd(36)} эталон ${ref.passed}/${ref.total}  starter ${empty.passed}/${empty.total}`);
    for (const n of ref.failedNames) console.log(`      эталон не прошёл: ${n}`);
    if (empty.passed > 0 && process.env.VERBOSE) console.log(`      starter прошёл ${empty.passed}`);
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
