// Фикстуры файлов для матрицы инструментов. Запуск из platform/: node eval/tools-matrix/make-fixtures.mjs
// PDF берём готовые из eval/pdf, DOCX — textutil (macOS), XLSX — python3+openpyxl, PNG — sharp (SVG -> PNG).
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ev = join(here, '..');
const out = join(here, 'fixtures');
mkdirSync(out, { recursive: true });
const cp = (from, to) => copyFileSync(join(ev, from), join(out, to));

cp('resumes/b02.md', 'resume.md');
cp('resumes/b03.md', 'notes.txt');
cp('attacks/atk-resume-1.md', 'inject.md');

for (const [md, name] of [['resumes/b02.md', 'resume.docx'], ['attacks/atk-resume-1.md', 'inject.docx']]) {
  const tmp = join(out, `_${name}.txt`);
  writeFileSync(tmp, readFileSync(join(ev, md), 'utf8'));
  execFileSync('textutil', ['-convert', 'docx', '-output', join(out, name), tmp]);
  execFileSync('rm', [tmp]);
}

writeFileSync(join(out, 'skills.csv'), 'навык,лет,уровень\nPython,3,средний\nPostgreSQL,2,средний\nDocker,1,начальный\nKafka,0,знаком\n');
execFileSync('python3', ['-c', `
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Проекты'
ws.append(['проект','стек','роль','год'])
ws.append(['Бот расписания','Python, aiogram, PostgreSQL','автор',2024])
ws.append(['Сервис заявок','Java, Spring Boot','стажёр',2025])
wb.save('${join(out, 'projects.xlsx')}')
`]);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="100%" height="100%" fill="white"/>
<g font-family="Arial" font-size="26" fill="black"><text x="40" y="60" font-size="34">Резюме: Иван Петров, Python-разработчик</text>
<text x="40" y="120">Опыт: 2 года, Django, PostgreSQL, Docker</text><text x="40" y="170">Проект: интернет-магазин, REST API, тесты pytest</text>
<text x="40" y="220">Образование: СПбГУ, прикладная математика</text></g></svg>`;
await sharp(Buffer.from(svg)).png().toFile(join(out, 'scan.png'));
await sharp(Buffer.from(svg)).jpeg().toFile(join(out, 'scan.jpg'));

writeFileSync(join(out, 'empty.pdf'), '');
writeFileSync(join(out, 'broken.pdf'), 'это просто текст, а не PDF: Иван Петров, Python, 2 года');
copyFileSync(join(out, 'scan.png'), join(out, 'fake.docx'));
console.log('ok');
