import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertSegment, saveSegment } from '@/server/call/audio';
import { resetEnvCache } from '@/server/env';

const dir = { value: '' };

beforeAll(() => {
  dir.value = mkdtempSync(path.join(os.tmpdir(), 'call-audio-'));
  process.env.CALL_DATA_DIR = dir.value;
  resetEnvCache();
});
afterAll(() => {
  rmSync(dir.value, { recursive: true, force: true });
  delete process.env.CALL_DATA_DIR;
  resetEnvCache();
});

describe('сегменты аудио созвона', () => {
  it('гонка двух загрузок: вторая получает 409, а не 500', async () => {
    const pcm = new Uint8Array(3200);
    const results = await Promise.allSettled([saveSegment('race', pcm), saveSegment('race', pcm)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const f of failed) expect(f.reason).toMatchObject({ status: 409 });
  });

  it('assertSegment: есть — ок, нет — 404, чужое имя — 400', async () => {
    const name = await saveSegment('exists', new Uint8Array(3200));
    await expect(assertSegment('exists', name)).resolves.toBeUndefined();
    await expect(assertSegment('exists', '099.wav')).rejects.toMatchObject({ status: 404 });
    await expect(assertSegment('exists', '../x.wav')).rejects.toMatchObject({ status: 400 });
  });
});
