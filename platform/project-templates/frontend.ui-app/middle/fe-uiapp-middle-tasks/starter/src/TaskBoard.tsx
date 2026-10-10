// Доска задач по контракту (contract.md).
import type { TasksApi } from './api';

export function TaskBoard({ api }: { api: TasksApi }) {
  void api;
  return <p>TODO: доска задач</p>;
}
