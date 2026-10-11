import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { VIDEO_MAX_SEGMENTS, listVideoSegments, parseVideoName, readVideoSegment, saveVideoSegment } from '@/server/call/video';
import { resetEnvCache } from '@/server/env';

const dir = { value: '' };

beforeAll(() => {
  dir.value = mkdtempSync(path.join(os.tmpdir(), 'call-video-'));
  process.env.CALL_DATA_DIR = dir.value;
  resetEnvCache();
});
afterAll(() => {
  rmSync(dir.value, { recursive: true, force: true });
  delete process.env.CALL_DATA_DIR;
  resetEnvCache();
});

describe('сегменты видео с камеры', () => {
  it('имя несёт номер и смещение от начала созвона; список по порядку; чтение', async () => {
    const a = await saveVideoSegment('s1', new Uint8Array([1, 2, 3]), 0);
    const b = await saveVideoSegment('s1', new Uint8Array([4]), 60_000.7);
    expect(a).toEqual({ name: '000-0.webm', startMs: 0 });
    expect(b).toEqual({ name: '001-60000.webm', startMs: 60_000 });
    expect(await listVideoSegments('s1')).toEqual([a, b]);
    expect([...(await readVideoSegment('s1', b.name))]).toEqual([4]);
    expect(parseVideoName('007-123.webm')).toEqual({ name: '007-123.webm', startMs: 123 });
    expect(parseVideoName('007.webm')).toBeNull();
    expect(await listVideoSegments('nope')).toEqual([]);
  });

  it('пустой сегмент – 400, чужое имя – 400, нет файла – 404, лимит сегментов – 409', async () => {
    await expect(saveVideoSegment('s2', new Uint8Array(0), 0)).rejects.toMatchObject({ status: 400 });
    await expect(readVideoSegment('s2', '../x.webm')).rejects.toMatchObject({ status: 400 });
    await expect(readVideoSegment('s2', '000-0.webm')).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < VIDEO_MAX_SEGMENTS; i++) await saveVideoSegment('s3', new Uint8Array([1]), i);
    await expect(saveVideoSegment('s3', new Uint8Array([1]), 99)).rejects.toMatchObject({ status: 409 });
  });
});
