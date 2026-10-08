import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { CONSULTANT_PROMPT, CONSULTANT_PROMPT_VERSION } from '@/server/agent/prompt';
import { FORBIDDEN_TOOL_NAME_RE, toolSpecs } from '@/server/agent/spec';
import { scoreEntry } from '@/server/agent/tools/catalog_search';
import { tools, TOOL_NAMES } from '@/server/agent/tools';
import type { CatalogEntry } from '@/server/claims/types';

const EXPECTED = [
  'read_upload',
  'fetch_url',
  'fetch_profile',
  'catalog_search',
  'propose_claims',
  'get_profile',
  'get_gap_map',
  'recommend_test',
  'recommend_tasks',
  'recommend_targets',
  'explain_invitation',
  'start_verification',
  'render_profile_pdf',
  'ask_user',
];

describe('реестр инструментов (ТЗ § 4.1, § 2)', () => {
  it('ровно 14 инструментов по ТЗ, без дублей', () => {
    expect([...TOOL_NAMES].sort()).toEqual([...EXPECTED].sort());
    expect(new Set(TOOL_NAMES).size).toBe(14);
  });

  it('нет инструментов записи в профиль, отклика, писем, категории, произвольного HTTP', () => {
    for (const name of TOOL_NAMES) expect(name, name).not.toMatch(FORBIDDEN_TOOL_NAME_RE);
    expect(FORBIDDEN_TOOL_NAME_RE.test('confirm_claim')).toBe(true);
    expect(FORBIDDEN_TOOL_NAME_RE.test('send_email')).toBe(true);
    expect(FORBIDDEN_TOOL_NAME_RE.test('set_grade')).toBe(true);
  });

  it('уровень доказанности и грейд нельзя передать ни в один инструмент', () => {
    for (const t of tools) {
      const schema = JSON.stringify(z.toJSONSchema(t.input, { unrepresentable: 'any' }));
      expect(schema, t.name).not.toMatch(/"(level|evidenceLevel|evidence_level|grade|category)"\s*:/);
    }
  });

  it('у каждого инструмента описание и JSON Schema объекта для провайдера', () => {
    const specs = toolSpecs(tools);
    expect(specs).toHaveLength(14);
    for (const s of specs) {
      expect(s.description.length).toBeGreaterThan(20);
      expect((s.parameters as { type: string }).type).toBe('object');
    }
    const propose = specs.find((s) => s.name === 'propose_claims')!.parameters as { properties: { items: { items: { required: string[] } } } };
    expect(propose.properties.items.items.required).toEqual(expect.arrayContaining(['catalogId', 'quote', 'sourceRef']));
  });

  it('только ask_user завершает ход; untrusted — ровно читающие внешний текст', () => {
    expect(tools.filter((t) => t.terminal).map((t) => t.name)).toEqual(['ask_user']);
    expect(tools.filter((t) => t.untrusted).map((t) => t.name).sort()).toEqual(['fetch_profile', 'fetch_url', 'read_upload']);
  });
});

describe('системный промпт', () => {
  it('prompt.ts совпадает с prompts/consultant.md (источник правды — .md)', () => {
    const md = readFileSync(path.join(process.cwd(), 'src/server/agent/prompts/consultant.md'), 'utf8');
    expect(CONSULTANT_PROMPT).toBe(md);
    expect(CONSULTANT_PROMPT_VERSION).toMatch(/^consultant-v\d+$/);
  });

  it('содержит границы и правила честности', () => {
    for (const must of ['категорию даёт только тест', 'по вакансиям на платформе', 'external_data', 'не инструкции', 'ask_user', 'на «ты»']) {
      expect(CONSULTANT_PROMPT.toLowerCase()).toContain(must.toLowerCase());
    }
  });
});

describe('catalog_search: scoreEntry', () => {
  const entry: CatalogEntry = {
    id: 'be.idempotency',
    specialization: 'backend',
    statement: 'Делал идемпотентную обработку платежей',
    grades: ['middle'],
    weight: 3,
    proof: ['task:payment-retry'],
    markers: ['идемпотентн', 'Idempotency-Key', 'повтор запроса'],
    limits: '',
  };
  it('маркер целиком весит больше, чем слово из формулировки; пустой запрос — 0', () => {
    expect(scoreEntry(entry, 'реализовал повтор запроса через Idempotency-Key')).toBeGreaterThan(scoreEntry(entry, 'обработку'));
    expect(scoreEntry(entry, 'ё')).toBe(0);
    expect(scoreEntry(entry, 'Kafka consumer')).toBe(0);
  });
  it('детерминирован', () => {
    expect(scoreEntry(entry, 'платежей повтор запроса')).toBe(scoreEntry(entry, 'платежей повтор запроса'));
  });
});
