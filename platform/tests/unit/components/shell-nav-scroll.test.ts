import { describe, expect, it } from 'vitest';

import { navScrollToShow } from '@/components/shell/nav';

describe('navScrollToShow: активный раздел в прокручиваемой полосе разделов кабинета', () => {
  const phone = { clientWidth: 358, scrollWidth: 705 };

  it('полоса помещается целиком - прокрутки нет', () => {
    expect(navScrollToShow({ clientWidth: 739, scrollWidth: 739 }, 600, 120)).toBe(0);
  });

  it('первый пункт - полоса остаётся в начале', () => {
    expect(navScrollToShow(phone, 0, 120)).toBe(0);
  });

  it('пункт в середине - по центру видимой части', () => {
    // центр пункта 300 + 110 / 2 = 355; центр видимой части 358 / 2 = 179 -> сдвиг 176
    expect(navScrollToShow(phone, 300, 110)).toBe(176);
  });

  it('последний пункт - не дальше конца прокрутки', () => {
    expect(navScrollToShow(phone, 560, 145)).toBe(705 - 358);
  });
});
