import type { TestResult } from './contract';

/**
 * Разбор отчётов тест-раннеров в `tests: [{name, passed, ms}]`.
 * Отчёт пишет процесс, в котором исполняется код кандидата, – значит, это недоверенные данные:
 * только разбор с лимитами, никаких eval; кривой отчёт = null («no_report»).
 */

const MAX_TESTS = 500;
const MAX_NAME = 300;
const MAX_ERROR = 300;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const firstLine = (s: string) => clip(s.replace(ANSI, '').trim().split('\n')[0] ?? '', MAX_ERROR);

interface VitestAssertion {
  fullName?: unknown;
  title?: unknown;
  status?: unknown;
  duration?: unknown;
  failureMessages?: unknown;
}
interface VitestFile {
  name?: unknown;
  status?: unknown;
  message?: unknown;
  assertionResults?: unknown;
}

/** Vitest `--reporter json`. Файл тестов, который не загрузился, становится одним красным тестом. */
export function parseVitestJson(text: string, repoDir?: string): TestResult[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { testResults?: unknown }).testResults)) return null;
  const out: TestResult[] = [];
  for (const file of (data as { testResults: VitestFile[] }).testResults) {
    const assertions = Array.isArray(file.assertionResults) ? (file.assertionResults as VitestAssertion[]) : [];
    if (assertions.length === 0 && file.status === 'failed') {
      const name = typeof file.name === 'string' ? file.name : 'test file';
      const rel = repoDir && name.startsWith(repoDir) ? name.slice(repoDir.length + 1) : name;
      out.push({
        name: clip(`${rel}: набор не загрузился`, MAX_NAME),
        passed: false,
        ms: 0,
        error: typeof file.message === 'string' ? firstLine(file.message) : undefined,
      });
      continue;
    }
    for (const a of assertions) {
      if (a.status === 'skipped' || a.status === 'pending' || a.status === 'todo') continue;
      const name = typeof a.fullName === 'string' ? a.fullName : typeof a.title === 'string' ? a.title : '(без имени)';
      const passed = a.status === 'passed';
      const msgs = Array.isArray(a.failureMessages) ? a.failureMessages.filter((m): m is string => typeof m === 'string') : [];
      out.push({
        name: clip(name, MAX_NAME),
        passed,
        ms: typeof a.duration === 'number' && Number.isFinite(a.duration) && a.duration >= 0 ? Math.round(a.duration) : 0,
        ...(passed || msgs.length === 0 ? {} : { error: firstLine(msgs[0]!) }),
      });
      if (out.length >= MAX_TESTS) return out;
    }
  }
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : undefined;
};

/** pytest `--junitxml`. Минимальный разбор `<testcase>`: failure/error → красный, skipped → пропуск. */
export function parseJunitXml(text: string): TestResult[] | null {
  if (!/<testsuites?[\s>]/.test(text)) return null;
  const out: TestResult[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < MAX_TESTS) {
    const head = m[1]!;
    const body = m[3] ?? '';
    if (/<skipped\b/.test(body)) continue;
    const cls = attr(head, 'classname')?.replace(/^\.platform-tests\./, '');
    const name = attr(head, 'name') ?? '(без имени)';
    const time = Number(attr(head, 'time'));
    const fail = /<(failure|error)\b([^>]*)/.exec(body);
    out.push({
      name: clip(cls ? `${cls}::${name}` : name, MAX_NAME),
      passed: !fail,
      ms: Number.isFinite(time) && time >= 0 ? Math.round(time * 1000) : 0,
      ...(fail ? { error: firstLine(attr(fail[0], 'message') ?? fail[1]!) } : {}),
    });
  }
  return out;
}

export function summarize(tests: TestResult[]) {
  const passed = tests.filter((t) => t.passed).length;
  return { total: tests.length, passed, failed: tests.length - passed };
}
