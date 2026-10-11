// Общие семейства (ADR 0003, дополнение 11.10): состав, параметры по грейду, детерминизм, ключи; сверка ключей
// shell и Git с настоящими bash и git (если они есть в окружении).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SUBCATEGORIES } from '@/lib/directions';
import { GRADES } from '@/lib/grades';
import { catalogFromFile } from '@/server/claims/catalog-file';
import { checkAnswer, normalizeAnswer } from '@/server/test/answers';
import { commonGeneratorsFor, GENERATORS } from '@/server/test/generators';
import { COMMON_GENERATORS } from '@/server/test/generators/common';
import { COMMON_BY_SPEC } from '@/server/test/generators/common-map';
import { gitLogRange, gitResetModes, gitStaged, shellExitStatus, shellPipeline } from '@/server/test/generators/common-ops';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 101);

describe('общие семейства: состав', () => {
  it('24–30 семейств, id `cm.*` уникальны во всём банке, taskId – свои, все три грейда', () => {
    expect(COMMON_GENERATORS.length).toBeGreaterThanOrEqual(24);
    expect(COMMON_GENERATORS.length).toBeLessThanOrEqual(30);
    for (const g of COMMON_GENERATORS) expect(g.id).toMatch(/^cm\./);
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
    const commonTasks = new Set(COMMON_GENERATORS.map((g) => g.taskId));
    expect(commonTasks.size).toBe(COMMON_GENERATORS.length);
    for (const g of GENERATORS) if (!g.shared) expect(commonTasks.has(g.taskId), g.id).toBe(false);
    for (const grade of GRADES) expect(COMMON_GENERATORS.filter((g) => g.grade === grade).length, grade).toBeGreaterThanOrEqual(8);
  });

  it('каждая компетенция карты обеспечена семействами; у каждой подкатегории есть общие Junior, Middle и Senior', () => {
    const used = new Set(Object.values(COMMON_BY_SPEC).flat());
    for (const c of used) expect(COMMON_GENERATORS.filter((g) => g.shared!.competency === c).length, c).toBeGreaterThanOrEqual(2);
    for (const sub of SUBCATEGORIES) {
      const common = commonGeneratorsFor(sub.id);
      for (const grade of GRADES) expect(common.some((g) => g.grade === grade), `${sub.id} ${grade}`).toBe(true);
    }
  });

  it('a, b – в диапазонах грейда, лимит времени задан, утверждения есть в каталоге (common.*)', () => {
    const catalog = new Set(catalogFromFile().map((c) => c.id));
    for (const g of COMMON_GENERATORS) {
      expect(g.a, g.id).toBeGreaterThanOrEqual(1.0);
      expect(g.a, g.id).toBeLessThanOrEqual(1.4);
      if (g.grade === 'junior') expect(g.b, g.id).toBeLessThanOrEqual(-0.4);
      if (g.grade === 'middle') expect([g.b >= 0.3, g.b <= 0.8], g.id).toEqual([true, true]);
      if (g.grade === 'senior') expect([g.b >= 1.0, g.b <= 1.7], g.id).toEqual([true, true]);
      expect(g.timeLimitSec, g.id).toBeGreaterThanOrEqual(60);
      for (const c of g.catalogIds) {
        expect(c, g.id).toMatch(/^common\./);
        expect(catalog.has(c), `${g.id}: ${c}`).toBe(true);
      }
    }
  });
});

for (const g of COMMON_GENERATORS) {
  it(`${g.id}: детерминизм, ключ проходит свою проверку, варианты различаются`, () => {
    const variants = new Set<string>();
    const keys = new Set<string>();
    for (const seed of SEEDS) {
      const inst = g.generate(seed);
      expect(g.generate(seed)).toEqual(inst);
      expect(inst.answerKey.length).toBeGreaterThan(0);
      expect(normalizeAnswer(g.format, inst.answerKey)).not.toBeNull();
      expect(checkAnswer(g.format, inst.answerKey, inst.answerKey), `${g.id} ${seed}`).toBe(true);
      variants.add(`${inst.prompt}\n${inst.code ?? ''}`);
      keys.add(inst.answerKey);
    }
    expect(variants.size).toBeGreaterThanOrEqual(20);
    // Ключ не константа: угадывание одним ответом не работает.
    expect(keys.size, g.id).toBeGreaterThanOrEqual(3);
  });
}

function has(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(has('bash'))('ключи shell совпадают с настоящим bash', () => {
  it('cm.shell-exit-status', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const inst = shellExitStatus.generate(seed);
      const c = inst.params.codes as { a: number; b: number; c: number };
      const script = `a() { return ${c.a}; }\nb() { return ${c.b}; }\nc() { return ${c.c}; }\n${inst.code!}`;
      expect(execFileSync('bash', ['-c', script]).toString().trim(), `${seed}\n${inst.code}`).toBe(inst.answerKey);
    }
  });

  it('cm.shell-pipeline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-shell-'));
    try {
      for (const seed of SEEDS.slice(0, 40)) {
        const inst = shellPipeline.generate(seed);
        const [log, cmd] = inst.code!.split('\n\n$ ');
        writeFileSync(join(dir, 'access.log'), `${log}\n`);
        const out = execFileSync('bash', ['-c', `${cmd!}; exit 0`], { cwd: dir, env: { ...process.env, LC_ALL: 'C' } }).toString().trim();
        expect(out.split(/\s+/)[0], `${seed}: ${cmd}`).toBe(inst.answerKey);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Песочница git: репозиторий во временной папке с локальными user.name/email. */
function gitSandbox(): { run: (args: string[]) => string; dir: string; write: (f: string, s: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cm-git-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  run(['init', '-q', '-b', 'main']);
  return { run, dir, write: (f, s) => writeFileSync(join(dir, f), s) };
}

const FILES = ['app.py', 'api.ts', 'README.md', 'config.yml', 'db.sql', 'main.go', 'style.css', 'Makefile'];

describe.runIf(has('git'))('ключи Git совпадают с настоящим git', () => {
  it('cm.git-staged', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const inst = gitStaged.generate(seed);
      const g = gitSandbox();
      try {
        for (const f of FILES) g.write(f, 'v0\n');
        g.run(['add', '.']);
        g.run(['commit', '-qm', 'init']);
        let n = 0;
        for (const line of inst.code!.split('\n')) {
          const edited = line.match(/^# изменён (.+)$/);
          if (edited) g.write(edited[1]!, `v${++n}\n`);
          else g.run(line.replace(/^git /, '').replace(/"wip"/, 'wip').split(' '));
        }
        const staged = g.run(['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean).sort().join(',');
        expect(staged, `${seed}\n${inst.code}`).toBe(inst.answerKey);
      } finally {
        rmSync(g.dir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('cm.git-reset-modes', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const inst = gitResetModes.generate(seed);
      const g = gitSandbox();
      try {
        for (const f of FILES) g.write(f, 'v0\n');
        g.run(['add', '.']);
        g.run(['commit', '-qm', 'init']);
        let n = 0;
        for (const line of inst.code!.split('\n')) {
          for (const f of line.split(': ')[1]!.split(', ')) g.write(f, `v${++n}\n`);
          g.run(['commit', '-qam', line.split(':')[0]!]);
        }
        const pre = inst.prompt.match(/в индексе были изменения (.+?), а в рабочей копии вне индекса – (.+?)\.\n/)!;
        const list = (s: string) => (s === '(нет)' ? [] : s.split(', '));
        for (const f of list(pre[1]!)) {
          g.write(f, `s${++n}\n`);
          g.run(['add', f]);
        }
        for (const f of list(pre[2]!)) g.write(f, `u${++n}\n`);
        const { k, mode, ask } = inst.params as { k: number; mode: string; ask: string };
        g.run(['reset', '-q', `--${mode}`, `HEAD~${k}`]);
        const out = g.run(ask === 'staged' ? ['diff', '--cached', '--name-only'] : ['diff', '--name-only']);
        expect(String(out.trim().split('\n').filter(Boolean).length), `${seed}\n${inst.prompt}\n${inst.code}`).toBe(inst.answerKey);
      } finally {
        rmSync(g.dir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('cm.git-log-range', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const inst = gitLogRange.generate(seed);
      const { base, mainAfter, feat, merged } = inst.params as { base: number; mainAfter: number; feat: number; merged: boolean };
      const g = gitSandbox();
      try {
        const commit = (name: string) => {
          g.write(`${name}.txt`, name);
          g.run(['add', '.']);
          g.run(['commit', '-qm', name]);
        };
        for (let i = 1; i <= base; i++) commit(`M${i}`);
        g.run(['branch', 'feature']);
        for (let i = base + 1; i <= base + mainAfter; i++) commit(`M${i}`);
        g.run(['checkout', '-q', 'feature']);
        for (let i = 1; i <= feat; i++) commit(`F${i}`);
        if (merged) g.run(['merge', '-q', '--no-edit', 'main']);
        const cmd = inst.code!.split('\n').pop()!;
        const out = g.run(cmd.replace(/^git /, '').split(' '));
        expect(String(out.trim().split('\n').filter(Boolean).length), `${seed}\n${inst.code}`).toBe(inst.answerKey);
      } finally {
        rmSync(g.dir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});
