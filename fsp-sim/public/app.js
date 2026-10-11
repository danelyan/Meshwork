// Стартовая страница стенда: кнопки с настоящими запросами к API и ручная правка реестра.
// Без зависимостей и внешних ресурсов. Пользовательский текст в DOM попадает только как текст.
(() => {
  'use strict';

  const API = '/api/v1';
  const state = { meta: null, card: null, events: [], creating: false };

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
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : 4000);
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
  const disciplineName = (code) => state.meta.disciplines.find((d) => d.code === code)?.short_name || code;
  const placeText = (a) => (a.status === 'disqualified' ? 'дисквалификация' : a.place ? `${a.place} место из ${a.entrants_total}` : 'участие');

  // --- Раздел 1: сценарии -----------------------------------------------------------------

  class Run {
    constructor(title) {
      $('result').hidden = false;
      $('result-title').textContent = title;
      $('result-summary').textContent = '';
      $('result-summary').className = 'summary';
      $('result-steps').replaceChildren();
    }

    /** Один запрос: показывает адрес, код ответа и JSON; возвращает ответ. */
    async step(title, method, url, opts = {}) {
      const shown = url.startsWith('http') ? url.replace(location.origin, '') : url;
      const auth = opts.token ? `  ·  Authorization: Bearer <${opts.tokenLabel || 'токен'}>` : '';
      const status = h('span', { class: 'badge' }, '…');
      const pre = h('pre', {}, h('code', {}, 'выполняется…'));
      const note = opts.note ? h('p', { class: 'step-note' }, opts.note) : null;
      const sent = opts.json !== undefined ? h('p', { class: 'step-note' }, 'Тело запроса: ', h('code', {}, JSON.stringify(opts.json))) : null;
      const box = h('details', { class: 'step', open: !opts.collapsed },
        h('summary', {}, h('span', { class: 'step-title' }, title), h('span', { class: 'step-req' }, `${method} ${shown}${auth}`), status),
        h('div', { class: 'step-body' }, note, sent, pre));
      $('result-steps').append(box);
      let r;
      try {
        r = await request(method, url, opts);
      } catch (err) {
        status.textContent = 'нет связи';
        status.classList.add('badge-bad');
        pre.firstChild.textContent = String(err && err.message || err);
        throw err;
      }
      status.textContent = String(r.status);
      status.classList.add(r.ok ? 'badge-ok' : 'badge-bad');
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
      const s = $('result-summary');
      s.textContent = text;
      s.className = `summary${kind ? ` is-${kind}` : ''}`;
    }

    async athleteToken(card) {
      const m = state.meta;
      const r = await this.step('ФСП ID выдаёт токен спортсмену', 'POST', m.token_url, {
        form: { grant_type: 'password', client_id: m.athlete_demo_client, username: card.login.username, password: card.login.password, scope: 'openid' },
        note: `Вход участника ${card.login.username}. На этой странице — по демо-паролю в один запрос; платформа получает такой же токен после входа через форму ФСП ID.`,
        collapsed: true,
      });
      if (!r.ok) throw new Error('ФСП ID не выдал токен спортсмену');
      return r.body.access_token;
    }

    async partnerToken() {
      const m = state.meta;
      const r = await this.step('ФСП ID выдаёт токен партнёру', 'POST', m.token_url, {
        form: { grant_type: 'client_credentials', client_id: m.partner_demo.client_id, client_secret: m.partner_demo.client_secret },
        note: `Сервисный аккаунт клиента ${m.partner_demo.client_id} — так к реестру обращается работодатель или другая площадка.`,
        collapsed: true,
      });
      if (!r.ok) throw new Error('ФСП ID не выдал токен партнёру');
      return r.body.access_token;
    }
  }

  const partnerRead = (run, card, token) =>
    run.step('Партнёр запрашивает достижения участника', 'GET', `${API}/athletes/${card.athlete.fsp_id}/achievements?per_page=5`, { token, tokenLabel: 'токен партнёра' });

  const SCENARIOS = [
    {
      id: 'protocol', title: 'Открытый протокол', text: 'Без токена: последнее соревнование и его результаты.',
      async run(run) {
        const list = await run.step('Список соревнований', 'GET', `${API}/events?per_page=10`, { collapsed: true });
        // У соревнования, заведённого вручную, протокола нет — берём последнее из набора.
        const ev = list.body.data.find((e) => !e.manual) || list.body.data[0];
        const r = await run.step('Протокол результатов', 'GET', `${API}/events/${ev.event_id}/results`);
        const rows = r.body.data.results;
        const first = rows[0]?.entrant;
        run.done(`«${ev.name}»: в протоколе ${plural(rows.length, 'строка', 'строки', 'строк')}${first ? `, первое место — ${first.name || first.display_name}` : ''}. Токен не нужен: протоколы публикуются открыто, и в них только фамилия с инициалами.`);
      },
    },
    {
      id: 'me', title: 'Спортсмен о себе', text: 'Участник входит через ФСП ID и читает свои записи. Так же их получает платформа.',
      async run(run, card) {
        const token = await run.athleteToken(card);
        await run.step('Профиль спортсмена', 'GET', `${API}/me`, { token, tokenLabel: 'токен спортсмена', collapsed: true });
        const r = await run.step('Достижения спортсмена', 'GET', `${API}/me/achievements?per_page=5`, { token, tokenLabel: 'токен спортсмена' });
        const total = r.body.meta.total;
        run.done(total
          ? `Реестр вернул ${plural(total, 'запись', 'записи', 'записей')} о достижениях участника ${card.athlete.full_name}${total > 5 ? ' (в ответе первые 5)' : ''}. Те же записи платформа получает при входе через ФСП ID.`
          : `У участника ${card.athlete.full_name} в реестре нет записей — список пуст. Внесите достижение в разделе 2 и нажмите ещё раз.`);
      },
    },
    {
      id: 'partner', title: 'Партнёр читает достижения', text: 'Работодатель видит записи только с согласия участника.',
      async run(run, card) {
        const r = await partnerRead(run, card, await run.partnerToken());
        if (r.ok) run.done(`Партнёр получил ${plural(r.body.meta.total, 'запись', 'записи', 'записей')}: участник ${card.athlete.full_name} дал согласие этому клиенту.`);
        else run.done(`${r.status} ${r.body?.error?.code}: участник ${card.athlete.full_name} не давал согласия этому партнёру, реестр ничего не выдал. Нажмите «Участник даёт согласие» и повторите.`, 'denied');
      },
    },
    {
      id: 'grant', title: 'Участник даёт согласие', text: 'Спортсмен разрешает партнёру читать свои записи — доступ появляется.',
      async run(run, card) {
        const token = await run.athleteToken(card);
        await run.step('Спортсмен даёт согласие партнёру', 'PUT', `${API}/me/consents/${state.meta.partner_demo.client_id}`, { token, tokenLabel: 'токен спортсмена', json: { scopes: ['profile', 'achievements', 'ranks'] } });
        const r = await partnerRead(run, card, await run.partnerToken());
        run.done(r.ok ? `Согласие дано — партнёр получил ${plural(r.body.meta.total, 'запись', 'записи', 'записей')}.` : `Партнёр получил ${r.status}.`, r.ok ? '' : 'error');
      },
    },
    {
      id: 'revoke', title: 'Участник отзывает согласие', text: 'Спортсмен закрывает доступ — партнёр получает 403.',
      async run(run, card) {
        const token = await run.athleteToken(card);
        await run.step('Спортсмен отзывает согласие', 'DELETE', `${API}/me/consents/${state.meta.partner_demo.client_id}`, { token, tokenLabel: 'токен спортсмена' });
        const r = await partnerRead(run, card, await run.partnerToken());
        run.done(r.status === 403 ? 'Согласие отозвано — тот же запрос партнёра теперь получает 403 consent_required. Данными распоряжается сам участник.' : `Партнёр получил ${r.status}.`, r.status === 403 ? 'denied' : 'error');
      },
    },
    {
      id: 'verify', title: 'Проверка записи', text: 'По идентификатору записи любой может убедиться, что она есть в реестре.',
      async run(run, card) {
        const a = card.achievements[0];
        if (a) await run.step('Запись участника', 'GET', `${API}/achievements/${a.achievement_id}/verify`);
        const fake = await run.step('Выдуманный идентификатор', 'GET', `${API}/achievements/ACH-1999-0001/verify`, { collapsed: Boolean(a) });
        run.done(a
          ? `Запись ${a.achievement_id} («${a.event_name}», ${placeText(a)}) подтверждена реестром; выдуманный идентификатор — valid: ${fake.body.data.valid}.`
          : `У участника нет записей; выдуманный идентификатор реестр не подтверждает — valid: ${fake.body.data.valid}.`);
      },
    },
    {
      id: 'noauth', title: 'Запрос без токена', text: 'Личные данные без входа не отдаются.',
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
    for (const b of buttons) { b.setAttribute('aria-busy', 'true'); b.disabled = true; b.classList.toggle('active', b.dataset.id === id); }
    const run = new Run(sc.title);
    try {
      await sc.run(run, state.card);
    } catch (err) {
      run.done(`Не получилось: ${err.message}. Проверьте /api/v1/health — возможно, ФСП ID перезапускается.`, 'error');
    } finally {
      for (const b of buttons) { b.removeAttribute('aria-busy'); b.disabled = false; }
      $('result').scrollIntoView({ block: 'nearest' });
      // Сценарии с согласиями меняют карточку участника.
      if (id === 'grant' || id === 'revoke') void selectAthlete(state.card.athlete.fsp_id, true);
    }
  }

  function renderScenarios() {
    $('scenarios').replaceChildren(...SCENARIOS.map((s) =>
      h('button', { type: 'button', class: 'scenario', 'data-id': s.id, onclick: () => runScenario(s.id) }, h('b', {}, s.title), h('span', {}, s.text))));
  }

  // --- Раздел 2: правка реестра -----------------------------------------------------------

  async function loadEvents() {
    state.events = (await request('GET', `${API}/events?per_page=100`)).body.data;
  }

  async function loadList() {
    const q = $('search').value.trim();
    const body = await sandbox('GET', `/athletes?per_page=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    const current = state.card?.athlete.fsp_id;
    const items = body.data.map((a) =>
      h('button', { type: 'button', 'aria-current': a.fsp_id === current ? 'true' : null, onclick: () => selectAthlete(a.fsp_id) },
        a.full_name, a.manual ? [' ', h('span', { class: 'badge badge-manual' }, 'вручную')] : null,
        h('small', {}, `${a.fsp_id} · ${a.region?.name || 'регион не указан'} · ${plural(a.achievements_total, 'запись', 'записи', 'записей')}`)));
    $('list').replaceChildren(...(items.length ? items : [h('div', { class: 'empty' }, 'Никого не найдено')]));
    renderChanges(body.meta.changes);
    return body.data;
  }

  function renderChanges(c) {
    const parts = [];
    if (c.manual_athletes) parts.push(`добавлено участников: ${c.manual_athletes}`);
    if (c.removed_athletes) parts.push(`удалено из исходного набора: ${c.removed_athletes}`);
    if (c.manual_achievements) parts.push(`внесено достижений: ${c.manual_achievements}`);
    if (c.manual_ranks) parts.push(`внесено разрядов: ${c.manual_ranks}`);
    $('changes-line').textContent = c.modified ? `Реестр изменён вручную${parts.length ? ` — ${parts.join(', ')}` : ''}. «Вернуть исходные данные» отменяет все правки.` : 'Сейчас в реестре исходный набор данных, ручных правок нет.';
  }

  async function selectAthlete(fspId, keepScroll) {
    state.creating = false;
    const body = await sandbox('GET', `/athletes/${fspId}`);
    state.card = body.data;
    renderCard();
    renderWho();
    for (const b of $('list').querySelectorAll('button')) b.setAttribute('aria-current', String(b.textContent.includes(fspId)));
    if (!keepScroll && window.matchMedia('(max-width: 820px)').matches) $('card').scrollIntoView({ block: 'start' });
  }

  function renderWho() {
    const c = state.card;
    if (!c) return;
    $('who-name').textContent = c.athlete.full_name;
    $('who-id').textContent = `(${c.athlete.fsp_id}, логин ${c.login.username})`;
    $('login-user').textContent = c.login.username;
    $('login-pass').textContent = c.login.password;
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

  function athleteFields(a) {
    const m = state.meta;
    return [
      field('Фамилия', h('input', { name: 'last_name', required: true, maxlength: 40, value: a?.last_name || '' })),
      field('Имя', h('input', { name: 'first_name', required: true, maxlength: 40, value: a?.first_name || '' })),
      field('Отчество', h('input', { name: 'middle_name', maxlength: 40, value: a?.middle_name || '' })),
      field('Год рождения', h('input', { name: 'birth_year', type: 'number', required: true, min: 1950, max: 2015, value: a?.birth_year || 2003 })),
      field('Регион', h('select', { name: 'region_code' }, m.regions.map((r) => option(r.code, r.name, r.code === (a?.region_code || '77'))))),
      field('Пол', h('select', { name: 'sex' }, option('m', 'мужской', (a?.sex || 'm') === 'm'), option('f', 'женский', a?.sex === 'f'))),
      h('div', { class: 'wide' }, h('span', { class: 'muted' }, 'Дисциплины'),
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
    const form = h('form', { class: 'form', onsubmit: action(async (ev) => {
      const body = await sandbox('POST', '/athletes', readAthlete(ev.target));
      state.card = body.data;
      state.creating = false;
    }, () => `Участник создан: ${state.card.athlete.fsp_id}, логин ${state.card.login.username}. Теперь внесите ему достижение.`) },
      athleteFields(null),
      h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Создать участника'),
        h('button', { type: 'button', class: 'btn', onclick: () => { state.creating = false; renderCard(); } }, 'Отмена')));
    $('card').replaceChildren(
      h('h3', { class: 'card-title' }, 'Новый участник'),
      h('p', { class: 'muted' }, 'Участник получит номер ФСП ID и логин для входа через ФСП ID. Имя — любое вымышленное, только буквы.'),
      form);
    form.querySelector('input').focus();
  }

  function eventControls() {
    const m = state.meta;
    const select = h('select', { name: 'event_id' },
      option('', '— новое соревнование (ввести название) —', true),
      state.events.map((e) => option(e.event_id, `${e.ends_on.slice(0, 4)} · ${e.name}`)));
    const fresh = h('div', { class: 'form wide' },
      field('Название соревнования', h('input', { name: 'event_name', maxlength: 160, placeholder: 'Например: Хакатон «Лидеры цифровой трансформации» 2026' }), true),
      field('Дисциплина', h('select', { name: 'event_discipline' }, m.disciplines.map((d) => option(d.code, d.short_name)))),
      field('Статус соревнования', h('select', { name: 'event_kind' }, m.event_kinds.map((k) => option(k.code, k.label, k.code === 'hackathon')))),
      field('Дата окончания', h('input', { name: 'event_date', type: 'date', min: '2000-01-01', max: new Date().toISOString().slice(0, 10), value: new Date().toISOString().slice(0, 10) })),
      field('Всего участников (команд)', h('input', { name: 'event_total', type: 'number', min: 1, max: 5000, value: 40 })));
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

  function renderCard() {
    if (state.creating) return renderNewAthlete();
    const c = state.card;
    if (!c) return;
    const a = c.athlete;
    const m = state.meta;
    const id = a.fsp_id;

    const profile = h('form', { class: 'form', onsubmit: action((ev) => sandbox('PATCH', `/athletes/${id}`, readAthlete(ev.target)), 'Данные участника сохранены в реестре и в ФСП ID') },
      athleteFields(a), h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Сохранить')));

    const achievements = c.achievements.length
      ? h('ul', { class: 'rows' }, c.achievements.map((x) => h('li', {},
          h('div', { class: 'what' }, x.event_name, x.manual ? [' ', h('span', { class: 'badge badge-manual' }, 'вручную')] : null,
            h('small', {}, `${x.date} · ${placeText(x)}${x.team_name ? ` · команда «${x.team_name}»` : ''} · ${x.achievement_id}`)),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: action(() => sandbox('DELETE', `/achievements/${encodeURIComponent(x.achievement_id)}`), 'Запись удалена из реестра') }, 'Удалить'))))
      : h('p', { class: 'muted' }, 'Записей нет. На платформе у такого участника будет «в реестре достижений нет».');

    const addAchievement = h('form', { class: 'add', onsubmit: action((ev) => sandbox('POST', `/athletes/${id}/achievements`, readAchievement(ev.target)), 'Достижение внесено в реестр') },
      h('b', {}, 'Внести достижение'),
      h('div', { class: 'form' }, eventControls(),
        field('Занятое место', h('input', { name: 'place', type: 'number', min: 1, max: 5000, value: 1 })),
        field('Команда (для командных дисциплин)', h('input', { name: 'team_name', maxlength: 60, placeholder: `Команда ${a.last_name}` })),
        h('div', { class: 'checks wide' }, h('label', {}, h('input', { type: 'checkbox', name: 'dq' }), 'дисквалификация (без места)')),
        h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Добавить запись'))));

    const ranks = c.ranks.length
      ? h('ul', { class: 'rows' }, c.ranks.map((r) => h('li', {},
          h('div', { class: 'what' }, r.rank, r.manual ? [' ', h('span', { class: 'badge badge-manual' }, 'вручную')] : null,
            h('small', {}, `${disciplineName(r.discipline)} · присвоен ${r.assigned_on}${r.valid_until ? ` · действует до ${r.valid_until}` : ' · бессрочно'}`)),
          h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: action(() => sandbox('DELETE', `/ranks/${encodeURIComponent(r.rank_id)}`), 'Разряд удалён') }, 'Удалить'))))
      : h('p', { class: 'muted' }, 'Разрядов нет.');

    const today = new Date().toISOString().slice(0, 10);
    const addRank = h('form', { class: 'add', onsubmit: action((ev) => {
      const f = new FormData(ev.target);
      return sandbox('POST', `/athletes/${id}/ranks`, { discipline: f.get('discipline'), rank: f.get('rank'), assigned_on: f.get('assigned_on') });
    }, 'Разряд внесён в реестр') },
      h('b', {}, 'Присвоить разряд'),
      h('div', { class: 'form' },
        field('Разряд или звание', h('select', { name: 'rank' }, m.ranks.map((r) => option(r, r, r === 'КМС')))),
        field('Дисциплина', h('select', { name: 'discipline' }, m.disciplines.map((d) => option(d.code, d.short_name, d.code === a.disciplines[0])))),
        field('Дата присвоения', h('input', { name: 'assigned_on', type: 'date', min: '2000-01-01', max: today, value: today })),
        h('div', { class: 'actions wide' }, h('button', { class: 'btn btn-primary' }, 'Добавить разряд'))));

    const partners = c.consents.map((x) => x.client_id);
    const consentLine = partners.includes(m.partner_demo.client_id)
      ? `Участник дал согласие демо-партнёру (${m.partner_demo.client_id}) — тот может читать его записи.`
      : `Демо-партнёру (${m.partner_demo.client_id}) согласие не дано — на его запрос реестр ответит 403.`;

    $('card').replaceChildren(
      h('h3', { class: 'card-title' }, a.full_name, h('span', { class: 'muted' }, id), a.manual ? h('span', { class: 'badge badge-manual' }, 'добавлен вручную') : null),
      h('div', { class: 'login-box' }, 'Вход через ФСП ID: логин ', h('code', {}, c.login.username), ', пароль ', h('code', {}, c.login.password),
        '. ', h('a', { href: '#platform' }, 'Как проверить на платформе')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => { location.hash = '#try'; void runScenario('me'); } }, 'Показать его записи в API'),
        h('button', { type: 'button', class: 'btn', onclick: () => { location.hash = '#try'; void runScenario('partner'); } }, 'Что увидит партнёр')),
      h('div', { class: 'sub' }, h('h3', {}, 'Данные участника'), profile),
      h('div', { class: 'sub' }, h('h3', {}, `Достижения (${c.achievements.length})`), achievements, addAchievement),
      h('div', { class: 'sub' }, h('h3', {}, `Спортивные разряды (${c.ranks.length})`), ranks, addRank),
      h('div', { class: 'sub' }, h('h3', {}, 'Согласия'), h('p', { class: 'muted' }, `${consentLine} Меняется кнопками «Участник даёт согласие» и «Участник отзывает согласие» в разделе 1 — как это сделал бы сам спортсмен.`)),
      h('div', { class: 'sub' }, h('h3', {}, 'Удаление'),
        h('p', { class: 'muted' }, 'Участник исчезнет из реестра вместе с достижениями и разрядами, войти через ФСП ID им будет нельзя. Строки в протоколах соревнований остаются.'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: action(async () => {
          if (!confirm(`Удалить участника ${a.full_name} (${id}) из реестра и ФСП ID?`)) return false;
          await sandbox('DELETE', `/athletes/${id}`);
          const rest = await loadList();
          state.card = null;
          if (rest[0]) await selectAthlete(rest[0].fsp_id, true);
          return false;
        }) }, 'Удалить участника')));
  }

  // --- Блок для разработчиков -------------------------------------------------------------

  function renderDev() {
    const m = state.meta;
    $('dev-discovery').href = `${m.issuer}/.well-known/openid-configuration`;
    $('dev-account').href = `${m.issuer}/account/`;
    const rows = [
      ['issuer', m.issuer],
      ['client_id платформы', 'fsp-career'],
      ['flow', 'authorization code + PKCE (S256); client_credentials для чтения реестра'],
      ['claims в токенах', 'fsp_id, region_code, realm_access.roles, aud=fsp-api'],
      ['API', m.api_url],
    ];
    $('dev-oidc').replaceChildren(...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, h('code', {}, v)))));
    const first = state.card?.athlete.fsp_id || 'FSP-10001';
    const user = state.card?.login.username || 'fsp-10001';
    $('dev-curl').textContent = [
      '# Токен спортсмена (приложения используют код авторизации; password grant — только для отладки)',
      `curl -s ${m.token_url} \\`,
      `  -d grant_type=password -d client_id=${m.athlete_demo_client} \\`,
      `  -d username=${user} -d password='${m.demo_password}' | jq -r .access_token`,
      `curl -s ${m.api_url}/me/achievements -H "Authorization: Bearer $TOKEN"`,
      '',
      '# Токен партнёра и чтение реестра в пределах согласий',
      `curl -s ${m.token_url} \\`,
      `  -d grant_type=client_credentials -d client_id=${m.partner_demo.client_id} -d client_secret='${m.partner_demo.client_secret}' | jq -r .access_token`,
      `curl -s ${m.api_url}/athletes/${first}/achievements -H "Authorization: Bearer $TOKEN"   # 403 consent_required, если согласия нет`,
      '',
      '# Ручная правка (песочница стенда, без токена)',
      `curl -s -X POST ${m.api_url}/sandbox/athletes/${first}/achievements -H 'content-type: application/json' \\`,
      `  -d '{"event":{"name":"Хакатон ЛЦТ 2026","discipline":"product","kind":"hackathon","date":"2026-10-11","entrants_total":40},"place":1}'`,
    ].join('\n');
  }

  // --- Запуск ------------------------------------------------------------------------------

  async function start() {
    renderScenarios();
    state.meta = (await sandbox('GET', '/meta')).data;
    const m = state.meta;
    $('stats-line').textContent = `${plural(m.stats.athletes, 'спортсмен', 'спортсмена', 'спортсменов')}, ${plural(m.stats.events, 'соревнование', 'соревнования', 'соревнований')}, ${plural(m.stats.achievements, 'запись', 'записи', 'записей')} о достижениях`;
    const link = $('platform-link');
    link.href = m.platform_url;
    link.textContent = m.platform_url.replace(/^https?:\/\//, '');
    await loadEvents();

    const hash = new URLSearchParams(location.hash.slice(1));
    const list = await loadList();
    const wanted = hash.get('athlete');
    const firstId = wanted && /^FSP-\d{5}$/.test(wanted) ? wanted : (list.find((a) => !a.manual) || list[0])?.fsp_id;
    if (firstId) await selectAthlete(firstId, true).catch(() => list[0] && selectAthlete(list[0].fsp_id, true));
    renderDev();
    // Ссылка вида /#run=me&athlete=FSP-10001 сразу выполняет сценарий.
    if (hash.get('run')) void runScenario(hash.get('run'));

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
