// Поле подсказок по контракту (contract.md).
export interface SuggestInputProps {
  debounceMs?: number;
  minLength?: number;
}

export function SuggestInput(_props: SuggestInputProps) {
  // TODO: пауза ввода, минимальная длина, отмена устаревших запросов, статусы и ошибка по контракту
  return <input aria-label="Поиск" />;
}
