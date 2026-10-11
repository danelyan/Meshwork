// Доска по контракту (contract.md).
export interface Stamp {
  c: number;
  r: string;
}
export type Op =
  | { kind: 'add'; id: string; title: string; column: string; ts: Stamp }
  | { kind: 'rename'; id: string; title: string; ts: Stamp }
  | { kind: 'move'; id: string; column: string; ts: Stamp }
  | { kind: 'remove'; id: string; ts: Stamp };

export interface Card {
  id: string;
  title: string;
  column: string;
}
export interface BoardStats {
  applied: number;
  duplicates: number;
  orphans: number;
}
export interface Replica {
  readonly id: string;
  add(title: string, column: string): Op;
  rename(cardId: string, title: string): Op;
  move(cardId: string, column: string): Op;
  remove(cardId: string): Op;
  apply(op: Op): void;
  snapshot(): Card[];
  log(): Op[];
  stats(): BoardStats;
  subscribe(listener: () => void): () => void;
}

export function createReplica(id: string): Replica {
  // TODO: реализовать по контракту
  const todo = (): never => {
    throw new Error('не реализовано');
  };
  return { id, add: todo, rename: todo, move: todo, remove: todo, apply: todo, snapshot: todo, log: todo, stats: todo, subscribe: todo };
}
