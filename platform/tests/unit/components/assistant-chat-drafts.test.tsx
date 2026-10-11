import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AssistantChat } from '@/components/employer/AssistantChat';
import type { CompanyDraft, ProjectTaskDraft } from '@/server/agent/employer/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();
const streamOf = (s: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(s));
      c.close();
    },
  });

const COMPANY: CompanyDraft = {
  name: null,
  industry: 'Финтех',
  description: 'Платёжный сервис',
  contact: null,
  current: { name: 'Северный Поток', industry: null, description: null, contact: 'hr@x.ru' },
  rationale: 'Так кандидатам понятнее.',
};
const TASK: ProjectTaskDraft = {
  vacancyId: 'v1',
  vacancyTitle: 'Backend платежей',
  templateId: 'tpl-1',
  templateTitle: 'REST-сервис',
  criteria: [{ catalogId: 'be.idem', statement: 'Идемпотентность' }],
  wishes: 'Без фреймворков',
  visibility: 'feed',
  replacesExisting: true,
  rationale: 'Проверит ключевое.',
};
const restored = (event: object) => ({ conversationId: 'c', items: [{ id: '1', role: 'agent' as const, event: event as never }] });

describe('карточки черновиков помощника', () => {
  it('company_draft: только не-null поля, «Применить» шлёт PATCH и блокируется', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'co', name: 'Северный Поток' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AssistantChat initial={restored({ type: 'company_draft', draft: COMPANY })} />);
    expect(screen.getByText('Черновик профиля компании', { selector: 'h3' })).toBeDefined();
    expect(screen.getByText(/Платёжный сервис/)).toBeDefined();
    expect(screen.queryByText(/Название:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(screen.getByText(/Применено/)).toBeDefined());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/employer/company');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ industry: 'Финтех', description: 'Платёжный сервис' });
    expect(screen.queryByRole('button', { name: 'Применить' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Профиль компании' }).getAttribute('href')).toBe('/employer/company');
  });

  it('company_draft: ошибка сервера показывается, кнопка остаётся', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'x', message: 'Плохо' } }), { status: 500 })));
    render(<AssistantChat initial={restored({ type: 'company_draft', draft: COMPANY })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Применить' })).toBeDefined();
  });

  it('project_task_draft: рендер, предупреждение о замене, POST тем же телом, ссылка на вакансию', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 't1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AssistantChat initial={restored({ type: 'project_task_draft', draft: TASK })} />);
    expect(screen.getByText('Идемпотентность')).toBeDefined();
    expect(screen.getByText(/заменит/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Сформировать задание' }));
    await waitFor(() => expect(screen.getByText(/Задание сформировано/)).toBeDefined());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/employer/needs/v1/project');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ templateId: 'tpl-1', requiredCatalogIds: ['be.idem'], wishesText: 'Без фреймворков', visibility: 'open' });
    expect(screen.getByRole('link', { name: 'Открыть вакансию' }).getAttribute('href')).toBe('/employer/needs/v1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('page уходит в тело сообщения, чип quickPrompts отправляет текст', async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf('data: {"type":"done"}\n\n'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AssistantChat page={{ path: '/employer/needs/v1', vacancyId: 'v1' }} quickPrompts={['Подбери кандидатов']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Подбери кандидатов' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/employer/assistant/messages');
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'Подбери кандидатов', page: { path: '/employer/needs/v1', vacancyId: 'v1' } });
  });
});
