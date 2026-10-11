// Лента по контракту (contract.md).
export interface Message {
  id: string;
  author: string;
  text: string;
  sentAt: number;
  editedAt?: number;
}

export type FeedEvent =
  | { type: 'message'; message: Message }
  | { type: 'edit'; id: string; text: string; editedAt: number }
  | { type: 'delete'; id: string };

export interface Feed {
  apply(event: FeedEvent): void;
  messages(): Message[];
  unreadCount(): number;
  markRead(): void;
  subscribe(listener: () => void): () => void;
}

export function createFeed(_options?: { me?: string }): Feed {
  // TODO: реализовать по контракту
  const todo = (): never => {
    throw new Error('не реализовано');
  };
  return { apply: todo, messages: todo, unreadCount: todo, markRead: todo, subscribe: todo };
}
