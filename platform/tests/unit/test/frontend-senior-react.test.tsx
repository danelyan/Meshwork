// Senior-семейства, ключи которых сверяются с реальным React 19 (react-dom + jsdom): повтор эффектов в StrictMode,
// перерисовки при контексте и memo, сохранение состояния строк при разных key.
import { act, createContext, createElement, memo, StrictMode, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

import { srContextRenders, srEffectLifecycle, srKeyReconcile } from '@/server/test/generators/frontend-senior';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const SEEDS = Array.from({ length: 150 }, (_, i) => i * 7919 + 13);

function load<T>(code: string, ret: string, scope: Record<string, unknown>): T {
  const js = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const names = Object.keys(scope);
  return new Function('React', ...names, `${js}\nreturn ${ret};`)({ createElement }, ...names.map((n) => scope[n])) as T;
}

describe('Senior через реальный React', () => {
  it('fe.sr-effect-lifecycle: StrictMode, обновления и unmount', () => {
    for (const seed of SEEDS) {
      const inst = srEffectLifecycle.generate(seed);
      const logs: string[] = [];
      const Widget = load<(p: { id: string; mode: string }) => null>(inst.code!, 'Widget', { useEffect, log: (s: string) => logs.push(s) });
      const props = [...inst.code!.matchAll(/id='(\w+)', mode='(\w+)'/g)].map((m) => ({ id: m[1]!, mode: m[2]! }));
      const root = createRoot(document.createElement('div'));
      for (const p of props) act(() => root.render(createElement(StrictMode, null, createElement(Widget, p))));
      act(() => root.unmount());
      expect(logs.join(','), `seed ${seed}`).toBe(inst.answerKey);
    }
  });

  it('fe.sr-context-renders: клики по кнопкам, счёт выполнений компонентов', () => {
    for (const seed of SEEDS) {
      const inst = srContextRenders.generate(seed);
      let n = 0;
      const App = load<() => unknown>(inst.code!, 'App', {
        Ctx: createContext<{ count: number } | null>(null),
        memo,
        useContext,
        useMemo,
        useState,
        log: () => n++,
      });
      const events = /нажаты кнопки: ([^(]+) \(/.exec(inst.prompt)![1]!.trim().split(', ');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      act(() => root.render(createElement(App as never)));
      for (const e of events) act(() => (host.querySelector(`#${e}`) as HTMLButtonElement).click());
      expect(String(n), `seed ${seed}`).toBe(inst.answerKey);
      act(() => root.unmount());
      host.remove();
    }
  });

  it('fe.sr-key-reconcile: введённый текст в полях после смены списка', () => {
    for (const seed of SEEDS) {
      const inst = srKeyReconcile.generate(seed);
      const lists = [...inst.prompt.matchAll(/items(?: стал| =) \[([^\]]*)\]/g)].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
      const typed = /значения ([^.]+)\./.exec(inst.prompt)![1]!.split(', ');
      const ask = /строки «([^»]+)»/.exec(inst.prompt)![1]!;
      const List = load<(p: { items: string[] }) => unknown>(inst.code!, 'List', {});
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      act(() => root.render(createElement(List as never, { items: lists[0] } as never)));
      host.querySelectorAll('input').forEach((el, i) => {
        el.value = typed[i]!; // DOM-значение неуправляемого поля
      });
      act(() => root.render(createElement(List as never, { items: lists[1] } as never)));
      const row = [...host.querySelectorAll('li')].find((li) => li.querySelector('span')!.textContent === ask)!;
      const v = row.querySelector('input')!.value;
      expect(v === '' ? '(пусто)' : v, `seed ${seed}`).toBe(inst.answerKey);
      act(() => root.unmount());
      host.remove();
    }
  });
});
