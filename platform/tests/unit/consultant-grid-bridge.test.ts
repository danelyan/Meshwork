import { readFileSync } from 'node:fs';
import vm from 'node:vm';

it('passes valid controls to the exported renderer and rejects invalid or foreign messages', () => {
  const html = readFileSync('public/design/consultant-grid/index.html', 'utf8');
  const logic = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  expect(logic).toBeTruthy();
  const parent = { postMessage: vi.fn() };
  const context = vm.createContext({
    DCLogic: class {}, React: { createRef: () => ({ current: null }) },
    window: { parent, location: { origin: 'http://localhost:3000' } },
  });
  const controller = vm.runInContext(`${logic}; new Component()`, context);
  const setParams = vi.fn();
  controller.head = { setParams };
  const message = { source: parent, origin: 'http://localhost:3000', data: { type: 'fsp-grid-settings', settings: { step: 24, relief: 1.5, angle: 0.4 } } };
  controller.onPreviewParams({ ...message, source: {} });
  controller.onPreviewParams({ ...message, origin: 'https://other.example' });
  for (const invalid of [NaN, Infinity, 0, 81]) {
    controller.onPreviewParams({ ...message, data: { ...message.data, settings: { ...message.data.settings, step: invalid } } });
  }
  expect(setParams).not.toHaveBeenCalled();
  controller.onPreviewParams(message);
  expect(setParams).toHaveBeenCalledWith(message.data.settings);
  expect(controller.headParams()).toEqual(message.data.settings);
  // The parent can connect after the fast, self-contained export has already loaded.
  controller.onPreviewParams({ ...message, data: { type: 'fsp-grid-connect' } });
  expect(parent.postMessage).toHaveBeenCalledWith({ type: 'fsp-grid-ready' }, message.origin);
});
