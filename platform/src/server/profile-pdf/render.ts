// Отрисовка ProfileDocument в PDF через pdfkit (docs: pdfkit.org/docs/text.html – встроенные TTF-шрифты,
// getting_started – опция `font` конструктора и сбор вывода через события потока).
// Кириллица требует встроенного шрифта: DejaVu Sans из public/assets/fonts (лицензия рядом, DejaVu-LICENSE.txt).
// Путь – от process.cwd(): в Docker runner копирует public/ в /app, в vitest cwd = platform/.
import { join } from 'node:path';

import PDFDocument from 'pdfkit';

import type { DocSection, ProfileDocument } from './model';

const FONT_DIR = join(process.cwd(), 'public', 'assets', 'fonts');
export const FONT_REGULAR = join(FONT_DIR, 'DejaVuSans.ttf');
export const FONT_BOLD = join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const MUTED = '#555555';
const INK = '#111111';
const RULE = '#cccccc';

function section(pdf: PDFKit.PDFDocument, s: DocSection, width: number): void {
  pdf.moveDown(0.9);
  pdf.font('bold').fontSize(12).fillColor(INK).text(s.title, { width });
  const y = pdf.y + 2;
  pdf.moveTo(pdf.x, y).lineTo(pdf.x + width, y).lineWidth(0.5).strokeColor(RULE).stroke();
  pdf.moveDown(0.4);
  pdf.fontSize(10);
  for (const f of s.facts ?? []) {
    pdf.font('bold').fillColor(INK).text(`${f.label}: `, { continued: true, width });
    pdf.font('regular').text(f.value, { width });
  }
  if (s.items?.length) {
    if (s.facts?.length) pdf.moveDown(0.2);
    pdf.font('regular').fillColor(INK);
    for (const item of s.items) pdf.text(`•  ${item}`, { width, indent: 0, paragraphGap: 2 });
  } else if (s.empty && !s.facts?.length) {
    pdf.font('regular').fillColor(MUTED).text(s.empty, { width });
  }
  if (s.note) {
    pdf.moveDown(0.2);
    pdf.font('regular').fontSize(8).fillColor(MUTED).text(s.note, { width });
  }
}

/** PDF целиком в памяти: профиль – одна-две страницы, потоковая отдача не нужна. */
export function renderProfilePdf(doc: ProfileDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 48,
    // Свой шрифт по умолчанию: pdfkit не трогает AFM-файлы стандартных шрифтов (их нет в standalone-сборке).
    font: FONT_REGULAR,
    info: { Title: `${doc.title} – ${doc.brand}`, Author: doc.brand, Producer: doc.brand, CreationDate: new Date() },
    pdfVersion: '1.5',
    lang: 'ru-RU',
  });
  pdf.registerFont('regular', FONT_REGULAR);
  pdf.registerFont('bold', FONT_BOLD);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  pdf.font('bold').fontSize(9).fillColor(MUTED).text(doc.brand.toUpperCase(), { width, characterSpacing: 1 });
  pdf.moveDown(0.3);
  pdf.font('bold').fontSize(20).fillColor(INK).text(doc.title, { width });
  pdf.font('regular').fontSize(9).fillColor(MUTED).text(`Сформировано ${doc.generatedAt}`, { width });
  pdf.moveDown(1);
  pdf.font('bold').fontSize(15).fillColor(INK).text(doc.name, { width });
  pdf.font('regular').fontSize(10).fillColor(MUTED).text(doc.headline, { width });

  for (const s of doc.sections) section(pdf, s, width);

  pdf.moveDown(1.2);
  pdf.font('regular').fontSize(8).fillColor(MUTED).text(doc.footer, { width });
  pdf.end();
  return done;
}
