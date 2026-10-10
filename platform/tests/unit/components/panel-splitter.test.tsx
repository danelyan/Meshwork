import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { PanelSplitter } from '@/components/avatar/PanelSplitter';

// Разделитель чата и сцены (владелец 11.10): ширина в --panel-w, запоминается, двойной клик — сброс.
function Host() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scene">
      <div data-testid="side-panel" />
      <PanelSplitter scene={ref} />
    </div>
  );
}

const KEY = 'fsp:consultant-panel-w';
const scene = () => screen.getByTestId('scene');

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1400 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 500, left: 0 } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('стрелки двигают границу и ширина запоминается', () => {
  render(<Host />);
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
  expect(scene().style.getPropertyValue('--panel-w')).toBe('524px');
  expect(localStorage.getItem(KEY)).toBe('524');
});

it('ширина ограничена: не уже 340px', () => {
  localStorage.setItem(KEY, '100');
  render(<Host />);
  expect(scene().style.getPropertyValue('--panel-w')).toBe('340px');
});

it('двойной клик возвращает ширину по умолчанию', () => {
  localStorage.setItem(KEY, '600');
  render(<Host />);
  expect(scene().style.getPropertyValue('--panel-w')).toBe('600px');
  fireEvent.doubleClick(screen.getByRole('separator'));
  expect(scene().style.getPropertyValue('--panel-w')).toBe('');
  expect(localStorage.getItem(KEY)).toBeNull();
});
