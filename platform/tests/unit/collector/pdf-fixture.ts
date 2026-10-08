/**
 * Минимальный генератор PDF для тестов сборщика: стандартный шрифт Helvetica
 * (не встраивается, латиница), явные операторы цвета/кегля/режима отрисовки.
 */
export interface PdfLine {
  text: string;
  size?: number;
  x?: number;
  y: number;
  /** 'rg' r g b (0..1) */
  rgb?: [number, number, number];
  /** 'g' — оттенок серого (0..1) */
  gray?: number;
  /** Tr: 3 — невидимый текст */
  mode?: number;
  /** альфа заливки через ExtGState /GS0 (ca) */
  transparent?: boolean;
}

const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);

export function makePdf(pages: PdfLine[][]): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  const n = pages.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /ExtGState /ca 0 >>');
  pages.forEach((lines, i) => {
    const ops = lines
      .map((l) => {
        const color = l.gray !== undefined ? `${l.gray} g` : `${(l.rgb ?? [0, 0, 0]).join(' ')} rg`;
        const gs = l.transparent ? '/GS0 gs ' : '';
        const tr = l.mode !== undefined ? `${l.mode} Tr ` : '';
        return `q ${gs}${color} BT ${tr}/F1 ${l.size ?? 11} Tf ${l.x ?? 50} ${l.y} Td (${esc(l.text)}) Tj ET Q`;
      })
      .join('\n');
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /ExtGState << /GS0 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    );
    add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Простое резюме: видимые строки сверху вниз. */
export function resumePdf(visible: string[], extra: PdfLine[] = []): Buffer {
  return makePdf([[...visible.map((text, i) => ({ text, y: 780 - i * 16 })), ...extra]]);
}
