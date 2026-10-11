import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recognizePdfAsync } from '@/server/collector/ocr';
import { resetEnvCache } from '@/server/env';

const page = (p: string, ...lines: string[]) => JSON.stringify({ page: p, textAnnotation: { blocks: [{ lines: lines.map((text) => ({ text })) }] } });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const PDF = Buffer.from('%PDF-1.4 test');
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('OCR_API_KEY', 'test-key');
  vi.stubEnv('YANDEX_FOLDER_ID', 'test-folder');
  vi.stubEnv('OCR_PROVIDER', '');
  resetEnvCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnvCache();
});

describe('collector/ocr: recognizePdfAsync', () => {
  it('опрашивает операцию и отдаёт строки двух страниц (0-based → 1-based)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'op1', done: false }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(`${page('0', 'Раз', 'Два')}\n${page('1', 'Три')}`, { status: 200 }));
    const lines = await recognizePdfAsync(PDF, 'scan.pdf', { pollMs: 5 });
    expect(lines).toEqual([
      { ref: 'scan.pdf#p1:l1', text: 'Раз' },
      { ref: 'scan.pdf#p1:l2', text: 'Два' },
      { ref: 'scan.pdf#p2:l1', text: 'Три' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(String(url)).toMatch(/\/recognizeTextAsync$/);
    expect(JSON.parse(init.body).mimeType).toBe('application/pdf');
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain('/getRecognition?operationId=op1');
  });

  it('отбрасывает страницы сверх лимита', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'op1' }))
      .mockResolvedValueOnce(new Response(`${page('1', 'а')}\n${page('2', 'б')}\n${page('3', 'в')}`, { status: 200 }));
    const lines = await recognizePdfAsync(PDF, 'f.pdf', { pollMs: 5, maxPages: 2 });
    expect(lines.map((l) => l.ref)).toEqual(['f.pdf#p1:l1', 'f.pdf#p2:l1']);
  });

  it('таймаут опроса → ocr_unavailable', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('recognizeTextAsync') ? json({ id: 'op1' }) : new Response('', { status: 200 })));
    await expect(recognizePdfAsync(PDF, 'f.pdf', { pollMs: 5, timeoutMs: 60 })).rejects.toMatchObject({ code: 'ocr_unavailable' });
  });

  it('403 → ocr_unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(recognizePdfAsync(PDF, 'f.pdf')).rejects.toMatchObject({ code: 'ocr_unavailable' });
  });

  it('выключенный OCR → ocr_unavailable без запросов', async () => {
    vi.stubEnv('OCR_PROVIDER', 'off');
    resetEnvCache();
    await expect(recognizePdfAsync(PDF, 'f.pdf')).rejects.toMatchObject({ code: 'ocr_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
