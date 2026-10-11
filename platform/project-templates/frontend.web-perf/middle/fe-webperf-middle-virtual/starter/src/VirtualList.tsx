// Виртуализированный список по контракту (contract.md).
import type { ReactNode } from 'react';

export interface VirtualListProps {
  count: number;
  rowHeight: number;
  height: number;
  renderRow: (index: number) => ReactNode;
  overscan?: number;
  scrollToIndex?: number;
  label?: string;
  onRangeChange?: (start: number, end: number) => void;
}

export function VirtualList(props: VirtualListProps) {
  // TODO: контейнер с прокруткой, распорка, строки окна, scrollToIndex, onRangeChange
  return <div role="list" aria-label={props.label ?? 'Список'} />;
}
