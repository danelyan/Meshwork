import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { AppError } from '../errors';
import { LIMITS } from './limits';

/**
 * Разбор PDF/DOCX в отдельном потоке (worker_threads) с таймаутом и лимитом
 * памяти: зависший или «тяжёлый» файл убивается `terminate()`, а не вешает
 * event loop сервера.
 *
 * Код потока – строка (`eval: true`), а пакеты (`unpdf`, `mammoth`) он грузит
 * через `createRequire(<cwd>/package.json)`: так не нужен отдельный бандл
 * worker-файла в Next. Оба пакета – в `serverExternalPackages` (next.config.ts),
 * поэтому лежат в `node_modules` и в standalone-сборке.
 */

export interface RawPdfItem {
  /** текст элемента getTextContent */
  s: string;
  /** transform [a,b,c,d,e,f] */
  t: number[];
  eol: boolean;
  /** доля «невидимых» глифов, сопоставленных этому элементу по операторам, 0..1; -1 – сопоставить не удалось */
  inv: number;
}
export interface RawPdfPage {
  /** [x0, y0, x1, y1] */
  view: number[];
  items: RawPdfItem[];
}
export type WorkerResult =
  | { ok: true; kind: 'pdf'; pages: RawPdfPage[]; numPages: number }
  | { ok: true; kind: 'docx'; text: string }
  | { ok: false; code: 'too_many_pages'; pages: number }
  | { ok: false; code: 'parse_failed'; message: string };

// Внутри потока: require('unpdf') (CJS-сборка), pdf.js-операторы для цвета/альфы/режима
// отрисовки глифов, выравнивание глифов с элементами getTextContent по порядку.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const req = createRequire(workerData.base);

function isInvisibleColor(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return r >= 0xf0 && g >= 0xf0 && b >= 0xf0; // белый и почти белый
}

async function pdf(data) {
  const unpdf = req('unpdf');
  const doc = await unpdf.getDocumentProxy(data, { isEvalSupported: false });
  try {
    if (doc.numPages > workerData.maxPages) return { ok: false, code: 'too_many_pages', pages: doc.numPages };
    const { OPS } = await unpdf.getResolvedPDFJS();
    const SHOW = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const ol = await page.getOperatorList();
      // Последовательность непробельных глифов с признаком «невидим».
      const chars = [];
      const inv = [];
      let st = { color: '#000000', alpha: 1, mode: 0 };
      const stack = [];
      for (let i = 0; i < ol.fnArray.length; i++) {
        const fn = ol.fnArray[i], args = ol.argsArray[i];
        if (fn === OPS.save) stack.push({ ...st });
        else if (fn === OPS.restore) st = stack.pop() || st;
        else if (fn === OPS.setFillRGBColor) st.color = args && args[0];
        else if (fn === OPS.setTextRenderingMode) st.mode = args && args[0];
        else if (fn === OPS.setGState && args && Array.isArray(args[0])) {
          for (const kv of args[0]) if (Array.isArray(kv) && kv[0] === 'ca') st.alpha = Number(kv[1]);
        } else if (SHOW.has(fn)) {
          const glyphs = fn === OPS.nextLineSetSpacingShowText ? args[2] : args[0];
          if (!Array.isArray(glyphs)) continue;
          const hidden = isInvisibleColor(st.color) || st.alpha <= 0.05 || st.mode === 3 || st.mode === 7;
          for (const g of glyphs) {
            if (!g || typeof g !== 'object' || typeof g.unicode !== 'string') continue;
            for (const ch of g.unicode) {
              if (/\s/.test(ch)) continue;
              chars.push(ch);
              inv.push(hidden);
            }
          }
        }
      }
      const tc = await page.getTextContent();
      const items = [];
      let ptr = 0;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        let matched = 0, hid = 0;
        for (const ch of it.str) {
          if (/\s/.test(ch)) continue;
          // ищем глиф вперёд в небольшом окне: порядок операторов = порядок getTextContent
          let found = -1;
          for (let k = ptr; k < Math.min(chars.length, ptr + 64); k++) if (chars[k] === ch) { found = k; break; }
          if (found < 0) continue;
          matched++; if (inv[found]) hid++;
          ptr = found + 1;
        }
        const nonWs = it.str.replace(/\s/g, '').length;
        items.push({ s: it.str, t: Array.from(it.transform || [1,0,0,1,0,0]), eol: !!it.hasEOL,
          inv: nonWs === 0 ? 0 : matched === 0 ? -1 : hid / matched });
      }
      pages.push({ view: Array.from(page.view || [0, 0, 612, 792]), items });
      page.cleanup();
    }
    return { ok: true, kind: 'pdf', pages, numPages: doc.numPages };
  } finally {
    if (doc.loadingTask) await doc.loadingTask.destroy(); // pdf.js 6: у PDFDocumentProxy нет destroy()
  }
}

async function docx(data) {
  const mammoth = req('mammoth');
  const r = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return { ok: true, kind: 'docx', text: r.value };
}

(async () => {
  try {
    const data = new Uint8Array(workerData.data);
    const res = workerData.kind === 'pdf' ? await pdf(data) : await docx(data);
    parentPort.postMessage(res);
  } catch (e) {
    parentPort.postMessage({ ok: false, code: 'parse_failed', message: String((e && e.message) || e).slice(0, 300) });
  }
})();
`;

function workerBase(): string {
  // Точка разрешения пакетов для потока: корень приложения (cwd), где лежит node_modules.
  const base = path.join(process.cwd(), 'package.json');
  try {
    createRequire(base).resolve('unpdf');
  } catch {
    /* поток сам вернёт parse_failed с понятной ошибкой */
  }
  return base;
}

export function parseInWorker(
  kind: 'pdf' | 'docx',
  buf: Buffer,
  opts: { timeoutMs?: number; maxPages?: number } = {},
): Promise<WorkerResult> {
  const timeoutMs = opts.timeoutMs ?? LIMITS.parseTimeoutMs;
  // Копия в отдельный ArrayBuffer: передаём владение потоку.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Promise<WorkerResult>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { kind, data: copy.buffer, base: workerBase(), maxPages: opts.maxPages ?? LIMITS.pdfMaxPages },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: LIMITS.parseMaxHeapMb, maxYoungGenerationSizeMb: 64 },
      stdout: true,
      stderr: true,
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new AppError('parse_timeout', 'Файл разбирается слишком долго', 422))),
      timeoutMs,
    );
    worker.once('message', (msg: WorkerResult) => finish(() => resolve(msg)));
    worker.once('error', (err) =>
      finish(() =>
        reject(
          /ERR_WORKER_OUT_OF_MEMORY/.test(String((err as NodeJS.ErrnoException).code ?? err.message))
            ? new AppError('parse_failed', 'Файл слишком сложный для разбора', 422)
            : new AppError('parse_failed', 'Не удалось разобрать файл', 422),
        ),
      ),
    );
    worker.once('exit', (code) => finish(() => reject(new AppError('parse_failed', `Разбор прерван (${code})`, 422))));
  });
}
