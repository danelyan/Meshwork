// Ключи fe.setstate-batching и fe.effect-deps сверяются с реальным React (react-dom + jsdom): независимое решение.
import { act, createElement, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';

import { effectDeps, setstateBatching } from '@/server/test/generators/frontend-ui-app';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEEDS = Array.from({ length: 120 }, (_, i) => i * 7919 + 13);
const React = { createElement };

/** JSX → JS и выполнение: возвращает объявленную функцию-компонент. */
function load(code: string, name: string, log: (...a: unknown[]) => void): (props: never) => unknown {
  const js = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('React', 'useState', 'useEffect', 'useMemo', 'log', `${js}\nreturn ${name};`)(React, useState, useEffect, useMemo, log) as (props: never) => unknown;
}

describe('ключи ui-app через реальный React', () => {
  it('fe.setstate-batching: клик по кнопке', () => {
    for (const seed of SEEDS) {
      const inst = setstateBatching.generate(seed);
      const Counter = load(inst.code!, 'Counter', () => {});
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      act(() => root.render(createElement(Counter as never)));
      act(() => host.querySelector('button')!.click());
      expect(host.textContent, `seed ${seed}`).toBe(inst.answerKey);
      act(() => root.unmount());
      host.remove();
    }
  });

  it('fe.effect-deps: число срабатываний эффектов за последовательность рендеров', () => {
    for (const seed of SEEDS) {
      const inst = effectDeps.generate(seed);
      let runs = 0;
      const Panel = load(inst.code!, 'Panel', () => runs++);
      const props = [...inst.code!.matchAll(/userId=(\d+), filter='(\w+)'/g)].map((m) => ({ userId: Number(m[1]), filter: m[2]! }));
      const host = document.createElement('div');
      const root = createRoot(host);
      for (const p of props) act(() => root.render(createElement(Panel as never, p as never)));
      expect(String(runs), `seed ${seed}`).toBe(inst.answerKey);
      act(() => root.unmount());
    }
  });
});
