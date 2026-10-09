import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ConsultantGridPreview } from '@/components/design/ConsultantGridPreview';

afterEach(cleanup);

function setup() {
  render(<ConsultantGridPreview />);
  const frame = screen.getByTitle('Карьерный консультант — тестовый макет') as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  const ready = (source: MessageEventSource | null = frame.contentWindow, origin = location.origin) => act(() => {
    window.dispatchEvent(new MessageEvent('message', { source, origin, data: { type: 'fsp-grid-ready' } }));
  });
  return { frame, send, ready };
}

it('queues settings until the actual frame is ready and applies the latest selection', () => {
  const { send, ready } = setup();
  fireEvent.change(screen.getByRole('slider', { name: /Шаг сетки/i }), { target: { value: '32' } });
  expect(send).not.toHaveBeenCalled();
  ready();
  expect(send).toHaveBeenLastCalledWith({ type: 'fsp-grid-settings', settings: { step: 32, relief: 1, angle: 0.5 } }, location.origin);
});

it('ignores ready messages from other windows and origins', () => {
  const { frame, send, ready } = setup();
  ready(window);
  ready(frame.contentWindow, 'https://other.example');
  expect(send).not.toHaveBeenCalled();
  ready();
  expect(send).toHaveBeenCalledTimes(1);
});

it('resets all parameters without replacing the iframe or losing the chat', () => {
  const { frame, send, ready } = setup();
  ready();
  fireEvent.change(screen.getByRole('slider', { name: /Выпуклость/i }), { target: { value: '1.6' } });
  fireEvent.change(screen.getByRole('slider', { name: /Угол/i }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Свернуть настройки' }));
  expect(screen.queryByRole('slider')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Настройки сетки' }));
  expect((screen.getByRole('slider', { name: /Выпуклость/i }) as HTMLInputElement).value).toBe('1.6');
  fireEvent.click(screen.getByRole('button', { name: 'Как в оригинале' }));
  expect(send).toHaveBeenLastCalledWith({ type: 'fsp-grid-settings', settings: { step: 46, relief: 1, angle: 0.5 } }, location.origin);
  expect(screen.getByTitle('Карьерный консультант — тестовый макет')).toBe(frame);
});

it('waits for each renderer after switching versions and reapplies the current settings', () => {
  const view = render(<ConsultantGridPreview source="/design/consultant-grid-v1/index.html" />);
  const frame = screen.getByTitle('Карьерный консультант — тестовый макет') as HTMLIFrameElement;
  const ready = () => act(() => window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, origin: location.origin, data: { type: 'fsp-grid-ready' },
  })));
  ready();
  fireEvent.change(screen.getByRole('slider', { name: /Шаг сетки/i }), { target: { value: '24' } });
  view.rerender(<ConsultantGridPreview source="/design/consultant-grid-v2/index.html" />);
  expect(screen.getByRole('status').textContent).toContain('Загружается');
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  ready();
  expect(send).toHaveBeenLastCalledWith({ type: 'fsp-grid-settings', settings: { step: 24, relief: 1, angle: 0.5 } }, location.origin);
});
