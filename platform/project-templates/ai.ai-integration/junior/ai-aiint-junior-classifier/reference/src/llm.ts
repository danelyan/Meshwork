// PLATFORM-OWNED: интерфейс модели (contract.md). Не меняйте: проверка подставляет свою модель.
export interface Llm {
  /** Отправляет prompt, возвращает текст ответа модели. */
  complete(prompt: string): Promise<string>;
}
