import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ArchiveError, normalizeEntryPath, parseTarGz } from '../../../runner/src/tar';
import { makeTar, makeTarGz, paxRecord } from '../../helpers/tar';

describe('runner tar: пути', () => {
  it.each(['/etc/passwd', '../x', 'a/../../x', 'a\\b', 'a\0b'])('отклоняет %j', (p) => {
    expect(() => normalizeEntryPath(p)).toThrow(ArchiveError);
  });

  it('нормализует ./ и пустые сегменты', () => {
    expect(normalizeEntryPath('./a//b/./c')).toEqual(['a', 'b', 'c']);
  });
});

describe('runner tar: архив', () => {
  it('снимает общий верхний каталог GitHub и читает pax-комментарий', () => {
    const gz = makeTarGz([
      { path: 'pax_global_header', type: 'g', data: paxRecord('comment', 'a'.repeat(40)) },
      { path: 'o-r-abc/', type: '5' },
      { path: 'o-r-abc/src/app.js', data: 'export {}' },
      { path: 'o-r-abc/README.md', data: '# hi' },
    ]);
    const parsed = parseTarGz(gz);
    expect(parsed.comment).toBe('a'.repeat(40));
    expect(parsed.entries.filter((e) => e.type === 'file').map((e) => e.path).sort()).toEqual(['README.md', 'src/app.js']);
  });

  it('pax path переопределяет имя записи', () => {
    const long = `top/${'d'.repeat(120)}/file.js`;
    const gz = makeTarGz([
      { path: 'PaxHeader', type: 'x', data: paxRecord('path', long) },
      { path: 'short', data: 'x' },
      { path: 'top/b.js', data: 'y' },
    ]);
    expect(parseTarGz(gz).entries.map((e) => e.path)).toContain(`${'d'.repeat(120)}/file.js`);
  });

  it('пропускает node_modules и .git', () => {
    const parsed = parseTarGz(
      makeTarGz([
        { path: 't/node_modules/vitest/index.js', data: 'evil' },
        { path: 't/.git/config', data: 'x' },
        { path: 't/src/a.js', data: 'ok' },
      ]),
    );
    expect(parsed.entries.map((e) => e.path)).toEqual(['src/a.js']);
    expect(parsed.skipped).toBe(2);
  });

  it.each([
    ['симлинк', { path: 't/link', type: '2' as const, linkname: '/etc/passwd' }],
    ['жёсткую ссылку', { path: 't/hard', type: '1' as const, linkname: 't/a.js' }],
    ['выход за каталог', { path: '../../escape.js', data: 'x' }],
    ['абсолютный путь', { path: '/tmp/abs.js', data: 'x' }],
  ])('отклоняет %s', (_n, entry) => {
    expect(() => parseTarGz(makeTarGz([{ path: 't/a.js', data: 'a' }, entry]))).toThrow(ArchiveError);
  });

  it('отклоняет pax linkpath', () => {
    const gz = makeTarGz([
      { path: 'PaxHeader', type: 'x', data: paxRecord('linkpath', '/etc') },
      { path: 't/a', data: 'x' },
    ]);
    expect(() => parseTarGz(gz)).toThrow(/ссылки/);
  });

  it('режет gzip-бомбу по лимиту распаковки', () => {
    const big = makeTar([{ path: 't/zeros.bin', data: Buffer.alloc(3 * 1024 * 1024) }]);
    const gz = gzipSync(big);
    expect(gz.length).toBeLessThan(64 * 1024);
    expect(() => parseTarGz(gz, { maxUncompressedBytes: 1024 * 1024, maxFiles: 10, maxFileBytes: 10 * 1024 * 1024, maxDepth: 10 })).toThrow(
      /лимита/,
    );
  });

  it('отклоняет битую контрольную сумму и не-gzip', () => {
    const tar = makeTar([{ path: 't/a.js', data: 'a' }]);
    tar[0] = tar[0]! ^ 0xff;
    expect(() => parseTarGz(gzipSync(tar))).toThrow(/контрольная/);
    expect(() => parseTarGz(Buffer.from('not gzip'))).toThrow(/gzip/);
  });

  it('лимит числа файлов', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ path: `t/f${i}.js`, data: 'x' }));
    expect(() => parseTarGz(makeTarGz(entries), { maxUncompressedBytes: 1e6, maxFiles: 10, maxFileBytes: 1e6, maxDepth: 10 })).toThrow(
      /много файлов/,
    );
  });
});
