'use client';

import type { SceneAsideData } from '@/server/consultant/aside';

import { Button } from '../ui';
import { useAsideData } from './aside-refresh';
import styles from './NextAction.module.css';

export interface NextStep {
  label: string;
  href: string;
}

/**
 * Действие текущего шага пути, у которого есть свой экран. Созвон и живая защита сюда не входят: у созвона своя
 * кнопка в шапке ленты (с проверкой готовности), у защиты действие зависит от слотов — оно в карточке шага справа.
 */
const CANDIDATE: Record<string, NextStep> = {
  test: { label: 'Пройти тест на грейд', href: '/test' },
  project: { label: 'Взять проект из ленты', href: '/projects' },
  invites: { label: 'Открыть приглашения', href: '/invitations' },
};
const EMPLOYER: Record<string, NextStep> = {
  needs: { label: 'Описать вакансию', href: '/employer/needs/new' },
  search: { label: 'Открыть подборку', href: '/employer' },
  invites: { label: 'Открыть приглашения', href: '/employer/invitations' },
};
const NEW_VACANCY: NextStep = { label: 'Описать новую вакансию', href: '/employer/needs/new' };

/**
 * Главное действие над полем ввода (макет Astra v2): шаг «сейчас» из пути. Идёт знакомство — действия нет
 * (нужно ответить на вопрос в ленте); шаг закрыт блокером (согласие, пауза пересдачи) — тоже нет: как его
 * снять, показывает карточка шага в правой колонке.
 */
export function nextStep(data: Pick<SceneAsideData, 'role' | 'steps' | 'onboarding' | 'stepBlock'> | undefined): NextStep | null {
  if (!data || data.onboarding || data.stepBlock?.blocker) return null;
  const now = data.steps.find((s) => s.state === 'now');
  if (!now) return null;
  return (data.role === 'employer' ? EMPLOYER : CANDIDATE)[now.id] ?? null;
}

/**
 * Полоса над композером на экране консультанта: одно главное действие и рядом запасное — кандидату «Загрузить
 * резюме» (то же окно выбора файла, что у скрепки), работодателю «Описать новую вакансию». Вне сцены консультанта
 * данных колонки нет — ничего не рисует.
 */
export function NextAction({ onAttach }: { onAttach?: () => void }) {
  const data = useAsideData();
  const step = nextStep(data);
  if (!data || !step) return null;
  const employer = data.role === 'employer';
  return (
    <div className={styles.bar} data-testid="next-action">
      <Button variant="cta" href={step.href} className={styles.primary}>
        {step.label}
        <span aria-hidden="true">→</span>
      </Button>
      {employer
        ? step.href !== NEW_VACANCY.href && <Button href={NEW_VACANCY.href}>{NEW_VACANCY.label}</Button>
        : onAttach && <Button onClick={onAttach}>Загрузить резюме</Button>}
    </div>
  );
}
