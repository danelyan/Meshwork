import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { EventFeed, type FeedItem, toBlocks } from '@/components/EventFeed';
import type { AgentEvent } from '@/server/agent/types';

afterEach(cleanup);

const claim = (id: string, statement = `Утверждение ${id}`, level = 'self_reported') => ({
  id,
  statement,
  quote: `цитата ${id}`,
  sourceRef: 'cv.pdf#p1:l1',
  level,
  limits: 'не доказывает объём',
  status: 'proposed',
});

let n = 0;
const ag = (event: AgentEvent): FeedItem => ({ id: `a${++n}`, role: 'agent', event });

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

describe('EventFeed: все типы AgentEvent', () => {
  it('claims без новых, но alreadyKnown > 0: честный заголовок со ссылкой на профиль', () => {
    render(<EventFeed items={[ag({ type: 'claims', proposed: [], rejected: 0, alreadyKnown: 4 })]} onClaimAction={async () => {}} />);
    expect(screen.getByText(/Новых утверждений нет: 4 уже в твоём профиле/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Открыть профиль' }).getAttribute('href')).toBe('/profile');
    expect(screen.queryByText(/не нашёл/)).toBeNull();
  });

  it('step: подряд идущие шаги в одном списке с aria-live', () => {
    render(<EventFeed items={[ag({ type: 'step', text: 'читаю резюме' }), ag({ type: 'step', text: 'читаю github.com/x' })]} />);
    const list = screen.getByRole('list', { name: 'Шаги консультанта' });
    expect(list.getAttribute('aria-live')).toBe('polite');
    expect(within(list).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['читаю резюме', 'читаю github.com/x']);
  });

  it('queue: показывает только последнюю позицию', () => {
    render(<EventFeed items={[ag({ type: 'queue', position: 3 }), ag({ type: 'queue', position: 2 })]} />);
    expect(screen.getByRole('status').textContent).toContain('2-й');
    expect(screen.queryByText(/3-й/)).toBeNull();
  });

  it('message и done: текст виден, done не рисуется', () => {
    const { container } = render(<EventFeed items={[ag({ type: 'message', text: 'Готово' }), ag({ type: 'done' })]} />);
    expect(screen.getByText('Готово')).toBeDefined();
    expect(container.querySelectorAll('ol > li').length).toBe(1);
  });

  it('claims: карточки, отброшенные без цитаты и плашка скрытого текста', () => {
    const items = [ag({ type: 'claims', proposed: [claim('1', undefined, 'artifact'), claim('2', undefined, 'artifact')], rejected: 2, hiddenText: 1 })];
    render(<EventFeed items={items} onClaimAction={async () => {}} onConfirmAll={async () => {}} />);
    expect(screen.getByText('Утверждение 1')).toBeDefined();
    expect(screen.getByText('Утверждение 2')).toBeDefined();
    expect(screen.getByText(/2 без цитаты/)).toBeDefined();
    expect(screen.getByText(/скрытый текст/)).toBeDefined();
    expect(screen.getAllByText('артефакт').length).toBe(2);
  });

  it('claims: без скрытого текста плашки нет; пустой список объяснён', () => {
    render(<EventFeed items={[ag({ type: 'claims', proposed: [], rejected: 0 })]} onClaimAction={async () => {}} />);
    expect(screen.queryByText(/скрытый текст/)).toBeNull();
    expect(screen.getByText(/не нашёл/)).toBeDefined();
  });

  it('«подтвердить все со слов» подтверждает каждое открытое утверждение', async () => {
    const confirmed: string[] = [];
    const onClaimAction = async (c: { id: string }) => { confirmed.push(c.id); };
    const { rerender } = render(
      <EventFeed
        items={[ag({ type: 'claims', proposed: [claim('1'), claim('2'), claim('3')], rejected: 0 })]}
        onClaimAction={onClaimAction}
        onConfirmAll={async (cs) => { for (const c of cs) await onClaimAction(c); }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить все со слов \(3\)/ }));
    await waitFor(() => expect(confirmed).toEqual(['1', '2', '3']));
    // родитель обновил статусы через overrides — кнопка «все» исчезает
    rerender(
      <EventFeed
        items={[ag({ type: 'claims', proposed: [claim('1'), claim('2'), claim('3')], rejected: 0 })]}
        claimOverrides={{ '1': { status: 'confirmed' }, '2': { status: 'confirmed' }, '3': { status: 'confirmed' } }}
        onClaimAction={onClaimAction}
        onConfirmAll={async () => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Подтвердить все/ })).toBeNull();
    expect(screen.getAllByText('Подтверждено').length).toBe(3);
  });

  it('«подтвердить все со слов» берёт только self_reported; артефакты — по одному', async () => {
    const got: string[][] = [];
    render(
      <EventFeed
        items={[ag({ type: 'claims', proposed: [claim('1'), claim('2'), claim('3', 'Код на GitHub', 'artifact')], rejected: 0 })]}
        onClaimAction={async () => {}}
        onConfirmAll={async (cs) => { got.push(cs.map((c) => c.id)); }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Подтвердить все со слов \(2\)/ }));
    await waitFor(() => expect(got).toEqual([['1', '2']]));
  });

  it('если со слов одно, а остальные артефакты — кнопки «все» нет', () => {
    render(
      <EventFeed
        items={[ag({ type: 'claims', proposed: [claim('1'), claim('2', 'a', 'artifact'), claim('3', 'b', 'artifact')], rejected: 0 })]}
        onClaimAction={async () => {}}
        onConfirmAll={async () => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Подтвердить все/ })).toBeNull();
  });

  it('ask: кнопки-варианты отправляют ответ один раз', () => {
    const onAnswer = vi.fn();
    render(<EventFeed items={[ag({ type: 'ask', question: 'Тест Middle или Junior?', options: ['Middle', 'Junior'] })]} onAnswer={onAnswer} />);
    expect(screen.getByText('Тест Middle или Junior?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Middle' }));
    expect(onAnswer).toHaveBeenCalledWith('Middle');
    expect((screen.getByRole('button', { name: 'Junior' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ask без вариантов — только вопрос', () => {
    render(<EventFeed items={[ag({ type: 'ask', question: 'Какая цель?' })]} />);
    expect(screen.getByText('Какая цель?')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('recommendations: задание, вакансия и тест карточками', () => {
    const items = [
      ag({
        type: 'recommendations',
        items: [
          { taskId: 't1', title: 'REST API с тестами', family: 'api', grade: 'junior', closes: ['x'], reason: 'закрывает пробел по API' },
          { vacancyId: 'v1', companyName: 'Контур', title: 'Backend', covered: 3, total: 5, missing: [{ catalogId: 'k', statement: 'Docker' }], reason: 'не хватает Docker' },
          { specialization: 'backend', grade: 'middle', allowed: true, reason: 'по утверждениям похоже на Middle' },
        ],
      }),
    ];
    render(<EventFeed items={items} />);
    expect(screen.getByText('REST API с тестами')).toBeDefined();
    expect(screen.getByText('Backend - Контур')).toBeDefined();
    expect(screen.getByText('закрываешь 3 из 5')).toBeDefined();
    expect(screen.getByText('Docker')).toBeDefined();
    expect(screen.getByText('Тест: Backend, middle')).toBeDefined();
  });

  it('error: сообщение в role=alert', () => {
    render(<EventFeed items={[ag({ type: 'error', code: 'llm_unavailable', message: 'Консультант недоступен' })]} />);
    expect(screen.getByRole('alert').textContent).toContain('Консультант недоступен');
  });

  it('реплика пользователя с файлами', () => {
    render(<EventFeed items={[{ id: 'u1', role: 'user', text: 'Собери профиль', files: ['cv.pdf'] }]} />);
    expect(screen.getByText(/Собери профиль/)).toBeDefined();
    expect(screen.getByText('cv.pdf')).toBeDefined();
  });

  it('пустая лента не падает', () => {
    render(<EventFeed items={[]} />);
    expect(screen.getByRole('list', { name: 'Переписка с консультантом' })).toBeDefined();
  });
});

describe('toBlocks', () => {
  it('queue после других событий не показывается устаревшей', () => {
    const blocks = toBlocks([ag({ type: 'queue', position: 1 }), ag({ type: 'step', text: 'начал' }), ag({ type: 'message', text: 'ok' })]);
    expect(blocks.map((b) => b.kind)).toEqual(['steps', 'event']);
  });
});
