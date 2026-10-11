import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MatchExplorer } from '@/components/employer/MatchExplorer';
import { SavedCandidates } from '@/components/employer/SavedCandidates';
import { VacancyForm } from '@/components/employer/VacancyForm';
import { VacancyCatalog } from '@/components/employer/VacancyCatalog';
import { InvitationTracker } from '@/components/employer/InvitationTracker';
import type { MatchItem } from '@/server/employer/matching';
import type { VacancyView } from '@/server/employer/vacancies';
import { getFavorites, setFavorite } from '@/lib/favorites';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/favorites', () => ({ getFavorites: vi.fn(), setFavorite: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function candidate(id: string, rank: number): MatchItem {
  return {
    candidateId: id, rank, score: .7, coverageScore: .6, covered: 1, total: 2,
    provenCount: 1, categoryMatch: true, subcategoryFit: 'exact', boosts: { category: .1, fsp: 0, stack: 0, specPenalty: 0 },
    explanation: { summary: 'Закрывает 1 из 2', covered: [{ statement: 'Git', level: 'artifact' }], proven: ['Git'], missing: ['SQL'], fsp: 'нет достижений', category: 'Backend · Middle', subcategory: '', stackMatched: [] },
    candidate: { id, displayName: `Кандидат #${id}`, specialization: 'backend', category: { specialization: 'backend', grade: 'middle', label: 'Backend · Middle' }, fsp: { state: 'not_linked', hasAchievements: false }, claims: [], contacts: null },
    invitation: null,
  };
}

describe('Astra employer cabinet', () => {
  it('switches map/list and selects the corresponding real candidate for invitation', () => {
    render(<MatchExplorer items={[candidate('one', 1), candidate('two', 2)]} vacancyId="vacancy" vacancyTitle="Backend" />);
    expect(screen.getByRole('button', { name: /Карта/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Кандидат #two/ }));
    expect(screen.getByRole('button', { name: 'Пригласить: Кандидат #two' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Пригласить: Кандидат #one' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Список/ }));
    expect(screen.getByRole('button', { name: /Список/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Пригласить: Кандидат #two' })).toBeDefined();
  });

  it('zooms the map within limits while keeping the chosen candidate', () => {
    render(<MatchExplorer items={[candidate('one', 1)]} vacancyId="vacancy" />);
    expect(screen.getByLabelText('Масштаб карты').textContent).toBe('100%');
    const zoomIn = screen.getByRole('button', { name: 'Увеличить карту' });
    for (let i = 0; i < 3; i++) fireEvent.click(zoomIn);
    expect(screen.getByLabelText('Масштаб карты').textContent).toBe('130%');
    expect(zoomIn).toHaveProperty('disabled', true);
    const zoomOut = screen.getByRole('button', { name: 'Уменьшить карту' });
    for (let i = 0; i < 6; i++) fireEvent.click(zoomOut);
    expect(screen.getByLabelText('Масштаб карты').textContent).toBe('70%');
    expect(zoomOut).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Пригласить: Кандидат #one' })).toBeDefined();
  });

  it('saves through authenticated API and removes a persisted favorite from the list', async () => {
    vi.mocked(getFavorites).mockResolvedValue({ kind: 'candidate', ids: [] });
    vi.mocked(setFavorite).mockResolvedValueOnce({ kind: 'candidate', ids: ['one'] });
    render(<MatchExplorer items={[candidate('one', 1)]} vacancyId={null} favoriteScope="employer-a" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'В избранное' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: 'В избранное' }));
    await screen.findByRole('button', { name: 'Убрать из избранного' });
    expect(setFavorite).toHaveBeenCalledWith('candidate', 'one', true);
    cleanup();
    vi.mocked(setFavorite).mockResolvedValueOnce({ kind: 'candidate', ids: [] });
    render(<SavedCandidates scope="employer-a" cards={[candidate('one', 1).candidate]} unavailable={0} />);
    expect(screen.getByRole('heading', { name: /Кандидат #one/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из избранного' }));
    expect(await screen.findByText(/Пока пусто/)).toBeDefined();
    expect(setFavorite).toHaveBeenLastCalledWith('candidate', 'one', false);
  });

  it('previews only entered vacancy data and selected requirements', () => {
    render(<VacancyForm catalog={[{ id: 'be.git', specialization: 'backend', statement: 'Git', grades: ['junior'], weight: 2 }]} />);
    const preview = screen.getByRole('complementary', { name: 'Черновик вакансии' });
    expect(preview.textContent).toContain('1требований для подборки');
    fireEvent.change(screen.getByLabelText('Кого ищешь'), { target: { value: 'Go developer' } });
    expect(preview.textContent).toContain('Go developer');
    fireEvent.click(screen.getByRole('button', { name: 'Git' }));
    expect(preview.textContent).toContain('0требований для подборки');
    expect(preview.textContent).toContain('после сохранения');
  });

  it('filters vacancy status without losing edit and matching actions', () => {
    const vacancy: VacancyView = { id: 'v1', title: 'Backend', specialization: 'backend', grade: 'middle', salaryFrom: 100000, salaryTo: 150000, teamDescription: null, description: null, stack: ['Go'], subcategoryId: null, needs: [], archived: false, createdAt: '2026-10-10', invitations: 1 };
    render(<VacancyCatalog vacancies={[vacancy, { ...vacancy, id: 'v2', title: 'Archived job', archived: true }]} />);
    expect(screen.getByRole('heading', { name: 'Archived job' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Закрытые/ }));
    expect(screen.getByRole('heading', { name: 'Archived job' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Изменить' }).getAttribute('href')).toBe('/employer/needs/v2/edit');
  });

  it('shows an already open invitation in saved candidates instead of another send form', () => {
    render(<SavedCandidates scope="employer-a" cards={[candidate('one', 1).candidate]} unavailable={0} pendingInvitations={[{ candidateId: 'one', status: 'viewed' }]} />);
    expect(screen.getByText('Приглашение: просмотрено')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Пригласить: Кандидат #one' })).toBeNull();
  });

  it('keeps accepted candidates in progress and withdrawn invitations closed', () => {
    const base = { id: 'i1', status: 'sent' as const, salaryFrom: 100000, salaryTo: 150000, message: null, createdAt: '2026-10-10T12:00:00Z', viewedAt: null, respondedAt: null, vacancy: null, candidate: candidate('one', 1).candidate };
    render(<InvitationTracker invitations={[base, { ...base, id: 'i2', status: 'withdrawn', candidate: candidate('two', 2).candidate }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Закрытые/ }));
    expect(screen.getByRole('heading', { name: 'Кандидат #two' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Кандидат #one' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отозвать приглашение' })).toBeNull();
  });

  it('filters invitations and exposes only server-provided contacts', () => {
    const base = { id: 'i1', status: 'sent' as const, salaryFrom: 100000, salaryTo: 150000, message: null, createdAt: '2026-10-10T12:00:00Z', viewedAt: null, respondedAt: null, vacancy: null, candidate: candidate('one', 1).candidate };
    render(<InvitationTracker invitations={[base, { ...base, id: 'i2', status: 'accepted', candidate: { ...candidate('two', 2).candidate, displayName: 'Анна', contacts: { name: 'Анна', contact: '@anna' } }, respondedAt: '2026-10-10T13:00:00Z' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /В процессе/ }));
    expect(screen.getByText('@anna')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Кандидат #one' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ждут ответа/ }));
    expect(screen.queryByText('@anna')).toBeNull();
    expect(screen.getByText(/Имя и контакт откроются/)).toBeDefined();
  });
});
