// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TaskBoard } from '../../src/TaskBoard';

import { TASKS, controlledApi } from './fake-api';

afterEach(cleanup);

describe('доска задач (visible)', () => {
  it('показывает загрузку, затем задачи и счётчик', async () => {
    const c = controlledApi();
    render(<TaskBoard api={c.api} />);
    expect(screen.getByRole('status').textContent).toContain('Загрузка');
    await act(async () => c.last('list').d.resolve(TASKS));
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('Осталось: 2')).toBeTruthy();
  });
});
