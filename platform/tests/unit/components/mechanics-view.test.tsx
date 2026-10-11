import { cleanup, render, screen } from '@testing-library/react';

import { MechanicsView } from '@/components/mechanics/MechanicsView';
import { buildMechanicsData } from '@/server/mechanics/page-data';

afterEach(cleanup);

describe('MechanicsView', () => {
  it('три варианта, ключ под раскрывашкой, IRT, блоки про утечку и сводку', () => {
    const data = buildMechanicsData({ spec: 'backend', seed: '4' });
    render(<MechanicsView data={data} />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getAllByText('Показать ключ')).toHaveLength(3);
    expect(screen.getByText(/a: различающая способность/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Почему утечка не помогает' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Сколько всего' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Полные цифры валидации' }).getAttribute('href')).toBe('/validation');
    expect(screen.getByRole('link', { name: 'Другой seed' }).getAttribute('href')).toContain('seed=5');
    expect(document.body.textContent).not.toMatch(/языков\S* модел/i);
  });
});
