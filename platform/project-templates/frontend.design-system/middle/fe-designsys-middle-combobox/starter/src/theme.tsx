// Токены темы по контракту (contract.md).
import type { ReactNode } from 'react';

export type TokenName = 'color.bg' | 'color.text' | 'color.primary' | 'space.2' | 'radius.md';
export type ThemeName = 'light' | 'dark';

export function cssVarName(token: TokenName): string {
  void token;
  return '';
}

export function ThemeProvider({ children }: { theme?: ThemeName; overrides?: Partial<Record<TokenName, string>>; children?: ReactNode }) {
  // TODO: корневой div с data-theme и CSS-переменными, вложенность
  return <>{children}</>;
}

export function useToken(token: TokenName): string {
  void token;
  return '';
}
