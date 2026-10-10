// PLATFORM-OWNED: интерфейс модели по контракту. Не меняйте: проверка подставляет свой клиент.
export interface LlmClient {
  complete(req: { system: string; user: string }): Promise<string>;
}
