import { cleanup, render, screen } from '@testing-library/react';
import { ConsultantScene } from '@/components/head/ConsultantScene';
import { useCompanionVoice } from '@/components/avatar/voice';

vi.mock('@/components/avatar/HeadView', () => ({
  HeadView: ({ style }: { style: string }) => {
    const voice = useCompanionVoice();
    return <div data-testid="selected-head" data-style={style} data-voice={Boolean(voice)} />;
  },
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('places weave six beside the actual conversation with a shared voice provider', () => {
  const { container } = render(<ConsultantScene><p>Actual conversation</p></ConsultantScene>);
  expect(screen.getByText('Actual conversation')).toBeTruthy();
  expect(screen.getByTestId('selected-head').getAttribute('data-style')).toBe('weave6');
  expect(screen.getByTestId('selected-head').getAttribute('data-voice')).toBe('true');
  expect(container.querySelector('iframe')).toBeNull();
});
it('keeps the loading scene free of a renderer', () => {
  render(<ConsultantScene pending><p>Loading chat</p></ConsultantScene>);
  expect(screen.queryByTestId('selected-head')).toBeNull();
});
