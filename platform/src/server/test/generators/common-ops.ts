// Общие семейства: Git, Linux/shell, тестирование, конкурентность (ADR 0003, дополнение 11.10). a, b — ПРЕДЛОЖЕНИЕ (экспертные).
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

import { commonFamily } from './common-util';

const FILES = ['app.py', 'api.ts', 'README.md', 'config.yml', 'db.sql', 'main.go', 'style.css', 'Makefile'];

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export const gitStaged: TaskGenerator = commonFamily({
  id: 'cm.git-staged',
  competency: 'common.git',
  title: 'Что попадёт в коммит: индекс Git',
  specialization: 'engineering',
  grade: 'junior',
  catalogIds: ['common.git'],
  format: 'list',
  a: 1.1,
  b: -0.9,
  paramSpace: 1e8,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const files = rng.sample(FILES, 4);
    const staged = new Set<string>();
    const modified = new Set<string>();
    const cmds: string[] = [];
    const total = rng.int(6, 8);
    for (let i = 0; i < total; i++) {
      const f = rng.pick(files);
      const op = rng.int(0, 9);
      if (op < 4) {
        modified.add(f);
        cmds.push(`# изменён ${f}`);
      } else if (op < 7) {
        if (!modified.has(f)) continue;
        modified.delete(f);
        staged.add(f);
        cmds.push(`git add ${f}`);
      } else if (op < 8) {
        if (!staged.has(f)) continue;
        staged.delete(f);
        modified.add(f);
        cmds.push(`git restore --staged ${f}`);
      } else if (op < 9) {
        if (staged.size === 0) continue;
        staged.clear();
        cmds.push('git commit -m "wip"');
      } else {
        if (modified.size === 0) continue;
        for (const m of modified) staged.add(m);
        modified.clear();
        cmds.push('git add .');
      }
    }
    if (staged.size === 0) {
      const f = rng.pick(files);
      cmds.push(`# изменён ${f}`, `git add ${f}`);
      staged.add(f);
      modified.delete(f);
    }
    return {
      prompt: 'Все файлы отслеживаются Git, рабочая копия была чистой. После команд ниже какие файлы окажутся в разделе «Changes to be committed» у git status?',
      code: cmds.join('\n'),
      answerHint: 'имена файлов через запятую',
      answerKey: [...staged].sort().join(','),
      explanation: 'git add кладёт изменения в индекс, git restore --staged убирает их из индекса обратно в рабочую копию, git commit фиксирует индекс и очищает его, git add . индексирует все изменения.',
      params: { cmds: cmds.length },
    };
  },
});

export const gitLogRange: TaskGenerator = commonFamily({
  id: 'cm.git-log-range',
  competency: 'common.git',
  title: 'Сколько коммитов покажет диапазон git log',
  specialization: 'engineering',
  grade: 'middle',
  catalogIds: ['common.git'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e5,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.int(2, 4);
    const mainAfter = rng.int(0, 4);
    const feat = rng.int(1, 5);
    // git merge main без новых коммитов в main — «Already up to date», merge-коммита нет: сливаем только при mainAfter > 0.
    const merged = mainAfter > 0 && rng.int(0, 2) === 0;
    const kind = rng.int(0, 2);
    const mainCommits = Array.from({ length: base + mainAfter }, (_, i) => `M${i + 1}`);
    const featCommits = Array.from({ length: feat }, (_, i) => `F${i + 1}`);
    const lines = [
      `main:    ${mainCommits.join(' - ')}`,
      `feature: ответвлена от M${base}, коммиты ${featCommits.join(' - ')}`,
      ...(merged ? ['затем на feature выполнено: git merge main (создан merge-коммит F-merge)'] : []),
    ];
    // feature содержит M1..Mbase, F*, (+ M(base+1).. и merge-коммит, если слили main)
    const featOnly = feat + (merged ? 1 : 0);
    const mainOnly = merged ? 0 : mainAfter;
    const ranges = [
      { cmd: 'git log --oneline main..feature', key: featOnly },
      { cmd: 'git log --oneline feature..main', key: mainOnly },
      { cmd: 'git log --oneline main...feature', key: featOnly + mainOnly },
    ];
    const r = ranges[kind]!;
    return {
      prompt: 'История репозитория описана ниже (слева направо — от старых к новым). Сколько строк выведет команда?',
      code: [...lines, '', r.cmd].join('\n'),
      answerHint: 'число коммитов',
      answerKey: String(r.key),
      explanation: 'A..B — коммиты, достижимые из B и недостижимые из A; A...B — симметричная разность. После git merge main все коммиты main достижимы из feature, а merge-коммит есть только в feature.',
      params: { base, mainAfter, feat, merged, kind },
    };
  },
});

export const gitResetModes: TaskGenerator = commonFamily({
  id: 'cm.git-reset-modes',
  competency: 'common.git',
  title: 'git reset --soft, --mixed, --hard',
  specialization: 'engineering',
  grade: 'senior',
  catalogIds: ['common.git'],
  format: 'number',
  a: 1.1,
  b: 1.0,
  paramSpace: 1e6,
  timeLimitSec: 270,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const k = rng.int(1, 3);
    const commits = Array.from({ length: k }, (_, i) => ({ name: `C${i + 1}`, files: rng.sample(FILES, rng.int(1, 3)) }));
    const preStaged = rng.sample(FILES, rng.int(0, 2));
    const preUnstaged = rng.sample(FILES.filter((f) => !preStaged.includes(f)), rng.int(0, 2));
    const mode = rng.pick(['soft', 'mixed', 'mixed', 'soft', 'hard']);
    const ask = rng.int(0, 1) === 0 ? 'staged' : 'unstaged';
    const undone = new Set(commits.flatMap((c) => c.files));
    let staged = new Set<string>();
    let unstaged = new Set<string>();
    if (mode === 'soft') {
      staged = new Set([...undone, ...preStaged]);
      unstaged = new Set(preUnstaged);
    } else if (mode === 'mixed') {
      unstaged = new Set([...undone, ...preStaged, ...preUnstaged]);
    }
    const key = ask === 'staged' ? staged.size : unstaged.size;
    return {
      prompt: [
        `Последние ${k} коммит(а) ветки меняли файлы, как указано ниже (каждый файл в каждом коммите менялся по-новому, ничего не откатывалось). Перед командой в индексе были изменения ${preStaged.join(', ') || '(нет)'}, а в рабочей копии вне индекса — ${preUnstaged.join(', ') || '(нет)'}.`,
        `Выполнено: git reset --${mode} HEAD~${k}. Сколько файлов git status покажет в разделе «${ask === 'staged' ? 'Changes to be committed' : 'Changes not staged for commit'}»?`,
      ].join('\n'),
      code: commits.map((c) => `${c.name}: ${c.files.join(', ')}`).join('\n'),
      answerHint: 'число файлов',
      answerKey: String(key),
      explanation: '--soft двигает только HEAD: изменения отменённых коммитов и прежний индекс остаются в индексе. --mixed сбрасывает и индекс: всё становится неиндексированными изменениями. --hard сбрасывает индекс и рабочую копию — изменений не остаётся.',
      params: { k, mode, ask },
    };
  },
});

// ---------------------------------------------------------------------------
// Linux / shell
// ---------------------------------------------------------------------------

const RWX = (d: number) => `${d & 4 ? 'r' : '-'}${d & 2 ? 'w' : '-'}${d & 1 ? 'x' : '-'}`;

export const chmodOctal: TaskGenerator = commonFamily({
  id: 'cm.chmod-octal',
  competency: 'common.linux',
  title: 'Права файла в восьмеричной записи',
  specialization: 'engineering',
  grade: 'junior',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.1,
  b: -0.8,
  paramSpace: 1e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const digits = [rng.pick([6, 7, 5, 4]), rng.pick([4, 5, 0, 6]), rng.pick([0, 4, 5, 1])];
    const kind = rng.int(0, 1);
    let result = [...digits];
    let prompt: string;
    let code: string;
    if (kind === 0) {
      prompt = 'ls -l показал права файла. Какой восьмеричный режим дать chmod, чтобы получить их же?';
      code = `-${digits.map(RWX).join('')} 1 dev dev 2048 deploy.sh`;
    } else {
      const who = rng.pick([
        { s: 'u', i: 0 },
        { s: 'g', i: 1 },
        { s: 'o', i: 2 },
      ]);
      const perm = rng.pick([
        { s: 'x', v: 1 },
        { s: 'w', v: 2 },
        { s: 'r', v: 4 },
      ]);
      const add = rng.int(0, 1) === 0;
      result = digits.map((d, i) => (i === who.i ? (add ? d | perm.v : d & ~perm.v) : d));
      prompt = 'Какими станут права файла (восьмеричная запись из трёх цифр) после команды?';
      code = `chmod ${digits.join('')} deploy.sh\nchmod ${who.s}${add ? '+' : '-'}${perm.s} deploy.sh`;
    }
    return {
      prompt,
      code,
      answerHint: 'например, 750',
      answerKey: result.join(''),
      explanation: `r = 4, w = 2, x = 1; цифры — владелец, группа, остальные: ${result.map(RWX).join('')} = ${result.join('')}.`,
      params: { digits, kind },
    };
  },
});

export const shellPipeline: TaskGenerator = commonFamily({
  id: 'cm.shell-pipeline',
  competency: 'common.linux',
  title: 'Результат конвейера по логу',
  specialization: 'engineering',
  grade: 'middle',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 1e8,
  timeLimitSec: 210,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const ips = rng.sample(['10.0.0.2', '10.0.0.7', '10.0.1.3', '192.168.1.5', '172.16.0.9'], rng.int(3, 4));
    const paths = ['/api/orders', '/api/users', '/health', '/login'];
    const statuses = [200, 200, 201, 304, 404, 500, 502];
    const rows = Array.from({ length: rng.int(7, 10) }, () => ({ ip: rng.pick(ips), m: rng.pick(['GET', 'POST']), p: rng.pick(paths), s: rng.pick(statuses) }));
    const kind = rng.int(0, 3);
    let cmd: string;
    let key: number;
    if (kind === 0) {
      const code = rng.pick([404, 500, 200]);
      cmd = `grep -c ' ${code}$' access.log`;
      key = rows.filter((r) => r.s === code).length;
    } else if (kind === 1) {
      cmd = "cut -d' ' -f1 access.log | sort -u | wc -l";
      key = new Set(rows.map((r) => r.ip)).size;
    } else if (kind === 2) {
      cmd = "awk '$4 >= 500' access.log | wc -l";
      key = rows.filter((r) => r.s >= 500).length;
    } else {
      cmd = "cut -d' ' -f1 access.log | sort | uniq -c | sort -rn | head -1";
      const c = new Map<string, number>();
      for (const r of rows) c.set(r.ip, (c.get(r.ip) ?? 0) + 1);
      key = Math.max(...c.values());
    }
    return {
      prompt: `Файл access.log (поля через один пробел: ip, метод, путь, код ответа). Какое число выведет команда${kind === 3 ? ' (первое поле строки)' : ''}?`,
      code: [...rows.map((r) => `${r.ip} ${r.m} ${r.p} ${r.s}`), '', `$ ${cmd}`].join('\n'),
      answerHint: 'число',
      answerKey: String(key),
      explanation:
        kind === 3
          ? 'uniq -c считает подряд идущие одинаковые строки (поэтому сначала sort), sort -rn ставит самую частую первой.'
          : 'grep -c считает строки по шаблону, cut -f1 берёт IP, sort -u оставляет уникальные, awk сравнивает 4-е поле как число.',
      params: { kind, n: rows.length },
    };
  },
});

export const shellExitStatus: TaskGenerator = commonFamily({
  id: 'cm.shell-exit-status',
  competency: 'common.linux',
  title: 'Код возврата цепочки команд',
  specialization: 'engineering',
  grade: 'senior',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.1,
  b: 1.1,
  paramSpace: 1e5,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const codes = { a: rng.pick([0, 0, 1, 2]), b: rng.pick([0, 1, 3]), c: rng.pick([0, 4, 127]) };
    const kind = rng.int(0, 3);
    const pipefail = rng.int(0, 1) === 1;
    let line: string;
    let key: number;
    if (kind === 0) {
      line = 'a && b || c';
      if (codes.a !== 0) key = codes.c;
      else key = codes.b === 0 ? 0 : codes.c;
    } else if (kind === 1) {
      line = 'a || b && c';
      // || и && в bash одного приоритета, левоассоциативны: (a || b) && c
      const left = codes.a === 0 ? 0 : codes.b;
      key = left === 0 ? codes.c : left;
    } else if (kind === 2) {
      line = 'a | b | c';
      const all = [codes.a, codes.b, codes.c];
      key = pipefail ? ([...all].reverse().find((x) => x !== 0) ?? 0) : codes.c;
    } else {
      line = '! a | b';
      const st = pipefail ? ([codes.b, codes.a].find((x) => x !== 0) ?? 0) : codes.b;
      key = st === 0 ? 1 : 0;
    }
    return {
      prompt: `Команды a, b, c завершаются с кодами ${codes.a}, ${codes.b}, ${codes.c} соответственно (вывод не важен). Что напечатает скрипт bash?`,
      code: [...(pipefail ? ['set -o pipefail'] : []), line, 'echo $?'].join('\n'),
      answerHint: 'число',
      answerKey: String(key),
      explanation:
        'В bash && и || одного приоритета и группируются слева: x || y && z = (x || y) && z; $? — код последней выполненной команды. Код конвейера — код последней команды, а с pipefail — последней ненулевой; ! инвертирует код конвейера.',
      params: { codes, kind, pipefail },
    };
  },
});

// ---------------------------------------------------------------------------
// Тестирование
// ---------------------------------------------------------------------------

const DOMAINS = [
  { what: 'возраст покупателя', unit: 'лет' },
  { what: 'количество товаров в заказе', unit: 'шт.' },
  { what: 'длина пароля', unit: 'символов' },
  { what: 'процент скидки', unit: '%' },
];

export const boundaryValues: TaskGenerator = commonFamily({
  id: 'cm.boundary-values',
  competency: 'common.testing',
  title: 'Граничные значения для теста',
  specialization: 'engineering',
  grade: 'junior',
  catalogIds: ['common.unit-tests'],
  format: 'list',
  a: 1.0,
  b: -0.7,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const d = rng.pick(DOMAINS);
    const lo = rng.int(1, 30);
    const hi = lo + rng.int(5, 80);
    const loIncl = rng.int(0, 1) === 1;
    const hiIncl = rng.int(0, 1) === 1;
    // Два значения на границу: последнее допустимое и первое недопустимое.
    const lowPair = loIncl ? [lo - 1, lo] : [lo, lo + 1];
    const highPair = hiIncl ? [hi, hi + 1] : [hi - 1, hi];
    const cond = `${lo} ${loIncl ? '≤' : '<'} x ${hiIncl ? '≤' : '<'} ${hi}`;
    return {
      prompt: `Поле «${d.what}» (целое, ${d.unit}) допустимо при ${cond}. Какие четыре значения дадут анализ граничных значений (по два на границу: последнее допустимое и первое недопустимое)?`,
      answerHint: 'числа через запятую',
      answerKey: [...lowPair, ...highPair].join(','),
      explanation: `Нижняя граница: ${lowPair.join(' и ')}, верхняя: ${highPair.join(' и ')}. Строгое неравенство сдвигает допустимое значение на единицу внутрь.`,
      params: { lo, hi, loIncl, hiIncl },
    };
  },
});

export const branchCoverage: TaskGenerator = commonFamily({
  id: 'cm.branch-coverage',
  competency: 'common.testing',
  title: 'Покрытие ветвей набором тестов',
  specialization: 'engineering',
  grade: 'middle',
  catalogIds: ['common.unit-tests'],
  format: 'number',
  a: 1.2,
  b: 0.5,
  paramSpace: 1e7,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const t1 = rng.int(5, 20);
    const t2 = t1 + rng.int(10, 40);
    const inputs = Array.from({ length: rng.int(2, 4) }, () => rng.int(0, t2 + 20));
    const covered = new Set<string>();
    for (const x of inputs) {
      covered.add(x < t1 ? 'if1:T' : 'if1:F');
      if (x < t1) continue;
      covered.add(x < t2 ? 'if2:T' : 'if2:F');
      if (x < t2) continue;
      covered.add(x % 2 === 0 ? 'if3:T' : 'if3:F');
    }
    const code = [
      'def fee(x):',
      `    if x < ${t1}:`,
      '        return 0',
      `    if x < ${t2}:`,
      '        return 50',
      '    if x % 2 == 0:',
      '        return 100',
      '    return 150',
      '',
      `# тесты: ${inputs.map((x) => `fee(${x})`).join(', ')}`,
    ].join('\n');
    return {
      prompt: 'В функции три if, у каждого две ветви (истина и ложь) — всего 6. Сколько ветвей НЕ покрыто тестами?',
      code,
      answerHint: 'число ветвей',
      answerKey: String(6 - covered.size),
      explanation: `Покрыты: ${[...covered].sort().join(', ')}. Ветвь считается покрытой, если хотя бы один тест прошёл через неё; до второго и третьего if доходят только x ≥ ${t1} и x ≥ ${t2}.`,
      params: { t1, t2, inputs },
    };
  },
});

export const mutationKill: TaskGenerator = commonFamily({
  id: 'cm.mutation-kill',
  competency: 'common.testing',
  title: 'Сколько тестов убьют мутанта',
  specialization: 'engineering',
  grade: 'senior',
  catalogIds: ['common.unit-tests'],
  format: 'number',
  a: 1.2,
  b: 1.1,
  paramSpace: 1e7,
  timeLimitSec: 270,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const limit = rng.int(10, 60);
    const rate = rng.pick([5, 10, 20]);
    const orig = (x: number) => (x >= limit ? x - Math.floor((x * rate) / 100) : x);
    const mutants = [
      { text: `x > ${limit}`, f: (x: number) => (x > limit ? x - Math.floor((x * rate) / 100) : x) },
      { text: `x >= ${limit + 1}`, f: (x: number) => (x >= limit + 1 ? x - Math.floor((x * rate) / 100) : x) },
      { text: `x <= ${limit}`, f: (x: number) => (x <= limit ? x - Math.floor((x * rate) / 100) : x) },
    ];
    const mi = rng.int(0, 2);
    const m = mutants[mi]!;
    const pool = [limit - rng.int(1, 5), limit, limit + 1, limit + rng.int(2, 30), Math.max(0, limit - rng.int(6, 9)), limit * 2];
    const inputs = rng.sample([...new Set(pool)], rng.int(3, 5));
    const killed = inputs.filter((x) => m.f(x) !== orig(x)).length;
    const code = [
      'def price(x):',
      `    if x >= ${limit}:            # мутант: if ${m.text}:`,
      `        return x - x * ${rate} // 100`,
      '    return x',
      '',
      ...inputs.map((x) => `assert price(${x}) == ${orig(x)}`),
    ].join('\n');
    return {
      prompt: 'Тесты проходят на исходной функции. Мутационное тестирование заменило условие на указанное в комментарии. Сколько из этих assert упадут на мутанте (убьют его)?',
      code,
      answerHint: 'число тестов',
      answerKey: String(killed),
      explanation: `Мутант отличается от оригинала только на входах, где условия расходятся; тест убивает мутанта, если его вход попадает туда. Здесь таких тестов: ${killed}.`,
      params: { limit, rate, mi, inputs },
    };
  },
});

// ---------------------------------------------------------------------------
// Конкурентность
// ---------------------------------------------------------------------------

export const lostUpdate: TaskGenerator = commonFamily({
  id: 'cm.lost-update',
  competency: 'common.concurrency',
  title: 'Потерянное обновление при чередовании потоков',
  specialization: 'backend',
  grade: 'middle',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.2,
  b: 0.6,
  paramSpace: 1e6,
  timeLimitSec: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const x0 = rng.int(0, 50);
    const dA = rng.int(1, 9);
    const dB = rng.int(10, 30);
    const nA = rng.int(1, 2);
    const nB = rng.int(1, 2);
    // Каждое обновление — два шага: чтение в локальную r, запись x = r + d.
    const steps: { th: 'A' | 'B'; op: 'read' | 'write' }[] = [];
    const left = { A: nA * 2, B: nB * 2 };
    const phase = { A: 0, B: 0 };
    while (left.A + left.B > 0) {
      const th: 'A' | 'B' = left.A === 0 ? 'B' : left.B === 0 ? 'A' : rng.int(0, 1) === 0 ? 'A' : 'B';
      steps.push({ th, op: phase[th] % 2 === 0 ? 'read' : 'write' });
      phase[th]++;
      left[th]--;
    }
    let x = x0;
    const r = { A: 0, B: 0 };
    for (const s of steps) {
      if (s.op === 'read') r[s.th] = x;
      else x = r[s.th] + (s.th === 'A' ? dA : dB);
    }
    return {
      prompt: [
        `Общая переменная x = ${x0}. Поток A ${nA} раз(а) прибавляет ${dA}, поток B ${nB} раз(а) прибавляет ${dB}; каждое прибавление — два шага без блокировки: r = x, затем x = r + d (r — локальная у потока).`,
        'Планировщик выполнил шаги в порядке ниже. Чему равно x в конце?',
      ].join('\n'),
      code: steps.map((s, i) => `${i + 1}. ${s.th}: ${s.op === 'read' ? 'r = x' : `x = r + ${s.th === 'A' ? dA : dB}`}`).join('\n'),
      answerHint: 'число',
      answerKey: String(x),
      explanation: `Без потерь было бы ${x0 + nA * dA + nB * dB}; запись по устаревшему r затирает чужое прибавление (lost update). Лечится атомарной операцией, блокировкой или CAS.`,
      params: { x0, dA, dB, nA, nB },
    };
  },
});

export const deadlockSchedule: TaskGenerator = commonFamily({
  id: 'cm.deadlock-schedule',
  competency: 'common.concurrency',
  title: 'Взаимная блокировка по расписанию',
  specialization: 'backend',
  grade: 'senior',
  catalogIds: ['common.debugging'],
  format: 'number',
  a: 1.2,
  b: 1.2,
  paramSpace: 1e6,
  timeLimitSec: 300,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const locks = ['L1', 'L2', 'L3'];
    const nThreads = rng.int(2, 3);
    const threads = Array.from({ length: nThreads }, (_, i) => ({ name: `T${i + 1}`, order: rng.sample(locks, 2) }));
    const schedule = Array.from({ length: rng.int(4, 6) }, () => rng.int(0, nThreads - 1));
    // Шаг потока: взять первый замок → взять второй → отпустить оба и завершиться. Занятый замок — поток ждёт (шаг не выполнен).
    const owner = new Map<string, number>();
    const pc = threads.map(() => 0);
    const step = (t: number): boolean => {
      const th = threads[t]!;
      if (pc[t] === 3) return false;
      if (pc[t]! < 2) {
        const l = th.order[pc[t]!]!;
        if (owner.has(l)) return false;
        owner.set(l, t);
        pc[t]!++;
        return true;
      }
      for (const l of th.order) owner.delete(l);
      pc[t] = 3;
      return true;
    };
    for (const t of schedule) step(t);
    // Дальше планировщик крутит потоки по кругу, пока кто-то продвигается.
    let progress = true;
    while (progress) {
      progress = false;
      for (let t = 0; t < nThreads; t++) if (step(t)) progress = true;
    }
    const stuck = pc.filter((p) => p !== 3).length;
    return {
      prompt: [
        'Каждый поток берёт два замка в своём порядке, затем отпускает оба и завершается. Если замок занят, поток ждёт. Планировщик сначала даёт шаги потокам в указанном порядке (шаг ждущего потока пропадает), затем крутит потоки по кругу, пока хоть один продвигается.',
        'Сколько потоков так и не завершатся?',
      ].join('\n'),
      code: [...threads.map((t) => `${t.name}: lock(${t.order[0]}); lock(${t.order[1]}); unlock all`), '', `шаги: ${schedule.map((t) => threads[t]!.name).join(', ')}`].join('\n'),
      answerHint: 'число потоков (0, если все завершатся)',
      answerKey: String(stuck),
      explanation: 'Взаимная блокировка — цикл ожидания: каждый поток держит замок, который нужен следующему. Единый порядок взятия замков для всех потоков исключает такой цикл.',
      params: { threads: threads.map((t) => t.order.join('>')), schedule },
    };
  },
});

export const COMMON_OPS_GENERATORS: readonly TaskGenerator[] = [
  gitStaged,
  gitLogRange,
  gitResetModes,
  chmodOctal,
  shellPipeline,
  shellExitStatus,
  boundaryValues,
  branchCoverage,
  mutationKill,
  lostUpdate,
  deadlockSchedule,
];
