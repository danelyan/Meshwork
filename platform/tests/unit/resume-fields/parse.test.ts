// R-C-01/02: распознавание ФИО, контакта, стажа, ролей и софт-скиллов в резюме (детерминированно, без LLM).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractFile } from '@/server/collector/files';
import { rawContactLines } from '@/server/collector/doc';
import { cleanRole, parseResumeFields, parseResumeText } from '@/server/resume-fields/parse';

const NOW = new Date('2026-10-11T12:00:00+03:00');
const byKey = (fs: ReturnType<typeof parseResumeText>) => Object.fromEntries(fs.map((f) => [f.key, f]));

describe('parseResumeText – демо-резюме eval/demo/demo-1', () => {
  const text = readFileSync(join(process.cwd(), 'eval/demo/demo-1/resume.md'), 'utf8');
  const f = byKey(parseResumeText(text, 'demo-1.md', NOW));

  it('ФИО из заголовка, контакт – почта', () => {
    expect(f.name?.value).toBe('Дмитрий Рябинин');
    expect(f.contact?.value).toBe('dmitry.ryabinin@example.com');
  });

  it('стаж – объединение периодов 2020–2022 и 2022–2026, цитата – дословная строка', () => {
    expect(f.experienceYears?.value).toBe(6);
    expect(text).toContain(f.experienceYears!.quote);
  });

  it('роли без названий компаний', () => {
    expect(f.roles?.value).toEqual(['Backend Engineer']);
    expect(JSON.stringify(f.roles?.value)).not.toMatch(/ПэйФлоу|Лавка/);
  });

  it('софт-скиллы – метки словаря с цитатой', () => {
    expect(f.softSkills?.value).toContain('Код-ревью и обратная связь');
    expect(f.softSkills?.quote).toContain('ревью');
  });
});

describe('parseResumeText – явный стаж словами', () => {
  it('«Полтора года пишу…» → 1, роль из заголовка', () => {
    const f = byKey(parseResumeText('# Марина Котова – Junior Backend (Node.js)\n\nmarina@example.com · Екатеринбург\n\nПолтора года пишу серверную часть небольших сервисов на NestJS.', 'r.md', NOW));
    expect(f.experienceYears?.value).toBe(1);
    expect(f.roles?.value).toEqual(['Junior Backend']);
  });
  it('«Опыт коммерческой разработки – 5 лет»', () => {
    expect(byKey(parseResumeText('Иван Петров\nОпыт коммерческой разработки – 5 лет', 'r.md', NOW)).experienceYears?.value).toBe(5);
  });
  it('нет данных – нет полей (не выдумываем)', () => {
    expect(parseResumeText('Python, SQL, Git.', 'r.md', NOW)).toEqual([]);
  });
});

describe('cleanRole', () => {
  it('убирает компанию, скрытые контакты и период; без слова должности – null', () => {
    expect(cleanRole('Backend-разработчик в Яндексе')).toBe('Backend-разработчик');
    expect(cleanRole('«Сбер», Team Lead (2021 – н.в.)')).toBe('Team Lead');
    expect(cleanRole('Junior → Middle')).toBeNull();
  });
});

describe('загрузка файла: контакт из немаскированных строк, в ExtractedDoc он скрыт', () => {
  it('extractFile маскирует почту в lines/text, а rawContactLines отдаёт её только в памяти', async () => {
    const md = '# Анна Смирнова – Frontend-разработчик\n\nanna.smirnova@example.com · tg @anna_dev\n\nОпыт 3 года.\n';
    const doc = await extractFile(Buffer.from(md), 'cv.md', 'text/markdown', { sourceKind: 'resume' });
    expect(JSON.stringify(doc)).not.toContain('anna.smirnova@example.com');
    const f = byKey(parseResumeFields(doc, rawContactLines(doc), NOW));
    expect(f.contact?.value).toBe('anna.smirnova@example.com');
    expect(f.name?.value).toBe('Анна Смирнова');
    expect(f.experienceYears?.value).toBe(3);
    // из БД (повторная загрузка) немаскированных строк нет – контакт не распознаётся, остальное да
    const fromDb = JSON.parse(JSON.stringify(doc));
    expect(byKey(parseResumeFields(fromDb, rawContactLines(fromDb), NOW)).contact).toBeUndefined();
  });
});
