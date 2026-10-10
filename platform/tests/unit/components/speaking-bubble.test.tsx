import { cleanup, render } from '@testing-library/react';

import { SpeakingBubble } from '@/components/avatar/Speaking';
import { scrollToEnd } from '@/components/chat/scroll';

const voice = { status: 'speaking', speakingText: 'Привет. Как дела?', speakingKey: null as string | null, getProgress: () => 0.1 };
vi.mock('@/components/avatar/voice', () => ({ useCompanionVoice: () => voice }));

afterEach(() => {
  cleanup();
  voice.speakingKey = null;
});

const pulses = (c: HTMLElement) => [...c.querySelectorAll('[data-speaking]')].length;

describe('SpeakingBubble: звучащая реплика определяется ключом, а не текстом', () => {
  it('две одинаковые реплики с разными ключами: мигает только звучащая', () => {
    voice.speakingKey = 'b';
    const { container } = render(
      <>
        <SpeakingBubble text="Привет. Как дела?" speakKey="a">первая</SpeakingBubble>
        <SpeakingBubble text="Привет. Как дела?" speakKey="b">вторая</SpeakingBubble>
      </>,
    );
    const marked = [...container.querySelectorAll('[data-speaking]')];
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('вторая');
  });

  it('без ключа (история): по тексту и только у последней с таким текстом', () => {
    const { container } = render(
      <>
        <SpeakingBubble text="Привет. Как дела?" latest={false}>старая</SpeakingBubble>
        <SpeakingBubble text="Привет. Как дела?" latest>новая</SpeakingBubble>
      </>,
    );
    expect(pulses(container)).toBe(1);
    expect(container.querySelector('[data-speaking]')!.textContent).toContain('новая');
  });
});

describe('scrollToEnd', () => {
  it('в панели с data-feed-scroll крутит панель, а не окно', () => {
    const pane = document.createElement('div');
    pane.setAttribute('data-feed-scroll', '');
    pane.style.overflowY = 'auto';
    const end = document.createElement('div');
    pane.append(end);
    document.body.append(pane);
    const paneScroll = vi.fn();
    const intoView = vi.fn();
    pane.scrollTo = paneScroll as never;
    end.scrollIntoView = intoView;
    scrollToEnd(end);
    expect(paneScroll).toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
    pane.remove();
  });

  it('без панели - прежний scrollIntoView', () => {
    const end = document.createElement('div');
    document.body.append(end);
    const intoView = vi.fn();
    end.scrollIntoView = intoView;
    scrollToEnd(end);
    expect(intoView).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
    end.remove();
  });
});
