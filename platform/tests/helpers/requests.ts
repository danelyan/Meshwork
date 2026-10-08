/** Request для прямого вызова route handler'а в тестах. */
export function jsonRequest(url: string, method: string, body?: unknown, cookie?: string): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookie) headers.set('cookie', cookie);
  return new Request(new URL(url, 'http://localhost'), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** `cid=...` из Set-Cookie ответа. */
export function cookieFrom(res: Response, name = 'cid'): string | undefined {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = new RegExp(`${name}=([^;]*)`).exec(raw);
  return m ? `${name}=${m[1]}` : undefined;
}
