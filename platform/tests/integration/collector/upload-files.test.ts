import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DELETE as deleteSourceRoute } from '@/app/api/sources/[id]/route';
import { DELETE as deleteUploadRoute } from '@/app/api/uploads/[id]/route';
import { GET as downloadRoute } from '@/app/api/uploads/[id]/file/route';
import { POST } from '@/app/api/uploads/route';
import { proposeClaims } from '@/server/claims/service';
import type { VerifiedClaim } from '@/server/claims/types';
import { resetEnvCache } from '@/server/env';
import { signSession } from '@/server/session';

import { prisma, resetDb } from '../../helpers/db';
import { resumePdf } from '../../unit/collector/pdf-fixture';

const cookieFor = (id: string) => `cid=${signSession(id)}`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, cookie?: string) => new Request(`http://localhost${url}`, { method, headers: cookie ? { cookie } : {} });

function upload(buf: Buffer, name: string, cookie: string) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(buf)], { type: 'application/pdf' }), name);
  return POST(new Request('http://localhost/api/uploads', { method: 'POST', body: form, headers: { cookie } }));
}

const claim = (catalogId: string, sourceRef: string, sourceKind: VerifiedClaim['sourceKind'] = 'resume'): VerifiedClaim => ({
  catalogId,
  statement: `S ${catalogId}`,
  quote: `Цитата для ${catalogId} достаточно длинная`,
  sourceRef,
  confidence: 'high',
  level: 'self_reported',
  limits: 'x',
  suggestedProof: [],
  sourceKind,
});

let dir: string;
const prevDir = process.env.UPLOAD_DIR;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fsp-uploads-'));
  process.env.UPLOAD_DIR = dir;
  resetEnvCache();
});
afterAll(async () => {
  if (prevDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = prevDir;
  resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  await prisma.candidate.createMany({
    data: [
      { id: 'cand-a', email: 'a@example.test', name: 'A' },
      { id: 'cand-b', email: 'b@example.test', name: 'B' },
    ],
  });
});

describe('оригиналы загрузок: upload → download → delete', () => {
  it('файл лежит по <candidateId>/<sha256>, имя пользователя в путь не попадает; повтор — без копии', async () => {
    const buf = resumePdf(['Ivan Petrov', 'Go']);
    const evil = '../../etc/passwd<script>.pdf';
    const res = await upload(buf, evil, cookieFor('cand-a'));
    expect(res.status).toBe(201);
    const { uploadId } = await res.json();
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(row.storageKey).toBe(`cand-a/${row.sha256}`);
    expect(readdirSync(dir)).toEqual(['cand-a']);
    expect(readdirSync(join(dir, 'cand-a'))).toEqual([row.sha256]);

    const again = await upload(buf, 'other-name.pdf', cookieFor('cand-a'));
    expect(again.status).toBe(200);
    expect(readdirSync(join(dir, 'cand-a'))).toHaveLength(1);
  });

  it('скачать может только владелец: байты те же, attachment с безопасным именем и nosniff; чужой — 404', async () => {
    const buf = resumePdf(['Резюме']);
    const { uploadId } = await (await upload(buf, 'Моё "резюме".pdf', cookieFor('cand-a'))).json();

    const res = await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET', cookieFor('cand-a')), params(uploadId));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(buf)).toBe(true);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(cd).not.toContain('"резюме"');
    expect(cd).toContain(encodeURIComponent('Моё _резюме_.pdf'));

    expect((await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET', cookieFor('cand-b')), params(uploadId))).status).toBe(404);
    expect((await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET'), params(uploadId))).status).toBe(401);
    expect((await downloadRoute(req('/api/uploads/nope/file', 'GET', cookieFor('cand-a')), params('nope'))).status).toBe(404);
  });

  it('Markdown и CSV: принимаются, текст с ref по строкам, mime для скачивания — текстовый', async () => {
    const md = Buffer.from('# Иван\nBackend на Go, 3 года', 'utf8');
    const res = await upload(md, 'cv.md', cookieFor('cand-a'));
    expect(res.status).toBe(201);
    const { uploadId } = await res.json();
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(row.mime).toBe('text/markdown');
    expect(JSON.stringify(row.extracted)).toContain('cv.md#p1:l2');
    const file = await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET', cookieFor('cand-a')), params(uploadId));
    expect(file.headers.get('content-type')).toBe('text/markdown');
    expect(Buffer.from(await file.arrayBuffer()).equals(md)).toBe(true);

    const csv = await upload(Buffer.from('навык;опыт\nGo;3 года'), 'skills.csv', cookieFor('cand-a'));
    expect(csv.status).toBe(201);
    const bin = await upload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]), 'photo.txt', cookieFor('cand-a'));
    expect(bin.status).toBe(415);
  });

  it('старая запись без оригинала — 404 на скачивание; повторная загрузка дописывает файл', async () => {
    const buf = resumePdf(['Old']);
    const { uploadId } = await (await upload(buf, 'old.pdf', cookieFor('cand-a'))).json();
    await prisma.upload.update({ where: { id: uploadId }, data: { storageKey: null } });
    rmSync(join(dir, 'cand-a'), { recursive: true, force: true });
    expect((await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET', cookieFor('cand-a')), params(uploadId))).status).toBe(404);
    await upload(buf, 'old.pdf', cookieFor('cand-a'));
    expect((await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET', cookieFor('cand-a')), params(uploadId))).status).toBe(200);
  });

  it('удаление: чужой — 404; владелец — файл и запись удалены, черновики удалены, подтверждённые остались', async () => {
    const { uploadId } = await (await upload(resumePdf(['Go', 'PostgreSQL']), 'cv.pdf', cookieFor('cand-a'))).json();
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
    const [draft, keep] = await proposeClaims('cand-a', [claim('be.lang-core', 'cv.pdf#p1:l1'), claim('be.framework', 'cv.pdf#p1:l2')]);
    await prisma.claim.update({ where: { id: keep!.id }, data: { status: 'confirmed', confirmedAt: new Date() } });
    const [unrelated] = await proposeClaims('cand-a', [claim('be.rest-design', 'other.pdf#p1:l1')]);

    expect((await deleteUploadRoute(req(`/api/uploads/${uploadId}`, 'DELETE', cookieFor('cand-b')), params(uploadId))).status).toBe(404);
    expect(existsSync(join(dir, row.storageKey!))).toBe(true);

    const res = await deleteUploadRoute(req(`/api/uploads/${uploadId}`, 'DELETE', cookieFor('cand-a')), params(uploadId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedClaims: 1, keptClaims: 1 });
    expect(existsSync(join(dir, row.storageKey!))).toBe(false);
    expect(await prisma.upload.count({ where: { id: uploadId } })).toBe(0);
    expect(await prisma.claim.findUnique({ where: { id: draft!.id } })).toBeNull();
    expect((await prisma.claim.findUniqueOrThrow({ where: { id: keep!.id } })).status).toBe('confirmed');
    expect(await prisma.claim.findUnique({ where: { id: unrelated!.id } })).not.toBeNull();
    expect((await downloadRoute(req(`/api/uploads/${uploadId}/file`, 'GET', cookieFor('cand-a')), params(uploadId))).status).toBe(404);
  });

  it('удаление ссылки: чужой — 404; черновики из неё удалены, исправленные остались, Source удалён', async () => {
    const origin = 'https://example.com/cv';
    const src = await prisma.source.create({
      data: { candidateId: 'cand-a', kind: 'url', origin, snapshot: { lines: [{ ref: `${origin}#l1`, text: 'Go' }] } },
    });
    const [draft, edited] = await proposeClaims('cand-a', [claim('be.lang-core', `${origin}#l1`, 'url'), claim('be.framework', `${origin}#l2`, 'url')]);
    await prisma.claim.update({ where: { id: edited!.id }, data: { status: 'edited' } });

    expect((await deleteSourceRoute(req(`/api/sources/${src.id}`, 'DELETE', cookieFor('cand-b')), params(src.id))).status).toBe(404);
    const res = await deleteSourceRoute(req(`/api/sources/${src.id}`, 'DELETE', cookieFor('cand-a')), params(src.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedClaims: 1, keptClaims: 1 });
    expect(await prisma.source.count()).toBe(0);
    expect(await prisma.claim.findUnique({ where: { id: draft!.id } })).toBeNull();
    expect(await prisma.claim.findUnique({ where: { id: edited!.id } })).not.toBeNull();
  });
});
