// Второй пакет семейств engineering.devops (+3 Junior, +5 Middle, +4 Senior; решение владельца 11.10).
// Параметры a, b – экспертные, не откалиброваны. Семантика Terraform (count против for_each), PDB, ResourceQuota,
// правило for у алертов Prometheus и матрицы GitHub Actions – по общему знанию; сверка с документацией не
// проводилась (помечено в docs/validation-results.md).
import { fam, randomDag, table } from './engineering-bank2-util';
import type { TaskGenerator } from '../types';

const SUB = 'devops' as const;

// --- Junior ---------------------------------------------------------------------------------------------------

export const tfPlanCount = fam(
  { id: 'tf-plan-count', title: 'Что покажет terraform plan', sub: SUB, grade: 'junior', cat: ['eng.iac'], format: 'number', hint: 'число ресурсов', a: 1.1, b: -0.9, space: 1e5, time: 180 },
  (rng) => {
    const pool = ['aws_s3_bucket.logs', 'aws_s3_bucket.media', 'aws_sqs_queue.jobs', 'aws_sqs_queue.dlq', 'aws_db_instance.main', 'aws_db_instance.replica', 'aws_instance.web', 'aws_instance.worker', 'aws_instance.batch', 'aws_lb.front', 'aws_iam_role.app', 'aws_sns_topic.alerts', 'aws_cache_cluster.sessions', 'aws_efs_file_system.shared'];
    const price: Record<string, number> = { small: 10, medium: 25, large: 60 };
    const attrs = ['small', 'medium', 'large'];
    const inState = rng.sample(pool, rng.int(8, 11));
    const state = new Map(inState.map((r) => [r, rng.pick(attrs)]));
    const desired = new Map<string, string>();
    for (const r of inState) if (rng.int(0, 3) > 0) desired.set(r, rng.int(0, 2) === 0 ? rng.pick(attrs.filter((x) => x !== state.get(r))) : state.get(r)!);
    for (const r of rng.sample(pool.filter((x) => !state.has(x)), rng.int(1, 3))) desired.set(r, rng.pick(attrs));
    const add = [...desired.keys()].filter((r) => !state.has(r)).length;
    const destroy = [...state.keys()].filter((r) => !desired.has(r)).length;
    const change = [...desired.keys()].filter((r) => state.has(r) && state.get(r) !== desired.get(r)).length;
    const kind = rng.int(0, 5);
    const cost = (m: Map<string, string>) => [...m.values()].reduce((s, v) => s + price[v]!, 0);
    const delta = cost(desired) - cost(state);
    const answer = [add, destroy, change, add + destroy + change, delta, delta][kind]!;
    const ask = ['создано (to add)', 'удалено (to destroy)', 'изменено на месте (to change)', 'затронуто всего (создание, удаление и изменение вместе)', 'изменится стоимость', 'изменится стоимость'][kind]!;
    return {
      prompt: `Terraform сравнивает текущее состояние (state) с описанием в коде. Атрибут size у каждого ресурса – единственный отличающийся параметр, менять его можно на месте. ${kind >= 4 ? 'Цены за размер: small – 10, medium – 25, large – 60 условных единиц в месяц. На сколько единиц в месяц изменится суммарная стоимость после применения плана (отрицательное число – если станет дешевле)?' : `Сколько ресурсов будет ${ask}?`}`,
      code: ['# state', ...[...state].map(([r, s]) => `${r}  size=${s}`), '', '# код (желаемое состояние)', ...[...desired].map(([r, s]) => `${r}  size=${s}`)].join('\n'),
      answerKey: String(answer),
      explanation: `Есть в коде, нет в state – создание (${add}); есть в state, нет в коде – удаление (${destroy}); есть в обоих, но size отличается – изменение на месте (${change}). Изменение стоимости: ${delta}.`,
      params: { kind, add, destroy, change },
    };
  },
);

export const multistageSize = fam(
  { id: 'multistage-size', title: 'Размер итогового образа', sub: SUB, grade: 'junior', cat: ['eng.dockerfile'], format: 'number', hint: 'МБ', a: 1.1, b: -0.8, space: 1e5, time: 180 },
  (rng) => {
    const buildBase = rng.pick([700, 900, 1100]);
    const runBase = rng.pick([20, 40, 80, 120]);
    const deps = rng.int(2, 8) * 50;
    const artifact = rng.int(2, 9) * 10;
    const certs = rng.int(1, 5) * 5;
    const cfg = rng.int(1, 4);
    const extraRun = rng.int(0, 1) === 1 ? rng.int(1, 6) * 10 : 0;
    const answer = runBase + artifact + certs + cfg + extraRun;
    return {
      prompt: 'Образ собирается двухстадийным Dockerfile. В комментариях указано, сколько МБ добавляет каждая инструкция (метаданные не считаем). Чему равен размер итогового образа (последней стадии), в МБ?',
      code: [
        `FROM builder-base AS build          # ${buildBase} МБ`,
        `RUN install-deps                    # +${deps} МБ`,
        `RUN compile                         # +${artifact} МБ (бинарник)`,
        '',
        `FROM runtime-base                   # ${runBase} МБ`,
        `COPY --from=build /out/app /app     # +${artifact} МБ`,
        `COPY certs/ /etc/certs              # +${certs} МБ`,
        `COPY config.yaml /etc/app.yaml      # +${cfg} МБ`,
        ...(extraRun ? [`RUN install-curl                    # +${extraRun} МБ`] : []),
        'ENTRYPOINT ["/app"]',
      ].join('\n'),
      answerKey: String(answer),
      explanation: `Итоговый образ – только последняя стадия: ${runBase} + ${artifact} + ${certs} + ${cfg}${extraRun ? ` + ${extraRun}` : ''} = ${answer}. Слои стадии build (${buildBase + deps + artifact} МБ) в него не попадают, копируется только артефакт.`,
      params: { buildBase, runBase, deps, artifact, certs, cfg, extraRun },
    };
  },
);

export const ciMatrix = fam(
  { id: 'ci-matrix', title: 'Сколько джоб создаст матрица', sub: SUB, grade: 'junior', cat: ['eng.ci-cd'], format: 'number', hint: 'число джоб', a: 1.1, b: -1.0, space: 1e4, time: 150 },
  (rng) => {
    const os = rng.sample(['ubuntu', 'macos', 'windows', 'alpine'], rng.int(2, 4));
    const ver = rng.sample(['16', '18', '20', '22', '24'], rng.int(2, 4));
    const arch = rng.sample(['x64', 'arm64'], rng.int(1, 2));
    const extra = rng.sample(['db=pg14', 'db=pg16', 'db=mysql8'], rng.int(1, 2));
    const combos = os.flatMap((o) => ver.map((v) => [o, v] as const));
    const excl = rng.sample(combos, rng.int(1, 3));
    const incl = rng.sample(['freebsd', 'solaris', 'debian'], rng.int(0, 3));
    const answer = (combos.length - excl.length) * arch.length + incl.length;
    return {
      prompt: 'Пайплайн запускает по одной джобе на каждую комбинацию значений матрицы. exclude убирает совпавшие комбинации (по всем значениям arch); include с новым значением os, которого нет в матрице, добавляет ещё одну отдельную джобу. Сколько джоб запустится?',
      code: [
        'matrix:',
        `  os: [${os.join(', ')}]`,
        `  node: [${ver.join(', ')}]`,
        `  arch: [${arch.join(', ')}]`,
        '  exclude:',
        ...excl.map(([o, v]) => `    - { os: ${o}, node: ${v} }`),
        ...(incl.length ? ['  include:', ...incl.map((o, i) => `    - { os: ${o}, node: ${ver[0]}, ${extra[i % extra.length]} }`)] : []),
      ].join('\n'),
      answerKey: String(answer),
      explanation: `(${os.length} × ${ver.length} − ${excl.length} исключённых) × ${arch.length} arch + ${incl.length} добавленных include = ${answer}.`,
      params: { os: os.length, ver: ver.length, excl: excl.length, incl: incl.length },
    };
  },
);

// --- Middle ---------------------------------------------------------------------------------------------------

export const tfCountShift = fam(
  { id: 'tf-count-shift', title: 'Удаление элемента из списка в count', sub: SUB, grade: 'middle', cat: ['eng.iac'], format: 'number', hint: 'число ресурсов', a: 1.2, b: 0.4, space: 5e3, time: 210 },
  (rng) => {
    const n = rng.int(6, 14);
    const p = rng.int(0, n - 2); // удаляем не последний: сдвиг затрагивает хвост
    const useCount = rng.int(0, 3) > 0;
    const kind = rng.int(0, 1);
    const names = Array.from({ length: n }, (_, i) => `srv${i + 1}`);
    // count: адрес по индексу; имя вынуждает пересоздание. for_each: адрес по ключу.
    const replacedByShift = n - 1 - p; // индексы p..n-2 получили другое имя → destroy+create
    const destroyed = useCount ? replacedByShift + 1 : 1;
    const created = useCount ? replacedByShift : 0;
    const answer = kind === 0 ? destroyed : created;
    return {
      prompt: `Серверы заданы ресурсом, который ${useCount ? 'использует count = length(var.names) и берёт имя var.names[count.index]' : 'использует for_each = toset(var.names) и берёт имя each.key'}. Изменение имени сервера пересоздаёт его (destroy + create). Из списка удалили элемент «${names[p]}» (номер ${p + 1} в списке). Сколько ресурсов ${kind === 0 ? 'будет удалено (destroy)' : 'будет создано (create)'} по плану?`,
      code: `var.names (было): [${names.join(', ')}]`,
      answerKey: String(answer),
      explanation: useCount
        ? `При count адрес – индекс. После удаления элемента ${p + 1} все следующие (${replacedByShift}) сдвигаются на индекс влево, их имя меняется → пересоздание; последний индекс исчезает. Удалено ${destroyed}, создано ${created}.`
        : 'При for_each адрес – ключ: удалённый элемент уничтожается, остальные не затрагиваются. Удалено 1, создано 0.',
      params: { n, p, useCount, kind },
    };
  },
);

export const alertForClause = fam(
  { id: 'alert-for-clause', title: 'Когда сработает алерт с for', sub: SUB, grade: 'middle', cat: ['eng.observability', 'eng.alerting'], format: 'number', hint: 'секунды от начала', a: 1.2, b: 0.3, space: 1e6, time: 210 },
  (rng) => {
    const step = rng.pick([15, 30, 60]);
    const forEvals = rng.int(3, 5);
    const forSec = forEvals * step;
    // Серия: короткие всплески (короче for), затем длинный.
    const vals: boolean[] = [];
    const bursts = rng.int(1, 3);
    for (let i = 0; i < bursts; i++) {
      for (let k = 0, len = rng.int(1, forEvals); k < len; k++) vals.push(true);
      for (let k = 0, len = rng.int(1, 3); k < len; k++) vals.push(false);
    }
    const lead = rng.int(0, 2);
    for (let k = 0; k < lead; k++) vals.push(false);
    for (let k = 0, len = rng.int(forEvals + 2, forEvals + 5); k < len; k++) vals.push(true);
    let activeAt = -1;
    let answer = -1;
    for (let i = 0; i < vals.length; i++) {
      const t = i * step;
      if (vals[i]) {
        if (activeAt < 0) activeAt = t;
        if (t - activeAt >= forSec) {
          answer = t;
          break;
        }
      } else activeAt = -1;
    }
    const label = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return {
      prompt: `Правило алертинга проверяется каждые ${step} с, первая проверка – в момент 0. Условие выражения (expr) на каждой проверке показано ниже. В правиле задано for: ${forSec} с: алерт переходит в firing, когда условие непрерывно выполняется не менее ${forSec} с с момента первого true; любое false сбрасывает ожидание. В какую секунду от момента 0 алерт впервые станет firing?`,
      code: vals.map((v, i) => `${label(i * step)}  ${v ? 'true' : 'false'}`).join('\n'),
      answerKey: String(answer),
      explanation: `Ожидание (pending) начинается с первого true после false и сбрасывается на false. Firing наступает на первой проверке, когда с начала непрерывной серии прошло не менее ${forSec} с: ${answer} с.`,
      params: { step, forEvals, len: vals.length },
    };
  },
);

export const cacheMisses = fam(
  { id: 'cache-misses', title: 'Промахи кэша зависимостей в CI', sub: SUB, grade: 'middle', cat: ['eng.ci-cd'], format: 'number', hint: 'число промахов', a: 1.1, b: 0.2, space: 1e6, time: 210 },
  (rng) => {
    const n = rng.int(14, 22);
    const locks = ['L1', 'L2', 'L3', 'L4'];
    const tools = ['T1', 'T2', 'T3'];
    let lock = 'L1';
    let tool = 'T1';
    const seen = new Set<string>();
    const rows: string[] = [];
    let misses = 0;
    for (let i = 1; i <= n; i++) {
      let note = 'исходники (src/)';
      const r = rng.int(0, 3);
      if (r === 0) {
        lock = rng.pick(locks.filter((x) => x !== lock));
        note = `package-lock.json → ${lock}`;
      } else if (r === 1 && i > 2) {
        tool = rng.pick(tools.filter((x) => x !== tool));
        note = `.nvmrc → ${tool}`;
      }
      const key = `${lock}-${tool}`;
      const miss = !seen.has(key);
      if (miss) misses++;
      seen.add(key); // успешный прогон сохраняет кэш под своим ключом
      rows.push(`коммит ${i}: ${note}`);
    }
    const install = rng.int(2, 9);
    return {
      prompt: 'Кэш зависимостей в CI хранится под ключом из хеша package-lock.json и версии Node (.nvmrc). Прогон – промах, если кэша с таким ключом ещё нет; после любого прогона кэш под его ключом сохраняется и живёт дальше. Состояния файлов сразу после первого коммита: lock = L1, Node = T1 (кэша до него нет). Ниже – что менялось в каждом из последовательных коммитов (каждый запускает один прогон; если файл вернулся к прежнему значению, ключ совпадает со старым). Промах стоит дополнительных ' + install + ' мин на установку зависимостей. Сколько минут на установку зависимостей в сумме будет потрачено (считая первый прогон)?',
      code: rows.join('\n'),
      answerKey: String(misses * install),
      explanation: `Промахов ${misses}, по ${install} мин. Промах – только на ранее не встречавшейся паре (lock, Node). Изменения исходников ключ не меняют; возврат к прежним значениям даёт попадание в сохранённый кэш.`,
      params: { n, misses },
    };
  },
);

export const quotaFit = fam(
  { id: 'quota-fit', title: 'Сколько реплик влезет в квоту', sub: SUB, grade: 'middle', cat: ['eng.k8s-resources'], format: 'number', hint: 'реплик', a: 1.2, b: 0.5, space: 1e6, time: 240 },
  (rng) => {
    const qCpu = rng.pick([4000, 6000, 8000, 10000]);
    const qMem = rng.pick([8, 12, 16, 20]) * 1024;
    const qPods = rng.int(8, 14);
    const apps = rng.sample(['api', 'worker', 'cache', 'cron'], rng.int(2, 3)).map((name) => ({ name, replicas: rng.int(1, 3), cpu: rng.pick([100, 250, 500]), mem: rng.pick([256, 512, 1024]) }));
    const usedCpu = apps.reduce((s, a) => s + a.replicas * a.cpu, 0);
    const usedMem = apps.reduce((s, a) => s + a.replicas * a.mem, 0);
    const usedPods = apps.reduce((s, a) => s + a.replicas, 0);
    const cpu = rng.pick([200, 250, 300, 500]);
    const mem = rng.pick([256, 384, 512, 768]);
    const byCpu = Math.floor((qCpu - usedCpu) / cpu);
    const byMem = Math.floor((qMem - usedMem) / mem);
    const byPods = qPods - usedPods;
    const answer = Math.max(0, Math.min(byCpu, byMem, byPods));
    return {
      prompt: `В неймспейсе действует ResourceQuota по requests (учитываются requests подов; limits в квоте не участвуют). Сколько реплик нового Deployment (requests: cpu ${cpu}m, memory ${mem}Mi на под) можно запустить, чтобы квота не была превышена?`,
      code: [
        `квота: requests.cpu ${qCpu}m, requests.memory ${qMem}Mi, pods ${qPods}`,
        'уже запущено:',
        ...apps.map((a) => `  ${a.name}: ${a.replicas} под(а), requests cpu ${a.cpu}m, memory ${a.mem}Mi на под`),
      ].join('\n'),
      answerKey: String(answer),
      explanation: `Остаток: cpu ${qCpu - usedCpu}m (${byCpu} реплик), память ${qMem - usedMem}Mi (${byMem}), pods ${byPods}. Подойдёт наименьшее: ${answer}.`,
      params: { qCpu, qMem, qPods, cpu, mem },
    };
  },
);

export const pdbDrain = fam(
  { id: 'pdb-drain', title: 'Сколько займёт drain узла с PDB', sub: SUB, grade: 'middle', cat: ['eng.k8s-probes', 'eng.deploy-rollback'], format: 'number', hint: 'минуты', a: 1.2, b: 0.6, space: 1e4, time: 240 },
  (rng) => {
    const replicas = rng.int(5, 10);
    const allowed = rng.int(1, 2);
    const useMaxUnavail = rng.int(0, 1) === 0;
    const onNode = rng.int(allowed + 1, Math.min(replicas, allowed + 4));
    const t = rng.pick([1, 2, 3, 5]);
    const rounds = Math.ceil(onNode / allowed);
    const answer = (rounds - 1) * t;
    return {
      prompt: `Сервис – ${replicas} реплик, все готовы. PodDisruptionBudget: ${useMaxUnavail ? `maxUnavailable: ${allowed}` : `minAvailable: ${replicas - allowed}`}. На узле, который выводят из работы командой drain, ${onNode} подов сервиса. Eviction выселяет за раунд максимум столько подов, сколько допускает PDB, мгновенно; замена выселенного пода (на другом узле) становится Ready через ${t} мин, и только после этого PDB разрешает следующий раунд. Через сколько минут после первого раунда будет выселен последний под?`,
      answerKey: String(answer),
      explanation: `PDB разрешает ${allowed} недоступных одновременно, раундов ⌈${onNode}/${allowed}⌉ = ${rounds}; между раундами ждём ${t} мин, пауз ${rounds - 1}: ${answer}.`,
      params: { replicas, allowed, useMaxUnavail, onNode, t },
    };
  },
);

// --- Senior ---------------------------------------------------------------------------------------------------

export const canaryExposure = fam(
  { id: 'canary-exposure', title: 'Цена канареечной выкатки', sub: SUB, grade: 'senior', cat: ['eng.deploy-rollback'], format: 'number', hint: 'число запросов', a: 1.2, b: 1.1, space: 1e6, time: 300 },
  (rng) => {
    const rps = rng.pick([100, 200, 500, 1000]);
    const dur = rng.pick([5, 10]);
    const thr = rng.pick([2, 3, 5]);
    const steps = [1, 5, 10, 25, 50].slice(0, rng.int(4, 5));
    const abortAt = rng.int(1, steps.length - 1);
    const err = steps.map((_, i) => (i < abortAt ? rng.pick([0, 1, 2].filter((e) => e <= thr)) : rng.pick([6, 8, 10, 12])));
    let total = 0;
    for (let i = 0; i <= abortAt; i++) total += (rps * 60 * dur * steps[i]! * err[i]!) / 10000;
    return {
      prompt: `Выкатка идёт канарейкой. Суммарный трафик сервиса – ${rps} запросов/с. Шаги: доля трафика на новую версию растёт по таблице, каждый шаг длится ${dur} мин. Решение принимается в конце шага: если доля ошибок канарейки на шаге выше ${thr} %, выкатка немедленно откатывается (весь трафик возвращается на старую версию). Сколько ошибочных запросов получили пользователи от канарейки за всё время выкатки?`,
      code: table('канарейка', ['шаг', 'доля трафика, %', 'ошибки канарейки, %'], steps.map((s, i) => [i + 1, s, err[i]!])),
      answerKey: String(total),
      explanation: `Шаг ${abortAt + 1} – первый, где ошибок больше ${thr} %; откат в его конце, поэтому ошибки этого шага тоже учитываются. Сумма по шагам 1…${abortAt + 1}: ${total}.`,
      params: { rps, dur, thr, steps: steps.length, abortAt },
    };
  },
);

export const ciRunners = fam(
  { id: 'ci-runners', title: 'Длительность пайплайна на ограниченных раннерах', sub: SUB, grade: 'senior', cat: ['eng.ci-cd'], format: 'number', hint: 'минуты', a: 1.2, b: 1.3, space: 1e7, time: 330 },
  (rng) => {
    const n = rng.int(7, 8);
    const names = rng.sample(['lint', 'unit', 'build', 'integration', 'e2e', 'scan', 'package', 'docs', 'deploy-stage', 'smoke'], n);
    const needs = randomDag(rng, n);
    const dur = Array.from({ length: n }, () => rng.int(1, 6) * 2);
    const runners = rng.int(2, 3);
    // Когда раннер свободен, стартует первая в списке готовая джоба.
    const started: number[] = Array(n).fill(-1);
    const finished: number[] = Array(n).fill(-1);
    let t = 0;
    let left = n;
    while (left > 0) {
      const running = finished.filter((f, i) => started[i]! >= 0 && f > t).length;
      let free = runners - running;
      for (let i = 0; i < n && free > 0; i++) {
        if (started[i]! >= 0) continue;
        if (needs[i]!.every((p) => finished[p]! >= 0 && finished[p]! <= t)) {
          started[i] = t;
          finished[i] = t + dur[i]!;
          free--;
          left--;
        }
      }
      const next = finished.filter((f, i) => started[i]! >= 0 && f > t);
      if (left === 0) break;
      t = Math.min(...next);
    }
    const answer = Math.max(...finished);
    return {
      prompt: `В CI одновременно работают ${runners} раннера. Как только раннер свободен, он берёт ПЕРВУЮ в списке джобу, все зависимости (needs) которой уже завершены. Джоба занимает раннер на всё время работы. Через сколько минут завершится весь пайплайн (старт в момент 0)?`,
      code: names.map((nm, i) => `${i + 1}. ${nm} (${dur[i]} мин)${needs[i]!.length ? ': needs ' + needs[i]!.map((p) => names[p]).join(', ') : ''}`).join('\n'),
      answerKey: String(answer),
      explanation: `Старты по раннерам: ${names.map((nm, i) => `${nm} с ${started[i]}`).join('; ')}. Последняя джоба заканчивается на ${answer}-й минуте.`,
      params: { n, runners },
    };
  },
);

export const tfReplaceCascade = fam(
  { id: 'tf-replace-cascade', title: 'Каскад пересоздания в Terraform', sub: SUB, grade: 'senior', cat: ['eng.iac'], format: 'number', hint: 'число ресурсов', a: 1.2, b: 1.2, space: 1e6, time: 300 },
  (rng) => {
    const pool = ['vpc', 'subnet', 'sec_group', 'db', 'cache', 'app_server', 'load_balancer', 'dns_record', 'queue', 'bucket'];
    const n = rng.int(7, 10);
    const names = rng.sample(pool, n);
    const parents = randomDag(rng, n);
    type Edge = { from: number; to: number; replace: boolean };
    const edges: Edge[] = parents.flatMap((ps, to) => ps.map((from) => ({ from, to, replace: rng.int(0, 2) > 0 })));
    const trigger = rng.int(0, 2);
    const replaced = new Set<number>([trigger]);
    for (let i = trigger; i < n; i++) if (replaced.has(i)) for (const e of edges) if (e.from === i && e.replace) replaced.add(e.to);
    const updated = new Set<number>();
    for (const e of edges) if (replaced.has(e.from) && !e.replace && !replaced.has(e.to)) updated.add(e.to);
    const kind = rng.int(0, 1);
    const answer = kind === 0 ? replaced.size : replaced.size + updated.size;
    return {
      prompt: `В коде Terraform у ресурса ${names[trigger]} поменяли параметр, из-за которого его нужно пересоздать (forces replacement). Зависимости ниже: «B ← A (replace)» значит, что B ссылается на атрибут A, который при пересоздании A меняется, и это вынуждает пересоздать и B; «B ← A (in-place)» значит, что B лишь обновится на месте. Пересозданный ресурс распространяет изменения на своих зависимых так же. Сколько ресурсов ${kind === 0 ? 'будет пересоздано (включая исходный)' : 'будет затронуто всего (пересоздано или обновлено на месте)'}?`,
      code: edges.map((e) => `${names[e.to]} ← ${names[e.from]} (${e.replace ? 'replace' : 'in-place'})`).join('\n'),
      answerKey: String(answer),
      explanation: `Пересоздаются: ${[...replaced].map((i) => names[i]).join(', ')}. Обновятся на месте: ${[...updated].map((i) => names[i]).join(', ') || 'никто'}. Каскад идёт только по «replace»-связям; «in-place» его останавливает.`,
      params: { n, trigger, kind },
    };
  },
);

export const seriesCardinality = fam(
  { id: 'series-cardinality', title: 'Сколько рядов породит метрика', sub: SUB, grade: 'senior', cat: ['eng.observability'], format: 'number', hint: 'число рядов', a: 1.1, b: 1.0, space: 1e6, time: 270 },
  (rng) => {
    const buckets = rng.pick([8, 10, 12, 14]);
    const labels = [
      { name: 'method', n: rng.pick([4, 5]) },
      { name: 'status', n: rng.pick([5, 6, 8]) },
      { name: 'route', n: rng.pick([20, 30, 50]) },
      { name: 'user_id', n: rng.pick([1000, 2000, 5000]) },
    ];
    const instances = rng.int(3, 12);
    const seriesPer = buckets + 1 + 2;
    const total = (ls: typeof labels) => ls.reduce((p, l) => p * l.n, 1) * seriesPer * instances;
    const kind = rng.int(0, 1);
    const drop = labels.find((l) => l.name === 'user_id')!;
    const answer = kind === 0 ? total(labels) : total(labels.filter((l) => l !== drop));
    return {
      prompt: `Сервис отдаёт гистограмму http_request_duration_seconds с ${buckets} явными границами. Гистограмма порождает ${buckets + 1} рядов _bucket (с границей +Inf), а также ряды _sum и _count на каждое сочетание значений меток. Метки и число их значений – ниже; сочетаются все со всеми. Подов – ${instances}, метка instance отличается у каждого. ${kind === 0 ? 'Сколько рядов хранит Prometheus для этой метрики?' : `Метку user_id убрали (она высококардинальна). Сколько рядов будет теперь?`}`,
      code: labels.map((l) => `${l.name}: ${l.n}`).join('\n'),
      answerKey: String(answer),
      explanation: `Рядов на сочетание – ${buckets + 1} + 2 = ${seriesPer}; сочетаний меток ${kind === 0 ? labels.reduce((p, l) => p * l.n, 1) : labels.filter((l) => l !== drop).reduce((p, l) => p * l.n, 1)}; подов ${instances}. Кардинальность растёт произведением значений меток – именно user_id делает её неподъёмной.`,
      params: { buckets, instances, kind },
    };
  },
);

export const DEVOPS_BANK2: TaskGenerator[] = [
  tfPlanCount,
  multistageSize,
  ciMatrix,
  tfCountShift,
  alertForClause,
  cacheMisses,
  quotaFit,
  pdbDrain,
  canaryExposure,
  ciRunners,
  tfReplaceCascade,
  seriesCardinality,
];
