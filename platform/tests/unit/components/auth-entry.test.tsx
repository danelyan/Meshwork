import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthEntry } from '@/components/auth/AuthEntry';
import { AuthEntryFlow } from '@/components/auth/AuthEntryFlow';
import { demoEmployerLogin, demoFreshLogin, demoLogin, getDemoAccounts } from '@/lib/api';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

vi.mock('@/lib/api',()=>({demoEmployerLogin:vi.fn(),demoFreshLogin:vi.fn(),demoLogin:vi.fn(),getDemoAccounts:vi.fn()}));
const navigate = vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(getDemoAccounts).mockResolvedValue({candidates:[{id:'demo-1',name:'Анна',specialization:null,fspState:'not_linked'}],employers:[{id:'boss',name:'Олег',company:{id:'company',name:'Компания'}}]});
  vi.mocked(demoLogin).mockResolvedValue({candidate:{id:'demo-1',name:'Анна'},next:'/consultant'});
  vi.mocked(demoEmployerLogin).mockResolvedValue({employer:{id:'boss',name:'Олег'},next:'/employer'});
  vi.mocked(demoFreshLogin).mockResolvedValue({user:{id:'fresh',name:'Новый'},next:'/consultant'});
  HTMLDialogElement.prototype.showModal = vi.fn(function(this:HTMLDialogElement){this.open=true;});
  HTMLDialogElement.prototype.close = vi.fn(function(this:HTMLDialogElement){this.open=false;});
});
afterEach(cleanup);
function flow(next:string|null=null, demoEnabled=true, fspHint:string|null=null) {
  render(<AuthEntryFlow yandexEnabled={false} fspHint={fspHint} demoEnabled={demoEnabled} next={next} onClose={vi.fn()} navigate={navigate} />);
}

it('opens over the existing page and closes with focus and scroll restored',()=>{
  render(<AuthEntry yandexEnabled={false} demoEnabled><a href="/auth">Приступим</a><p>Главная</p></AuthEntry>);
  const entry=screen.getByRole('link',{name:'Приступим'}); entry.focus();
  fireEvent.click(entry);
  expect(screen.getByRole('dialog').textContent).toContain('Вход');
  expect(screen.getByText('Главная')).toBeTruthy();
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(screen.getByRole('button',{name:'Закрыть окно входа'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(entry);
  expect(document.body.style.overflow).toBe('');
});

it('preserves modified clicks and external auth links',()=>{
  render(<AuthEntry yandexEnabled={false} demoEnabled><a href="/auth" target="_blank" onClick={e=>e.preventDefault()}>Новая вкладка</a><a href="https://example.com/auth" onClick={e=>e.preventDefault()}>Внешний</a></AuthEntry>);
  fireEvent.click(screen.getByText('Новая вкладка')); fireEvent.click(screen.getByText('Внешний'),{ctrlKey:true});
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Вход без выбора роли (владелец 11.10): роль новому аккаунту задаёт чат, демо-профили — двумя группами.
it('opens sign-in at once, without a role step, and logs a ready candidate back to the page',async()=>{
  flow('/profile');
  expect(screen.queryByText('Кто вы?')).toBeNull();
  expect(screen.getByRole('form',{name:'Вход по почте'})).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Анна →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/profile'));
  expect(demoLogin).toHaveBeenCalledWith('demo-1');
  expect(demoEmployerLogin).not.toHaveBeenCalled();
});

it('lists specialists and companies in separate groups; a company goes to its assistant, not to a candidate link',async()=>{
  flow('/profile');
  const people=await screen.findByRole('group',{name:'Специалисты'});
  const companies=screen.getByRole('group',{name:'Компании'});
  expect(people.textContent).toContain('Анна');
  expect(companies.textContent).toContain('Компания');
  fireEvent.click(screen.getByRole('button',{name:'Компания →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(demoEmployerLogin).toHaveBeenCalledWith('boss');
});

it('creates a new demo profile only after consent; the role is asked in the AI chat',async()=>{
  flow();
  fireEvent.click(screen.getByRole('button',{name:'Новый демо-профиль'}));
  const enter=screen.getByRole('button',{name:'К ИИ-помощнику →'});
  expect((enter as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:/Согласен/}));
  fireEvent.click(enter);
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(demoFreshLogin).toHaveBeenCalledWith(CONSENT_VERSION);
  expect(screen.queryByRole('textbox',{name:'Название компании'})).toBeNull();
});

it('respects the demo flag and disables unconfigured real login',()=>{
  flow(null,false);
  expect(screen.queryByRole('button',{name:'Новый демо-профиль'})).toBeNull();
  expect(screen.getByText('Войти через Яндекс ID').closest('a')?.getAttribute('href')).toBeNull();
});

it('shares one consent checkbox across registration, both SSO buttons and fresh demo', async () => {
  render(<AuthEntryFlow yandexEnabled demoEnabled next="/profile" onClose={vi.fn()} navigate={navigate} />);
  await screen.findByRole('button', { name: 'Анна →' });
  fireEvent.click(screen.getByRole('button', { name: 'Регистрация' }));
  fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'shared@example.test' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'shared-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Новый демо-профиль' }));
  const checkboxes = screen.getAllByRole('checkbox', { name: 'Согласен(на) на обработку персональных данных' });
  expect(checkboxes).toHaveLength(1);
  const register = screen.getByRole('button', { name: 'Получить код' }) as HTMLButtonElement;
  const fresh = screen.getByRole('button', { name: 'К ИИ-помощнику →' }) as HTMLButtonElement;
  const yandex = screen.getByText('Войти через Яндекс ID').closest('a')!;
  const fsp = screen.getByText('Войти через ФСП ID').closest('a')!;
  expect(register.disabled).toBe(true);
  expect(fresh.disabled).toBe(true);
  expect(yandex.getAttribute('href')).toBeNull();
  expect(fsp.getAttribute('href')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Показать текст согласия' }));
  expect(register.disabled).toBe(true);
  expect(fresh.disabled).toBe(true);
  fireEvent.click(checkboxes[0]!);
  expect(register.disabled).toBe(false);
  expect(fresh.disabled).toBe(false);
  expect(new URL(yandex.getAttribute('href')!, 'http://localhost').searchParams.get('consent')).toBe(CONSENT_VERSION);
  expect(new URL(fsp.getAttribute('href')!, 'http://localhost').searchParams.get('consent')).toBe(CONSENT_VERSION);
  fireEvent.click(checkboxes[0]!);
  expect(register.disabled).toBe(true);
  expect(fresh.disabled).toBe(true);
  expect(yandex.getAttribute('href')).toBeNull();
  expect(fsp.getAttribute('href')).toBeNull();
  fireEvent.click(fresh);
  expect(demoFreshLogin).not.toHaveBeenCalled();
});

it('retries failed demo loading without blocking email login',async()=>{
  vi.mocked(getDemoAccounts).mockRejectedValueOnce(new Error('Сеть недоступна'));
  flow();
  expect((await screen.findByRole('alert')).textContent).toContain('Сеть недоступна');
  expect(screen.getByRole('form',{name:'Вход по почте'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Повторить загрузку профилей'}));
  fireEvent.click(await screen.findByRole('button',{name:'Компания →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(getDemoAccounts).toHaveBeenCalledTimes(2);
});

it('explains an empty demo list and keeps fresh profile creation available',async()=>{
  vi.mocked(getDemoAccounts).mockResolvedValue({candidates:[],employers:[]});
  flow();
  expect(await screen.findByText(/Готовых профилей пока нет/)).toBeTruthy();
  expect(screen.queryByText('Загружаю профили…')).toBeNull();
  expect(screen.getByRole('button',{name:'Новый демо-профиль'})).toBeTruthy();
});

it('подсказка «чем войти в симулятор ФСП ID» показана, только когда она задана (внешний провайдер)',()=>{
  flow(null, true, 'логин fsp-10001, пароль demo-pass');
  expect(screen.getByText('Вход в симулятор ФСП ID: логин fsp-10001, пароль demo-pass')).toBeTruthy();
  cleanup();
  flow();
  expect(screen.queryByText(/Вход в симулятор ФСП ID/)).toBeNull();
});
