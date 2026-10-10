import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { InstructionsCard } from '@/components/consultant/InstructionsCard';
import { SceneAside } from '@/components/consultant/SceneAside';
import { candidateSteps, employerSteps } from '@/server/consultant/aside';
import { CUSTOM_MAX, SKILLS } from '@/server/consultant/skills';

// MemoryCard переходит к шагу знакомства мягким обновлением (useRouter) — в тестах роутера нет.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InstructionsCard', () => {
  it('показывает все скиллы чипами с aria-pressed по начальным данным', () => {
    render(<InstructionsCard initial={{ skills: ['brief'], custom: 'на вы' }} />);
    for (const s of SKILLS) expect(screen.getByRole('button', { name: s.label })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Коротко и по делу' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Готовь к тесту' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Свои инструкции') as HTMLTextAreaElement).value).toBe('на вы');
    expect(screen.getByText(`5/${CUSTOM_MAX}`)).toBeTruthy();
  });

  it('переключает чип, считает символы и сохраняет PUT-ом', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(init?.body as string, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<InstructionsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Готовь к тесту' }));
    expect(screen.getByRole('button', { name: 'Готовь к тесту' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Свои инструкции'), { target: { value: 'примеры на Go' } });
    expect(screen.getByText(`13/${CUSTOM_MAX}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('сохранено'));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/consultant/settings');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ skills: ['test_prep'], custom: 'примеры на Go' });
  });

  it('ошибка сохранения — понятный статус', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    render(<InstructionsCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/не сохранилось/));
  });
});

describe('SceneAside + карточка', () => {
  const hint = { title: 'x', text: 'y' };
  it('у кандидата есть «Как мне работать», у работодателя нет', () => {
    const steps = candidateSteps({ intro: false, introNote: '', confirmed: 0, category: null, invitations: 0 });
    render(<SceneAside data={{ role: 'candidate', steps, docs: [], hint, instructions: { skills: [], custom: '' } }} />);
    expect(screen.getByTestId('aside-instructions')).toBeTruthy();
    cleanup();
    render(<SceneAside data={{ role: 'employer', steps: employerSteps({ intro: true, introNote: '', needs: 0, invitations: 0 }), docs: null, hint }} />);
    expect(screen.queryByTestId('aside-instructions')).toBeNull();
  });
});
