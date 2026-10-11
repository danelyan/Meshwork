// Стартовая страница стенда: ручная правка реестра и кнопки с настоящими запросами к API.
// Без зависимостей и внешних ресурсов. Пользовательский текст в DOM попадает только как текст.
(() => {
  'use strict';

  const API = '/api/v1';
  const SHOWN_ROWS = 5;
  const DEFAULT_EVENT = 'Хакатон «Лидеры цифровой трансформации» 2026';
  const state = { meta: null, card: null, events: [], creating: false, adding: false, showAll: false, fresh: null };

  const $ = (id) => document.getElementById(id);

  /** h('div', { class: 'x', onclick }, 'текст', узел) — узел DOM без innerHTML. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'open') el[k] = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  let toastTimer = 0;
  function toast(text, isError) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('is-error', Boolean(isError));
    t.hidden = false;
    t.classList.remove('is-leaving');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.add('is-leaving');
      toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove('is-leaving'); }, 200);
    }, isError ? 7000 : 3500);
  }

  async function request(method, url, opts = {}) {
    const headers = {};
    let body;
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
    if (opts.form) body = new URLSearchParams(opts.form);
    const res = await fetch(url, { method, headers, body });
    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
    return { status: res.status, ok: res.ok, body: data };
  }

  /** Запрос песочницы: при ошибке показывает её текст и бросает исключение. */
  async function sandbox(method, path, json) {
    const r = await request(method, `${API}/sandbox${path}`, { json });
    if (!r.ok) throw new Error(r.body?.error?.message || `Ошибка ${r.status}`);
    return r.body;
  }

  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    return `${n} ${a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
  };
  const records = (n) => plural(n, 'запись', 'записи', 'записей');
  const disciplineName = (code) => state.meta.disciplines.find((d) => d.code === code)?.short_name || code;
  const placeText = (a) => (a.status === 'disqualified' ? 'дисквалификация' : a.place ? `${a.place} место из ${a.entrants_total}` : 'участие');
  const hasConsent = () => Boolean(state.card?.consents.some((x) => x.client_id === state.meta.partner_demo.client_id));
  const platformHost = () => state.meta.platform_url.replace(/^https?:\/\//, '');

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'скопировано ✓';
      btn.classList.add('is-done');
      setTimeout(() => { btn.textContent = 'копировать'; btn.classList.remove('is-done'); }, 1500);
    } catch { toast('Не удалось скопировать — выделите текст вручную', true); }
  }

  /** Плавное появление содержимого карточки — только при смене участника, не после каждой правки. */
  let cardTimer = 0;
  function animateCard() {
    const card = $('card');
    card.classList.remove('is-entering');
    void card.offsetWidth;
    card.classList.add('is-entering');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => card.classList.remove('is-entering'), 700);
  }

  /** Раскрытие блока: анимация только когда открыл пользователь, а не при перерисовке открытого. */
  const moreToggle = (key) => (ev) => {
    const open = ev.target.open;
    if (open && !state[key]) ev.target.classList.add('is-opening');
    state[key] = open;
  };

  // --- Ответы API: сценарии ---------------------------------------------------------------

  class Run {
    constructor(title) {
      this.summary = h('p', { class: 'summary is-wait' }, 'Выполняется…');
      this.steps = h('div', { class: 'steps' });
      $('result').replaceChildren(h('h3', {}, title), this.summary, this.steps);
    }

    /** Один запрос: показывает адрес, код ответа и JSON; возвращает ответ. */
    async step(title, method, url, opts = {}) {
      const shown = url.startsWith('http') ? url.replace(location.origin, '') : url;
      const status = h('span', { class: 'badge badge-wait' }, '…');
      const pre = h('pre', {}, h('code', {}, 'выполняется…'));
      const note = opts.note ? h('p', { class: 'step-note' }, opts.note) : null;
      const sent = opts.json !== undefined ? h('p', { class: 'step-note' }, 'Тело запроса: ', h('code', {}, JSON.stringify(opts.json))) : null;
      const box = h('details', { class: 'step', open: !opts.collapsed },
        h('summary', {},
          h('span', { class: 'step-title' }, title),
          status,
          h('span', { class: 'step-req' }, h('span', { class: 'method' }, method), shown, opts.token ? h('span', { class: 'auth' }, opts.tokenLabel || 'с токеном') : null)),
        h('div', { class: 'step-body' }, note, sent, pre));
      this.steps.append(box);
      let r;
      try {
        r = await request(method, url, opts);
      } catch (err) {
        status.textContent = 'нет связи';
        status.className = 'badge badge-bad';
        pre.firstChild.textContent = String(err && err.message || err);
        throw err;
      }
      status.textContent = String(r.status);
      status.className = `badge ${r.ok ? 'badge-ok' : 'badge-bad'}`;
      let view = r.body;
      // Токен целиком на экране не нужен: показываем начало.
      if (view && typeof view.access_token === 'string') {
        view = { ...view, access_token: `${view.access_token.slice(0, 24)}… (сокращено)` };
        for (const k of ['refresh_token', 'id_token']) if (view[k]) view[k] = '… (сокращено)';
      }
      pre.firstChild.textContent = r.status === 204 ? '204 No Content — тела нет' : JSON.stringify(view, null, 2);
      return r;
    }

    done(text, kind) {
      this.summary.textContent = text;
      this.summary.className = `summary${kind ? ` is-${kind}` : ''}`;
    }

    async athleteToken(card) {
      const m = state.meta;
      const r = await this.step('ФСП ID выдаёт токен спортсмену', 'POST', m.token_url, {
        form: { grant_type: 'password', client_id: m.athlete_demo_client, username: card.login.username, password: card.login.password, scope: 'openid' },
        note: `Вход участника ${card.login.username} по демо-паролю. Платформа получает такой же токен после формы входа ФСП ID.`,
        collapsed: true,
      });
      if (!r.ok) throw new Error('ФСП ID не выдал токен спортсмену');
      return r.body.access_token;
    }

    async partnerToken() {
      const m = state.meta;
      const r = await this.step('ФСП ID выдаёт токен партнёру', 'POST', m.token_url, {
        form: { grant_type: 'client_credentials', client_id: m.partner_demo.client_id, client_secret: m.partner_demo.client_secret },
        note: `Сервисный аккаунт ${m.partner_demo.client_id}: так к реестру обращается работодатель или другая площадка.`,
        collapsed: true,
      });
      if (!r.ok) throw new Error('ФСП ID не выдал токен партнёру');
      return r.body.access_token;
    }
  }

  const partnerRead = (run, card, token) =>
    run.step('Партнёр запрашивает достижения', 'GET', `${API}/athletes/${card.athlete.fsp_id}/achievements?per_page=5`, { token, tokenLabel: 'токен партнёра' });

  const SCENARIOS = [
    {
      id: 'me', title: 'Что получает платформа', text: 'Вход через ФСП ID и записи участника',
      async run(run, card) {
        const token = await run.athleteToken(card);
        await run.step('Профиль', 'GET', `${API}/me`, { token, tokenLabel: 'токен спортсмена', collapsed: true });
        const r = await run.step('Достижения', 'GET', `${API}/me/achievements?per_page=5`, { token, tokenLabel: 'токен спортсмена' });
        const total = r.body.meta.total;
        run.done(total
          ? `Реестр вернул ${records(total)}${total > 5 ? ', в ответе первые 5' : ''}. Те же записи платформа получает при входе через ФСП ID.`
          : 'У участника нет записей. Внесите достижение выше и нажмите ещё раз.');
      },
    },
    {
      id: 'partner', title: 'Чтение партнёром', text: 'Работодатель видит записи только с согласия',
      async run(run, card) {
        const r = await partnerRead(run, card, await run.partnerToken());
        if (r.ok) run.done(`Партнёр получил ${records(r.body.meta.total)}: участник дал ему согласие.`);
        else run.done(`${r.status} ${r.body?.error?.code}: согласия нет, реестр ничего не выдал. Нажмите «Дать согласие» и повторите.`, 'denied');
      },
    },
    {
      id: 'grant', title: 'Дать согласие', text: 'Участник открывает доступ партнёру',
      async run(run, card) {
        const token = await run.athleteToken(card);
        await run.step('Участник даёт согласие', 'PUT', `${API}/me/consents/${state.meta.partner_demo.client_id}`, { token, tokenLabel: 'токен спортсмена', json: { scopes: ['profile', 'achievements', 'ranks'] } });
        const r = await partnerRead(run, card, await run.partnerToken());
        run.done(r.ok ? `Согласие дано, партнёр получил ${records(r.body.meta.total)}.` : `Партнёр получил ${r.status}.`, r.ok ? '' : 'error');
      },
    },
    {
      id: 'revoke', title: 'Отозвать согласие', text: 'Тот же запрос партнёра получает 403',
      async run(run, card) {
        const token = await run.athleteToken(card);
        await run.step('Участник отзывает согласие', 'DELETE', `${API}/me/consents/${state.meta.partner_demo.client_id}`, { token, tokenLabel: 'токен спортсмена' });
        const r = await partnerRead(run, card, await run.partnerToken());
        run.done(r.status === 403 ? 'Согласие отозвано: партнёр получает 403 consent_required. Данными распоряжается участник.' : `Партнёр получил ${r.status}.`, r.status === 403 ? 'denied' : 'error');
      },
    },
    {
      id: 'verify', title: 'Проверка записи', text: 'Подлинность по номеру, без входа',
      async run(run, card) {
        const a = card.achievements[0];
        if (a) await run.step('Запись участника', 'GET', `${API}/achievements/${a.achievement_id}/verify`);
        const fake = await run.step('Выдуманный номер', 'GET', `${API}/achievements/ACH-1999-0001/verify`, { collapsed: Boolean(a) });
        run.done(a
          ? `Запись ${a.achievement_id} подтверждена реестром. Выдуманный номер: valid ${fake.body.data.valid}.`
          : `У участника нет записей. Выдуманный номер: valid ${fake.body.data.valid}.`);
      },
    },
    {
      id: 'protocol', title: 'Открытый протокол', text: 'Без токена, только фамилия и инициалы',
      async run(run) {
        const list = await run.step('Список соревнований', 'GET', `${API}/events?per_page=10`, { collapsed: true });
        // У соревнования, заведённого вручную, протокола нет — берём последнее из набора.
        const ev = list.body.data.find((e) => !e.manual) || list.body.data[0];
        const r = await run.step('Протокол результатов', 'GET', `${API}/events/${ev.event_id}/results`);
        const rows = r.body.data.results;
        const first = rows[0]?.entrant;
        run.done(`«${ev.name}»: ${plural(rows.length, 'строка', 'строки', 'строк')}${first ? `, первое место — ${first.name || first.display_name}` : ''}. Протоколы открыты, личных данных в них нет.`);
      },
    },
    {
      id: 'noauth', title: 'Запрос без токена', text: 'Личные данные без входа закрыты',
      async run(run) {
        const r = await run.step('Профиль без токена', 'GET', `${API}/me`);
        run.done(`Ответ ${r.status} ${r.body?.error?.code}: без токена ФСП ID реестр личные записи не отдаёт.`, 'denied');
      },
    },
  ];

  async function runScenario(id) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc || !state.card) return;
    const buttons = [...document.querySelectorAll('.scenario')];
    for (const b of buttons) { b.disabled = true; b.classList.toggle('active', b.dataset.id === id); if (b.dataset.id === id) b.setAttribute('aria-busy', 'true'); }
    const run = new Run(sc.title);
    if (window.matchMedia('(max-width: 900px)').matches) $('result').scrollIntoView({ block: 'start' });
    try {
      await sc.run(run, state.card);
    } catch (err) {
      run.done(`Не получилось: ${err.message}. Проверьте /api/v1/health — возможно, ФСП ID перезапускается.`, 'error');
    } finally {
      for (const b of buttons) { b.removeAttribute('aria-busy'); b.disabled = false; }
      // Сценарии с согласиями меняют карточку участника.
      if (id === 'grant' || id === 'revoke') void selectAthlete(state.card.athlete.fsp_id, true);
    }
  }

  function renderScenarios() {
    $('scenarios').replaceChildren(...SCENARIOS.map((s) =>
      h('button', { type: 'button', class: 'scenario', 'data-id': s.id, onclick: () => runScenario(s.id) }, h('b', {}, s.title), h('span', {}, s.text))));
  }

  // --- Проверка: правка реестра -----------------------------------------------------------

  async function loadEvents() {
    state.events = (await request('GET', `${API}/events?per_page=100`)).body.data;
  }

  async function loadList() {
    const q = $('search').value.trim();
    const body = await sandbox('GET', `/athletes?per_page=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    const current = state.creating ? null : state.card?.athlete.fsp_id;
    const items = body.data.map((a) =>
      h('button', { type: 'button', 'data-id': a.fsp_id, 'aria-current': a.fsp_id === current ? 'true' : null, onclick: () => selectAthlete(a.fsp_id) },
        a.full_name, a.manual ? h('span', { class: 'badge badge-manual' }, 'новый') : null,
        h('small', {}, `${a.fsp_id} · ${records(a.achievements_total)}`)));
    $('list').replaceChildren(...(items.length ? items : [h('div', { class: 'empty' }, 'Никого не найдено')]));
    renderChanges(body.meta.changes);
    return body.data;
  }

  function renderChanges(c) {
    const parts = [];
    if (c.manual_athletes) parts.push(`участников +${c.manual_athletes}`);
    if (c.removed_athletes) parts.push(`удалено ${c.removed_athletes}`);
    if (c.manual_achievements) parts.push(`достижений +${c.manual_achievements}`);
    if (c.manual_ranks) parts.push(`разрядов +${c.manual_ranks}`);
    $('changes-line').textContent = c.modified ? `Правки: ${parts.join(', ') || 'есть'}.` : '';
    $('reset').hidden = !c.modified;
  }

  function markCurrent() {
    const id = state.creating ? null : state.card?.athlete.fsp_id;
    for (const b of $('list').querySelectorAll('button[data-id]')) b.setAttribute('aria-current', String(b.dataset.id === id));
  }

  async function selectAthlete(fspId, keepScroll) {
    const changed = state.card?.athlete.fsp_id !== fspId;
    const body = await sandbox('GET', `/athletes/${fspId}`);
    state.creating = false;
    if (changed) { state.adding = false; state.showAll = false; state.fresh = null; }
    state.card = body.data;
    renderCard();
    if (changed) animateCard();
    renderWho();
    markCurrent();
    if (!keepScroll && window.matchMedia('(max-width: 900px)').matches) $('card').scrollIntoView({ block: 'start' });
  }

  function renderWho() {
    const c = state.card;
    if (!c) return;
    $('who-name').textContent = c.athlete.full_name;
    $('who-consent').textContent = hasConsent() ? '. Согласие демо-партнёру дано' : '. Согласия демо-партнёру нет';
  }

  /** Шаги вверху: участник выбран → внесено своё достижение → войти на платформе. */
  function renderStepper() {
    const c = state.creating ? null : state.card;
    const done = [Boolean(c), Boolean(c?.achievements.some((x) => x.manual)), false];
    const current = done.indexOf(false);
    for (const li of $('stepper').children) {
      const i = Number(li.dataset.step) - 1;
      li.classList.toggle('done', done[i]);
      li.classList.toggle('current', i === current);
    }
  }

  /** Обёртка действий формы: блокирует кнопку, показывает ошибку, обновляет список и карточку. */
  function action(fn, okText) {
    return async (ev) => {
      ev.preventDefault();
      const btn = ev.submitter || ev.currentTarget;
      btn.disabled = true;
      try {
        const next = await fn(ev);
        await Promise.all([loadList(), loadEvents()]);
        if (next !== false && state.card) await selectAthlete(state.card.athlete.fsp_id, true);
        if (okText) toast(typeof okText === 'function' ? okText() : okText);
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    };
  }

  const field = (label, control, wide) => h('label', { class: wide ? 'wide' : null }, label, control);
  const option = (value, text, selected) => h('option', { value, selected }, text);
  const count = (n) => h('span', { class: 'count' }, String(n));

  function athleteFields(a) {
    const m = state.meta;
    return [
      field('Фамилия', h('input', { name: 'last_name', required: true, maxlength: 40, value: a?.last_name || '', autocomplete: 'off' })),
      field('Имя', h('input', { name: 'first_name', required: true, maxlength: 40, value: a?.first_name || '', autocomplete: 'off' })),
      field('Отчество', h('input', { name: 'middle_name', maxlength: 40, value: a?.middle_name || '', autocomplete: 'off' })),
      field('Год рождения', h('input', { name: 'birth_year', type: 'number', required: true, min: 1950, max: 2015, value: a?.birth_year || 2003 })),
      field('Регион', h('select', { name: 'region_code' }, m.regions.map((r) => option(r.code, r.name, r.code === (a?.region_code || '77'))))),
      field('Пол', h('select', { name: 'sex' }, option('m', 'мужской', (a?.sex || 'm') === 'm'), option('f', 'женский', a?.sex === 'f'))),
      h('div', { class: 'wide' }, h('span', { class: 'field-title' }, 'Дисциплины'),
        h('div', { class: 'checks' }, m.disciplines.map((d) =>
          h('label', {}, h('input', { type: 'checkbox', name: 'disciplines', value: d.code, checked: a ? a.disciplines.includes(d.code) : d.code === 'product' }), d.short_name)))),
    ];
  }

  function readAthlete(form) {
    const f = new FormData(form);
    const disciplines = f.getAll('disciplines');
    if (!disciplines.length) throw new Error('Отметьте хотя бы одну дисциплину');
    return {
      last_name: f.get('last_name').trim(), first_name: f.get('first_name').trim(), middle_name: f.get('middle_name').trim(),
      birth_year: Number(f.get('birth_year')), region_code: f.get('region_code'), sex: f.get('sex'), disciplines,
    };
  }

  function renderNewAthlete() {
    state.creating = true;
    markCurrent();
    renderStepper();
    const form = h('form', { class: 'form', onsubmit: action(async (ev) => {
      const body = await sandbox('POST', '/athletes', readAthlete(ev.target));
      state.card = body.data;
      state.creating = false;
      state.adding = true;
      state.showAll = false;
      state.fresh = null;
    }, () => `Участник ${state.card.athlete.fsp_id} создан. Теперь внесите ему достижение.`) },
      athleteFields(null),
      h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Создать участника'),
        h('button', { type: 'button', class: 'btn', onclick: () => { state.creating = false; renderCard(); markCurrent(); } }, 'Отмена')));
    $('card').replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Новый участник'), h('p', {}, 'Получит номер ФСП ID и логин для входа. Имя — любое вымышленное.'))),
      h('div', { class: 'block' }, form));
    animateCard();
    form.querySelector('input').focus();
  }

  function eventControls() {
    const m = state.meta;
    const today = new Date().toISOString().slice(0, 10);
    const select = h('select', { name: 'event_id' },
      option('', 'Новое соревнование', true),
      state.events.map((e) => option(e.event_id, `${e.ends_on.slice(0, 4)} · ${e.name}`)));
    const fresh = h('div', { class: 'sub-form wide' },
      field('Название', h('input', { name: 'event_name', maxlength: 160, value: DEFAULT_EVENT }), true),
      field('Дисциплина', h('select', { name: 'event_discipline' }, m.disciplines.map((d) => option(d.code, d.short_name)))),
      field('Статус', h('select', { name: 'event_kind' }, m.event_kinds.map((k) => option(k.code, k.label, k.code === 'hackathon')))),
      field('Дата окончания', h('input', { name: 'event_date', type: 'date', min: '2000-01-01', max: today, value: today })),
      field('Участников всего', h('input', { name: 'event_total', type: 'number', min: 1, max: 5000, value: 40 })));
    select.addEventListener('change', () => { fresh.hidden = select.value !== ''; });
    return [field('Соревнование', select, true), fresh];
  }

  function readAchievement(form) {
    const f = new FormData(form);
    const dq = f.get('dq') === 'on';
    const body = { status: dq ? 'disqualified' : 'ranked', place: dq ? null : Number(f.get('place')) };
    const team = f.get('team_name').trim();
    if (team) body.team_name = team;
    if (f.get('event_id')) body.event_id = f.get('event_id');
    else {
      const name = f.get('event_name').trim();
      if (name.length < 3) throw new Error('Введите название соревнования или выберите его из списка');
      body.event = { name, discipline: f.get('event_discipline'), kind: f.get('event_kind'), date: f.get('event_date'), entrants_total: Number(f.get('event_total')) };
    }
    if (!dq && !(body.place >= 1)) throw new Error('Укажите занятое место');
    return body;
  }

  function signInBox(c) {
    const m = state.meta;
    const cred = (label, value) => h('span', { class: 'cred' }, label, h('code', {}, value),
      h('button', { type: 'button', class: 'copy', 'aria-label': `Скопировать: ${label.toLowerCase()}`, onclick: (ev) => copy(value, ev.currentTarget) }, 'копировать'));
    return h('div', { class: 'signin' },
      h('div', { class: 'creds' }, cred('Логин', c.login.username), cred('Пароль', c.login.password)),
      h('a', { class: 'btn btn-primary', href: `${m.platform_url}/auth`, target: '_blank', rel: 'noopener' }, `Войти на ${platformHost()} ↗`),
      h('p', { class: 'hint' }, 'Отметьте согласие, нажмите «ФСП ID» и выберите этого участника. Записи появятся в «Настройках», блок «ФСП ID». После новой правки войдите заново.'));
  }

  function achievementsBlock(c) {
    const id = c.athlete.fsp_id;
    const list = c.achievements;
    const freshAt = list.findIndex((x) => x.achievement_id === state.fresh);
    const shown = state.showAll || freshAt >= SHOWN_ROWS ? list : list.slice(0, SHOWN_ROWS);
    const rows = list.length
      ? h('ul', { class: 'rows' }, shown.map((x) => h('li', { class: x.achievement_id === state.fresh ? `fresh${state.freshNew ? ' is-new' : ''}` : null },
          h('div', { class: 'what' }, x.event_name, x.manual ? h('span', { class: 'badge badge-manual' }, 'вручную') : null,
            h('small', {}, `${x.date} · ${placeText(x)}${x.team_name ? ` · «${x.team_name}»` : ''}`)),
          h('button', { type: 'button', class: 'icon-btn', title: 'Удалить запись', 'aria-label': `Удалить запись «${x.event_name}»`, onclick: action(() => sandbox('DELETE', `/achievements/${encodeURIComponent(x.achievement_id)}`), 'Запись удалена из реестра') }, '×'))))
      : state.adding ? null : h('p', { class: 'empty-note' }, 'Записей нет. На платформе у участника будет «достижений пока нет».');
    state.freshNew = false;
    const more = list.length > shown.length
      ? h('button', { type: 'button', class: 'link-btn rows-more', onclick: () => { state.showAll = true; renderCard(); } }, `Показать все ${list.length}`)
      : null;

    const add = h('form', { class: 'add', hidden: !state.adding, onsubmit: action(async (ev) => {
      const body = await sandbox('POST', `/athletes/${id}/achievements`, readAchievement(ev.target));
      state.fresh = body.data.achievement_id;
      state.freshNew = true;
      state.adding = false;
    }, 'Достижение внесено. Войдите этим участником на платформе.') },
      h('div', { class: 'form' }, eventControls(),
        field('Место', h('input', { name: 'place', type: 'number', min: 1, max: 5000, value: 1 })),
        field('Команда', h('input', { name: 'team_name', maxlength: 60, placeholder: 'для командных дисциплин' })),
        h('label', { class: 'check wide' }, h('input', { type: 'checkbox', name: 'dq' }), 'Дисквалификация, без места'),
        h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Внести в реестр'),
          h('button', { type: 'button', class: 'btn', onclick: () => { state.adding = false; renderCard(); } }, 'Отмена'))));

    const toggle = state.adding ? null
      : h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { state.adding = true; renderCard(); } }, '+ Внести достижение');

    return h('div', { class: 'block' },
      h('div', { class: 'block-head' }, h('h4', {}, 'Достижения', count(list.length)), toggle),
      add, rows, more);
  }

  function ranksBlock(c) {
    const m = state.meta;
    const id = c.athlete.fsp_id;
    const today = new Date().toISOString().slice(0, 10);
    const rows = c.ranks.length
      ? h('ul', { class: 'rows' }, c.ranks.map((r) => h('li', {},
          h('div', { class: 'what' }, r.rank, r.manual ? h('span', { class: 'badge badge-manual' }, 'вручную') : null,
            h('small', {}, `${disciplineName(r.discipline)} · с ${r.assigned_on}${r.valid_until ? ` до ${r.valid_until}` : ', бессрочно'}`)),
          h('button', { type: 'button', class: 'icon-btn', title: 'Удалить разряд', 'aria-label': `Удалить разряд ${r.rank}`, onclick: action(() => sandbox('DELETE', `/ranks/${encodeURIComponent(r.rank_id)}`), 'Разряд удалён') }, '×'))))
      : h('p', { class: 'empty-note' }, 'Разрядов нет.');
    const add = h('form', { class: 'add', onsubmit: action((ev) => {
      const f = new FormData(ev.target);
      return sandbox('POST', `/athletes/${id}/ranks`, { discipline: f.get('discipline'), rank: f.get('rank'), assigned_on: f.get('assigned_on') });
    }, 'Разряд внесён в реестр') },
      h('div', { class: 'form' },
        field('Разряд или звание', h('select', { name: 'rank' }, m.ranks.map((r) => option(r, r, r === 'КМС')))),
        field('Дисциплина', h('select', { name: 'discipline' }, m.disciplines.map((d) => option(d.code, d.short_name, d.code === c.athlete.disciplines[0])))),
        field('Дата присвоения', h('input', { name: 'assigned_on', type: 'date', min: '2000-01-01', max: today, value: today })),
        h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Присвоить разряд'))));
    return h('details', { class: 'more', open: state.ranksOpen, ontoggle: moreToggle('ranksOpen') },
      h('summary', {}, 'Разряды', count(c.ranks.length)),
      h('div', { class: 'more-body' }, rows, add));
  }

  function profileBlock(c) {
    const a = c.athlete;
    const id = a.fsp_id;
    const form = h('form', { class: 'form', onsubmit: action((ev) => sandbox('PATCH', `/athletes/${id}`, readAthlete(ev.target)), 'Данные сохранены в реестре и в ФСП ID') },
      athleteFields(a), h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Сохранить')));
    const remove = h('div', { class: 'danger-zone' },
      h('span', {}, 'Удаление убирает участника из реестра и ФСП ID.'),
      h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: action(async () => {
        if (!confirm(`Удалить участника ${a.full_name} (${id}) из реестра и ФСП ID?`)) return false;
        await sandbox('DELETE', `/athletes/${id}`);
        const rest = await loadList();
        state.card = null;
        if (rest[0]) await selectAthlete(rest[0].fsp_id, true);
        return false;
      }) }, 'Удалить участника'));
    return h('details', { class: 'more', open: state.profileOpen, ontoggle: moreToggle('profileOpen') },
      h('summary', {}, 'Данные участника'),
      h('div', { class: 'more-body' }, form, remove));
  }

  function renderCard() {
    if (state.creating) return renderNewAthlete();
    renderStepper();
    const c = state.card;
    if (!c) return;
    const a = c.athlete;
    const facts = [a.fsp_id, a.region?.name, a.birth_year ? `${a.birth_year} г. р.` : null].filter(Boolean).join(' · ');
    $('card').replaceChildren(
      h('div', { class: 'card-head' }, h('div', {},
        h('h3', {}, a.full_name, a.manual ? h('span', { class: 'badge badge-manual' }, 'заведён вручную') : null),
        h('p', {}, facts))),
      signInBox(c),
      achievementsBlock(c),
      ranksBlock(c),
      profileBlock(c));
  }

  // --- Для разработчиков ------------------------------------------------------------------

  function renderDev() {
    const m = state.meta;
    $('dev-discovery').href = `${m.issuer}/.well-known/openid-configuration`;
    const rows = [
      ['issuer', m.issuer],
      ['client_id платформы', 'fsp-career'],
      ['flow', 'authorization code + PKCE (S256); client_credentials для партнёров'],
      ['claims', 'fsp_id, region_code, realm_access.roles, aud=fsp-api'],
      ['API', m.api_url],
    ];
    $('dev-oidc').replaceChildren(...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, h('code', {}, v)))));
    const first = state.card?.athlete.fsp_id || 'FSP-10001';
    const user = state.card?.login.username || 'fsp-10001';
    $('dev-curl').textContent = [
      '# Токен спортсмена (приложения используют код авторизации; password grant — только для отладки)',
      `TOKEN=$(curl -s ${m.token_url} \\`,
      `  -d grant_type=password -d client_id=${m.athlete_demo_client} \\`,
      `  -d username=${user} -d password='${m.demo_password}' | jq -r .access_token)`,
      `curl -s ${m.api_url}/me/achievements -H "Authorization: Bearer $TOKEN"`,
      '',
      '# Токен партнёра: чтение реестра в пределах согласий',
      `TOKEN=$(curl -s ${m.token_url} \\`,
      `  -d grant_type=client_credentials -d client_id=${m.partner_demo.client_id} -d client_secret='${m.partner_demo.client_secret}' | jq -r .access_token)`,
      `curl -s ${m.api_url}/athletes/${first}/achievements -H "Authorization: Bearer $TOKEN"   # 403 consent_required без согласия`,
      '',
      '# Правка в песочнице стенда, без токена',
      `curl -s -X POST ${m.api_url}/sandbox/athletes/${first}/achievements -H 'content-type: application/json' \\`,
      `  -d '{"event":{"name":"Хакатон ЛЦТ 2026","discipline":"product","kind":"hackathon","date":"2026-10-11","entrants_total":40},"place":1}'`,
    ].join('\n');
  }

  // --- Запуск ------------------------------------------------------------------------------

  async function start() {
    renderScenarios();
    state.meta = (await sandbox('GET', '/meta')).data;
    const m = state.meta;
    $('stats-line').textContent = `: ${plural(m.stats.athletes, 'спортсмен', 'спортсмена', 'спортсменов')}, ${plural(m.stats.events, 'соревнование', 'соревнования', 'соревнований')}, ${records(m.stats.achievements)} о достижениях`;
    await loadEvents();

    const hash = new URLSearchParams(location.hash.slice(1));
    const list = await loadList();
    const wanted = hash.get('athlete');
    const firstId = wanted && /^FSP-\d{5}$/.test(wanted) ? wanted : (list.find((a) => !a.manual) || list[0])?.fsp_id;
    if (firstId) await selectAthlete(firstId, true).catch(() => list[0] && selectAthlete(list[0].fsp_id, true));
    renderDev();
    // Ссылка вида /#run=me&athlete=FSP-10001 сразу выполняет сценарий.
    if (hash.get('run')) { $('api').scrollIntoView(); void runScenario(hash.get('run')); }

    let timer = 0;
    $('search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadList().catch((e) => toast(e.message, true)), 200); });
    $('new-athlete').addEventListener('click', () => { renderNewAthlete(); $('card').scrollIntoView({ block: 'nearest' }); });
    $('reset').addEventListener('click', action(async () => {
      if (!confirm('Отменить все ручные правки и вернуть исходный набор данных?')) return false;
      await sandbox('POST', '/reset');
      await loadEvents();
      const rest = await loadList();
      state.card = null;
      const again = rest.find((a) => !a.manual) || rest[0];
      if (again) await selectAthlete(again.fsp_id, true);
      toast('Исходные данные возвращены');
      return false;
    }));
  }

  start().catch((err) => {
    $('card').replaceChildren(h('p', { class: 'muted' }, `Не удалось загрузить данные стенда: ${err.message}`));
    toast(`Не удалось загрузить данные стенда: ${err.message}`, true);
  });
})();
