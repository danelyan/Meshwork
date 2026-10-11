import type { Config } from './config.js';
import type { Registry } from './data.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Стартовая страница: что это, как войти, как получить токен. Без внешних ресурсов. */
export function renderLanding(reg: Registry, config: Config): string {
  const s = reg.stats();
  const first = reg.dataset.athletes[0]!;
  const oidc = `${config.issuer}/protocol/openid-connect`;
  const tokenUrl = `${oidc}/token`;
  const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td><code>${esc(v)}</code></td></tr>`;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Реестр ФСП — симулятор API и ФСП ID</title>
<style>
body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1b1f23;background:#fafafa}
h1{font-size:28px;margin:.2em 0} h2{font-size:20px;margin-top:1.8em;border-bottom:1px solid #ddd;padding-bottom:.2em}
.warn{background:#fff4d6;border:1px solid #e3b341;border-radius:8px;padding:12px 16px;margin:16px 0}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px} pre{background:#f0f0f0;padding:12px;border-radius:8px;overflow:auto}
table{border-collapse:collapse;width:100%} td{border-bottom:1px solid #e5e5e5;padding:6px 8px;vertical-align:top} td:first-child{width:38%;color:#555}
a{color:#0b57d0} ul{padding-left:20px} .muted{color:#666;font-size:14px}
</style></head><body>
<h1>Реестр ФСП — симулятор</h1>
<p class="muted">API реестра достижений и «ФСП ID» на Keycloak. Команда «ФСП Карьера», ЛЦТ 2026.</p>
<div class="warn"><b>Это не сервис Федерации спортивного программирования.</b> API и схема реестра ФСП по ТЗ не предоставляются; здесь — предложенный командой контракт и <b>синтетические данные</b>: ${s['athletes']} спортсменов, ${s['events']} соревнований, ${s['achievements']} записей о достижениях, ${s['ranks']} разрядов (сгенерировано детерминированно, ${esc(reg.dataset.generated_at)}). Любые совпадения ФИО случайны. Каждый ответ помечен <code>X-FSP-Simulator: true</code>.</div>

<h2>Ссылки</h2>
<ul>
<li><a href="/docs">Swagger UI</a> · <a href="/openapi.json">openapi.json</a> · <a href="/api/v1/health">health</a></li>
<li>ФСП ID (Keycloak): <a href="${esc(config.issuer)}/.well-known/openid-configuration">OIDC discovery</a> · <a href="${esc(config.issuer)}/account/">кабинет спортсмена</a> · <a href="${esc(config.authBase)}/admin/">консоль администратора</a></li>
<li>Открытые данные: <a href="/api/v1/events?per_page=5">соревнования</a> · <a href="/api/v1/disciplines">дисциплины</a> · <a href="/api/v1/regions">регионы</a> · <a href="/api/v1/partners">партнёры</a></li>
</ul>

<h2>Подключение приложения (OpenID Connect)</h2>
<table>
${row('issuer', config.issuer)}
${row('client_id платформы', 'fsp-career')}
${row('flow', 'authorization code + PKCE (S256); client_credentials для чтения реестра')}
${row('redirect URI', 'https://fsp2.ru/*, http://localhost:3000/*, http://localhost:3100/*')}
${row('claims в токенах', 'fsp_id, region_code, realm_access.roles, aud=fsp-api')}
${row('API', `${config.publicUrl}/api/v1`)}
</table>
<p class="muted">Секрет клиента <code>fsp-career</code> задаётся в <code>.env</code> стенда и здесь не публикуется. Открытый демо-клиент для проверки модели согласий — <code>fsp-partner-demo</code>.</p>

<h2>Демо-учётные данные спортсмена</h2>
<table>
${row('логин', first.username)}
${row('пароль', config.demoPassword)}
${row('ФСП ID', first.fsp_id)}
${row('другие логины', `fsp-10001 … fsp-${10000 + s['athletes']!} (пароль общий)`)}
</table>

<h2>Примеры</h2>
<p>Токен спортсмена (password grant включён только для отладки; приложения используют код авторизации):</p>
<pre>curl -s ${esc(tokenUrl)} \\
  -d grant_type=password -d client_id=fsp-career -d client_secret=&lt;секрет&gt; \\
  -d username=${esc(first.username)} -d password='${esc(config.demoPassword)}' | jq -r .access_token

curl -s ${esc(config.publicUrl)}/api/v1/me/achievements -H "Authorization: Bearer $TOKEN"</pre>
<p>Токен партнёра и чтение реестра в пределах согласий:</p>
<pre>curl -s ${esc(tokenUrl)} \\
  -d grant_type=client_credentials -d client_id=fsp-partner-demo -d client_secret='${esc(config.partnerDemoSecret)}' | jq -r .access_token

curl -s "${esc(config.publicUrl)}/api/v1/athletes?per_page=5" -H "Authorization: Bearer $TOKEN"
curl -s ${esc(config.publicUrl)}/api/v1/athletes/${esc(first.fsp_id)}/achievements -H "Authorization: Bearer $TOKEN"   # 403 consent_required, если согласия нет</pre>
<p>Проверка записи без токена: <a href="/api/v1/achievements/${esc(reg.dataset.achievements[0]?.achievement_id ?? 'ACH-2023-0001')}/verify">/api/v1/achievements/${esc(reg.dataset.achievements[0]?.achievement_id ?? 'ACH-2023-0001')}/verify</a></p>

<h2>Модель доступа</h2>
<ul>
<li><b>Открыто:</b> справочники, соревнования, протоколы (как публикуемые протоколы: фамилия с инициалами и регион), проверка записи по идентификатору.</li>
<li><b>Спортсмен</b> (токен пользователя с <code>fsp_id</code>): свой профиль, достижения, разряды, согласия партнёрам.</li>
<li><b>Партнёр</b> (<code>client_credentials</code>, роль <code>partner</code>): поиск и чтение только тех спортсменов, кто дал согласие именно этому клиенту, по областям <code>profile</code>, <code>achievements</code>, <code>ranks</code>. Без согласия — <code>403 consent_required</code>.</li>
<li>Реестр не фиксирует личную роль в команде, ссылку на проект и стек: это сообщает кандидат, и платформа помечает это как его слова.</li>
<li>Согласия хранятся в памяти сервиса и сбрасываются при рестарте (исходное состояние: все спортсмены дали согласие <code>fsp-career</code>, пятая часть — <code>fsp-partner-demo</code>).</li>
</ul>
</body></html>`;
}

export function renderSwagger(config: Config): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Реестр ФСП — OpenAPI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
<script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(`${config.publicUrl}/openapi.json`)}, dom_id: '#swagger-ui', persistAuthorization: true });</script>
</body></html>`;
}
