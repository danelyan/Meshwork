// Расширенный банк frontend.design-system: +3 Junior, +5 Middle, +4 Senior (решение владельца 11.10).
// Ключ считает код генератора по модели из условия; a, b — ПРЕДЛОЖЕНИЕ.
import { createRng } from '../rng';
import type { TaskInstance } from '../types';
import { DS, fam } from './frontend-bank2-util';

// --- Junior ---------------------------------------------------------------------------

export const boxModel = fam({
  id: 'fe.b2-box-model',
  sub: DS,
  grade: 'junior',
  title: 'Ширина блока с учётом box-sizing',
  catalogIds: ['fe.css-layout', 'fe.css-cascade'],
  taskId: 'task:css-layout',
  a: 1.2,
  b: -1.1,
  space: 1e5,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const w = rng.pick([200, 240, 300, 320, 400]);
    const p = rng.int(4, 24);
    const bd = rng.int(1, 6);
    const m = rng.int(0, 20);
    const bs = rng.pick(['content-box', 'border-box'] as const);
    const total = bs === 'content-box' ? w + 2 * p + 2 * bd + 2 * m : w + 2 * m;
    return {
      prompt: 'Сколько пикселей по горизонтали занимает блок в потоке вместе с внешними отступами?',
      code: `.card {\n  box-sizing: ${bs};\n  width: ${w}px;\n  padding: 0 ${p}px;\n  border: ${bd}px solid;\n  margin: 0 ${m}px;\n}`,
      answerHint: 'пиксели, число',
      answerKey: String(total),
      explanation: bs === 'content-box' ? `width задаёт только содержимое: ${w} + 2×${p} + 2×${bd} + 2×${m} = ${total}.` : `При border-box width включает padding и border, остаются только внешние отступы: ${w} + 2×${m} = ${total}.`,
      params: { w, p, bd, m, bs },
    };
  },
});

export const tabOrder = fam({
  id: 'fe.b2-tab-order',
  sub: DS,
  grade: 'junior',
  title: 'Порядок фокуса по Tab',
  catalogIds: ['fe.a11y', 'fe.html-semantic'],
  format: 'text',
  a: 1.2,
  b: -0.8,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const labels = rng.sample(['Save', 'Cancel', 'Help', 'Search', 'Menu', 'Close', 'Next', 'Back'], rng.int(5, 7));
    const kinds = ['button', 'a', 'input', 'div', 'button-dis'] as const;
    const items = labels.map((label) => {
      const kind = rng.pick(kinds);
      const ti = rng.pick([undefined, undefined, undefined, 0, -1, 1, 2, 3] as const);
      return { label, kind, ti };
    });
    const natural = (k: string) => k === 'button' || k === 'a' || k === 'input';
    const focusable = items.filter((it) => (it.ti === undefined ? natural(it.kind) : it.ti >= 0) && it.kind !== 'button-dis');
    const pos = focusable.filter((it) => (it.ti ?? 0) > 0).sort((x, y) => x.ti! - y.ti!); // sort стабилен: при равенстве порядок DOM
    const rest = focusable.filter((it) => !((it.ti ?? 0) > 0));
    const order = [...pos, ...rest].map((it) => it.label.toLowerCase());
    const html = (it: (typeof items)[number]) => {
      const t = it.ti === undefined ? '' : ` tabindex="${it.ti}"`;
      switch (it.kind) {
        case 'button': return `<button${t}>${it.label}</button>`;
        case 'button-dis': return `<button disabled${t}>${it.label}</button>`;
        case 'a': return `<a href="#"${t}>${it.label}</a>`;
        case 'input': return `<input${t} aria-label="${it.label}">`;
        default: return `<div${t}>${it.label}</div>`;
      }
    };
    return {
      prompt: 'Пользователь с чистого листа нажимает Tab, пока фокус не пройдёт по всем доступным элементам. В каком порядке они получат фокус? Назовите подписи (метки у input — в aria-label) через запятую. Если фокус не получит ни один, напишите none.',
      code: items.map(html).join('\n'),
      answerHint: 'метки через запятую, строчными',
      answerKey: order.length ? order.join(',') : 'none',
      explanation: 'Сначала идут элементы с положительным tabindex по возрастанию (равные — в порядке документа), затем естественно фокусируемые и tabindex="0" в порядке DOM. tabindex="-1", disabled-кнопки и div без tabindex в обход не попадают.',
      params: { items: items.map((i) => `${i.kind}:${i.ti}`).join(',') },
    };
  },
});

const COLORS = ['red', 'blue', 'green', 'teal', 'orange', 'purple', 'navy', 'olive'];

export const mediaWin = fam({
  id: 'fe.b2-media-win',
  sub: DS,
  grade: 'junior',
  title: 'Какое правило media-запроса победит',
  catalogIds: ['fe.responsive', 'fe.css-cascade'],
  format: 'text',
  taskId: 'task:css-specificity',
  a: 1.2,
  b: -0.6,
  space: 1e5,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const base = rng.pick(COLORS);
    const rules = Array.from({ length: rng.int(3, 4) }, () => ({
      kind: rng.pick(['min', 'max'] as const),
      px: rng.pick([480, 600, 768, 900, 1024, 1200]),
      color: rng.pick(COLORS),
    }));
    const vw = rng.pick([360, 540, 700, 800, 950, 1100, 1300]);
    let color = base;
    for (const r of rules) if (r.kind === 'min' ? vw >= r.px : vw <= r.px) color = r.color;
    return {
      prompt: `Окно браузера шириной ${vw}px. Какого цвета будет текст .title? Все правила имеют одинаковую специфичность.`,
      code: [`.title { color: ${base}; }`, ...rules.map((r) => `@media (${r.kind}-width: ${r.px}px) { .title { color: ${r.color}; } }`)].join('\n'),
      answerHint: 'название цвета',
      answerKey: color,
      explanation: 'Подходят все media-запросы, чьё условие истинно при такой ширине; при равной специфичности побеждает объявленное позже, поэтому берём цвет последнего подошедшего правила (иначе исходный).',
      params: { vw, base, rules: rules.map((r) => `${r.kind}${r.px}${r.color}`).join(',') },
    };
  },
});

// --- Middle ---------------------------------------------------------------------------

type Decl = { layer: string | null; spec: 'id' | 'class' | 'tag'; imp: boolean; color: string };

export const cascadeLayers = fam({
  id: 'fe.b2-cascade-layers',
  sub: DS,
  grade: 'middle',
  title: 'Каскадные слои @layer',
  catalogIds: ['fe.css-cascade', 'fe.css-architecture'],
  format: 'text',
  taskId: 'task:css-specificity',
  a: 1.3,
  b: 0.8,
  space: 1e6,
  time: 240,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const layers = rng.shuffle(['base', 'components', 'utilities']);
    const cols = rng.sample(COLORS, 5);
    const decls: Decl[] = Array.from({ length: 5 }, (_, i) => ({
      layer: rng.pick([layers[0]!, layers[1]!, layers[2]!, null, layers[0]!]),
      spec: rng.pick(['id', 'class', 'tag'] as const),
      imp: rng.int(0, 4) === 0,
      color: cols[i]!,
    }));
    const W = { id: 100, class: 10, tag: 1 };
    const rank = (d: Decl, order: number) => {
      const li = d.layer === null ? -1 : layers.indexOf(d.layer);
      // обычные: неслойные сильнее слойных, из слоёв сильнее поздний; важные: обратный порядок слоёв, неслойные слабее слойных
      const lr = d.imp ? (d.layer === null ? 0 : layers.length - li) : d.layer === null ? layers.length : li;
      return [d.imp ? 1 : 0, lr, W[d.spec], order];
    };
    const ranks = decls.map((d, i) => rank(d, i));
    let best = 0;
    for (let i = 1; i < decls.length; i++) {
      const x = ranks[i]!;
      const y = ranks[best]!;
      for (let k = 0; k < 4; k++) {
        if (x[k]! !== y[k]!) {
          if (x[k]! > y[k]!) best = i;
          break;
        }
      }
    }
    const sel = { id: '#hero', class: '.hero', tag: 'p' };
    return {
      prompt: 'Элемент <p id="hero" class="hero"> подпадает под все правила ниже (порядок записи сверху вниз). Какого цвета будет текст? Порядок слоёв задан первой строкой: поздний слой сильнее раннего.',
      code: [
        `@layer ${layers.join(', ')};`,
        ...decls.map((d) => {
          const body = `${sel[d.spec]} { color: ${d.color}${d.imp ? ' !important' : ''}; }`;
          return d.layer ? `@layer ${d.layer} { ${body} }` : body;
        }),
      ].join('\n'),
      answerHint: 'название цвета',
      answerKey: decls[best]!.color,
      explanation: 'Сначала сравнивается важность: !important сильнее обычных. Среди обычных неслойные правила сильнее любого слоя, а из слоёв выигрывает поздний; специфичность сравнивается только внутри одного слоя. У !important порядок слоёв перевёрнут: ранний слой сильнее позднего, а неслойные важные слабее слойных.',
      params: { layers: layers.join(','), decls: decls.map((d) => `${d.layer}/${d.spec}/${d.imp}/${d.color}`).join(';') },
    };
  },
});

export const gridTracks = fam({
  id: 'fe.b2-grid-tracks',
  sub: DS,
  grade: 'middle',
  title: 'Ширина колонки CSS Grid',
  catalogIds: ['fe.css-layout', 'fe.responsive'],
  taskId: 'task:css-layout',
  a: 1.2,
  b: 0.3,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(3, 4);
    const tracks = Array.from({ length: n }, () => (rng.int(0, 2) === 0 ? { fr: 0, px: rng.pick([80, 120, 160, 200, 240]) } : { fr: rng.int(1, 3), px: 0 }));
    if (!tracks.some((t) => t.fr > 0)) tracks[rng.int(0, n - 1)] = { fr: rng.int(1, 3), px: 0 };
    const gap = rng.pick([8, 12, 16, 24]);
    const u = rng.int(20, 90);
    const fixed = tracks.reduce((s, t) => s + t.px, 0);
    const frSum = tracks.reduce((s, t) => s + t.fr, 0);
    const W = fixed + gap * (n - 1) + u * frSum;
    const idx = rng.pick(tracks.map((t, i) => (t.fr > 0 ? i : -1)).filter((i) => i >= 0));
    const tr = tracks[idx]!;
    return {
      prompt: `Контейнер шириной ${W}px (без внутренних отступов). Сколько пикселей займёт колонка №${idx + 1}?`,
      code: `.grid {\n  display: grid;\n  grid-template-columns: ${tracks.map((t) => (t.fr ? `${t.fr}fr` : `${t.px}px`)).join(' ')};\n  column-gap: ${gap}px;\n}`,
      answerHint: 'пиксели, число',
      answerKey: String(tr.fr * u),
      explanation: `Сначала вычитаются фиксированные колонки (${fixed}px) и промежутки (${gap}×${n - 1}); остаток ${u * frSum}px делится на ${frSum} fr, то есть ${u}px на 1fr. Колонка ${tr.fr}fr = ${tr.fr * u}px.`,
      params: { tracks: tracks.map((t) => (t.fr ? `${t.fr}fr` : `${t.px}px`)).join(' '), gap, W },
    };
  },
});

export const rovingTabindex = fam({
  id: 'fe.b2-roving-tabindex',
  sub: DS,
  grade: 'middle',
  title: 'Стрелки в составном виджете (roving tabindex)',
  catalogIds: ['fe.a11y', 'fe.components'],
  a: 1.2,
  b: 0.4,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const n = rng.int(5, 8);
    const dis = new Set(rng.sample(Array.from({ length: n }, (_, i) => i), rng.int(1, 2)));
    const enabled = Array.from({ length: n }, (_, i) => i).filter((i) => !dis.has(i));
    let cur = rng.pick(enabled);
    const start = cur;
    const keys = Array.from({ length: rng.int(5, 8) }, () => rng.pick(['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'Home', 'End']));
    for (const k of keys) {
      const pos = enabled.indexOf(cur);
      if (k === 'Home') cur = enabled[0]!;
      else if (k === 'End') cur = enabled[enabled.length - 1]!;
      else cur = enabled[(pos + (k === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]!;
    }
    return {
      prompt: `Панель инструментов из ${n} кнопок реализована как roving tabindex: фокус держит одна кнопка, стрелки Вправо/Влево двигают его по кругу, Home и End переходят к первой и последней доступной. Недоступные (disabled) кнопки пропускаются. Фокус стоит на кнопке №${start + 1}. Пользователь нажал: ${keys.join(', ')}. На какой кнопке (по номеру слева направо) окажется фокус?`,
      code: `недоступны: ${[...dis].sort((x, y) => x - y).map((i) => i + 1).join(', ')}`,
      answerHint: 'номер кнопки',
      answerKey: String(cur + 1),
      explanation: 'Считаем только по доступным кнопкам, с переходом через край: после последней идёт первая. Home и End сбрасывают позицию на край списка доступных.',
      params: { n, dis: [...dis].join(','), start, keys: keys.join(',') },
    };
  },
});

export const tsUtilityTypes = fam({
  id: 'fe.b2-ts-utility-types',
  sub: DS,
  grade: 'middle',
  title: 'Утилитарные типы TypeScript',
  catalogIds: ['fe.ts-typing', 'fe.components'],
  taskId: 'task:ts-typecheck',
  a: 1.2,
  b: 0.5,
  space: 1e6,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const keys = rng.sample(['id', 'label', 'size', 'tone', 'icon', 'onClick', 'href', 'disabled'], rng.int(5, 6));
    const req = new Map(keys.map((k) => [k, rng.int(0, 1) === 1]));
    const cur = new Map(req);
    let expr = 'Base';
    const nOps = rng.int(2, 3);
    for (let i = 0; i < nOps; i++) {
      const ks = [...cur.keys()];
      const last = i === nOps - 1;
      const op = ks.length <= 2 ? rng.pick(['Partial', 'Required']) : rng.pick(last ? ['Omit', 'Pick', 'Required', 'Omit'] : ['Omit', 'Pick', 'Partial', 'Required']);
      if (op === 'Partial') {
        for (const k of ks) cur.set(k, false);
        expr = `Partial<${expr}>`;
      } else if (op === 'Required') {
        for (const k of ks) cur.set(k, true);
        expr = `Required<${expr}>`;
      } else if (op === 'Omit') {
        const drop = rng.sample(ks, rng.int(1, 2));
        for (const k of drop) cur.delete(k);
        expr = `Omit<${expr}, ${drop.map((k) => `'${k}'`).join(' | ')}>`;
      } else {
        const keep = rng.sample(ks, rng.int(2, Math.min(3, ks.length)));
        for (const k of ks) if (!keep.includes(k)) cur.delete(k);
        expr = `Pick<${expr}, ${keep.map((k) => `'${k}'`).join(' | ')}>`;
      }
    }
    const requiredCount = [...cur.values()].filter(Boolean).length;
    return {
      prompt: 'Сколько обязательных (не optional) свойств у типа Result? Omit и Pick сохраняют необязательность оставшихся свойств, Partial делает все необязательными, Required — все обязательными.',
      code: `interface Base {\n${keys.map((k) => `  ${k}${req.get(k) ? '' : '?'}: unknown;`).join('\n')}\n}\ntype Result = ${expr};`,
      answerHint: 'число',
      answerKey: String(requiredCount),
      explanation: `Применяем операции изнутри наружу, отслеживая множество свойств и их обязательность. В итоге свойств: ${cur.size}, обязательных: ${requiredCount}.`,
      params: { keys: keys.join(','), expr },
    };
  },
});

export const fluidClamp = fam({
  id: 'fe.b2-fluid-clamp',
  sub: DS,
  grade: 'middle',
  title: 'Текучий размер через clamp()',
  catalogIds: ['fe.responsive', 'fe.css-layout'],
  taskId: 'task:css-layout',
  a: 1.1,
  b: 0.2,
  space: 1e5,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const minRem = rng.pick([1, 1.5, 2, 2.5]);
    const maxRem = minRem + rng.pick([1, 1.5, 2, 3]);
    const vw = rng.int(1, 5);
    const W = rng.pick([320, 400, 600, 800, 1000, 1200, 1600]);
    const preferred = (vw * W) / 100;
    const px = Math.min(Math.max(preferred, minRem * 16), maxRem * 16);
    return {
      prompt: `Корневой размер шрифта 16px. Какой размер шрифта (в px) получит заголовок при ширине окна ${W}px?`,
      code: `h1 { font-size: clamp(${minRem}rem, ${vw}vw, ${maxRem}rem); }`,
      answerHint: 'пиксели, число',
      answerKey: String(px),
      explanation: `${vw}vw при ширине ${W}px — ${preferred}px; границы ${minRem * 16}px и ${maxRem * 16}px. clamp возвращает среднее значение между ними: ${px}px.`,
      params: { minRem, maxRem, vw, W },
    };
  },
});

// --- Senior ---------------------------------------------------------------------------

export const srTokenMigration = fam({
  id: 'fe.b2-sr-token-migration',
  sub: DS,
  grade: 'senior',
  title: 'Радиус поражения при смене токена',
  catalogIds: ['fe.design-handoff', 'fe.css-architecture', 'fe.architecture'],
  taskId: 'task:find-bug',
  a: 1.2,
  b: 1.1,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const prim = ['blue-500', 'blue-700', 'gray-100', 'gray-900', 'red-600'].slice(0, 4);
    const sem = ['text-primary', 'text-link', 'surface', 'border', 'danger', 'focus-ring'];
    const comps = ['Button', 'Input', 'Modal', 'Tabs', 'Toast', 'Badge', 'Table'];
    const refs = new Map<string, string[]>();
    prim.forEach((p) => refs.set(p, []));
    const semNames = rng.sample(sem, rng.int(4, 5));
    semNames.forEach((s, i) => {
      const pool = [...prim, ...semNames.slice(0, i)];
      refs.set(s, rng.sample(pool, rng.int(1, 2)));
    });
    const compNames = rng.sample(comps, rng.int(5, 6));
    compNames.forEach((c) => refs.set(c, rng.sample([...semNames, ...semNames, ...prim], rng.int(1, 3)).filter((v, i, a) => a.indexOf(v) === i)));
    const target = rng.pick(prim);
    const dep = (node: string): boolean => (refs.get(node) ?? []).some((r) => r === target || dep(r));
    const hit = compNames.filter(dep);
    return {
      prompt: `Примитивный токен «${target}» удаляют из темы (все ссылки на него становятся недействительными). Токены и компоненты ссылаются друг на друга, как в списке, по цепочке. Сколько компонентов потеряют значение хотя бы одного свойства?`,
      code: [...semNames, ...compNames].map((n) => `${n} → ${(refs.get(n) ?? []).join(', ')}`).join('\n'),
      answerHint: 'число',
      answerKey: String(hit.length),
      explanation: `Затронут любой узел, у которого по цепочке ссылок встречается «${target}»: ${hit.join(', ') || 'никто'}. Прямые ссылки компонентов на примитивы — расширяют радиус поражения.`,
      params: { target, refs: [...refs.entries()].map(([k, v]) => `${k}:${v.join('+')}`).join(';') },
    };
  },
});

export const srSemverCopies = fam({
  id: 'fe.b2-sr-semver-copies',
  sub: DS,
  grade: 'senior',
  title: 'Сколько копий библиотеки в бандле',
  catalogIds: ['fe.bundler', 'fe.architecture', 'fe.web-perf'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.3,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const all = ['0.4.2', '0.4.9', '0.5.1', '1.2.0', '1.5.3', '1.9.0', '2.0.1', '2.3.0', '3.1.0'];
    const reg = all.filter((_, i) => i < 3 || rng.int(0, 3) > 0);
    const parse = (v: string) => v.split('.').map(Number) as [number, number, number];
    const cmp = (x: string, y: string) => {
      const a = parse(x);
      const b = parse(y);
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    };
    const ok = (range: string, v: string) => {
      const [M, m] = parse(range);
      const [vM, vm] = parse(v);
      if (cmp(v, range) < 0) return false;
      return M > 0 ? vM === M : vM === 0 && vm === m;
    };
    const base = Array.from({ length: rng.int(5, 7) }, () => rng.pick(reg));
    const names = ['app', 'forms', 'charts', 'admin', 'widgets', 'icons', 'docs'];
    const deps = base.map((v, i) => ({ n: names[i]!, range: v }));
    const picks = deps.map((d) => reg.filter((v) => ok(d.range, v)).sort(cmp).pop()!);
    const copies = new Set(picks).size;
    return {
      prompt: 'Сборка устанавливает для каждого пакета самую высокую версию design-kit из реестра, подходящую под его диапазон ^. Для ^M.m.p при M ≥ 1 допустимы версии не ниже указанной в пределах мажора M; для 0.m.p — только та же 0.m. Каждая различная выбранная версия попадает в бандл отдельной копией. Сколько копий design-kit в бандле?',
      code: `в реестре: ${[...reg].sort(cmp).join(', ')}\n${deps.map((d) => `${d.n}: "design-kit": "^${d.range}"`).join('\n')}`,
      answerHint: 'число',
      answerKey: String(copies),
      explanation: `Выбранные версии: ${picks.join(', ')}. Различных: ${copies}. Несовместимые мажоры и разные 0.x дают отдельные копии; единый диапазон peerDependencies позволил бы их свести.`,
      params: { reg: reg.join(','), ranges: base.join(',') },
    };
  },
});

const GRAYS = [0x00, 0x20, 0x40, 0x59, 0x6b, 0x76, 0x85, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
const lum = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const ratio = (a: number, b: number) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

export const srContrastMatrix = fam({
  id: 'fe.b2-sr-contrast-matrix',
  sub: DS,
  grade: 'senior',
  title: 'Аудит контраста в двух темах',
  catalogIds: ['fe.a11y', 'fe.design-handoff'],
  taskId: 'task:web-vitals',
  a: 1.2,
  b: 1.2,
  space: 1e8,
  time: 280,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const hex = (c: number) => '#' + c.toString(16).padStart(2, '0').repeat(3);
    const pairs: Array<{ name: string; theme: string; fg: number; bg: number; thr: number }> = [];
    const pool: Array<[number, number]> = [];
    for (const f of GRAYS) for (const b of GRAYS) if (f !== b) pool.push([f, b]);
    const safe = pool.filter(([f, b]) => Math.abs(ratio(f, b) - 4.5) > 0.12 && Math.abs(ratio(f, b) - 3) > 0.12);
    const parts = rng.sample(['Текст', 'Подпись', 'Ссылка', 'Placeholder', 'Иконка', 'Крупный заголовок'], 5);
    for (const name of parts) {
      for (const theme of ['светлая', 'тёмная']) {
        const [fg, bg] = rng.pick(safe);
        const large = name === 'Крупный заголовок' || name === 'Иконка';
        pairs.push({ name, theme, fg, bg, thr: large ? 3 : 4.5 });
      }
    }
    const fails = pairs.filter((p) => ratio(p.fg, p.bg) < p.thr).length;
    return {
      prompt: 'Для уровня AA нужен контраст не ниже 4,5:1 для обычного текста и 3:1 для крупного текста и графики (в списке это «Крупный заголовок» и «Иконка»). Сколько пар цвет текста/фон из списка не проходят проверку? Контраст = (L1 + 0,05) / (L2 + 0,05) по относительной яркости WCAG, где L1 — большая яркость; цвета серые, у канала c яркость ((c/255 + 0,055)/1,055)^2,4 при c/255 > 0,03928, иначе (c/255)/12,92.',
      code: pairs.map((p) => `${p.theme}: ${p.name} ${hex(p.fg)} на ${hex(p.bg)}`).join('\n'),
      answerHint: 'число',
      answerKey: String(fails),
      explanation: `Считаем контраст каждой пары и сравниваем с порогом 4,5 или 3 по типу элемента. Не проходят ${fails} из ${pairs.length}.`,
      params: { pairs: pairs.map((p) => `${p.fg}/${p.bg}/${p.thr}`).join(',') },
    };
  },
});

export const srVariantCombos = fam({
  id: 'fe.b2-sr-variant-combos',
  sub: DS,
  grade: 'senior',
  title: 'Комбинации вариантов компонента',
  catalogIds: ['fe.components', 'fe.component-tests', 'fe.architecture'],
  taskId: 'task:complexity',
  a: 1.1,
  b: 1.0,
  space: 1e7,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const dims: Record<string, string[]> = {
      variant: rng.pick([['primary', 'secondary', 'ghost'], ['primary', 'secondary', 'ghost', 'link']]),
      size: rng.pick([['sm', 'md', 'lg'], ['xs', 'sm', 'md', 'lg']]),
      tone: rng.pick([['neutral', 'danger'], ['neutral', 'danger', 'success']]),
      icon: ['none', 'left', 'right'],
      state: ['idle', 'loading', 'disabled'],
    };
    const names = Object.keys(dims);
    const chosen = rng.sample(names, 4);
    const rules: Array<[string, string, string, string]> = [];
    for (let i = 0; i < rng.int(2, 3); i++) {
      const [d1, d2] = rng.sample(chosen, 2) as [string, string];
      rules.push([d1, rng.pick(dims[d1]!), d2, rng.pick(dims[d2]!)]);
    }
    let count = 0;
    const walk = (i: number, cur: Record<string, string>) => {
      if (i === chosen.length) {
        if (!rules.some(([d1, v1, d2, v2]) => cur[d1] === v1 && cur[d2] === v2)) count++;
        return;
      }
      for (const v of dims[chosen[i]!]!) walk(i + 1, { ...cur, [chosen[i]!]: v });
    };
    walk(0, {});
    return {
      prompt: 'Компонент принимает независимые свойства со значениями ниже. Некоторые сочетания запрещены (если запрещена пара значений, запрещены все комбинации, где они встречаются вместе). Сколько допустимых комбинаций нужно покрыть визуальными тестами?',
      code: [...chosen.map((d) => `${d}: ${dims[d]!.join(' | ')}`), ...rules.map(([d1, v1, d2, v2]) => `нельзя: ${d1}=${v1} вместе с ${d2}=${v2}`)].join('\n'),
      answerHint: 'число',
      answerKey: String(count),
      explanation: `Полное произведение ${chosen.map((d) => dims[d]!.length).join('×')}, из него вычитаются комбинации с запрещёнными парами (пересечения вычитаются один раз). Допустимо ${count}.`,
      params: { dims: chosen.map((d) => `${d}:${dims[d]!.length}`).join(','), rules: rules.map((r) => r.join('=')).join(';') },
    };
  },
});

export const DS_BANK2_GENERATORS = [
  boxModel, tabOrder, mediaWin,
  cascadeLayers, gridTracks, rovingTabindex, tsUtilityTypes, fluidClamp,
  srTokenMigration, srSemverCopies, srContrastMatrix, srVariantCombos,
];
