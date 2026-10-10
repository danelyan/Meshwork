import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RelaxHints } from '@/components/employer/MatchResults';
import { fspLevel, fspPlace, fspWeight } from '@/server/employer/fsp-weight';
import { rankCandidates, scoreCandidate, type CandidateEvidence, type MatchTarget } from '@/server/employer/ranking';
import { relaxationHints } from '@/server/employer/relax';
import { TECH_PROXIMITY, matchStackPartial } from '@/server/employer/tech-proximity';
import { FSP_BOOST_MAX, STACK_BOOST_PER_TAG } from '@/server/employer/weights';

import { fixtureCatalog } from '../../helpers/recommend-fixtures';

const catalog = fixtureCatalog();
const YEAR = 2026;
const opts = { year: YEAR };
const target: MatchTarget = {
  specialization: 'backend',
  grade: 'middle',
  needs: [
    { catalogId: 'be.idempotency', weight: 3 },
    { catalogId: 'be.transactions', weight: 3 },
    { catalogId: 'be.message-queue', weight: 2 },
    { catalogId: 'be.sql-indexes', weight: 2 },
  ],
  stack: [],
};

type Level = CandidateEvidence['claims'][number]['level'];
function cand(id: string, claims: [string, Level][], extra: Partial<CandidateEvidence> = {}, quote = 'Go'): CandidateEvidence {
  return {
    id,
    specialization: 'backend',
    fspState: 'not_linked',
    category: null,
    claims: claims.map(([catalogId, level]) => ({ catalogId, level, statement: `Утверждение ${catalogId}`, quote })),
    ...extra,
  };
}

const CUP = { event: 'Кубок России по спортивному программированию (продуктовое программирование)', year: 2025, result: 'призёр, 2 место' };

describe('вес достижений ФСП (R-M-02)', () => {
  it('место и уровень разбираются по ключевым словам, неизвестное — без падения', () => {
    expect(fspPlace('победитель трека')).toBe('winner');
    expect(fspPlace('призёр, 2 место')).toBe('prize');
    expect(fspPlace('финалист')).toBe('finalist');
    expect(fspPlace('участник, 37 место из 212')).toBe('participant');
    expect(fspLevel('Всероссийские соревнования')).toBe('national');
    expect(fspLevel('Чемпионат региона')).toBe('regional');
    expect(fspLevel('Новое событие без уровня')).toBe('other');
    expect(fspWeight([{ event: 'Новое событие', year: YEAR, result: '???' }], YEAR).boost).toBeGreaterThan(0);
  });

  it('свежее достижение весомее старого, победа весомее участия, отборочный этап — вполовину', () => {
    const fresh = fspWeight([CUP], YEAR).boost;
    const old = fspWeight([{ ...CUP, year: 2021 }], YEAR).boost;
    const part = fspWeight([{ ...CUP, result: 'участник' }], YEAR).boost;
    const qual = fspWeight([{ ...CUP, event: `${CUP.event}, отборочный этап` }], YEAR).boost;
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeGreaterThan(part);
    expect(qual).toBeCloseTo(fresh / 2, 4);
  });

  it('потолок: много побед не дают больше FSP_BOOST_MAX', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ event: `Международная олимпиада ${i}`, year: YEAR, result: 'победитель' }));
    const w = fspWeight(many, YEAR);
    expect(w.boost).toBe(FSP_BOOST_MAX);
    expect(w.capped).toBe(true);
  });

  it('без ФСП не штрафуется: не привязан = привязан без достижений = недоступен', () => {
    const claims: [string, Level][] = [['be.idempotency', 'artifact']];
    const scores = [
      scoreCandidate(cand('a', claims), target, catalog, opts)!,
      scoreCandidate(cand('b', claims, { fspState: 'no_achievements' }), target, catalog, opts)!,
      scoreCandidate(cand('c', claims, { fspState: 'unavailable' }), target, catalog, opts)!,
      scoreCandidate(cand('d', claims, { fspState: 'linked', fspAchievements: [] }), target, catalog, opts)!,
    ].map((r) => r.score);
    expect(new Set(scores).size).toBe(1);
    const linked = scoreCandidate(cand('e', claims, { fspState: 'linked', fspAchievements: [CUP] }), target, catalog, opts)!;
    expect(linked.score).toBeGreaterThan(scores[0]!);
    expect(linked.score - scores[0]!).toBeLessThanOrEqual(FSP_BOOST_MAX + 1e-9);
  });

  it('ФСП уточняет порядок, но не перебивает покрытие: потолок ФСП не поднимает над тем, кто закрыл больше', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ event: `Международная олимпиада ${i}`, year: YEAR, result: 'победитель' }));
    const star = cand('star', [['be.idempotency', 'artifact']], { fspState: 'linked', fspAchievements: many });
    const solid = cand('solid', [['be.idempotency', 'artifact'], ['be.sql-indexes', 'artifact']]);
    const twin = cand('twin', [['be.idempotency', 'artifact']]);
    expect(rankCandidates([star, solid, twin], target, catalog, {}, opts).map((r) => r.candidateId)).toEqual(['solid', 'star', 'twin']);
  });

  it('причина в объяснении: место, событие, год и вклад', () => {
    const r = scoreCandidate(cand('a', [['be.idempotency', 'artifact']], { fspState: 'linked', fspAchievements: [CUP] }), target, catalog, opts)!;
    expect(r.explanation.fspReasons).toEqual([`призёр: ${CUP.event}, 2025: +0,02`]);
    expect(r.explanation.summary).toContain('ФСП: есть подтверждённые достижения: призёр: Кубок России');
    // призёр (0,7) × всероссийский (0,8) × давность 1 год (0,5^0,5) × FSP_PER_POINT (0,05)
    expect(r.boosts.fsp).toBeCloseTo(0.7 * 0.8 * 0.5 ** 0.5 * 0.05, 4);
  });
});

describe('частичный зачёт близких технологий', () => {
  const t: MatchTarget = { ...target, stack: ['Kafka'] };

  it('коэффициенты карты — 0,3…0,6', () => {
    for (const [, , c] of TECH_PROXIMITY) {
      expect(c).toBeGreaterThanOrEqual(0.3);
      expect(c).toBeLessThanOrEqual(0.6);
    }
  });

  it('RabbitMQ вместо Kafka закрывает метку частично, с объяснением', () => {
    const r = scoreCandidate(cand('a', [['be.message-queue', 'artifact']], {}, 'RabbitMQ, Go'), t, catalog, opts)!;
    expect(r.explanation.stackMatched).toEqual([]);
    expect(r.explanation.stackPartial).toEqual([{ tag: 'Kafka', via: 'RabbitMQ', coef: 0.5 }]);
    expect(r.explanation.summary).toContain('частично: RabbitMQ вместо Kafka');
    expect(r.boosts.stack).toBeCloseTo(0.5 * STACK_BOOST_PER_TAG, 6);
  });

  it('близость не обгоняет точное совпадение', () => {
    const exact = cand('exact', [['be.message-queue', 'artifact']], {}, 'Kafka');
    const near = cand('near', [['be.message-queue', 'artifact']], {}, 'RabbitMQ');
    const none = cand('none', [['be.message-queue', 'artifact']], {}, 'Go');
    const r = rankCandidates([near, none, exact], t, catalog, {}, opts);
    expect(r.map((x) => x.candidateId)).toEqual(['exact', 'near', 'none']);
    expect(r[0]!.explanation.stackPartial).toBeUndefined();
  });

  it('поиск целым словом и по синонимам', () => {
    expect(matchStackPartial('send invite to user', ['Webpack'])).toEqual([]);
    expect(matchStackPartial('MySQL 8 в проде', ['Postgres'])).toEqual([{ tag: 'Postgres', via: 'MySQL', coef: 0.6 }]);
  });
});

describe('подсказки ослабления (R-M-04)', () => {
  const pool = [
    cand('go-kafka', [['be.idempotency', 'artifact']], {}, 'Go, Kafka'),
    cand('go-1', [['be.idempotency', 'artifact']], {}, 'Go'),
    cand('go-2', [['be.transactions', 'self_reported']], {}, 'Go'),
    cand('kafka', [['be.message-queue', 'artifact']], {}, 'Kafka'),
    cand('jun', [], { category: { specialization: 'backend', grade: 'junior' } }),
  ];

  it('снятие одной метки стека: «Ослабьте „Kafka“» и сколько добавится, лучшие первыми', () => {
    const hints = relaxationHints(pool, target, catalog, { stack: ['Go', 'Kafka'] }, opts);
    expect(hints[0]).toEqual({ kind: 'stack', label: 'Ослабьте «Kafka»', gain: 2, filters: { stack: ['Go'] } });
    expect(hints.find((h) => h.label === 'Ослабьте «Go»')).toMatchObject({ gain: 1, filters: { stack: ['Kafka'] } });
    expect(hints.map((h) => h.gain)).toEqual([...hints.map((h) => h.gain)].sort((a, b) => b - a));
  });

  it('грейд потребности на ступень ниже — кандидат с категорией Junior', () => {
    const hints = relaxationHints(pool, target, catalog, {}, opts);
    expect(hints).toEqual([{ kind: 'vacancyGrade', label: 'Рассмотрите Junior вместо Middle', gain: 1, filters: null, grade: 'junior' }]);
  });

  it('ничего не добавляет — подсказок нет; текущая подборка не меняется', () => {
    const before = rankCandidates(pool, { ...target, grade: 'junior' }, catalog, {}, opts);
    expect(relaxationHints(pool, { ...target, grade: 'junior' }, catalog, {}, opts)).toEqual([]);
    expect(rankCandidates(pool, { ...target, grade: 'junior' }, catalog, {}, opts)).toEqual(before);
  });

  it('вывод: ссылки на ту же подборку с новыми фильтрами, грейд — на правку потребности', () => {
    const html = renderToStaticMarkup(
      createElement(RelaxHints, {
        basePath: '/employer/needs/v1',
        hints: [
          { kind: 'stack', label: 'Ослабьте «Kafka»', gain: 2, filters: { stack: ['Go'] } },
          { kind: 'vacancyGrade', label: 'Рассмотрите Junior вместо Middle', gain: 1, filters: null, grade: 'junior' },
        ],
      }),
    );
    expect(html).toContain('href="/employer/needs/v1?stack=Go"');
    expect(html).toContain('Ослабьте «Kafka» - +2 кандидата');
    expect(html).toContain('href="/employer/needs/v1/edit"');
    expect(html).toContain('+1 кандидат<');
  });
});
