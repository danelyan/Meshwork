import { FSP_DEMO_PARTICIPANTS } from '@/server/collector/fsp-demo';

import type { AuthorizeRequest } from './provider';

/**
 * Страница «входа в ФСП ID» мока: выбор демо-участника вместо логина и пароля. Отдаётся маршрутом
 * Keycloak-пути `.../protocol/openid-connect/auth`, поэтому это HTML-ответ route handler, а не page.tsx.
 * Без скриптов и внешних ресурсов; запрещена вставка во фрейм (кликджекинг формы входа).
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const LOGIN_PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; padding: 32px 16px; display: flex; justify-content: center; }
main { max-width: 520px; width: 100%; }
h1 { font-size: 22px; margin: 0 0 6px; }
p { margin: 0 0 14px; line-height: 1.5; opacity: .85; }
.demo { display: inline-block; font-size: 12px; padding: 2px 8px; border: 1px solid currentColor; border-radius: 999px; margin-bottom: 12px; }
form { margin: 0 0 10px; }
button { width: 100%; text-align: left; padding: 14px 16px; border: 1px solid; border-radius: 10px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button strong { display: block; margin-bottom: 4px; }
button span { font-size: 13px; opacity: .8; }
.cancel { text-align: center; opacity: .8; }
`;

function hidden(req: AuthorizeRequest): string {
  const fields: Record<string, string> = {
    response_type: 'code',
    scope: 'openid profile',
    client_id: req.clientId,
    redirect_uri: req.redirectUri,
    state: req.state,
    nonce: req.nonce,
    code_challenge: req.codeChallenge,
    code_challenge_method: 'S256',
  };
  return Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join('');
}

export function renderLoginPage(req: AuthorizeRequest, action: string): string {
  const h = hidden(req);
  const options = FSP_DEMO_PARTICIPANTS.map(
    (p) =>
      `<form method="post" action="${esc(action)}">${h}<input type="hidden" name="participant" value="${esc(p.sub)}"><button type="submit"><strong>${esc(p.name)}</strong><span>${esc(p.label)}</span></button></form>`,
  ).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ФСП ID (демо)</title><style>${STYLE}</style></head><body><main>
<span class="demo">демо-данные · мок провайдера</span>
<h1>Вход в ФСП ID</h1>
<p>Это демонстрационный провайдер ФСП ID внутри платформы (OIDC, пути как у Keycloak). Настоящий реестр ФСП не подключён: выберите демо-участника. Люди и результаты выдуманы.</p>
<p>Приложение «ФСП Карьера» получит ваш идентификатор участника и имя, чтобы связать профиль с достижениями.</p>
${options}
<form method="post" action="${esc(action)}">${h}<input type="hidden" name="cancel" value="1"><button type="submit" class="cancel">Отмена</button></form>
</main></body></html>`;
}

export function renderErrorPage(message: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ФСП ID (демо): ошибка</title><style>${STYLE}</style></head><body><main><span class="demo">демо-данные · мок провайдера</span><h1>Запрос входа отклонён</h1><p>${esc(message)}</p></main></body></html>`;
}
