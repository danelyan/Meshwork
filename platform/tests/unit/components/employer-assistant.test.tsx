import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AssistantChat } from '@/components/employer/AssistantChat';
import { InviteForm } from '@/components/employer/InviteForm';
import type { AssistantCandidate, CandidatesBlock, CandidatesBlockView, InvitationDraft, NeedDraft } from '@/server/agent/employer/types';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const streamOf = (s: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(s));
      c.close();
    },
  });

const CAND: AssistantCandidate = {
  candidateId: 'c1',
  alias: 'Кандидат #ABC123',
  rank: 1,
  score: 0.81,
  category: 'Backend · Middle',
  specialization: 'backend',
  fsp: true,
  covered: 2,
  total: 3,
  coveredItems: [
    { statement: 'Идемпотентность', level: 'artifact', sourceType: 'github' },
    { statement: 'Транзакции', level: 'self_reported', sourceType: null },
  ],
  missing: ['Очереди'],
  stackMatched: ['Go'],
  summary: 's',
  invitation: null,
};
const BLOCK: CandidatesBlock = { vacancy: { id: 'v1', title: 'Backend платежей', salaryFrom: 200000, salaryTo: 260000 }, total: 6, items: [CAND, { ...CAND, candidateId: 'c2', alias: 'Кандидат #DEF456', rank: 2, invitation: 'accepted' }] };
const DRAFT: InvitationDraft = {
  candidateId: 'c1',
  alias: 'Кандидат #ABC123',
  vacancyId: 'v1',
  vacancyTitle: 'Backend платежей',
  salaryFrom: 200000,
  salaryTo: 260000,
  message: 'Северный Поток ищет: Backend платежей.',
  limit: { sent: 2, limit: 20, left: 18 },
  blocked: null,
};
const NEED: NeedDraft = {
  title: 'Backend-разработчик Middle (Go)',
  specialization: 'backend',
  grade: 'middle',
  stack: ['Go'],
  salaryFrom: 200000,
  salaryTo: 260000,
  teamDescription: null,
  needs: [{ catalogId: 'be.idempotency', statement: 'Делал идемпотентную обработку', weight: 3 }],
  formHref: '/employer/needs/new?spec=backend',
};

describe('лента помощника работодателя', () => {
  it('restores multiple invitation drafts inline; only an explicit cabinet action opens a modal', () => {
    const overflow = document.body.style.overflow;
    render(<><AssistantChat initial={{ conversationId: 'conv', items: [
      { id: 'draft-1', role: 'agent', event: { type: 'invitation_draft', draft: DRAFT } },
      { id: 'draft-2', role: 'agent', event: { type: 'invitation_draft', draft: { ...DRAFT, candidateId: 'c2', alias: 'Кандидат #DEF456' } } },
    ] }} /><InviteForm candidateId="c3" candidateName="Кандидат из кабинета" vacancyId="v1" /></>);
    expect(screen.getAllByRole('form', { name: /^Приглашение:/ })).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe(overflow);
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить: Кандидат из кабинета' }));
    expect(screen.getByRole('dialog', { name: 'Приглашение: Кандидат из кабинета' })).toBeDefined();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть приглашение' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('form', { name: /^Приглашение:/ })).toHaveLength(2);
    expect(document.body.style.overflow).toBe(overflow);
    cleanup();
    expect(document.body.style.overflow).toBe(overflow);
  });

  it('карточка принятого кандидата показывает имя (с псевдонимом), непринятого – только псевдоним; почты нет', () => {
    const block: CandidatesBlockView = { ...BLOCK, items: [CAND, { ...CAND, candidateId: 'c2', alias: 'Кандидат #DEF456', rank: 2, invitation: 'accepted', name: 'Мария Секретова' }] };
    render(<AssistantChat initial={{ conversationId: 'conv', items: [{ id: '2', role: 'agent', event: { type: 'candidates', block } }] }} />);
    const cards = screen.getAllByTestId('assistant-candidate');
    expect(within(cards[1]!).getByRole('heading').textContent).toContain('Мария Секретова');
    expect(within(cards[1]!).getByRole('heading').textContent).toContain('Кандидат #DEF456');
    expect(within(cards[0]!).getByRole('heading').textContent).toContain('Кандидат #ABC123');
    expect(within(cards[0]!).getByRole('heading').textContent).not.toContain('Мария');
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it('выдача карточками в сообщении: псевдоним, покрытие, «Пригласить»; у принявшего – ссылка на «Приглашения», без контактов', () => {
    render(
      <AssistantChat
        initial={{
          conversationId: 'conv',
          items: [
            { id: '1', role: 'user', text: 'Подбери под мою потребность Backend Middle' },
            { id: '2', role: 'agent', event: { type: 'candidates', block: BLOCK } },
            { id: '3', role: 'agent', event: { type: 'message', text: 'Под «Backend платежей» нашлось 6' } },
          ],
        }}
      />,
    );
    const block = screen.getByTestId('assistant-candidates');
    expect(within(block).getAllByTestId('assistant-candidate')).toHaveLength(2);
    expect(within(block).getByRole('heading', { name: /Кандидат #ABC123/ })).toBeDefined();
    expect(within(block).getAllByRole('img', { name: 'Закрыто 2 из 3 требований' })).toHaveLength(2);
    expect(within(block).getByRole('button', { name: 'Пригласить: Кандидат #ABC123' })).toBeDefined();
    expect(within(block).queryByRole('button', { name: 'Пригласить: Кандидат #DEF456' })).toBeNull();
    expect(within(block).getByRole('link', { name: '«Приглашения»' }).getAttribute('href')).toBe('/employer/invitations');
    expect(screen.getByText(/нашлось 6/)).toBeDefined();
    // до первого сообщения – подсказки; после – нет
    expect(screen.queryByRole('group', { name: 'С чего начать' })).toBeNull();
  });

  it('черновик приглашения – открытая форма с текстом и зарплатой; отправляет человек кнопкой', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'i1', status: 'sent' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AssistantChat initial={{ conversationId: 'conv', items: [{ id: '1', role: 'agent', event: { type: 'invitation_draft', draft: DRAFT } }] }} />);
    const form = screen.getByRole('form', { name: 'Приглашение: Кандидат #ABC123' });
    expect((within(form).getByRole('textbox', { name: /Почему именно этот кандидат/ }) as HTMLTextAreaElement).value).toContain('Северный Поток');
    expect(screen.getByText(/осталось 18 из 20/)).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole('button', { name: 'Отправить приглашение' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/employer/invitations');
    expect(JSON.parse(init.body as string)).toMatchObject({ candidateId: 'c1', vacancyId: 'v1', salaryFrom: 200000, salaryTo: 260000 });
  });

  it('черновик при исчерпанном лимите – без формы, с пояснением', () => {
    render(<AssistantChat initial={{ conversationId: null, items: [{ id: '1', role: 'agent', event: { type: 'invitation_draft', draft: { ...DRAFT, blocked: 'daily_limit' } } }] }} />);
    expect(screen.queryByRole('form', { name: /Приглашение/ })).toBeNull();
    expect(screen.getByText(/Лимит приглашений на сутки исчерпан/)).toBeDefined();
  });

  it('черновик потребности – требования и ссылка на форму', () => {
    render(<AssistantChat initial={{ conversationId: null, items: [{ id: '1', role: 'agent', event: { type: 'need_draft', draft: NEED } }] }} />);
    expect(screen.getByText('Делал идемпотентную обработку')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Открыть форму и сохранить' }).getAttribute('href')).toBe(NEED.formHref);
  });

  it('приветствие объясняет, что нужно от работодателя: потребность, подборка, приглашение', () => {
    render(<AssistantChat />);
    const t = screen.getByText(/Я Кира, помощница работодателя/).textContent ?? '';
    expect(t).toMatch(/описать вакансию/);
    expect(t).toMatch(/подберу кандидатов/);
    expect(t).toMatch(/приглашение с зарплатой/);
  });

  it('подсказка отправляет ход; события потока рисуются в ленте, id разговора уходит дальше', async () => {
    const first = frame({ type: 'conversation', id: 'conv-9' }) + frame({ type: 'candidates', block: BLOCK }) + frame({ type: 'message', text: 'Готово' }) + frame({ type: 'done' });
    const second = frame({ type: 'ask', question: 'Под какую потребность?', options: ['Backend платежей', 'Frontend'] }) + frame({ type: 'done' });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(streamOf(first), { status: 200 }))
      .mockImplementationOnce(async () => new Response(streamOf(second), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AssistantChat />);
    fireEvent.click(screen.getByRole('button', { name: 'Подбери под вакансию' }));
    await waitFor(() => expect(screen.getByText('Готово')).toBeDefined());
    expect(screen.getAllByTestId('assistant-candidate')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Сообщение помощнику'), { target: { value: 'ещё' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.getByText('Под какую потребность?')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Backend платежей' })).toBeDefined();
    const body = (i: number) => JSON.parse((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);
    expect(body(0)).toEqual({ text: 'Подбери под мою потребность' });
    expect(body(1)).toEqual({ text: 'ещё', conversationId: 'conv-9' });
  });
});

beforeEach(() => { HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; }); HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; }); });
