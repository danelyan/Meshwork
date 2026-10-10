// Клиент для tests/runner/docker.test.ts: запускается в контейнере в сети runner-net (как app),
// гоняет архивы из /cases и печатает одну строку JSON с результатами.
import { readFileSync } from 'node:fs';

const base = 'http://runner:8090';
const h = { authorization: `Bearer ${process.env.TOK}` };
const cases = JSON.parse(readFileSync('/cases/cases.json', 'utf8'));
const out = { health: await (await fetch(`${base}/health`)).json(), noauth: (await fetch(`${base}/run/${'a'.repeat(32)}`)).status, results: {} };
for (const c of cases) {
  const up = await (
    await fetch(`${base}/uploads`, { method: 'POST', headers: { ...h, 'content-type': 'application/gzip' }, body: readFileSync(`/cases/${c.file}`) })
  ).json();
  const acc = await (
    await fetch(`${base}/run`, {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ repoTarballUrl: `upload:${up.uploadId}`, commitSha: 'abc1234', testsBundleRef: c.bundle, image: c.image ?? 'node20', ...(c.timeoutSec ? { timeoutSec: c.timeoutSec } : {}) }),
    })
  ).json();
  if (!acc.jobId) {
    out.results[c.name] = { rejected: acc };
    continue;
  }
  let r;
  for (;;) {
    r = await (await fetch(`${base}/run/${acc.jobId}`, { headers: h })).json();
    if (r.status === 'done' || r.status === 'failed') break;
    await new Promise((x) => setTimeout(x, 200));
  }
  out.results[c.name] = r;
}
console.log(JSON.stringify(out));
