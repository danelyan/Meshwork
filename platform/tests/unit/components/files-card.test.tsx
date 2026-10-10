import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FilesCard } from '@/components/consultant/FilesCard';
import { MATERIALS_EVENT } from '@/components/consultant/materials';
import { deleteMaterial, uploadFile } from '@/lib/api';

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  uploadFile: vi.fn(),
  deleteMaterial: vi.fn(),
}));

const pdf = (name = 'cv.pdf', size = 1024) => {
  const f = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const dt = (files: File[]) => ({ types: ['Files'], files, dropEffect: 'none' });

/** Лента консультанта: слушает материалы из колонки и отвечает outcome. */
function listenFeed(outcome: 'sent' | 'busy') {
  const got: unknown[] = [];
  const on = (e: Event) => {
    const d = (e as CustomEvent<{ outcome: string }>).detail;
    got.push({ ...d });
    d.outcome = outcome;
  };
  window.addEventListener(MATERIALS_EVENT, on);
  return { got, off: () => window.removeEventListener(MATERIALS_EVENT, on) };
}

afterEach(() => {
  cleanup();
  vi.mocked(uploadFile).mockReset();
  vi.mocked(deleteMaterial).mockReset();
});

describe('FilesCard', () => {
  it('drop: файл грузится, затем уходит консультанту; композер (drop на окне) видит defaultPrevented', async () => {
    vi.mocked(uploadFile).mockResolvedValue({ id: 'u1', filename: 'cv.pdf', deduplicated: false });
    const feed = listenFeed('sent');
    let windowSawPrevented: boolean | undefined;
    const onWindowDrop = (e: Event) => {
      windowSawPrevented = e.defaultPrevented;
    };
    window.addEventListener('drop', onWindowDrop);
    render(<FilesCard docs={[]} />);
    const zone = screen.getByTestId('files-drop');
    fireEvent.dragEnter(zone, { dataTransfer: dt([]) });
    expect(zone.getAttribute('data-over')).toBe('true');
    fireEvent.drop(zone, { dataTransfer: dt([pdf()]) });
    expect(zone.getAttribute('data-over')).toBeNull();
    expect(windowSawPrevented).toBe(true);
    expect(screen.getByText(/загружаю/)).toBeTruthy();
    await waitFor(() => expect(feed.got).toHaveLength(1));
    expect(feed.got[0]).toMatchObject({ uploadIds: ['u1'], urls: [], names: ['cv.pdf'] });
    expect(await screen.findByText('сохранён, консультант разбирает')).toBeTruthy();
    feed.off();
    window.removeEventListener('drop', onWindowDrop);
  });

  it('ошибки лимита понятным текстом, без запроса', () => {
    render(<FilesCard docs={[]} />);
    fireEvent.drop(screen.getByTestId('files-drop'), { dataTransfer: dt([pdf('big.pdf', 6 * 1024 * 1024), pdf('photo.png')]) });
    expect(screen.getByText(/«big.pdf»: больше 5 МБ/)).toBeTruthy();
    expect(screen.getByText(/«photo.png»: принимаем PDF, DOCX, MD, TXT и CSV/)).toBeTruthy();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('ошибка сервера показывается у файла', async () => {
    vi.mocked(uploadFile).mockRejectedValue(new Error('Файл больше 5 МБ'));
    render(<FilesCard docs={[]} />);
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [pdf()] } });
    expect(await screen.findByText('Файл больше 5 МБ')).toBeTruthy();
  });

  it('консультант занят: файл сохранён, кнопка «Разобрать» отправляет повторно', async () => {
    vi.mocked(uploadFile).mockResolvedValue({ id: 'u2', filename: 'cv.pdf', deduplicated: false });
    let feed = listenFeed('busy');
    render(<FilesCard docs={[]} />);
    fireEvent.drop(screen.getByTestId('files-drop'), { dataTransfer: dt([pdf()]) });
    expect(await screen.findByText('сохранён; консультант ещё отвечает')).toBeTruthy();
    feed.off();
    feed = listenFeed('sent');
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
    expect(feed.got).toHaveLength(1);
    expect(await screen.findByText('сохранён, консультант разбирает')).toBeTruthy();
    feed.off();
  });

  it('клавиатура: Enter на зоне открывает выбор файла', () => {
    render(<FilesCard docs={[]} />);
    const input = screen.getByTestId('files-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByTestId('files-drop'), { key: 'Enter' });
    expect(click).toHaveBeenCalled();
  });

  it('ссылка уходит в ленту; не ссылка и нет ленты — ошибка', () => {
    render(<FilesCard docs={[]} />);
    const input = screen.getByPlaceholderText(/Вставь ссылку/);
    fireEvent.change(input, { target: { value: 'просто текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Не похоже на ссылку/);

    fireEvent.change(input, { target: { value: 'github.com/octo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(screen.getByRole('alert').textContent).toMatch(/закончи знакомство/);

    const feed = listenFeed('sent');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(feed.got[0]).toMatchObject({ urls: ['https://github.com/octo'], uploadIds: [] });
    expect((input as HTMLInputElement).value).toBe('');
    feed.off();
  });

  it('список: «скачать» только при сохранённом оригинале; «удалить» — после подтверждения', async () => {
    vi.mocked(deleteMaterial).mockResolvedValue({ deletedClaims: 1, keptClaims: 0 });
    render(
      <FilesCard
        docs={[
          { id: 'u1', name: 'cv.pdf', kind: 'file', status: 'разобран, 2 утверждения', hasFile: true },
          { id: 'u0', name: 'old.pdf', kind: 'file', status: 'разобран, утверждений нет' },
          { id: 's1', name: 'github.com/octo', kind: 'link', status: 'разобран, утверждений нет' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Скачать cv.pdf' }).getAttribute('href')).toBe('/api/uploads/u1/file');
    expect(screen.queryByRole('link', { name: 'Скачать old.pdf' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Скачать github/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить github.com/octo' }));
    expect(screen.getByText(/Неподтверждённые утверждения из ссылки удалятся, подтверждённые останутся/)).toBeTruthy();
    expect(deleteMaterial).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(deleteMaterial).toHaveBeenCalledWith('link', 's1');
    await waitFor(() => expect(screen.queryByText('github.com/octo')).toBeNull());
  });
});
