// PLATFORM-OWNED: интерфейс серверного API по контракту. Не меняйте.
export interface Task {
  id: string;
  title: string;
  done: boolean;
}

export interface TasksApi {
  list(): Promise<Task[]>;
  create(title: string): Promise<Task>;
  setDone(id: string, done: boolean): Promise<Task>;
}
