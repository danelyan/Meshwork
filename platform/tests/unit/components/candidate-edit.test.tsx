import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileBasics } from '@/components/candidate/ProfileCards';
import { CandidateSettings } from '@/components/candidate/CandidateSettings';
const navigate = vi.fn();
beforeEach(() => { navigate.mockReset(); vi.stubGlobal('location', { ...window.location, assign: navigate }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function stub(fail = false) {
  const fetcher = vi.fn(async (url: string) => ({ ok: !(fail && url === '/api/onboarding'), status: fail && url === '/api/onboarding' ? 409 : 200, json: async () => url === '/api/onboarding' ? fail ? { error: { message: 'Этот вопрос недоступен' } } : { onboarded: true, current: { id: 'stack' } } : url === '/api/auth/me' ? { name: 'Тест', consent: true } : { version: 'v1' } }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
it('opens explicit editor only after validated goto succeeded', async () => {
  const fetcher = stub();
  render(<ProfileBasics details={null} name="Тест" />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Изменить ↗' })[0]!);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant?edit=profile'));
  expect(fetcher).toHaveBeenCalledWith('/api/onboarding', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'goto', stepId: 'stack' }) }));
});
it('does not navigate to editor when goto validation fails', async () => {
  stub(true);
  render(<ProfileBasics details={null} name="Тест" />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Изменить ↗' })[0]!);
  await screen.findByRole('alert');
  expect(navigate).not.toHaveBeenCalled();
});
it('opens FSP question in explicit editor from settings', async () => {
  const fetcher = stub();
  render(<CandidateSettings hidden={false} contact={null} fspState="not_linked" />);
  fireEvent.click(screen.getByRole('button', { name: /Добавить опыт в диалоге/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/consultant?edit=profile'));
  expect(fetcher).toHaveBeenCalledWith('/api/onboarding', expect.objectContaining({ body: JSON.stringify({ action: 'goto', stepId: 'fsp' }) }));
});
it('starts FSP ID linking via OIDC from settings', async () => {
  stub();
  render(<CandidateSettings hidden={false} contact={null} fspState="not_linked" />);
  fireEvent.click(screen.getByRole('button', { name: /^Привязать ФСП ID/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/api/fsp-id/link'));
});
