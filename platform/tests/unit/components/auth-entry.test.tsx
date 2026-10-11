import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthEntry } from '@/components/auth/AuthEntry';
import { AuthEntryFlow } from '@/components/auth/AuthEntryFlow';
import { demoEmployerLogin, demoFreshLogin, demoLogin, getDemoAccounts } from '@/lib/api';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

vi.mock('@/lib/api',()=>({demoEmployerLogin:vi.fn(),demoFreshLogin:vi.fn(),demoLogin:vi.fn(),getDemoAccounts:vi.fn()}));
const navigate = vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(getDemoAccounts).mockResolvedValue({candidates:[],employers:[],personas:[
    {id:'fresh',kind:'fresh',stage:1,badge:'Пусто',name:'Новый пользователь',sees:'Чистый аккаунт.'},
    {id:'demo-1',kind:'candidate',stage:3,badge:'Профиль из резюме',name:'Анна',sees:'Профиль из резюме.'},
    {id:'boss',kind:'employer',stage:null,badge:'Поиск',name:'Компания',sees:'Вакансии и подборка.'},
  ]});
  vi.mocked(demoLogin).mockResolvedValue({candidate:{id:'demo-1',name:'Анна'},next:'/consultant'});
  vi.mocked(demoEmployerLogin).mockResolvedValue({employer:{id:'boss',name:'Олег'},next:'/employer'});
  vi.mocked(demoFreshLogin).mockResolvedValue({user:{id:'fresh',name:'Новый'},next:'/consultant'});
  HTMLDialogElement.prototype.showModal = vi.fn(function(this:HTMLDialogElement){this.open=true;});
  HTMLDialogElement.prototype.close = vi.fn(function(this:HTMLDialogElement){this.open=false;});
});
afterEach(cleanup);
function flow(next:string|null=null, demoEnabled=true) {
  render(<AuthEntryFlow yandexEnabled={false} demoEnabled={demoEnabled} next={next} onClose={vi.fn()} navigate={navigate} />);
}
const openEmail=()=>fireEvent.click(screen.getByRole('button',{name:/Войти по почте/}));

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

// Вход без выбора роли (владелец 11.10): роль новому аккаунту задаёт чат; демо-профили - курированные персоны двумя группами.
it('opens sign-in at once, without a role step, and logs a ready candidate back to the page',async()=>{
  flow('/profile');
  expect(screen.queryByText('Кто вы?')).toBeNull();
  expect(screen.queryByRole('form',{name:'Вход по почте'})).toBeNull();
  openEmail();
  expect(screen.getByRole('form',{name:'Вход по почте'})).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Войти как Анна'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/profile'));
  expect(demoLogin).toHaveBeenCalledWith('demo-1');
  expect(demoEmployerLogin).not.toHaveBeenCalled();
});

it('shows one persona card for the default stage 3; stage buttons and arrows switch it; a company tab logs in without a candidate link',async()=>{
  flow('/profile');
  const dot3=await screen.findByRole('button',{name:'Этап 3: Профиль из резюме'});
  expect(dot3.getAttribute('aria-current')).toBe('step');
  expect(screen.getByRole('button',{name:'Этап 1: Пусто'}).getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('button',{name:'Войти как Анна'}).closest('div')!.textContent).toContain('3 · Анна');
  fireEvent.keyDown(dot3,{key:'ArrowLeft'});
  expect(screen.getByRole('button',{name:'Этап 1: Пусто'}).getAttribute('aria-current')).toBe('step');
  fireEvent.click(screen.getByRole('button',{name:'Этап 3: Профиль из резюме'}));
  fireEvent.click(screen.getByRole('tab',{name:'Компании'}));
  expect(screen.queryByRole('button',{name:'Войти как Анна'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Войти как Компания'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/employer'));
  expect(demoEmployerLogin).toHaveBeenCalledWith('boss');
});

it('creates a new demo profile only after consent; the role is asked in the AI chat',async()=>{
  flow();
  fireEvent.click(await screen.findByRole('button',{name:'Этап 1: Пусто'}));
  const enter=screen.getByRole('button',{name:'Новый пользователь'});
  expect((enter as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:/Согласен/}));
  expect((enter as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(enter);
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(demoFreshLogin).toHaveBeenCalledWith(CONSENT_VERSION);
});

it('hides the Yandex button when it is not configured; FSP ID stays, disabled without consent',()=>{
  flow(null,false);
  expect(screen.queryByText('Войти через Яндекс ID')).toBeNull();
  expect(screen.getByText('Войти через ФСП ID').closest('a')?.getAttribute('href')).toBeNull();
});

it('respects the demo flag and disables unconfigured real login',()=>{
  flow(null,false);
  expect(screen.queryByRole('button',{name:/^Этап/})).toBeNull();
  expect(getDemoAccounts).not.toHaveBeenCalled();
  expect(screen.getByText('Войти через ФСП ID').closest('a')?.getAttribute('href')).toBeNull();
});

it('shares one consent checkbox across registration, both SSO buttons and fresh demo', async () => {
  render(<AuthEntryFlow yandexEnabled demoEnabled next="/profile" onClose={vi.fn()} navigate={navigate} />);
  await screen.findByRole('button', { name: 'Войти как Анна' });
  openEmail();
  fireEvent.click(screen.getByRole('button', { name: 'Регистрация' }));
  fireEvent.change(screen.getByLabelText('Почта'), { target: { value: 'shared@example.test' } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'shared-password' } });
  const checkboxes = screen.getAllByRole('checkbox', { name: 'Согласен(на) на обработку персональных данных' });
  expect(checkboxes).toHaveLength(1);
  const register = screen.getByRole('button', { name: 'Получить код' }) as HTMLButtonElement;
  fireEvent.click(screen.getByRole('button', { name: 'Этап 1: Пусто' }));
  const fresh = screen.getByRole('button', { name: 'Новый пользователь' }) as HTMLButtonElement;
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
  openEmail();
  expect(screen.getByRole('form',{name:'Вход по почте'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Повторить загрузку профилей'}));
  fireEvent.click(await screen.findByRole('tab',{name:'Компании'}));
  fireEvent.click(screen.getByRole('button',{name:'Войти как Компания'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/employer'));
  expect(getDemoAccounts).toHaveBeenCalledTimes(2);
});

it('keeps fresh profile creation available when the server sends no personas',async()=>{
  vi.mocked(getDemoAccounts).mockResolvedValue({candidates:[],employers:[]});
  flow();
  expect(await screen.findByRole('button',{name:'Новый пользователь'})).toBeTruthy();
  expect(screen.queryByText('Загружаю профили…')).toBeNull();
  expect(screen.queryByRole('tab',{name:'Компании'})).toBeNull();
});
