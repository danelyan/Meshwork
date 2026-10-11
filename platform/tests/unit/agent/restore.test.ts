import { humanizeUserText, pendingAskOf } from '@/server/agent/restore';

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

describe('pendingAskOf', () => {
  const askRow = { role: 'assistant', toolCalls: [{ id: 'c1', name: 'ask_user', arguments: { question: 'Какой грейд?', options: ['Junior', 'Middle'] } }] };

  it('вопрос без ответа поднимается событием ask с вариантами', () => {
    const rows = [{ role: 'user', toolCalls: null }, askRow, { role: 'tool', toolCalls: null }];
    expect(pendingAskOf(rows)).toEqual({ type: 'ask', question: 'Какой грейд?', options: ['Junior', 'Middle'] });
  });

  it('отвеченный вопрос (после него реплика кандидата) не поднимается', () => {
    expect(pendingAskOf([askRow, { role: 'tool', toolCalls: null }, { role: 'user', toolCalls: null }])).toBeNull();
  });

  it('результат другого инструмента вопросом не считается', () => {
    const other = { role: 'assistant', toolCalls: [{ id: 'c2', name: 'read_upload', arguments: {} }] };
    expect(pendingAskOf([other, { role: 'tool', toolCalls: null }])).toBeNull();
  });
});
