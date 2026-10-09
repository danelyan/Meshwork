import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConsultantHead } from '@/components/head/ConsultantHead';
import { ConsultantScene } from '@/components/head/ConsultantScene';
import { GRID_V3_STORAGE_KEY } from '@/components/design/grid-preview-settings';
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('uses the approved grid in the main consultant while keeping the actual chat', () => {
  const { container } = render(<ConsultantScene><p>Actual conversation</p></ConsultantScene>);
  expect(screen.getByText('Actual conversation')).toBeTruthy();
  expect(screen.getByTitle('Сеточная голова консультанта').getAttribute('src')).toBe('/design/consultant-grid-v3/head.html');
  expect(container.querySelector('main')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Настройки сетки' }));
  expect(screen.getByRole('slider', { name: /Шаг сетки/ }).getAttribute('value')).toBe('42');
  expect(screen.queryByText(/Демо-чат из макета/)).toBeNull();
});
it('shares saved v3 controls and sends them only to its own ready frame', () => {
  localStorage.setItem(GRID_V3_STORAGE_KEY, JSON.stringify({step:54,relief:1.4,angle:0.74}));
  render(<ConsultantHead />);
  const frame = screen.getByTitle('Сеточная голова консультанта') as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, origin: location.origin, data: {type:'fsp-grid-ready'},
  })));
  expect(send).toHaveBeenLastCalledWith({type:'fsp-grid-settings',settings:{step:54,relief:1.4,angle:0.74}},location.origin);
  fireEvent.click(screen.getByRole('button', {name:'Настройки сетки'}));
  fireEvent.change(screen.getByRole('slider',{name:/Шаг сетки/}),{target:{value:'56'}});
  expect(JSON.parse(localStorage.getItem(GRID_V3_STORAGE_KEY)!).step).toBe(56);
});
it('keeps the loading scene free of a second renderer', () => {
  render(<ConsultantScene pending><p>Loading chat</p></ConsultantScene>);
  expect(screen.queryByTitle('Сеточная голова консультанта')).toBeNull();
});
it('forwards gaze from the actual conversation and releases the listener on unmount', () => {
  const view = render(<ConsultantHead />);
  const frame = screen.getByTitle('Сеточная голова консультанта') as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent.pointerMove(window, {clientX:10,clientY:20});
  expect(send).toHaveBeenCalledWith(expect.objectContaining({type:'fsp-grid-pointer'}),location.origin);
  send.mockClear();
  view.unmount();
  fireEvent.pointerMove(window, {clientX:10,clientY:20});
  expect(send).not.toHaveBeenCalled();
});
