import { LEVEL_LABEL, waysUp, whyLevel } from '@/server/agent/tools/explain_evidence';

describe('explain_evidence: пути и объяснение уровня (ADR-0001)', () => {
  it('со слов → артефакт ссылкой, платформа – только пути из каталога', () => {
    const w = waysUp('self_reported', ['task:payment-retry', 'interview:defend']);
    expect(w.map((x) => `${x.toLevel}:${x.kind}`)).toEqual(['artifact:link_account', 'platform:task', 'platform:interview']);
    expect(w[1]?.taskId).toBe('task:payment-retry');
  });

  it('нет задания и защиты в каталоге – пути на platform нет', () => {
    expect(waysUp('artifact', []).map((x) => x.toLevel)).toEqual([]);
  });

  it('реестр ФСП – единственный путь к третьей стороне; пути по возрастанию уровня', () => {
    expect(waysUp('artifact', ['registry:fsp-algo', 'task:complexity']).map((x) => `${x.toLevel}:${x.kind}`)).toEqual([
      'third_party:link_account',
      'platform:task',
    ]);
  });

  it('платформа – верхний уровень (решение 09.10): с неё путей нет, третью сторону не предлагаем', () => {
    expect(waysUp('platform', ['registry:fsp-algo', 'task:complexity', 'interview:defend'])).toEqual([]);
  });

  it('третья сторона: тест и защита поднимают до платформы (решение 09.10), реестр не предлагаем', () => {
    expect(waysUp('third_party', ['registry:fsp-algo', 'task:complexity', 'interview:defend']).map((x) => `${x.toLevel}:${x.kind}`)).toEqual([
      'platform:task',
      'platform:interview',
    ]);
  });

  it('объяснение по типу источника, ярлыки на русском', () => {
    expect(whyLevel('self_reported', 'resume')).toMatch(/резюме/);
    expect(whyLevel('self_reported', 'chat')).toMatch(/чате/);
    expect(whyLevel('artifact', 'github')).toMatch(/артефакт/);
    expect(LEVEL_LABEL.platform).toBe('проверено платформой');
  });
});
