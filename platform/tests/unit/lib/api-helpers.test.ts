import { MAX_UPLOAD_BYTES, parseUrls, validateUploadFile } from '@/lib/api';
import { normalizeClaim, normalizeRecommendation } from '@/lib/claims-view';

describe('validateUploadFile', () => {
  it('принимает PDF и DOCX в пределах лимита', () => {
    expect(validateUploadFile({ name: 'cv.pdf', size: 1000 })).toBeNull();
    expect(validateUploadFile({ name: 'CV.DOCX', size: MAX_UPLOAD_BYTES })).toBeNull();
  });
  it('отклоняет больше 5 МБ с понятным текстом', () => {
    expect(validateUploadFile({ name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1 })).toContain('5 МБ');
  });
  it('отклоняет чужой тип и пустой файл', () => {
    expect(validateUploadFile({ name: 'a.exe', size: 10 })).toContain('PDF и DOCX');
    expect(validateUploadFile({ name: 'a.pdf', size: 0 })).toContain('пустой');
  });
});

describe('parseUrls', () => {
  it('делит по пробелам, запятым и строкам, добавляет https', () => {
    const r = parseUrls('github.com/x, https://codeforces.com/profile/y\nexample.org/a');
    expect(r.invalid).toEqual([]);
    expect(r.urls).toEqual(['https://github.com/x', 'https://codeforces.com/profile/y', 'https://example.org/a']);
  });
  it('дубликаты схлопывает, мусор и чужие схемы отбрасывает', () => {
    const r = parseUrls('github.com/x github.com/x javascript:alert(1) ftp://a.b/c слово');
    expect(r.urls).toEqual(['https://github.com/x']);
    expect(r.invalid).toEqual(['javascript:alert(1)', 'ftp://a.b/c', 'слово']);
  });
  it('пустая строка', () => {
    expect(parseUrls('  ')).toEqual({ urls: [], invalid: [] });
  });
});

describe('нормализация данных агента', () => {
  it('утверждение без id или формулировки отбрасывается', () => {
    expect(normalizeClaim({ statement: 'x' })).toBeNull();
    expect(normalizeClaim({ id: '1' })).toBeNull();
    expect(normalizeClaim(null)).toBeNull();
  });
  it('неизвестный уровень и статус приводятся к безопасным', () => {
    const c = normalizeClaim({ id: '1', statement: 's', level: 'hacked', status: 'weird' });
    expect(c).toMatchObject({ level: 'self_reported', status: 'proposed', quote: '' });
  });
  it('рекомендации разных видов', () => {
    expect(normalizeRecommendation({ taskId: 't', title: 'Задача', family: 'api', grade: 'junior' }, 0)?.kind).toBe('task');
    const t = normalizeRecommendation({ vacancyId: 'v', title: 'Dev', companyName: 'ACME', covered: 2, total: 5, missing: [{ statement: 'Docker' }] }, 0);
    expect(t).toMatchObject({ kind: 'target', meta: 'закрываешь 2 из 5', missing: ['Docker'] });
    expect(normalizeRecommendation({ specialization: 'backend', grade: 'middle', allowed: false, reason: 'r' }, 0)).toMatchObject({ kind: 'test', meta: 'сейчас недоступен' });
    expect(normalizeRecommendation({}, 0)).toBeNull();
  });
});
