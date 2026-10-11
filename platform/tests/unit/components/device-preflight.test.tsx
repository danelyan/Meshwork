import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DevicePreflight, micErrorState } from '@/components/call/DevicePreflight';
import { getMicDeviceId, setMicDeviceId } from '@/components/call/devicePrefs';

const track = (deviceId: string) => ({ stop: vi.fn(), getSettings: () => ({ deviceId }) });
const fakeStream = (deviceId = 'mic-1') => {
  const t = track(deviceId);
  return { stream: { getTracks: () => [t], getAudioTracks: () => [t] } as unknown as MediaStream, track: t };
};

let gum: ReturnType<typeof vi.fn>;
let enumerate: ReturnType<typeof vi.fn>;

function setMedia(over: { getUserMedia?: unknown; enumerateDevices?: unknown } | null) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: over ?? undefined });
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) };
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createOscillator() {
    const o: { frequency: { value: number }; connect: (n: unknown) => unknown; start: () => void; stop: () => void; onended: null | (() => void) } = {
      frequency: { value: 0 },
      connect: (n) => n,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    return o;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (n: unknown) => n };
  }
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
}

beforeEach(() => {
  setMicDeviceId(null);
  gum = vi.fn();
  enumerate = vi.fn(async () => []);
  setMedia({ getUserMedia: gum, enumerateDevices: enumerate });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setMedia(null);
});

const props = () => ({ onReady: vi.fn(), onTextOnly: vi.fn(), onCancel: vi.fn() });

describe('DevicePreflight – проверка устройств перед созвоном', () => {
  it('разрешено: состояние «разрешён», выбор устройства, «начать» закрывает поток и зовёт onReady', async () => {
    const { stream, track: t } = fakeStream('mic-1');
    gum.mockResolvedValue(stream);
    enumerate.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Встроенный' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'Гарнитура' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Камера' },
    ]);
    const p = props();
    render(<DevicePreflight {...p} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
    expect(screen.getByTestId('call-devices-level')).toBeTruthy();
    const select = (await screen.findByTestId('call-devices-select')) as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    expect(getMicDeviceId()).toBe('mic-1');

    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(t.stop).toHaveBeenCalled();
    expect(p.onReady).toHaveBeenCalledTimes(1);
    expect(p.onTextOnly).not.toHaveBeenCalled();
  });

  it('смена устройства открывает поток с exact deviceId и запоминает выбор', async () => {
    gum.mockResolvedValueOnce(fakeStream('mic-1').stream).mockResolvedValueOnce(fakeStream('mic-2').stream);
    enumerate.mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'A' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'B' },
    ]);
    render(<DevicePreflight {...props()} />);
    const select = (await screen.findByTestId('call-devices-select')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'mic-2' } });
    await waitFor(() => expect(getMicDeviceId()).toBe('mic-2'));
    expect(gum.mock.calls[1]![0].audio.deviceId).toEqual({ exact: 'mic-2' });
  });

  it('отказ: инструкция про замок, «Повторить» запрашивает снова, «Продолжить текстом»', async () => {
    gum.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const p = props();
    render(<DevicePreflight {...p} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('denied'));
    expect(screen.getByTestId('call-devices-help').textContent).toContain('замка');

    gum.mockResolvedValueOnce(fakeStream().stream);
    fireEvent.click(screen.getByTestId('call-devices-retry'));
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));

    cleanup();
    gum.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const p2 = props();
    render(<DevicePreflight {...p2} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('denied'));
    fireEvent.click(screen.getByTestId('call-devices-text'));
    expect(p2.onTextOnly).toHaveBeenCalledTimes(1);
    expect(p2.onReady).not.toHaveBeenCalled();
  });

  it('браузер уже помнит запрет (permissions.query = denied): запрос не дёргаем', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: 'denied' })) } });
    render(<DevicePreflight {...props()} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('denied'));
    expect(gum).not.toHaveBeenCalled();
  });

  it('permissions.query бросает (Safari/Firefox) – всё равно спрашиваем микрофон', async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => { throw new TypeError('microphone'); }) } });
    gum.mockResolvedValue(fakeStream().stream);
    render(<DevicePreflight {...props()} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
  });

  it('нет устройства: сообщение и повтор', async () => {
    gum.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' }));
    render(<DevicePreflight {...props()} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('nodevice'));
    expect(screen.getByText(/Подключи микрофон/)).toBeTruthy();
    expect(screen.getByTestId('call-devices-retry')).toBeTruthy();
  });

  it('нет mediaDevices (небезопасный контекст): сразу «не поддерживается», только текст', async () => {
    setMedia(null);
    const p = props();
    render(<DevicePreflight {...p} />);
    expect(screen.getByTestId('call-devices').dataset.mic).toBe('unsupported');
    expect(screen.queryByTestId('call-devices-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('call-devices-text'));
    expect(p.onTextOnly).toHaveBeenCalledTimes(1);
  });

  it('«Проверить звук» создаёт контекст по жесту и показывает результат', async () => {
    gum.mockResolvedValue(fakeStream().stream);
    render(<DevicePreflight {...props()} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('call-devices-tone'));
    });
    expect(screen.getByText(/Короткий сигнал/)).toBeTruthy();
  });

  it('камера – только с withCamera; без cameraJoinsCall по умолчанию выключена', async () => {
    gum.mockResolvedValue(fakeStream().stream);
    const { unmount } = render(<DevicePreflight {...props()} />);
    expect(screen.queryByTestId('call-devices-camera')).toBeNull();
    unmount();
    render(<DevicePreflight {...props()} withCamera />);
    const box = screen.getByTestId('call-devices-camera') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(1));
    expect(gum.mock.calls[0]![0].video).toBeUndefined();
  });

  it('cameraJoinsCall: галочка по умолчанию стоит, камеру просим сразу → onReady({ camera: true }); снята – camera: false', async () => {
    gum.mockImplementation(async () => fakeStream().stream);
    const p = props();
    const { unmount } = render(<DevicePreflight {...p} withCamera cameraJoinsCall />);
    expect(screen.getByText(/Камера в созвоне/)).toBeTruthy();
    expect((screen.getByTestId('call-devices-camera') as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
    await waitFor(() => expect(gum.mock.calls.some((c) => c[0].video)).toBe(true));
    await act(async () => undefined);
    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(p.onReady).toHaveBeenCalledWith({ camera: true });
    unmount();

    const p2 = props();
    render(<DevicePreflight {...p2} withCamera cameraJoinsCall />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
    fireEvent.click(screen.getByTestId('call-devices-camera')); // снять галочку
    await act(async () => undefined);
    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(p2.onReady).toHaveBeenCalledWith({ camera: false });
  });

  it('cameraJoinsCall: камера запрещена (NotAllowedError) – подсказка «без видео», onReady({ camera: false })', async () => {
    gum.mockImplementation(async (c: MediaStreamConstraints) => {
      if (c.video) throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
      return fakeStream().stream;
    });
    const p = props();
    render(<DevicePreflight {...p} withCamera cameraJoinsCall />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
    expect((await screen.findByTestId('call-devices-camera-denied')).textContent).toContain('без видео');
    fireEvent.click(screen.getByTestId('call-devices-go'));
    expect(p.onReady).toHaveBeenCalledWith({ camera: false });
  });

  it('размонтирование закрывает поток микрофона', async () => {
    const { stream, track: t } = fakeStream();
    gum.mockResolvedValue(stream);
    const { unmount } = render(<DevicePreflight {...props()} />);
    await waitFor(() => expect(screen.getByTestId('call-devices').dataset.mic).toBe('granted'));
    unmount();
    expect(t.stop).toHaveBeenCalled();
  });

  it('micErrorState: имена ошибок getUserMedia', () => {
    expect(micErrorState({ name: 'NotAllowedError' })).toBe('denied');
    expect(micErrorState({ name: 'NotFoundError' })).toBe('nodevice');
    expect(micErrorState({ name: 'NotReadableError' })).toBe('busy');
  });
});
