import { loadLastEmployerChat } from '@/server/agent/employer/restore';
import { llmIsDemoStub } from '@/server/demo/mode';
import { AssistantDrawer } from './AssistantDrawer';

/**
 * Плавающая помощница работодателя: кнопка-портрет и боковая панель с чатом (все черновики — только после
 * подтверждения человеком). Серверный компонент: подтягивает последний разговор, чтобы панель продолжала ту же
 * ленту, что и /consultant, и флаг демо без модели. Монтируется из layout через prop `employerDock`.
 */
export async function EmployerConsultantDock({ employerProfileId }: { employerProfileId: string }) {
  const initial = (await loadLastEmployerChat(employerProfileId).catch((e: unknown) => {
    console.warn('[employer dock] restore failed', e);
    return null;
  })) ?? undefined;
  return <AssistantDrawer initial={initial} demoNoLlm={llmIsDemoStub()} />;
}
