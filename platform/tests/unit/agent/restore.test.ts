import { humanizeUserText } from '@/server/agent/restore';

describe('humanizeUserText', () => {
  const names = new Map([['c1', 'resume.pdf'], ['c2', 'cv.docx']]);

  it('id вложений заменяются именами файлов, скобок нет', () => {
    expect(humanizeUserText('вот резюме\n[вложения: файл c1, файл c2]', names)).toBe('вот резюме\nВложения: resume.pdf, cv.docx');
  });

  it('неизвестный id не показывается', () => {
    expect(humanizeUserText('[вложения: файл zzz]', names)).toBe('Вложения: файл');
  });

  it('ссылки — обычным текстом', () => {
    expect(humanizeUserText('глянь\n[ссылки: https://a.dev https://b.dev]', names)).toBe('глянь\nСсылки: https://a.dev https://b.dev');
  });

  it('обычный текст не меняется', () => {
    expect(humanizeUserText('привет [вложения: тут]', names)).toBe('привет [вложения: тут]');
  });
});
