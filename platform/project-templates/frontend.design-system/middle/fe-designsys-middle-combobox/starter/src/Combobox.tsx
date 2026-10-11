// Combobox по контракту (contract.md).
export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  label: string;
  options: Option[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  name?: string;
  disabled?: boolean;
}

export function Combobox({ label }: ComboboxProps) {
  // TODO: разметка, фильтр, клавиатура, контролируемый и неконтролируемый режим
  return <p>TODO: {label}</p>;
}
