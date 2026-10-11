import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ClaimCard } from '@/components/ClaimCard';
import { EventFeed, type FeedItem, rejectNotesOf } from '@/components/EventFeed';
import { ProfilePage } from '@/components/ProfilePage';
import type { AgentEvent } from '@/server/agent/types';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ClaimCard: limits', () => {
  it('префикс «Не доказывает» ровно один, и для старых данных', () => {
    render(<ClaimCard claim={{ id: 'c', statement: 's', quote: 'q', sourceRef: 'r', level: 'self_reported', limits: 'Не доказывает: прикладную разработку', status: 'proposed' }} onAction={async () => {}} />);
    const t = document.body.textContent ?? '';
    expect(t.match(/Не доказывает/g)).toHaveLength(1);
    expect(t).toContain('прикладную разработку');
  });
});

describe('плашки отказов', () => {
  const ev = (e: Partial<Extract<AgentEvent, { type: 'claims' }>>) => ({ type: 'claims', proposed: [], rejected: 0, ...e }) as Extract<AgentEvent, { type: 'claims' }>;
  it('только дубли → «объединено повторов», без «отброшено»', () => {
    const n = rejectNotesOf(ev({ rejected: 3, rejectedByReason: { duplicate: 3 } }));
    expect(n).toHaveLength(1);
    expect(n[0]).toContain('Объединено повторов: 3');
    expect(n.join(' ')).not.toContain('отброшено');
  });
  it('разные причины – отдельные плашки', () => {
    const n = rejectNotesOf(ev({ rejected: 3, rejectedByReason: { no_quote: 1, unknown_catalog_id: 1, hidden_text: 1 } }));
    expect(n.join('|')).toMatch(/без цитаты.*\|.*вне каталога.*\|.*скрытого текста/);
  });
  it('старое событие без разбивки → как раньше', () => {
    expect(rejectNotesOf(ev({ rejected: 2 }))[0]).toContain('без цитаты в источнике');
  });
});

describe('«Подтвердить все»: итог', () => {
  it('показывает «Подтверждено: N»', async () => {
    const c = (id: string) => ({ id, statement: `У ${id}`, quote: 'q', sourceRef: 'r', level: 'self_reported', limits: '', status: 'proposed' });
    const items: FeedItem[] = [{ id: 'a', role: 'agent', event: { type: 'claims', proposed: [c('1'), c('2')], rejected: 0 } }];
    render(<EventFeed items={items} onClaimAction={async () => {}} onConfirmAll={async (cs) => cs.length} />);
    fireEvent.click(screen.getByText(/Подтвердить все со слов \(2\)/));
    await waitFor(() => expect(screen.getByText('Подтверждено: 2.')).toBeDefined());
  });
});

const claim = (id: string, status: string, catalogId = 'be.cache') => ({
  id, catalogId, statement: `Утв ${id}`, level: 'self_reported', quote: 'q', sourceRef: 'r', sourceKind: 'resume', limits: 'Не доказывает: x', suggestedProof: [], status, createdAt: '2026-10-01T00:00:00Z', confirmedAt: null,
});

describe('ProfilePage: решения по черновикам', () => {
  it('Да → POST confirm, список обновляется без перезагрузки', async () => {
    let status = 'proposed';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        status = url.endsWith('/confirm') ? 'confirmed' : 'rejected';
        return { ok: true, status: 200, json: async () => ({}) };
      }
      const body = url.startsWith('/api/profile')
        ? { candidate: { id: 'x', name: 'Т', specialization: null, fspState: 'linked' }, category: null, claims: [claim('c1', status)], byLevel: {} }
        : { gaps: [{ id: 'be.cache', catalogId: 'be.cache', statement: 'Кэш', weight: 2, currentLevel: null, priority: 1, suggestedProof: [] }], targets: [], tasks: [] };
      return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProfilePage />);
    await screen.findByText('Утв c1');
    expect(screen.queryByText('нет утверждения')).toBeNull(); // карта пробелов живёт в «Навыки и грейд»
    fireEvent.click(await screen.findByRole('button', { name: 'Да' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Да' })).toBeNull());
    expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/claims/c1/confirm' && (i as RequestInit).method === 'POST')).toBe(true);
  });

  it('Нет → утверждение пропадает из списка', async () => {
    let status = 'proposed';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { status = 'rejected'; return { ok: true, status: 200, json: async () => ({}) }; }
      const body = url.startsWith('/api/profile')
        ? { candidate: { id: 'x', name: 'Т', specialization: null, fspState: 'linked' }, category: null, claims: [claim('c1', status)], byLevel: {} }
        : { gaps: [{ id: 'be.cache', catalogId: 'be.cache', statement: 'Кэш', weight: 2, currentLevel: null, priority: 1, suggestedProof: [] }] };
      return { ok: true, status: 200, json: async () => body };
    }));
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(screen.queryByText('Утв c1')).toBeNull());
  });
});
