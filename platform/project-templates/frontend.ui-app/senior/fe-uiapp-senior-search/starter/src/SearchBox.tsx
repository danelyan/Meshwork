// Поиск по контракту (contract.md).
export interface Item {
  id: string;
  title: string;
}

export interface SearchBoxProps {
  search: (query: string, signal: AbortSignal) => Promise<Item[]>;
  onSelect: (item: Item) => void;
  debounceMs?: number;
  label?: string;
}

export function SearchBox({ label = 'Поиск' }: SearchBoxProps) {
  // TODO: запросы с дребезгом и отменой, кэш, список и клавиатура по контракту
  return <input aria-label={label} />;
}
