import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { applyTheme } from '@/components/shell/theme';
import { THEME_KEY, THEME_SCRIPT } from '@/components/shell/theme-script';

const root = () => document.documentElement.getAttribute('data-theme');

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
});

describe('ThemeToggle', () => {
  it('на /consultant переключает тему страницы: data-theme на <html> и запоминание', () => {
    window.history.replaceState(null, '', '/consultant');
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: 'Тёмная тема' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(root()).toBe('dark');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(root()).toBeNull();
  });
});

describe('тема страницы', () => {
  it('тёмная действует в разделах кабинета: вне их (главная, вход, юридические) атрибут снимается', () => {
    window.localStorage.setItem(THEME_KEY, 'dark');
    for (const path of ['/consultant', '/profile', '/test', '/employer', '/employer/search', '/projects/abc']) {
      applyTheme(path);
      expect(root(), path).toBe('dark');
    }
    for (const path of ['/', '/auth', '/privacy', '/terms', '/employerx', '/design/consultant-a']) {
      applyTheme(path);
      expect(root(), path).toBeNull();
    }
  });

  it('инлайн-скрипт до гидрации ставит тёмную только в разделах кабинета и только при выборе', () => {
    const run = () => new Function(THEME_SCRIPT)();
    window.history.replaceState(null, '', '/consultant');
    run();
    expect(root()).toBeNull();
    window.localStorage.setItem(THEME_KEY, 'dark');
    run();
    expect(root()).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    window.history.replaceState(null, '', '/employer/search');
    run();
    expect(root()).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    window.history.replaceState(null, '', '/');
    run();
    expect(root()).toBeNull();
  });
});
