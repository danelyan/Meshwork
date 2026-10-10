import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthEntry } from '@/components/auth/AuthEntry';
import { AuthEntryFlow } from '@/components/auth/AuthEntryFlow';
import { chooseRoleApi, demoEmployerLogin, demoFreshLogin, demoLogin, getDemoAccounts } from '@/lib/api';
import { CONSENT_VERSION } from '@/server/onboarding/consent-text';

vi.mock('@/lib/api',()=>({chooseRoleApi:vi.fn(),demoEmployerLogin:vi.fn(),demoFreshLogin:vi.fn(),demoLogin:vi.fn(),getDemoAccounts:vi.fn()}));
const navigate = vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(getDemoAccounts).mockResolvedValue({candidates:[{id:'demo-1',name:'Анна',specialization:null,fspState:'not_linked'}],employers:[{id:'boss',name:'Олег',company:{id:'company',name:'Компания'}}]});
  vi.mocked(demoLogin).mockResolvedValue({candidate:{id:'demo-1',name:'Анна'},next:'/consultant'});
  vi.mocked(demoEmployerLogin).mockResolvedValue({employer:{id:'boss',name:'Олег'},next:'/employer'});
  vi.mocked(demoFreshLogin).mockResolvedValue({user:{id:'fresh',name:'Новый'},next:'/consultant'});
  vi.mocked(chooseRoleApi).mockResolvedValue({role:'candidate',candidateId:'fresh',employerProfileId:null});
  HTMLDialogElement.prototype.showModal = vi.fn(function(this:HTMLDialogElement){this.open=true;});
  HTMLDialogElement.prototype.close = vi.fn(function(this:HTMLDialogElement){this.open=false;});
});
afterEach(cleanup);
function flow(next:string|null=null, demoEnabled=true) {
  render(<AuthEntryFlow yandexEnabled={false} demoEnabled={demoEnabled} next={next} onClose={vi.fn()} navigate={navigate} />);
}
function select(role='Ищу работу') {
  fireEvent.click(screen.getByRole('button',{name:new RegExp(role)}));
  fireEvent.click(screen.getByRole('button',{name:'Продолжить →'}));
}

it('opens over the existing page and closes with focus and scroll restored',()=>{
  render(<AuthEntry yandexEnabled={false} demoEnabled><a href="/auth">Приступим</a><p>Главная</p></AuthEntry>);
  const entry=screen.getByRole('link',{name:'Приступим'}); entry.focus();
  fireEvent.click(entry);
  expect(screen.getByRole('dialog').textContent).toContain('Кто вы?');
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

it('requires a role and logs a ready candidate into the assistant without a second account page',async()=>{
  flow('/profile');
  expect((screen.getByRole('button',{name:'Продолжить →'}) as HTMLButtonElement).disabled).toBe(true);
  select();
  fireEvent.click(await screen.findByRole('button',{name:'Анна →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/profile'));
  expect(demoLogin).toHaveBeenCalledWith('demo-1');
  expect(demoEmployerLogin).not.toHaveBeenCalled();
});

it('filters employer profiles and sends employers to their own assistant',async()=>{
  flow('/profile');select('Ищу специалистов');
  fireEvent.click(await screen.findByRole('button',{name:'Компания →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(screen.queryByRole('button',{name:'Анна →'})).toBeNull();
  expect(demoEmployerLogin).toHaveBeenCalledWith('boss');
});

it('creates a new profile only after consent, chooses its role and continues in the AI chat',async()=>{
  flow();select();
  fireEvent.click(screen.getByRole('button',{name:'Новый демо-профиль'}));
  const enter=screen.getByRole('button',{name:'К ИИ-помощнику →'});
  expect((enter as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox',{name:/Согласен/})[1]!);
  fireEvent.click(enter);
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(demoFreshLogin).toHaveBeenCalledWith(CONSENT_VERSION);
  expect(chooseRoleApi).toHaveBeenCalledWith({role:'candidate'});
  expect(screen.queryByText(/Выберите грейд/)).toBeNull();
});

it('keeps fresh-account retry from creating another account when assigning the role fails',async()=>{
  vi.mocked(chooseRoleApi).mockRejectedValueOnce(new Error('Попробуйте снова'));
  flow();select();fireEvent.click(screen.getByRole('button',{name:'Новый демо-профиль'}));
  fireEvent.click(screen.getAllByRole('checkbox',{name:/Согласен/})[1]!);
  fireEvent.click(screen.getByRole('button',{name:'К ИИ-помощнику →'}));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'К ИИ-помощнику →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(demoFreshLogin).toHaveBeenCalledTimes(1);
});

it('respects the demo flag and disables unconfigured real login',()=>{
  flow(null,false);select();
  expect(screen.queryByRole('button',{name:'Новый демо-профиль'})).toBeNull();
  expect(screen.getByText('Войти через Яндекс ID').closest('a')?.getAttribute('href')).toBeNull();
});
it('creates an employer profile with a company before handing off to the assistant',async()=>{
  flow();select('Ищу специалистов');
  fireEvent.click(screen.getByRole('button',{name:'Новый демо-профиль'}));
  fireEvent.click(screen.getAllByRole('checkbox',{name:/Согласен/})[1]!);
  expect((screen.getByRole('button',{name:'К ИИ-помощнику →'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox',{name:'Название компании'}),{target:{value:' Тестовая компания '}});
  fireEvent.click(screen.getByRole('button',{name:'К ИИ-помощнику →'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/consultant'));
  expect(chooseRoleApi).toHaveBeenCalledWith({role:'employer',companyName:'Тестовая компания'});
});
