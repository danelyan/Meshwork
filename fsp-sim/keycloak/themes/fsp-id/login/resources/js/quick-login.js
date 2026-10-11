// Вход в одно нажатие на странице симулятора ФСП ID: участники и общий демо-пароль берутся у API
// реестра на том же адресе. Если API не ответил, остаётся обычная форма с подсказкой.
const API = '/api/v1/sandbox';
const SHOWN = 5;

const form = document.getElementById('kc-form-login');
const quick = document.getElementById('fsp-sim-quick');
const list = document.getElementById('fsp-sim-list');

async function json(path) {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()).data;
}

function records(n) {
  const a = n % 100;
  const b = a % 10;
  return `${n} ${a > 10 && a < 20 ? 'записей' : b === 1 ? 'запись' : b >= 2 && b <= 4 ? 'записи' : 'записей'}`;
}

function signIn(username, password) {
  form.elements.username.value = username;
  form.elements.password.value = password;
  for (const b of list.querySelectorAll('button')) b.disabled = true;
  form.requestSubmit();
}

function button(athlete, password) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fsp-sim__athlete';
  const name = document.createElement('b');
  name.textContent = athlete.full_name;
  const meta = document.createElement('span');
  meta.textContent = `${athlete.username} · ${records(athlete.achievements_total)}${athlete.manual ? ' · новый' : ''}`;
  b.append(name, meta);
  b.addEventListener('click', () => signIn(athlete.username, password));
  return b;
}

if (form && form.elements.username && quick && list) {
  try {
    const [meta, athletes] = await Promise.all([json('/meta'), json(`/athletes?per_page=${SHOWN}`)]);
    if (athletes.length) {
      list.replaceChildren(...athletes.map((a) => button(a, meta.demo_password)));
      quick.hidden = false;
      document.getElementById('fsp-sim-hint').hidden = true;
      document.getElementById('fsp-sim-manual').hidden = false;
    }
  } catch {
    // Реестр недоступен — подсказка со ссылкой на главную страницу уже на экране.
  }
}
