import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SceneAside } from '@/components/consultant/SceneAside';
import { candidateSteps, employerSteps, markStates } from '@/server/consultant/aside';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(cleanup);

const base = { intro: false, introNote: '2 из 10', confirmed: 0, category: null, invitations: 0 };

describe('journey steps', () => {
  it('marks the first unfinished step as now, earlier ones done, later ones next', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 3 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'now', 'next']);
  });
  it('keeps the last step as now when everything before it is done', () => {
    const s = candidateSteps({ ...base, intro: true, confirmed: 1, category: { specialization: 'backend', grade: 'middle' }, invitations: 2 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'now']);
    expect(s[2]!.note).toBe('Backend · Middle');
    expect(s[3]!.note).toBe('2 приглашения');
  });
  it('links candidate steps to existing sections', () => {
    expect(candidateSteps(base).map((x) => x.href)).toEqual(['/consultant', '/profile', '/test', '/invitations']);
  });
  it('employer path: company, need, search, invitations', () => {
    const s = employerSteps({ intro: true, introNote: 'пройдено', needs: 1, invitations: 0 });
    expect(s.map((x) => x.state)).toEqual(['done', 'done', 'now', 'next']);
    expect(s.map((x) => x.href)).toEqual(['/consultant', '/employer', '/employer/search', '/employer/invitations']);
  });
  it('markStates works on a single step', () => {
    expect(markStates([{ id: 'a', label: 'A', short: 'A', note: '', href: '/', done: true }])[0]!.state).toBe('now');
  });
});

describe('SceneAside', () => {
  const data = { role: 'candidate' as const, steps: candidateSteps(base), docs: [], hint: { title: 'Документы', text: 'Прикрепи файл' } };
  it('renders roadmap, empty documents with the attach button and the hint', () => {
    render(<SceneAside data={data} />);
    expect(screen.getByTestId('journey-intro').getAttribute('data-state')).toBe('now');
    expect(screen.getByRole('button', { name: 'Прикрепить' })).toBeTruthy();
    expect(screen.getByText('Прикрепи файл')).toBeTruthy();
  });
  it('attach clicks the composer paperclip inside the feed', () => {
    const clicked = vi.fn();
    render(
      <div data-feed-scroll>
        <button type="button" aria-label="Прикрепить файл" onClick={clicked} />
        <SceneAside data={data} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Прикрепить' }));
    expect(clicked).toHaveBeenCalled();
  });
  it('lists documents with their parse status and toggles the accordion', () => {
    render(<SceneAside data={{ ...data, docs: [{ id: '1', name: 'cv.pdf', kind: 'file', status: 'разобран, 2 утверждения' }] }} />);
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /Документы/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
  it('employer has no documents block', () => {
    render(<SceneAside data={{ ...data, role: 'employer', docs: null }} />);
    expect(screen.queryByTestId('aside-docs')).toBeNull();
  });
});
