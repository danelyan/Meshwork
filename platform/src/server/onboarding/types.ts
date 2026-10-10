// Контракт онбординг-чата (E-02, лейн onboarding). Типы общие для сервера и клиента:
// клиент импортирует их только как `import type`.
import type { Specialization } from '@/lib/directions';

export type StepKind = 'consent' | 'role' | 'one' | 'many' | 'chips' | 'range' | 'text' | 'files' | 'summary';

export type Role = 'pending' | 'candidate' | 'employer';
export type Scenario = 'candidate' | 'employer';
export type FspStateValue = 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';

export interface StepOption {
  value: string;
  label: string;
  note?: string;
  /** Показан, но выбрать нельзя («скоро»). */
  disabled?: boolean;
  /** Как ответ звучит в ленте и сводке, если label — действие («Привязать» → «привязан»). */
  answered?: string;
}

export interface RangeSpec {
  min: number;
  max: number;
  step: number;
  /** Подпись единиц под числом. */
  unit: string;
  /** Множитель хранения: значение на шкале × scale = значение в БД (тыс ₽ → ₽). */
  scale: number;
  fromLabel: string;
  toLabel: string;
  defaults: { from: number; to: number };
}

/** Факты из БД, от которых зависят условия шагов. */
export interface Facts {
  role: Role;
  consent: boolean;
  name: string;
  fspState: FspStateValue | null;
  specialization: Specialization | null;
}

export type Answers = Record<string, unknown>;

export interface StepContext {
  answers: Answers;
  facts: Facts;
}

/** Текстовая проверка (кроме длины): ИНН по контрольной сумме; контакт — почта или Telegram (server/contact.ts). */
export type TextCheck = 'inn' | 'contact';

export interface StepDef {
  id: string;
  kind: StepKind;
  /** Кикер над вопросом. */
  eyebrow: string;
  question: string;
  sub?: string;
  /** Как шаг называется в сводке «вот что я понял». */
  summaryLabel: string;
  /** Куда пишется ответ (документация и тест трассируемости). */
  target: string;
  /** Требование ТЗ. */
  req: string;
  options?: StepOption[] | ((ctx: StepContext) => StepOption[]);
  /** Можно ввести свой вариант. */
  allowCustom?: boolean;
  /** Пропустить нельзя (согласие, роль, название компании). */
  required?: boolean;
  /** Показывать шаг, только если условие истинно. */
  when?: (ctx: StepContext) => boolean;
  /** Шаг закрыт фактом из БД (согласие уже дано, роль выбрана) — без ответа в состоянии. */
  doneBy?: (ctx: StepContext) => boolean;
  range?: RangeSpec;
  maxLength?: number;
  check?: TextCheck;
  placeholder?: string;
}

// --- вид для клиента (GET/POST /api/onboarding) ---

export interface FspDemoAchievement {
  event: string;
  year: number;
  result: string;
  role: string;
}

export interface StepView {
  id: string;
  kind: StepKind;
  eyebrow: string;
  /** Короткое имя шага (подпись поля, сводка). */
  label: string;
  question: string;
  sub?: string;
  /** Реплика помощника перед вопросом (шаблон или LLM). */
  lead: string;
  options?: StepOption[];
  allowCustom: boolean;
  required: boolean;
  /** Прежний ответ — при возврате к шагу. */
  value?: unknown;
  range?: RangeSpec;
  maxLength?: number;
  placeholder?: string;
  /** Подсказка (рекомендация грейда по подтверждённым утверждениям). */
  hint?: string;
  /** Шаг ФСП: что подтянется из демо-профиля (явно помечено «демо»). */
  fspDemo?: FspDemoAchievement[];
}

export interface HistoryItem {
  stepId: string;
  /** Короткое имя шага (как в сводке) — для «Что я уже знаю» в правой колонке консультанта. */
  label?: string;
  lead: string;
  question: string;
  /** null — шаг пропущен. */
  answer: string | null;
  /** Можно вернуться и поправить (не согласие и не роль). */
  editable: boolean;
}

export interface SummaryView {
  items: { stepId: string; label: string; value: string }[];
  skipped: { stepId: string; label: string }[];
  warnings: string[];
}

export interface OnboardingView {
  name: string;
  role: Role;
  scenario: Scenario | null;
  consent: { version: string; docUrl: string };
  progress: { done: number; total: number };
  history: HistoryItem[];
  /** Текущий шаг; при kind = 'summary' — итог. */
  current: StepView;
  summary: SummaryView | null;
  /** «Настроить позже» уведёт в кабинет (роль и согласие есть) или на главную. */
  laterTarget: string;
  /** Куда ведёт «Пройти тест на грейд»; testReady = false — роута теста ещё нет. */
  test: { href: string; ready: boolean };
  /** Онбординг уже завершён (человек вернулся настроить). */
  onboarded: boolean;
  /**
   * Кандидат нажал «Настроить позже» (решение владельца 10.10): на /consultant шаги на паузе,
   * лента — свободный разговор с консультантом; любой ответ, пропуск или возврат к шагу снимает паузу.
   */
  later?: boolean;
}
