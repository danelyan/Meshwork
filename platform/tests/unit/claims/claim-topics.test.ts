import { describe, expect, it } from 'vitest';

import catalog from '../../../prisma/seed/claims-catalog.json';
import { claimTopic, claimTopics, groupClaimsByQuote } from '@/lib/claim-topics';
import type { CardClaim } from '@/lib/claims-view';

const entries = (catalog as { entries: { id: string; statement: string }[] }).entries;
const st = (id: string) => entries.find((e) => e.id === id)!.statement;

describe('claimTopic', () => {
  it('после двоеточия', () => {
    expect(claimTopic('Получал данные с сервера: состояния загрузки и ошибки, отмена запросов, гонки ответов')).toBe('состояния загрузки и ошибки, отмена запросов, гонки ответов');
  });
  it('без двоеточия — убирает ведущий глагол', () => {
    expect(claimTopic('Строил раскладки на Flexbox и Grid')).toBe('раскладки на Flexbox и Grid');
    expect(claimTopic('Верстала макеты по Figma')).toBe('макеты по Figma');
    expect(claimTopic('Выбирал, где хранить состояние')).toBe('где хранить состояние');
  });
  it('не глагол прошедшего времени — пусто', () => {
    expect(claimTopic('Понимаю схемы входа')).toBe('');
    expect(claimTopic('')).toBe('');
  });
  it('реальный каталог: тема не пустая и не содержит исходного первого слова-глагола', () => {
    for (const e of entries) {
      const t = claimTopic(e.statement);
      if (/^(Понимаю|Знаю|Умею)/.test(e.statement)) continue;
      expect(t, e.id).not.toBe('');
      expect(t.startsWith(e.statement.split(/\s/)[0]!), e.id).toBe(false);
    }
  });
  it('реальные записи fe.responsive и fe.css-layout', () => {
    expect(claimTopic(st('fe.css-layout'))).toBe('раскладки на Flexbox и Grid');
    expect(claimTopic(st('fe.responsive'))).toMatch(/^медиазапросы/);
  });
});

describe('claimTopics', () => {
  it('убирает совпадающее с цитатой и повторы', () => {
    expect(claimTopics([{ statement: 'Делал X: тема А', quote: 'тема а' }])).toBe('');
    expect(claimTopics([{ statement: 'Делал X: А', quote: 'q' }, { statement: 'Писал Y: А', quote: 'q' }, { statement: 'Писал Z: Б', quote: 'q' }])).toBe('А; Б');
  });
});

const c = (id: string, quote: string, status: CardClaim['status'] = 'proposed', level: CardClaim['level'] = 'self_reported'): CardClaim => ({
  id, statement: 's' + id, quote, sourceRef: '', level, limits: '', status,
});

describe('groupClaimsByQuote', () => {
  it('склеивает одинаковую нормализованную цитату, порядок по первому вхождению', () => {
    const g = groupClaimsByQuote([c('1', 'Верстала, адаптивно.'), c('2', 'Другая цитата'), c('3', 'верстала адаптивно')]);
    expect(g.map((x) => x.map((y) => y.id))).toEqual([['1', '3'], ['2']]);
  });
  it('разные статусы/уровни и пустые цитаты не склеиваются', () => {
    const g = groupClaimsByQuote([c('1', 'q q', 'proposed'), c('2', 'q q', 'confirmed'), c('3', 'q q', 'proposed', 'artifact' as CardClaim['level']), c('4', ''), c('5', '')]);
    expect(g).toHaveLength(5);
  });
});
