import { describe, expect, it } from 'vitest';

import { parseJunitXml, parseVitestJson, summarize } from '../../../runner/src/report';

describe('runner report: vitest json', () => {
  const report = {
    testResults: [
      {
        name: '/w/repo/.platform-tests/a.test.js',
        status: 'failed',
        assertionResults: [
          { fullName: 'api health', status: 'passed', duration: 12.6, failureMessages: [] },
          { fullName: 'api create', status: 'failed', duration: 3, failureMessages: ['\u001b[31mAssertionError: expected 501 to be 201\u001b[39m\n    at stack'] },
          { fullName: 'api skipped', status: 'skipped', duration: 0 },
        ],
      },
      { name: '/w/repo/.platform-tests/b.test.js', status: 'failed', message: 'SyntaxError: Unexpected token\nat x', assertionResults: [] },
    ],
  };

  it('тесты, длительность, первая строка ошибки без ANSI; упавший файл — красный тест', () => {
    const tests = parseVitestJson(JSON.stringify(report), '/w/repo')!;
    expect(tests).toEqual([
      { name: 'api health', passed: true, ms: 13 },
      { name: 'api create', passed: false, ms: 3, error: 'AssertionError: expected 501 to be 201' },
      { name: '.platform-tests/b.test.js: набор не загрузился', passed: false, ms: 0, error: 'SyntaxError: Unexpected token' },
    ]);
    expect(summarize(tests)).toEqual({ total: 3, passed: 1, failed: 2 });
  });

  it('мусор → null', () => {
    expect(parseVitestJson('not json')).toBeNull();
    expect(parseVitestJson('{"x":1}')).toBeNull();
  });
});

describe('runner report: junit xml', () => {
  it('pytest junitxml', () => {
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="pytest" tests="3">
      <testcase classname="test_api" name="test_health" time="0.012"/>
      <testcase classname="test_api" name="test_create" time="0.1"><failure message="assert 501 == 201">trace</failure></testcase>
      <testcase classname="test_api" name="test_skip" time="0"><skipped message="x"/></testcase>
    </testsuite></testsuites>`;
    expect(parseJunitXml(xml)).toEqual([
      { name: 'test_api::test_health', passed: true, ms: 12 },
      { name: 'test_api::test_create', passed: false, ms: 100, error: 'assert 501 == 201' },
    ]);
  });

  it('не junit → null', () => {
    expect(parseJunitXml('<html/>')).toBeNull();
  });
});
