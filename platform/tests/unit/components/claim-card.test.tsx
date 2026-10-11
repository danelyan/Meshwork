import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { ClaimCard } from '@/components/ClaimCard';
import type { CardClaim } from '@/lib/claims-view';

afterEach(cleanup);

const base: CardClaim = {
  id: 'c1',
  statement: 'Пишет REST API на Node.js',
  quote: 'разработал REST API на Node.js для платежей',
  sourceRef: 'cv.pdf#p1:l4',
  level: 'self_reported',
  limits: 'не доказывает глубину владения',
  status: 'proposed',
};

function Harness({ onAction }: { onAction: (a: string, s?: string) => Promise<void> }) {
  const [claim, setClaim] = useState(base);
  return (
    <ClaimCard
      claim={claim}
      onAction={async (c, a, s) => {
        await onAction(a, s);
        setClaim({ ...c, status: a === 'confirm' ? 'confirmed' : a === 'reject' ? 'rejected' : 'edited', statement: s ?? c.statement });
      }}
    />
  );
}

describe('ClaimCard', () => {
  it('показывает формулировку, цитату в кавычках, источник, уровень и ограничение', () => {
    render(<Harness onAction={async () => {}} />);
    expect(screen.getByText('Пишет REST API на Node.js')).toBeDefined();
    expect(screen.getByText('«разработал REST API на Node.js для платежей»')).toBeDefined();
    expect(screen.getByText(/cv\.pdf#p1:l4/)).toBeDefined();
    expect(screen.getByText('со слов')).toBeDefined();
    expect(screen.getByText(/не доказывает глубину владения/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Да' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Поправить' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Нет' })).toBeDefined();
  });

  it('«Да» подтверждает и прячет кнопки', async () => {
    const spy = vi.fn(async () => {});
    render(<Harness onAction={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(screen.getByText('Подтверждено')).toBeDefined());
    expect(spy).toHaveBeenCalledWith('confirm', undefined);
    expect(screen.queryByRole('button', { name: 'Да' })).toBeNull();
  });

  it('«Нет» отклоняет', async () => {
    const spy = vi.fn(async () => {});
    render(<Harness onAction={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(screen.getByText('Отклонено')).toBeDefined());
    expect(spy).toHaveBeenCalledWith('reject', undefined);
  });

  it('«Поправить» открывает поле с label и отправляет новый текст', async () => {
    const spy = vi.fn(async () => {});
    render(<Harness onAction={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поправить' }));
    const field = screen.getByLabelText('Поправьте формулировку') as HTMLTextAreaElement;
    expect(field.value).toBe('Пишет REST API на Node.js');
    fireEvent.change(field, { target: { value: 'Пишет REST API на Fastify' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByText('Исправлено и подтверждено')).toBeDefined());
    expect(spy).toHaveBeenCalledWith('edit', 'Пишет REST API на Fastify');
    expect(screen.getByText('Пишет REST API на Fastify')).toBeDefined();
  });

  it('пустую правку отправить нельзя', () => {
    render(<Harness onAction={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поправить' }));
    fireEvent.change(screen.getByLabelText('Поправьте формулировку'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ошибка сервера показывается, кнопки остаются', async () => {
    render(<Harness onAction={async () => { throw new Error('Сервер недоступен'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Сервер недоступен');
    expect((screen.getByRole('button', { name: 'Да' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('busy блокирует кнопки', () => {
    render(<ClaimCard claim={base} onAction={async () => {}} busy />);
    expect((screen.getByRole('button', { name: 'Да' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('уже подтверждённое не показывает кнопки', () => {
    render(<ClaimCard claim={{ ...base, status: 'confirmed' }} onAction={async () => {}} />);
    expect(screen.queryByRole('button', { name: 'Да' })).toBeNull();
    expect(screen.getByText('Подтверждено')).toBeDefined();
  });
});

describe('ClaimCard: формулировка под цитату', () => {
  const api: CardClaim = {
    ...base,
    statement: 'Получал данные с сервера: состояния загрузки и ошибки, отмена запросов, гонки ответов',
    wording: 'Получала данные с API через fetch: состояния загрузки и ошибки',
    quote: 'Получала данные с API через fetch, показывала состояния загрузки и ошибки.',
  };

  it('крупно — формулировка под цитату, каталожная — мелко как тема созвона', () => {
    render(<ClaimCard claim={api} onAction={async () => {}} />);
    expect(screen.getByText('Получала данные с API через fetch: состояния загрузки и ошибки')).toBeDefined();
    expect(screen.getByText(/Проверим на созвоне:/)).toBeDefined();
    expect(screen.getByRole('article').getAttribute('aria-label')).toContain('Получала данные с API');
  });

  it('«Поправить» начинается с показанной формулировки', async () => {
    const spy = vi.fn(async () => {});
    render(<ClaimCard claim={api} onAction={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поправить' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(api.wording);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(api, 'edit', api.wording));
  });

  it('старая запись без wording — показывается statement, без строки о созвоне', () => {
    render(<ClaimCard claim={base} onAction={async () => {}} />);
    expect(screen.getByText('Пишет REST API на Node.js')).toBeDefined();
    expect(screen.queryByText(/Проверим на созвоне/)).toBeNull();
  });

  it('формулировка совпадает с цитатой — цитата не дублируется', () => {
    render(<ClaimCard claim={{ ...api, wording: 'Получала данные с API через fetch, показывала состояния загрузки и ошибки' }} onAction={async () => {}} />);
    expect(screen.queryByText(/^«/)).toBeNull();
    expect(screen.getByText('Дословно из вашего документа')).toBeDefined();
  });
});
