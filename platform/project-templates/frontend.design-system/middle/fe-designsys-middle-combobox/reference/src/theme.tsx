// Эталон: токены темы по контракту.
import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export type TokenName = 'color.bg' | 'color.text' | 'color.primary' | 'space.2' | 'radius.md';
export type ThemeName = 'light' | 'dark';
type Overrides = Partial<Record<TokenName, string>>;

const TABLE: Record<ThemeName, Record<TokenName, string>> = {
  light: { 'color.bg': '#ffffff', 'color.text': '#111827', 'color.primary': '#2563eb', 'space.2': '8px', 'radius.md': '6px' },
  dark: { 'color.bg': '#0b1220', 'color.text': '#e5e7eb', 'color.primary': '#60a5fa', 'space.2': '8px', 'radius.md': '6px' },
};

interface Ctx {
  theme: ThemeName;
  overrides: Overrides;
}

const ThemeContext = createContext<Ctx | null>(null);

export function cssVarName(token: TokenName): string {
  return `--ds-${token.replace(/\./g, '-')}`;
}

function resolve(ctx: Ctx): Record<TokenName, string> {
  return { ...TABLE[ctx.theme], ...ctx.overrides } as Record<TokenName, string>;
}

export function ThemeProvider({ theme, overrides, children }: { theme?: ThemeName; overrides?: Overrides; children?: ReactNode }) {
  const parent = useContext(ThemeContext);
  const ctx: Ctx = { theme: theme ?? parent?.theme ?? 'light', overrides: { ...parent?.overrides, ...overrides } };
  const style: Record<string, string> = {};
  for (const [token, v] of Object.entries(resolve(ctx))) style[cssVarName(token as TokenName)] = v;
  return (
    <ThemeContext.Provider value={ctx}>
      <div data-theme={ctx.theme} style={style as CSSProperties}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useToken(token: TokenName): string {
  const ctx = useContext(ThemeContext) ?? { theme: 'light' as ThemeName, overrides: {} };
  const table = resolve(ctx);
  if (!(token in table)) throw new Error(`Unknown token: ${token}`);
  return table[token];
}
