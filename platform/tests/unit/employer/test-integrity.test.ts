import { loadTestIntegrity, publicIntegrity } from '@/server/employer/test-integrity';

const findMany = vi.fn();
vi.mock('@/server/db', () => ({ prisma: { testAttempt: { findMany: (...a: unknown[]) => findMany(...a) } } }));

const reason = (code: string, group: string) => ({ code, group, detail: 'секретная деталь: 12 с при лимите 90 с' });

afterEach(() => findMany.mockReset());

describe('publicIntegrity: проекция индекса честности для работодателя', () => {
  it('без причин - low, без групп', () => {
    expect(publicIntegrity({ level: 'low', reasons: [] })).toEqual({ level: 'low', groups: [], confirmedAgain: false });
  });

  it('только превышение лимита времени замечанием не считается', () => {
    expect(publicIntegrity({ level: 'medium', reasons: [reason('overtime', 'time')] })).toEqual({ level: 'low', groups: [], confirmedAgain: false });
  });

  it('группы без деталей; ловушка наружу не называется, но уровень сохраняется', () => {
    const v = publicIntegrity({ level: 'high', reasons: [reason('tab_away', 'browser'), reason('overtime', 'time'), reason('fast_correct_hard', 'time'), reason('canary_hit', 'canary')] });
    expect(v).toEqual({ level: 'high', groups: ['browser', 'time'], confirmedAgain: false });
    expect(JSON.stringify(v)).not.toContain('секретная');
  });

  it('подтверждён повторно: confirmedBy в индексе или признак от вызывающего', () => {
    expect(publicIntegrity({ level: 'high', reasons: [reason('paste', 'browser'), reason('fast_correct_hard', 'time')], confirmedBy: 'att2' })?.confirmedAgain).toBe(true);
    expect(publicIntegrity({ level: 'high', reasons: [reason('paste', 'browser')] }, true)?.confirmedAgain).toBe(true);
  });

  it('нет индекса или мусор - null, а не «без замечаний»', () => {
    expect(publicIntegrity(null)).toBeNull();
    expect(publicIntegrity([])).toBeNull();
    expect(publicIntegrity({ level: 'strange' })).toBeNull();
  });
});

describe('loadTestIntegrity: попытка, давшая категорию', () => {
  const cat = { specialization: 'backend', grade: 'middle', subcategoryId: 'backend.web-api' } as const;
  const base = { specialization: 'backend', grade: 'middle', subcategoryId: 'backend.web-api', kind: 'grade', confirmsAttemptId: null };

  it('берёт последнюю пройденную попытку той же категории, чужой грейд пропускает', async () => {
    findMany.mockResolvedValueOnce([
      { ...base, candidateId: 'c1', grade: 'senior', integrity: { level: 'high', reasons: [reason('paste', 'browser')] } },
      { ...base, candidateId: 'c1', integrity: { level: 'low', reasons: [] } },
      { ...base, candidateId: 'c1', integrity: { level: 'high', reasons: [reason('paste', 'browser')] } },
    ]);
    const out = await loadTestIntegrity(new Map([['c1', cat]]));
    expect(out.get('c1')).toEqual({ level: 'low', groups: [], confirmedAgain: false });
  });

  it('подтверждающая попытка отдаёт индекс исходной с пометкой «повторно»', async () => {
    findMany
      .mockResolvedValueOnce([{ ...base, candidateId: 'c1', kind: 'confirm', confirmsAttemptId: 's1', integrity: { level: 'low', reasons: [] } }])
      .mockResolvedValueOnce([{ id: 's1', integrity: { level: 'high', reasons: [reason('tab_away', 'browser'), reason('fast_correct_hard', 'time')] } }]);
    const out = await loadTestIntegrity(new Map([['c1', cat]]));
    expect(out.get('c1')).toEqual({ level: 'high', groups: ['browser', 'time'], confirmedAgain: true });
  });

  it('кандидат без категории или без попытки - записи нет, запрос не идёт без кандидатов', async () => {
    expect((await loadTestIntegrity(new Map([['c1', null]]))).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    findMany.mockResolvedValueOnce([]);
    expect((await loadTestIntegrity(new Map([['c2', cat]]))).size).toBe(0);
  });
});
