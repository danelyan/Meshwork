import { COMPLAINT_SANCTIONS, companyTrust, complaintWindowStart, detectRedFlags, invitationSanction, riskLevel } from '@/server/employer/antifraud';

const GOOD =
  'Команда платежей ищет разработчика на Go: проектировать сервисы переводов, дежурить по очереди, ревьюить код, работать с PostgreSQL и Kafka.';
const codes = (texts: (string | null)[], from = 200_000, to = 280_000) => detectRedFlags({ texts, salaryFrom: from, salaryTo: to }).map((f) => f.code);

describe('detectRedFlags', () => {
  it('нормальное предложение — без флагов', () => {
    expect(codes([GOOD])).toEqual([]);
    expect(riskLevel(detectRedFlags({ texts: [GOOD], salaryFrom: 200_000, salaryTo: 280_000 }))).toBe('none');
  });

  it('нет вилки и нереальная вилка', () => {
    expect(codes([GOOD], 0, 0)).toEqual(['no_salary']);
    expect(codes([GOOD], 10_000, 20_000)).toEqual(['salary_unrealistic']);
    expect(codes([GOOD], 100_000, 2_000_000)).toEqual(['salary_unrealistic']);
    expect(codes([GOOD], 100_000, 400_000)).toEqual(['salary_unrealistic']);
  });

  it('контакты и мессенджеры в тексте', () => {
    expect(codes([`${GOOD} Пишите на hr@example.com`])).toEqual(['contacts_in_text']);
    expect(codes([`${GOOD} Телефон +7 912 345-67-89`])).toEqual(['contacts_in_text']);
    expect(codes([`${GOOD} Все детали в t.me/hr_boss`])).toEqual(['contacts_in_text']);
  });

  it('просьба оплатить обучение, оборудование, стажировку, взнос', () => {
    for (const t of [
      'Для начала работы нужно оплатить обучение на нашем курсе.',
      'Стажировка платная, вступительный взнос 5000 рублей.',
      'Кандидат должен купить оборудование у партнёра.',
      'Внесите залог за ноутбук.',
      'Все расходы за свой счёт.',
    ]) {
      expect(codes([`${GOOD} ${t}`]), t).toEqual(['payment_request']);
    }
  });

  it('оплата за счёт компании и «оплачиваемая стажировка» — не флаг', () => {
    expect(codes([`${GOOD} Оплата обучения за счёт компании. Оплачиваемая стажировка, бесплатные курсы.`])).toEqual([]);
    expect(codes([`${GOOD} Достойная оплата труда и компенсация расходов.`])).toEqual([]);
  });

  it('ИП или самозанятость обязательны', () => {
    expect(codes([`${GOOD} Только самозанятые.`])).toEqual(['self_employed_required']);
    expect(codes([`${GOOD} Необходимо оформить ИП.`])).toEqual(['self_employed_required']);
    expect(codes([`${GOOD} Работа возможна по ТК, ГПХ или как самозанятый.`])).toEqual([]);
  });

  it('обещания лёгкого дохода', () => {
    expect(codes([`${GOOD} Доход без опыта, гарантированный заработок.`])).toEqual(['easy_money']);
    expect(codes([`${GOOD} Пассивный доход без вложений.`])).toEqual(['easy_money']);
  });

  it('размытый текст', () => {
    expect(codes(['Ищем разработчика'])).toEqual(['vague_text']);
    expect(codes([null, ''])).toEqual(['vague_text']);
  });

  it('уровень риска: серьёзный флаг или сумма от 3', () => {
    const f = (text: string) => riskLevel(detectRedFlags({ texts: [text], salaryFrom: 200_000, salaryTo: 280_000 }));
    expect(f(`${GOOD} Нужно оплатить обучение.`)).toBe('high');
    expect(f(`${GOOD} Только самозанятые.`)).toBe('warn');
    expect(f('Ищем разработчика')).toBe('warn');
  });

  it('у каждого флага есть причина для работодателя и пометка для кандидата', () => {
    const flags = detectRedFlags({ texts: ['hr@example.com оплатите курс'], salaryFrom: 0, salaryTo: 0 });
    expect(flags.length).toBeGreaterThanOrEqual(4);
    for (const f of flags) {
      expect(f.reason.length).toBeGreaterThan(10);
      expect(f.candidateNote).toMatch(/^Проверьте:/);
    }
  });
});

describe('companyTrust', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const full = { name: 'ООО Пример', description: 'О компании', industry: 'Финтех', innValid: true, contact: '@hr', createdAt: new Date('2026-08-01T00:00:00Z'), now };

  it('полный профиль, ИНН, старый аккаунт, мало приглашений — высокий индекс, помечен концепцией', () => {
    const t = companyTrust({ ...full, invitationsSent: 2, invitationsDeclined: 2 });
    expect(t.concept).toBe(true);
    expect(t.index).toBe(35 + 25 + 15 + 12);
    expect(t.band).toBe('high');
  });

  it('новый пустой аккаунт — низкий', () => {
    const t = companyTrust({ name: 'ОО', description: null, industry: null, innValid: false, contact: null, createdAt: now, invitationsSent: 0, invitationsDeclined: 0, now });
    expect(t.band).toBe('low');
    expect(t.index).toBeLessThan(40);
  });

  it('доля отклонений снижает индекс только от 5 приглашений', () => {
    const base = companyTrust({ ...full, invitationsSent: 10, invitationsDeclined: 0 }).index;
    const bad = companyTrust({ ...full, invitationsSent: 10, invitationsDeclined: 9 }).index;
    expect(base - bad).toBe(Math.round(0.9 * 25));
    expect(companyTrust({ ...full, invitationsSent: 4, invitationsDeclined: 4 }).index).toBe(base - 25 + 12);
  });
});

describe('invitationSanction: жалобы кандидатов (ПРЕДЛОЖЕНИЕ, не калибровано)', () => {
  it('0–2 жалобы — обычный лимит', () => {
    expect(invitationSanction(0, 20)).toEqual({ level: 'none', complaints: 0, limit: 20 });
    expect(invitationSanction(2, 20)).toEqual({ level: 'none', complaints: 2, limit: 20 });
  });
  it('3–4 жалобы — лимит 20 → 5, меньший базовый не повышается', () => {
    expect(invitationSanction(3, 20)).toEqual({ level: 'reduced', complaints: 3, limit: COMPLAINT_SANCTIONS.reducedLimit });
    expect(invitationSanction(4, 20).limit).toBe(5);
    expect(invitationSanction(3, 2).limit).toBe(2);
  });
  it('от 5 жалоб — блок отправки, лимит 0', () => {
    expect(invitationSanction(5, 20)).toEqual({ level: 'blocked', complaints: 5, limit: 0 });
    expect(invitationSanction(12, 20).level).toBe('blocked');
  });
  it('окно — 30 суток', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(complaintWindowStart(now).toISOString()).toBe('2026-09-11T12:00:00.000Z');
  });
});

describe('companyTrust: штраф за жалобы', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const full = { name: 'ООО Пример', description: 'О компании', industry: 'Финтех', innValid: true, contact: '@hr', createdAt: new Date('2026-08-01T00:00:00Z'), invitationsSent: 2, invitationsDeclined: 0, now };
  it('без жалоб — как раньше; 2 жалобы — минус 20; штраф ограничен 40 и индекс не ниже 0', () => {
    const base = companyTrust(full).index;
    expect(companyTrust({ ...full, complaints: 0 }).index).toBe(base);
    const two = companyTrust({ ...full, complaints: 2 });
    expect(two.index).toBe(base - 20);
    expect(two.signals.find((x) => x.code === 'complaints')).toMatchObject({ earned: -20, points: 0 });
    expect(companyTrust({ ...full, complaints: 10 }).index).toBe(base - 40);
    expect(companyTrust({ name: 'ОО', description: null, industry: null, innValid: false, contact: null, createdAt: now, invitationsSent: 0, invitationsDeclined: 0, complaints: 9, now }).index).toBe(0);
  });
});

describe('companyTrust: неявки на назначенные защиты', () => {
  const now = new Date('2026-09-20T00:00:00Z');
  const full = { name: 'ООО Пример', description: 'О компании', industry: 'Финтех', innValid: true, contact: '@hr', createdAt: new Date('2026-08-01T00:00:00Z'), invitationsSent: 2, invitationsDeclined: 0, now };
  it('15 баллов за неявку, не больше 30; без неявок сигнала нет', () => {
    const base = companyTrust(full);
    expect(base.signals.some((x) => x.code === 'no_shows')).toBe(false);
    const one = companyTrust({ ...full, noShows: 1 });
    expect(one.index).toBe(base.index - 15);
    expect(one.signals.find((x) => x.code === 'no_shows')).toMatchObject({ earned: -15, points: 0 });
    expect(companyTrust({ ...full, noShows: 7 }).index).toBe(base.index - 30);
  });
});

