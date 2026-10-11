import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { MicGear, MicSettings } from '@/components/mic/MicSettings';
import { MIC_MODE_KEY, readMicMode, setMicMode, useMicMode } from '@/components/mic/micMode';
import { useMicPress } from '@/components/mic/useMicPress';

// jsdom без PointerEvent: fireEvent теряет button/pointerType.
beforeAll(() => {
  class PE extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  }
  vi.stubGlobal('PointerEvent', PE);
});
afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Probe({ onStart, onStop, recording }: { onStart: () => void; onStop: () => void; recording: boolean }) {
  const p = useMicPress({ recording, onStart, onStop });
  return (
    <div>
      <button type="button" data-testid="mic" {...p.buttonProps}>
        mic
      </button>
      <span data-testid="mode">{p.mode}</span>
      {p.menuOpen && <MicSettings onClose={p.closeMenu} />}
      <MicGear onClick={p.openMenu} />
    </div>
  );
}

const down = (el: Element, init: Record<string, unknown> = {}) => fireEvent.pointerDown(el, { button: 0, pointerId: 1, pointerType: 'mouse', ...init });

describe('micMode', () => {
  it('по умолчанию hold, click хранится, hold снимает ключ', () => {
    expect(readMicMode()).toBe('hold');
    setMicMode('click');
    expect(localStorage.getItem(MIC_MODE_KEY)).toBe('click');
    expect(readMicMode()).toBe('click');
    setMicMode('hold');
    expect(localStorage.getItem(MIC_MODE_KEY)).toBeNull();
  });

  it('хук подписан на смену режима', () => {
    function M() {
      return <span data-testid="m">{useMicMode()}</span>;
    }
    render(<M />);
    expect(screen.getByTestId('m').textContent).toBe('hold');
    act(() => setMicMode('click'));
    expect(screen.getByTestId('m').textContent).toBe('click');
  });
});

describe('useMicPress: hold', () => {
  it('pointerdown стартует, pointerup останавливает; хвостовой клик мыши игнорируется', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(<Probe recording={false} onStart={onStart} onStop={onStop} />);
    const mic = screen.getByTestId('mic');
    down(mic);
    expect(onStart).toHaveBeenCalledTimes(1);
    rerender(<Probe recording onStart={onStart} onStop={onStop} />);
    fireEvent.pointerUp(mic);
    expect(onStop).toHaveBeenCalledTimes(1);
    fireEvent.click(mic, { detail: 1 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('отпускание вне кнопки приходит как pointercancel; потеря окна тоже останавливает', () => {
    const onStop = vi.fn();
    const { rerender } = render(<Probe recording={false} onStart={vi.fn()} onStop={onStop} />);
    const mic = screen.getByTestId('mic');
    down(mic);
    rerender(<Probe recording onStart={vi.fn()} onStop={onStop} />);
    fireEvent.pointerCancel(mic);
    expect(onStop).toHaveBeenCalledTimes(1);
    down(mic);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('отпустили раньше, чем началась запись – остановка сразу после старта', () => {
    const onStop = vi.fn();
    const { rerender } = render(<Probe recording={false} onStart={vi.fn()} onStop={onStop} />);
    const mic = screen.getByTestId('mic');
    down(mic);
    fireEvent.pointerUp(mic);
    expect(onStop).not.toHaveBeenCalled();
    rerender(<Probe recording onStart={vi.fn()} onStop={onStop} />);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('правая кнопка запись не начинает; клавиатурный клик (detail 0) переключает', () => {
    const onStart = vi.fn();
    render(<Probe recording={false} onStart={onStart} onStop={vi.fn()} />);
    const mic = screen.getByTestId('mic');
    down(mic, { button: 2 });
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(mic, { detail: 0 });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('долгое касание во время удержания не открывает меню', () => {
    render(<Probe recording={false} onStart={vi.fn()} onStop={vi.fn()} />);
    const mic = screen.getByTestId('mic');
    down(mic, { pointerType: 'touch' });
    fireEvent.contextMenu(mic);
    expect(screen.queryByTestId('mic-settings')).toBeNull();
  });
});

describe('useMicPress: click', () => {
  it('клик начинает, второй клик останавливает; pointerdown ничего не делает', () => {
    setMicMode('click');
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(<Probe recording={false} onStart={onStart} onStop={onStop} />);
    const mic = screen.getByTestId('mic');
    down(mic);
    fireEvent.pointerUp(mic);
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(mic, { detail: 1 });
    expect(onStart).toHaveBeenCalledTimes(1);
    rerender(<Probe recording onStart={onStart} onStop={onStop} />);
    fireEvent.click(mic, { detail: 1 });
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('меню настроек микрофона', () => {
  it('ПКМ открывает меню, переключатель меняет режим, Esc и клик вне закрывают', () => {
    render(<Probe recording={false} onStart={vi.fn()} onStop={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId('mic'));
    expect(screen.getByRole('dialog', { name: 'Настройки микрофона' })).toBeDefined();
    fireEvent.click(screen.getByLabelText('Клик – начать, клик – остановить'));
    expect(readMicMode()).toBe('click');
    expect(screen.getByTestId('mode').textContent).toBe('click');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('mic-settings')).toBeNull();
    fireEvent.click(screen.getByTestId('mic-gear'));
    expect(screen.getByTestId('mic-settings')).toBeDefined();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('mic-settings')).toBeNull();
  });
});
