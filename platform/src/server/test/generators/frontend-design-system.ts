// Генераторы frontend.design-system (библиотека компонентов: токены, варианты, a11y-контракты, версии).
// Ключ считает код генератора, не LLM (R-T-02); юнит-тест сверяет его независимым решением
// (tests/unit/test/frontend-subcategories.test.ts). a, b — ПРЕДЛОЖЕНИЕ, калибруются персонами.
// Фокус-порядок (tabindex, disabled, a без href) и SemVer (deprecated = minor) сверены с документацией
// (MDN, semver.org) 10.10.
import { createRng } from '../rng';
import type { TaskGenerator, TaskInstance } from '../types';

const SUB = 'frontend.design-system';
const COLORS = ['red', 'blue', 'green', 'teal', 'orange', 'purple', 'navy', 'olive', 'coral', 'gray'];

// --- Junior: токены и наследование custom properties ----------------------------

export const tokensResolve: TaskGenerator = {
  id: 'fe.tokens-resolve',
  subcategoryId: SUB,
  taskId: 'task:css-specificity',
  title: 'Какое значение токена получит кнопка',
  specialization: 'frontend',
  grade: 'junior',
  catalogIds: ['fe.css-architecture', 'fe.css-cascade'],
  format: 'text',
  a: 1.3,
  b: -0.7,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const [cRoot, cWrap, cCard, cBtn, cDecoy, cFallback] = rng.sample(COLORS, 6) as [string, string, string, string, string, string];
    const where = {
      root: rng.int(0, 1) === 1,
      wrap: rng.int(0, 1) === 1,
      card: rng.int(0, 1) === 1,
      btn: rng.int(0, 2) === 0,
    };
    const css = [
      where.root ? `:root { --accent: ${cRoot}; }` : `:root { --radius: 4px; }`,
      where.wrap ? `.theme { --accent: ${cWrap}; }` : `.theme { --gap: 8px; }`,
      where.card ? `.card { --accent: ${cCard}; }` : `.card { padding: var(--gap, 4px); }`,
      where.btn ? `.btn { --accent: ${cBtn}; background: var(--accent, ${cFallback}); }` : `.btn { background: var(--accent, ${cFallback}); }`,
      `.sidebar { --accent: ${cDecoy}; }`,
    ].join('\n');
    const html = '<div class="theme">\n  <aside class="sidebar"></aside>\n  <section class="card">\n    <button class="btn">Купить</button>\n  </section>\n</div>';
    // Значение custom property берётся от ближайшего предка (включая сам элемент); нет нигде - запасное значение var().
    const answer = where.btn ? cBtn : where.card ? cCard : where.wrap ? cWrap : where.root ? cRoot : cFallback;
    return {
      prompt: 'Какой цвет фона получит кнопка .btn? Custom properties наследуются как обычные наследуемые свойства.',
      code: `${css}\n\n${html}`,
      answerHint: 'название цвета',
      answerKey: answer,
      explanation: `Значение --accent берётся от самого элемента или ближайшего предка, где оно объявлено; .sidebar - не предок кнопки и не влияет. Если токена нет нигде по цепочке, срабатывает запасное значение var(--accent, ${cFallback}). Здесь: ${answer}.`,
      params: {
        where: Object.values(where).map(Number).join(''),
        cRoot,
        cWrap,
        cCard,
        cBtn,
      },
    };
  },
};

// --- Middle: фокус-ловушка в модальном диалоге -----------------------------------

export const focusTrap: TaskGenerator = {
  id: 'fe.focus-trap',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Где окажется фокус в модальном диалоге',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.a11y', 'fe.components'],
  format: 'text',
  a: 1.3,
  b: 0.5,
  paramSpace: 5e4,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    type El = { id: string; html: string; tabbable: boolean };
    const labels = rng.shuffle(['save', 'cancel', 'email', 'help', 'close', 'agree', 'more', 'name']);
    const kinds: ((id: string) => El)[] = [
      (id) => ({
        id,
        html: `<button id="${id}">${id}</button>`,
        tabbable: true,
      }),
      (id) => ({ id, html: `<input id="${id}" type="text">`, tabbable: true }),
      (id) => ({
        id,
        html: `<a id="${id}" href="/${id}">${id}</a>`,
        tabbable: true,
      }),
      (id) => ({
        id,
        html: `<span id="${id}" tabindex="0">${id}</span>`,
        tabbable: true,
      }),
      (id) => ({
        id,
        html: `<button id="${id}" disabled>${id}</button>`,
        tabbable: false,
      }),
      (id) => ({
        id,
        html: `<div id="${id}" tabindex="-1">${id}</div>`,
        tabbable: false,
      }),
      (id) => ({ id, html: `<a id="${id}">${id}</a>`, tabbable: false }),
    ];
    const n = rng.int(5, 7);
    let els: El[];
    for (;;) {
      els = Array.from({ length: n }, (_, i) => rng.pick(kinds)(labels[i]!));
      const t = els.filter((e) => e.tabbable).length;
      if (t >= 3 && t <= n - 1) break;
    }
    const tab = els.filter((e) => e.tabbable);
    // Фокус-ловушка: после последнего Tab фокус возвращается к первому, Shift+Tab с первого - к последнему.
    let pos = 0; // при открытии фокус на первом доступном для Tab элементе
    const keys: string[] = [];
    const steps = rng.int(4, 8);
    for (let i = 0; i < steps; i++) {
      const back = rng.int(0, 2) === 0;
      keys.push(back ? 'Shift+Tab' : 'Tab');
      pos = (pos + (back ? -1 : 1) + tab.length) % tab.length;
    }
    const code = ['<div role="dialog" aria-modal="true">', ...els.map((e) => `  ${e.html}`), '</div>'].join('\n');
    return {
      prompt: `Диалог открылся, и фокус стоит на первом элементе, до которого можно дойти клавишей Tab. Реализована фокус-ловушка: Tab с последнего такого элемента переводит на первый, Shift+Tab с первого - на последний. Нажаты клавиши по порядку: ${keys.join(', ')}. Какой id у элемента в фокусе?`,
      code,
      answerHint: 'id элемента',
      answerKey: tab[pos]!.id,
      explanation: `Для Tab доступны кнопки без disabled, поля ввода, ссылки с href и элементы с tabindex="0". Не входят в порядок обхода: disabled-кнопка, элемент с tabindex="-1" (фокусируется только программно), <a> без href. Порядок обхода: ${tab.map((e) => e.id).join(' → ')}. После нажатий фокус на ${tab[pos]!.id}.`,
      params: {
        n,
        els: els.map((e) => +e.tabbable).join(''),
        keys: keys.join(''),
      },
    };
  },
};

// --- Middle: разрешение вариантов компонента ----------------------------------------

export const variantResolve: TaskGenerator = {
  id: 'fe.variant-resolve',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Итоговый размер варианта компонента',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.components', 'fe.design-handoff'],
  format: 'number',
  a: 1.2,
  b: 0.4,
  paramSpace: 1e5,
  timeLimitSec: 180,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const sizes = ['sm', 'md', 'lg'] as const;
    const tones = ['primary', 'ghost', 'danger'] as const;
    type Style = { height?: number; padX?: number };
    const pickStyle = (probH: number, probP: number): Style => {
      const s: Style = {};
      if (rng.int(0, 99) < probH) s.height = rng.int(6, 12) * 4;
      if (rng.int(0, 99) < probP) s.padX = rng.int(2, 8) * 4;
      return s;
    };
    const base: Style = { height: rng.int(7, 10) * 4, padX: rng.int(3, 4) * 4 };
    const sizeV: Record<string, Style> = {};
    for (const s of sizes)
      sizeV[s] = {
        height: rng.int(5, 12) * 4,
        ...(rng.int(0, 1) ? { padX: rng.int(2, 6) * 4 } : {}),
      };
    const toneV: Record<string, Style> = {};
    for (const t of tones) toneV[t] = pickStyle(25, 55);
    const cSize = rng.pick(sizes);
    const cTone = rng.pick(tones);
    const compound: { size: string; tone: string; style: Style } = {
      size: cSize,
      tone: cTone,
      style: pickStyle(70, 70),
    };
    if (compound.style.height === undefined && compound.style.padX === undefined) compound.style.height = rng.int(6, 12) * 4;
    const defaults = { size: rng.pick(sizes), tone: rng.pick(tones) };
    const props: { size?: string; tone?: string } = {};
    if (rng.int(0, 2) > 0) props.size = rng.pick(sizes);
    if (rng.int(0, 2) > 0) props.tone = rng.pick(tones);
    if (rng.int(0, 2) === 0) {
      props.size = cSize;
      props.tone = cTone;
    }
    const prop = rng.pick(['height', 'padX'] as const);
    const eff = {
      size: props.size ?? defaults.size,
      tone: props.tone ?? defaults.tone,
    };
    // Порядок наложения: base → variants в порядке объявления (size, tone) → compound.
    const res: Style = { ...base, ...sizeV[eff.size], ...toneV[eff.tone] };
    if (eff.size === compound.size && eff.tone === compound.tone) Object.assign(res, compound.style);
    const fmt = (s: Style) =>
      `{ ${Object.entries(s)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')} }`;
    const code = [
      'const button = {',
      `  base: ${fmt(base)},`,
      '  variants: {',
      `    size: { ${sizes.map((s) => `${s}: ${fmt(sizeV[s]!)}`).join(', ')} },`,
      `    tone: { ${tones.map((t) => `${t}: ${fmt(toneV[t]!)}`).join(', ')} },`,
      '  },',
      `  compound: [{ size: '${compound.size}', tone: '${compound.tone}', style: ${fmt(compound.style)} }],`,
      `  defaults: { size: '${defaults.size}', tone: '${defaults.tone}' },`,
      '};',
      '',
      `<Button${Object.entries(props)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join('')} />`,
    ].join('\n');
    return {
      prompt: `Стили собираются так: base, затем варианты в порядке объявления (size, потом tone) - каждый перекрывает предыдущие только теми ключами, что в нём заданы; затем подходящие compound; свойства, не переданные в <Button>, берутся из defaults. Чему равно ${prop} у кнопки?`,
      code,
      answerHint: 'число',
      answerKey: String(res[prop]),
      explanation: `Итоговые варианты: size=${eff.size}, tone=${eff.tone}${eff.size === compound.size && eff.tone === compound.tone ? ' (совпали с compound, он накладывается последним)' : ' (compound не подходит)'}. Результат слоёв: ${fmt(res)}.`,
      params: {
        prop,
        props: JSON.stringify(props),
        eff: `${eff.size}/${eff.tone}`,
      },
    };
  },
};

// --- Middle: SemVer релиза библиотеки ---------------------------------------------

type Bump = 'major' | 'minor' | 'patch';
const CHANGES: { text: string; bump: Bump }[] = [
  { text: 'добавлен необязательный проп size у Button', bump: 'minor' },
  { text: 'добавлен новый компонент Tooltip', bump: 'minor' },
  {
    text: 'проп onClick у Link помечен deprecated, но работает как раньше',
    bump: 'minor',
  },
  { text: 'добавлен токен --color-accent-strong', bump: 'minor' },
  { text: 'исправлен цвет рамки фокуса у Input', bump: 'patch' },
  {
    text: 'внутренний рефакторинг Select без изменения публичного API',
    bump: 'patch',
  },
  { text: 'исправлена опечатка в aria-label у Modal', bump: 'patch' },
  { text: 'удалён проп variant="link" у Button', bump: 'major' },
  {
    text: 'токен --color-bg переименован в --surface-bg без алиаса',
    bump: 'major',
  },
  { text: 'проп label у IconButton стал обязательным', bump: 'major' },
  {
    text: 'Modal больше не закрывается по клику на фон по умолчанию',
    bump: 'major',
  },
];

export const semverRelease: TaskGenerator = {
  id: 'fe.semver-release',
  subcategoryId: SUB,
  taskId: 'task:code-output',
  title: 'Номер следующего релиза библиотеки',
  specialization: 'frontend',
  grade: 'middle',
  catalogIds: ['fe.components', 'fe.architecture'],
  format: 'text',
  a: 1.0,
  b: 0.3,
  paramSpace: 5e4,
  timeLimitSec: 150,
  generate(seed): TaskInstance {
    const rng = createRng(seed);
    const [maj, min, pat] = [rng.int(1, 6), rng.int(0, 9), rng.int(0, 9)];
    const changes = rng.sample(CHANGES, rng.int(2, 4));
    const order: Bump[] = ['patch', 'minor', 'major'];
    const top = changes.reduce<Bump>((m, c) => (order.indexOf(c.bump) > order.indexOf(m) ? c.bump : m), 'patch');
    const next = top === 'major' ? `${maj + 1}.0.0` : top === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
    return {
      prompt: `Библиотека компонентов сейчас версии ${maj}.${min}.${pat}. Все перечисленные изменения выходят одним релизом по правилам SemVer. Какая версия будет у релиза?`,
      code: changes.map((c, i) => `${i + 1}. ${c.text}`).join('\n'),
      answerHint: 'версия, например 2.4.0',
      answerKey: next,
      explanation: `Старшее изменение - ${top}: несовместимое изменение публичного API (удаление, переименование без алиаса, новая обязательность, смена поведения по умолчанию) - major; новая обратно совместимая возможность и пометка deprecated - minor; исправление без изменения API - patch. При повышении старшей части младшие сбрасываются в 0. Итог: ${next}.`,
      params: {
        from: `${maj}.${min}.${pat}`,
        changes: changes.map((c) => c.bump[0]).join(''),
      },
    };
  },
};

export const DESIGN_SYSTEM_NEW_GENERATORS: TaskGenerator[] = [tokensResolve, focusTrap, variantResolve, semverRelease];
