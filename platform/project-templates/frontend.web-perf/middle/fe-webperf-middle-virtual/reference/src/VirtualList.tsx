import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { computeWindow } from './windowing';

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

interface RowProps {
  index: number;
  count: number;
  rowHeight: number;
  renderRow: (index: number) => ReactNode;
}

const Row = memo(function Row({ index, count, rowHeight, renderRow }: RowProps) {
  return (
    <div
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={count}
      style={{ position: 'absolute', left: 0, right: 0, top: index * rowHeight, height: rowHeight }}
    >
      {renderRow(index)}
    </div>
  );
});

export function VirtualList({
  count,
  rowHeight,
  height,
  renderRow,
  overscan = 3,
  scrollToIndex,
  label = 'Список',
  onRangeChange,
}: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const { start, end, totalHeight } = computeWindow({ count, rowHeight, viewportHeight: height, scrollTop, overscan });

  useLayoutEffect(() => {
    if (scrollToIndex === undefined) return;
    const index = Math.min(Math.max(scrollToIndex, 0), Math.max(0, count - 1));
    const target = Math.min(index * rowHeight, Math.max(0, count * rowHeight - height));
    if (ref.current) ref.current.scrollTop = target;
    setScrollTop(target);
    // count/height/rowHeight намеренно не в зависимостях: прокрутка только при смене scrollToIndex
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex]);

  const lastRange = useRef<string | null>(null);
  useEffect(() => {
    const key = `${start}:${end}`;
    if (lastRange.current === key) return;
    lastRange.current = key;
    onRangeChange?.(start, end);
  });

  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push(<Row key={i} index={i} count={count} rowHeight={rowHeight} renderRow={renderRow} />);
  }

  return (
    <div
      ref={ref}
      role="list"
      aria-label={label}
      style={{ height, overflow: 'auto' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ position: 'relative', height: totalHeight }}>{rows}</div>
    </div>
  );
}
