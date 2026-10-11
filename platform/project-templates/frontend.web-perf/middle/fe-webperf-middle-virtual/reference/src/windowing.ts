export interface WindowInput {
  count: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
}
export interface WindowRange {
  start: number;
  end: number;
  totalHeight: number;
}

export function computeWindow({ count, rowHeight, viewportHeight, scrollTop, overscan }: WindowInput): WindowRange {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count');
  if (!(rowHeight > 0)) throw new RangeError('rowHeight');
  if (!(viewportHeight >= 0)) throw new RangeError('viewportHeight');
  if (!(overscan >= 0)) throw new RangeError('overscan');
  const totalHeight = count * rowHeight;
  const top = Math.min(Math.max(scrollTop, 0), Math.max(0, totalHeight - viewportHeight));
  const first = Math.floor(top / rowHeight);
  const lastExclusive = Math.min(count, Math.ceil((top + viewportHeight) / rowHeight));
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, lastExclusive + overscan),
    totalHeight,
  };
}
