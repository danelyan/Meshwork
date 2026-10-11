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

const newer = (a: Stamp, b: Stamp): boolean => a.c > b.c || (a.c === b.c && a.r > b.r);

interface Entry {
  created: Stamp | null;
  title: { v: string; ts: Stamp } | null;
  column: { v: string; ts: Stamp } | null;
  removed: boolean;
}

function validate(op: unknown): Op {
  const o = op as Record<string, unknown> | null;
  const ts = o && (o.ts as Record<string, unknown> | null);
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !ts || typeof ts !== 'object') throw new TypeError('bad op');
  if (!Number.isInteger(ts.c) || (ts.c as number) < 0 || typeof ts.r !== 'string' || ts.r === '') throw new TypeError('bad ts');
  switch (o.kind) {
    case 'add':
      if (typeof o.title !== 'string' || typeof o.column !== 'string') throw new TypeError('bad add');
      break;
    case 'rename':
      if (typeof o.title !== 'string') throw new TypeError('bad rename');
      break;
    case 'move':
      if (typeof o.column !== 'string') throw new TypeError('bad move');
      break;
    case 'remove':
      break;
    default:
      throw new TypeError('bad kind');
  }
  return op as Op;
}

export function createReplica(id: string): Replica {
  const entries = new Map<string, Entry>();
  const seen = new Set<string>();
  const ops: Op[] = [];
  const listeners = new Set<() => void>();
  let clock = 0;
  let duplicates = 0;

  const entry = (cardId: string): Entry => {
    let e = entries.get(cardId);
    if (!e) {
      e = { created: null, title: null, column: null, removed: false };
      entries.set(cardId, e);
    }
    return e;
  };
  const visible = (e: Entry | undefined): e is Entry => !!e && e.created !== null && !e.removed;
  const snapshot = (): { id: string; title: string; column: string }[] => {
    const rows: { e: Entry; id: string }[] = [];
    for (const [cardId, e] of entries) if (visible(e)) rows.push({ e, id: cardId });
    rows.sort((x, y) => (newer(x.e.created!, y.e.created!) ? 1 : -1));
    return rows.map(({ e, id: cardId }) => ({ id: cardId, title: e.title!.v, column: e.column!.v }));
  };

  const ingest = (op: Op): boolean => {
    const key = `${op.kind}|${op.id}|${op.ts.c}|${op.ts.r}`;
    if (seen.has(key)) {
      duplicates += 1;
      return false;
    }
    seen.add(key);
    ops.push(op);
    clock = Math.max(clock, op.ts.c);
    const e = entry(op.id);
    if (op.kind === 'add') {
      if (!e.created || newer(e.created, op.ts)) e.created = op.ts;
      if (!e.title || newer(op.ts, e.title.ts)) e.title = { v: op.title, ts: op.ts };
      if (!e.column || newer(op.ts, e.column.ts)) e.column = { v: op.column, ts: op.ts };
    } else if (op.kind === 'rename') {
      if (!e.title || newer(op.ts, e.title.ts)) e.title = { v: op.title, ts: op.ts };
    } else if (op.kind === 'move') {
      if (!e.column || newer(op.ts, e.column.ts)) e.column = { v: op.column, ts: op.ts };
    } else {
      e.removed = true;
    }
    return true;
  };

  const run = (op: Op): void => {
    const before = JSON.stringify(snapshot());
    if (!ingest(op)) return;
    if (JSON.stringify(snapshot()) !== before) [...listeners].forEach((l) => l());
  };

  const local = (): Stamp => ({ c: clock + 1, r: id });
  const need = (cardId: string): void => {
    if (!visible(entries.get(cardId))) throw new Error(`нет карточки ${cardId}`);
  };

  return {
    id,
    add(title, column) {
      const ts = local();
      const op: Op = { kind: 'add', id: `${id}:${ts.c}`, title, column, ts };
      run(op);
      return op;
    },
    rename(cardId, title) {
      need(cardId);
      const op: Op = { kind: 'rename', id: cardId, title, ts: local() };
      run(op);
      return op;
    },
    move(cardId, column) {
      need(cardId);
      const op: Op = { kind: 'move', id: cardId, column, ts: local() };
      run(op);
      return op;
    },
    remove(cardId) {
      need(cardId);
      const op: Op = { kind: 'remove', id: cardId, ts: local() };
      run(op);
      return op;
    },
    apply(op) {
      run(validate(op));
    },
    snapshot,
    log: () => [...ops],
    stats() {
      let orphans = 0;
      for (const e of entries.values()) if (e.created === null) orphans += 1;
      return { applied: ops.length, duplicates, orphans };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
