import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Сборка tar.gz для тестов runner: обычные файлы, каталоги, ссылки, pax-заголовки. */
export interface TarSpec {
  path: string;
  type?: '0' | '1' | '2' | '5' | 'x' | 'g';
  data?: string | Buffer;
  linkname?: string;
}

function header(name: string, size: number, type: string, linkname = ''): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000644\0', 100, 'ascii');
  h.write('0000000\0', 108, 'ascii');
  h.write('0000000\0', 116, 'ascii');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  h.write('00000000000\0', 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write(type, 156, 'ascii');
  h.write(linkname, 157, 'utf8');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}

export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len = String(len).length + body.length;
  return `${len}${body}`;
}

export function makeTar(entries: TarSpec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    blocks.push(header(e.path, data.length, e.type ?? '0', e.linkname));
    if (data.length) {
      blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

export const makeTarGz = (entries: TarSpec[]) => gzipSync(makeTar(entries));

/** Каталог → записи tar под общим верхним каталогом (как в tarball GitHub). */
export function dirEntries(dir: string, top = 'owner-repo-abc1234', extra: TarSpec[] = []): TarSpec[] {
  const out: TarSpec[] = [{ path: `${top}/`, type: '5' }];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs)) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(a).isDirectory()) {
        out.push({ path: `${top}/${r}/`, type: '5' });
        walk(a, r);
      } else {
        out.push({ path: `${top}/${r}`, data: readFileSync(a) });
      }
    }
  };
  walk(dir, '');
  return [...out, ...extra.map((e) => ({ ...e, path: `${top}/${e.path}` }))];
}
