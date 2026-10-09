import { LEVEL_LABEL, waysUp, whyLevel } from '@/server/agent/tools/explain_evidence';

describe('explain_evidence: пути и объяснение уровня (ADR-0001)', () => {
  it('со слов → артефакт ссылкой, платформа — только пути из каталога', () => {
    const w = waysUp('self_reported', ['task:payment-retry', 'interview:defend']);
    expect(w.map((x) => `${x.toLevel}:${x.kind}`)).toEqual(['artifact:link_account', 'platform:task', 'platform:interview']);
    expect(w[1]?.taskId).toBe('task:payment-retry');
  });

  it('нет задания и защиты в каталоге — пути на platform нет', () => {
    expect(waysUp('artifact', []).map((x) => x.toLevel)).toEqual([]);
  });

  it('реестр ФСП — единственный путь к третьей стороне', () => {
    expect(waysUp('platform', ['registry:fsp-algo', 'task:complexity'])).toEqual([
      expect.objectContaining({ toLevel: 'third_party', kind: 'link_account' }),
    ]);
    expect(waysUp('third_party', ['registry:fsp-algo'])).toEqual([]);
  });

  it('объяснение по типу источника, ярлыки на русском', () => {
    expect(whyLevel('self_reported', 'resume')).toMatch(/резюме/);
    expect(whyLevel('self_reported', 'chat')).toMatch(/чате/);
    expect(whyLevel('artifact', 'github')).toMatch(/артефакт/);
    expect(LEVEL_LABEL.platform).toBe('проверено платформой');
  });
});
