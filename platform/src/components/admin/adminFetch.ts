/** fetch для клиентских форм админки: JSON туда и обратно, ошибка API → Error с текстом сервера. */
export async function adminFetch<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new Error(data.error?.message ?? `Ошибка ${res.status}`);
  return data;
}
