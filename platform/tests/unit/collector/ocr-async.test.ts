import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inflateSync } from 'node:zlib';

import { extractFile } from '@/server/collector/files';
import { encodePng, recognizePdfAsync } from '@/server/collector/ocr';
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

// Два листа 40x30, по одной встроенной картинке (серый), без текстового слоя.
const SCAN2 = Buffer.from('JVBERi0xLjQKJSBjcmVhdGVkIGJ5IFBpbGxvdyBQREYgZHJpdmVyCjcgMCBvYmo8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgOCAwIFIKPj5lbmRvYmoKOCAwIG9iajw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMgovS2lkcyBbIDIgMCBSIDUgMCBSIF0KPj5lbmRvYmoKMSAwIG9iajw8Ci9UeXBlIC9YT2JqZWN0Ci9TdWJ0eXBlIC9JbWFnZQovV2lkdGggNDAKL0hlaWdodCAzMAovRmlsdGVyIC9EQ1REZWNvZGUKL0JpdHNQZXJDb21wb25lbnQgOAovQ29sb3JTcGFjZSAvRGV2aWNlR3JheQovTGVuZ3RoIDM0Nwo+PnN0cmVhbQr/2P/gABBKRklGAAEBAAABAAEAAP/bAEMACAYGBwYFCAcHBwkJCAoMFA0MCwsMGRITDxQdGh8eHRocHCAkLicgIiwjHBwoNyksMDE0NDQfJzk9ODI8LjM0Mv/AAAsIAB4AKAEBEQD/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAIAQEAAD8A9/ooooooooooooooooooor//2QplbmRzdHJlYW0KZW5kb2JqCjIgMCBvYmo8PAovUmVzb3VyY2VzIDw8Ci9Qcm9jU2V0IFsgL1BERiAvSW1hZ2VCIF0KL1hPYmplY3QgPDwKL2ltYWdlIDEgMCBSCj4+Cj4+Ci9NZWRpYUJveCBbIDAgMCA0MC4wIDMwLjAgXQovQ29udGVudHMgMyAwIFIKL1R5cGUgL1BhZ2UKL1BhcmVudCA4IDAgUgo+PmVuZG9iagozIDAgb2JqPDwKL0xlbmd0aCA0NQo+PnN0cmVhbQpxIDQwLjAwMDAwMCAwIDAgMzAuMDAwMDAwIDAgMCBjbSAvaW1hZ2UgRG8gUQoKZW5kc3RyZWFtCmVuZG9iago0IDAgb2JqPDwKL1R5cGUgL1hPYmplY3QKL1N1YnR5cGUgL0ltYWdlCi9XaWR0aCA0MAovSGVpZ2h0IDMwCi9GaWx0ZXIgL0RDVERlY29kZQovQml0c1BlckNvbXBvbmVudCA4Ci9Db2xvclNwYWNlIC9EZXZpY2VHcmF5Ci9MZW5ndGggMzQ1Cj4+c3RyZWFtCv/Y/+AAEEpGSUYAAQEAAAEAAQAA/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/8AACwgAHgAoAQERAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAgBAQAAPwAooooooooooooooooooor/2QplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmo8PAovUmVzb3VyY2VzIDw8Ci9Qcm9jU2V0IFsgL1BERiAvSW1hZ2VCIF0KL1hPYmplY3QgPDwKL2ltYWdlIDQgMCBSCj4+Cj4+Ci9NZWRpYUJveCBbIDAgMCA0MC4wIDMwLjAgXQovQ29udGVudHMgNiAwIFIKL1R5cGUgL1BhZ2UKL1BhcmVudCA4IDAgUgo+PmVuZG9iago2IDAgb2JqPDwKL0xlbmd0aCA0NQo+PnN0cmVhbQpxIDQwLjAwMDAwMCAwIDAgMzAuMDAwMDAwIDAgMCBjbSAvaW1hZ2UgRG8gUQoKZW5kc3RyZWFtCmVuZG9iago5IDAgb2JqPDwKL1RpdGxlICj+/wB0AGkAbgB5KQovQ3JlYXRpb25EYXRlIChEOjIwMjYxMDExMTk0NTQ4WikKL01vZERhdGUgKEQ6MjAyNjEwMTExOTQ1NDhaKQo+PmVuZG9iagp4cmVmCjAgMTAKMDAwMDAwMDAwMCA2NTUzNiBmIAowMDAwMDAwMTUwIDAwMDAwIG4gCjAwMDAwMDA2NjEgMDAwMDAgbiAKMDAwMDAwMDgyMSAwMDAwMCBuIAowMDAwMDAwOTE0IDAwMDAwIG4gCjAwMDAwMDE0MjMgMDAwMDAgbiAKMDAwMDAwMTU4MyAwMDAwMCBuIAowMDAwMDAwMDQwIDAwMDAwIG4gCjAwMDAwMDAwODcgMDAwMDAgbiAKMDAwMDAwMTY3NiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9Sb290IDcgMCBSCi9TaXplIDEwCi9JbmZvIDkgMCBSCj4+CnN0YXJ0eHJlZgoxNzc4CiUlRU9G', 'base64');
const visionPage = (text: string) => new Response(JSON.stringify({ result: { textAnnotation: { blocks: [{ lines: [{ text }] }] } } }), { status: 200 });

describe('collector/ocr: encodePng', () => {
  it('сигнатура, IHDR, CRC и пиксели декодируются обратно', () => {
    const px = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]); // 2x2 RGB
    const png = encodePng(px, 2, 2, 3);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(2);
    // обход чанков с проверкой CRC
    let off = 8;
    const idat: Buffer[] = [];
    const types: string[] = [];
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString('ascii');
      const body = png.subarray(off + 8, off + 8 + len);
      const crc = png.readUInt32BE(off + 8 + len);
      let c = 0xffffffff;
      for (const b of Buffer.concat([Buffer.from(type), body])) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      expect((c ^ 0xffffffff) >>> 0).toBe(crc);
      types.push(type);
      if (type === 'IDAT') idat.push(body);
      off += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    const raw = inflateSync(Buffer.concat(idat));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 10, 20, 30]);
  });
});

describe('collector/ocr: многостраничный скан PDF по страницам', () => {
  it('по вызову Vision на страницу, ref с реальными номерами страниц', async () => {
    fetchMock.mockResolvedValueOnce(visionPage('Первая')).mockResolvedValueOnce(visionPage('Вторая'));
    const doc = await extractFile(SCAN2, 'scan.pdf', 'application/pdf');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const c of fetchMock.mock.calls as [string, { body: string }][]) expect(JSON.parse(c[1].body).mimeType).toBe('image/png');
    expect(doc.lines.map((l) => l.ref).sort()).toEqual(['scan.pdf#p1:l1', 'scan.pdf#p2:l1']);
    expect(doc.meta).toMatchObject({ ocr: true });
    expect(doc.meta?.ocrPartial).toBeUndefined();
  });

  it('сбой одной страницы → берём распознанное, meta.ocrPartial', async () => {
    fetchMock.mockResolvedValueOnce(visionPage('Первая')).mockResolvedValueOnce(new Response('', { status: 503 }));
    const doc = await extractFile(SCAN2, 'scan.pdf', 'application/pdf');
    expect(doc.lines.map((l) => l.ref)).toEqual(['scan.pdf#p1:l1']);
    expect(doc.meta).toMatchObject({ ocr: true, ocrPartial: true });
  });

  it('упали все страницы → ocrFailed + empty', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    const doc = await extractFile(SCAN2, 'scan.pdf', 'application/pdf');
    expect(doc.meta).toMatchObject({ empty: true, ocrFailed: true, ocrReason: 'multipage' });
  });
});
