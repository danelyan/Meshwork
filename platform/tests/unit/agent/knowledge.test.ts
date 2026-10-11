import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { dispatchToolCall } from '@/server/agent/dispatch';
import { buildCorpusSource } from '@/server/agent/knowledge/build';
import { KNOWLEDGE_DOCS } from '@/server/agent/knowledge/corpus';
import { parseDoc, parseFacts } from '@/server/agent/knowledge/parse';
import { clip, KNOWLEDGE_TEXT_MAX, searchKnowledge, stem, tokens } from '@/server/agent/knowledge/search';
import { searchKnowledgeTool } from '@/server/agent/knowledge/tool';

const root = process.cwd();
const facts = readFileSync(path.join(root, 'src/server/agent/prompts/platform-facts.md'), 'utf8');
const kdir = path.join(root, 'src/server/agent/knowledge/docs');

describe('база знаний: документы и корпус', () => {
  it('corpus.ts собран из docs/*.md и platform-facts.md (источник правды – .md)', () => {
    const docs = readdirSync(kdir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ docId: f.replace(/\.md$/, ''), md: readFileSync(path.join(kdir, f), 'utf8') }));
    expect(readFileSync(path.join(root, 'src/server/agent/knowledge/corpus.ts'), 'utf8')).toBe(buildCorpusSource(facts, docs).source);
  });

  it('факты платформы – один из документов: пункт F<n> = секция F<n>, без дубля текста', () => {
    const doc = parseFacts(facts);
    expect(doc.docId).toBe('platform-facts');
    expect(doc.sections.map((s) => s.sectionId)).toEqual(doc.sections.map((_, i) => `F${i + 1}`));
    expect(doc.sections[0]!.title).toBe('Подбор и приглашения');
    expect(doc.sections[0]!.text).toMatch(/^Механика обратная/);
    expect(KNOWLEDGE_DOCS[0]).toEqual(doc);
  });

  it('документ: секции с id, комментарии не попадают, без id – ошибка', () => {
    const d = parseDoc('x', '<!-- источник -->\n# Док\n\n## Раз {#one}\nтекст\nещё\n\n## Два {#two}\nдва\n');
    expect(d).toEqual({
      docId: 'x',
      title: 'Док',
      sections: [
        { docId: 'x', sectionId: 'one', title: 'Раз', text: 'текст\nещё' },
        { docId: 'x', sectionId: 'two', title: 'Два', text: 'два' },
      ],
    });
    expect(() => parseDoc('x', '# Док\n## Без id\nтекст')).toThrow(/нет id/);
    expect(() => parseDoc('x', '# Док\n## А {#a}\n1\n## Б {#a}\n2')).toThrow(/повтор/);
    expect(() => parseDoc('x', '## А {#a}\nтекст')).toThrow(/заголовка/);
  });

  it('в базе нет заданий теста и ключей', () => {
    const all = JSON.stringify(KNOWLEDGE_DOCS);
    expect(all).not.toMatch(/paramSpace|instanceSeed|irtB|answerKey/);
  });
});

describe('лексический поиск', () => {
  it('стемминг сводит формы слова к одной основе', () => {
    expect(stem('приглашение')).toBe(stem('приглашения'));
    expect(stem('задания')).toBe(stem('заданий'));
    expect(stem('Ёлками')).toBe(stem('елками'));
    expect(stem('PostgreSQL')).toBe('postgresql');
    expect(tokens('Что и как в тесте?')).toEqual(['тест']);
  });

  it.each([
    ['Через сколько можно пересдать тест?', 'grade-test', 'retake'],
    ['есть ли премиум подписка', 'faq', 'premium'],
    ['сколько хранится профиль после удаления', 'faq', 'retention'],
    ['что видит работодатель до принятия приглашения', 'faq', 'name'],
    ['влияет ли ожидаемая зарплата на место в подборке', 'faq', 'salary'],
    ['откликнуться на вакансию', 'faq', 'apply'],
  ])('«%s» → %s#%s в топ-3', (q, doc, section) => {
    const hits = searchKnowledge(q);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.map((h) => `${h.docId}#${h.sectionId}`)).toContain(`${doc}#${section}`);
  });

  it('как поднять уровень: секция про «проверено платформой» среди найденных', () => {
    expect(searchKnowledge('как поднять уровень до проверено платформой').map((h) => h.sectionId)).toContain('to-platform');
  });

  it('пустой или бессмысленный запрос – пусто; текст секции ≤ 1200 символов', () => {
    expect(searchKnowledge('и что как')).toEqual([]);
    expect(searchKnowledge('zzzqqq')).toEqual([]);
    for (const h of searchKnowledge('тест грейд категория уровень работодатель')) expect(h.text.length).toBeLessThanOrEqual(KNOWLEDGE_TEXT_MAX + 1);
    const long = `${'Предложение. '.repeat(200)}`;
    expect(clip(long).length).toBeLessThanOrEqual(KNOWLEDGE_TEXT_MAX + 1);
    expect(clip(long).endsWith('.…')).toBe(true);
  });

  it('поиск по своему набору документов (BM25: заголовок весит больше текста)', () => {
    const docs = [
      { docId: 'a', title: 'А', sections: [{ docId: 'a', sectionId: 's1', title: 'Про кошек', text: 'собаки собаки' }] },
      { docId: 'b', title: 'Б', sections: [{ docId: 'b', sectionId: 's2', title: 'Про собак', text: 'кошки' }] },
    ];
    expect(searchKnowledge('собаки', { docs })[0]!.sectionId).toBe('s2');
  });
});

describe('инструмент search_knowledge', () => {
  it('возвращает секции {docId, sectionId, title, text}, результат не помечен untrusted', async () => {
    expect(searchKnowledgeTool.untrusted).toBeFalsy();
    const r = await dispatchToolCall([searchKnowledgeTool], {}, { id: 'c1', name: 'search_knowledge', arguments: { query: 'пересдача теста' } });
    expect(r.ok).toBe(true);
    expect(r.content.startsWith('{')).toBe(true);
    const out = r.output as { sections: { docId: string; sectionId: string; title: string; text: string }[] };
    expect(out.sections[0]).toEqual(expect.objectContaining({ docId: 'grade-test', sectionId: 'retake' }));
    expect(Object.keys(out.sections[0]!).sort()).toEqual(['docId', 'sectionId', 'text', 'title']);
  });

  it('ничего не нашлось – пустой список и подсказка сказать «не знаю»; короткий запрос – ошибка аргументов', async () => {
    const r = await dispatchToolCall([searchKnowledgeTool], {}, { id: 'c1', name: 'search_knowledge', arguments: { query: 'zzzqqq' } });
    expect(r.output).toEqual({ sections: [], note: expect.stringMatching(/нет/) });
    const bad = await dispatchToolCall([searchKnowledgeTool], {}, { id: 'c2', name: 'search_knowledge', arguments: { query: 'a' } });
    expect(bad.errorCode).toBe('invalid_arguments');
  });
});
