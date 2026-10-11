import { describe, expect, it } from 'vitest';

import { csvCell, maskSmall, toCsv } from '@/server/admin/metrics/csv';
import { parseDays } from '@/server/admin/metrics/period';
import { recalibrationFlags } from '@/server/admin/metrics/test-monitor';

const base = { answered: 100, correctShare: 0.5, discrimination: 0.4, pairs: 100, irtA: 1, irtB: 0 };

describe('правило перекалибровки', () => {
  it('нормальное задание — без флагов', () => expect(recalibrationFlags(base)).toEqual([]));
  it('мало ответов — выводов нет', () => expect(recalibrationFlags({ ...base, answered: 10, correctShare: 1 })).toEqual([]));
  it('слишком лёгкое и слишком трудное', () => {
    expect(recalibrationFlags({ ...base, correctShare: 0.98 }).join()).toContain('слишком лёгкое');
    expect(recalibrationFlags({ ...base, correctShare: 0.02 }).join()).toContain('слишком трудное');
  });
  it('слабая корреляция — только при достаточном числе пар', () => {
    expect(recalibrationFlags({ ...base, discrimination: 0.02 }).join()).toContain('слабо различает');
    expect(recalibrationFlags({ ...base, discrimination: 0.02, pairs: 5 })).toEqual([]);
  });
  it('расхождение с моделью', () => {
    expect(recalibrationFlags({ ...base, correctShare: 0.9, irtB: 2 }).join()).toContain('далека от модели');
  });
});

describe('csv и период', () => {
  it('экранирует и защищает от формул', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell(-3)).toBe('-3');
    expect(toCsv(['a'], [[1]])).toContain('a\r\n1\r\n');
  });
  it('малые группы скрыты', () => {
    expect(maskSmall(4)).toBe('<5');
    expect(maskSmall(5)).toBe(5);
  });
  it('parseDays: умолчание 30, потолок 365', () => {
    expect(parseDays(undefined)).toBe(30);
    expect(parseDays('abc')).toBe(30);
    expect(parseDays('7')).toBe(7);
    expect(parseDays('99999')).toBe(365);
  });
});
