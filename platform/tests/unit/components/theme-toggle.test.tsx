import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ThemeToggle } from '@/components/shell/ThemeToggle';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ThemeToggle', () => {
  it('переключает тему сцены консультанта и запоминает её (scene-theme)', () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: 'Тёмная тема' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('fsp:scene-theme')).toBe('dark');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('fsp:scene-theme')).toBeNull();
  });
});
