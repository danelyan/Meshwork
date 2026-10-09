import { isDevHost } from '@/server/devtools/guard';

/**
 * Серверный гейт дебаг-панели: решает по env и Host. Клиентский код панели подгружается
 * динамическим import только в ветке «localhost» - в production он не отдаётся.
 */
export async function DevPanelGate() {
  if (!(await isDevHost())) return null;
  const { DevPanel } = await import('./DevPanel');
  return <DevPanel />;
}
