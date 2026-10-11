// Дашборд по контракту (contract.md): виджеты на общем кэше с бюджетом рендеров.
import type { QueryCache } from './queryCache';

export interface WidgetSpec {
  id: string;
  title: string;
  key: string;
}
export interface DashboardProps {
  cache: QueryCache;
  widgets: WidgetSpec[];
  onWidgetRender?: (id: string) => void;
}

export function Dashboard(_props: DashboardProps) {
  // TODO: кнопки «Компактный вид» и «Обновить всё», виджеты с подпиской на свой ключ,
  // <Profiler> внутри виджета, мемоизация, состояния загрузки и ошибки
  return <div data-compact="false" />;
}
