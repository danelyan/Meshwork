// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '../src/Dialog';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('style');
  document.body.removeAttribute('aria-hidden');
});

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });
const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
const openBtn = (name = 'Открыть') => screen.getByRole('button', { name });
const dialogEl = () => screen.getByRole('dialog');

function Basic(props: { onOpenChange?: (o: boolean) => void; open?: boolean; defaultOpen?: boolean; role?: 'alertdialog'; children?: React.ReactNode }) {
  const { children, role, ...root } = props;
  return (
    <Dialog {...root}>
      <Dialog.Trigger>Открыть</Dialog.Trigger>
      <Dialog.Content role={role}>
        {children ?? (
          <>
            <Dialog.Title>Заголовок</Dialog.Title>
            <input aria-label="A" />
            <input aria-label="B" />
            <Dialog.Close>Закрыть</Dialog.Close>
          </>
        )}
      </Dialog.Content>
    </Dialog>
  );
}

describe('Dialog: разметка', () => {
  it('триггер: aria-controls и aria-expanded только по состоянию; окно – role, aria-modal, tabindex', () => {
    render(<Basic />);
    const t = openBtn();
    expect(t.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(t);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const d = dialogEl();
    expect(t.getAttribute('aria-controls')).toBe(d.id);
    expect(d.id).not.toBe('');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('tabindex')).toBe('-1');
    expect(d.parentElement?.hasAttribute('data-dialog-overlay')).toBe(true);
    expect(d.parentElement?.parentElement).toBe(document.body);
  });

  it('aria-labelledby и aria-describedby есть, только если Title/Description смонтированы', () => {
    const { rerender } = render(
      <Basic defaultOpen>
        <Dialog.Title>Т</Dialog.Title>
        <Dialog.Description>О</Dialog.Description>
        <Dialog.Close>x</Dialog.Close>
      </Basic>,
    );
    const d = dialogEl();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Т');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toBe('О');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Т');
    rerender(
      <Basic defaultOpen>
        <Dialog.Close>x</Dialog.Close>
      </Basic>,
    );
    expect(dialogEl().hasAttribute('aria-labelledby')).toBe(false);
    expect(dialogEl().hasAttribute('aria-describedby')).toBe(false);
    cleanup();
    {
      render(
        <>
          <Dialog defaultOpen>
            <Dialog.Content><Dialog.Title>1</Dialog.Title></Dialog.Content>
          </Dialog>
          <Dialog defaultOpen>
            <Dialog.Content><Dialog.Title>2</Dialog.Title></Dialog.Content>
          </Dialog>
        </>,
      );
      const ds = screen.getAllByRole('dialog', { hidden: true });
      expect(ds).toHaveLength(2);
      const ids = ds.flatMap((d) => [d.id, d.getAttribute('aria-labelledby')]);
      expect(new Set(ids).size).toBe(4);
    }
  });

  it('role="alertdialog" и пробрасывание остальных пропсов', () => {
    render(
      <Dialog defaultOpen>
        <Dialog.Content role="alertdialog" className="box" data-x="1">
          <Dialog.Close>ok</Dialog.Close>
        </Dialog.Content>
      </Dialog>,
    );
    const d = screen.getByRole('alertdialog');
    expect(d.className).toBe('box');
    expect(d.getAttribute('data-x')).toBe('1');
  });


  it('часть вне Dialog бросает понятную ошибку; preventDefault в onClick триггера не открывает окно', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Dialog.Trigger>x</Dialog.Trigger>)).toThrow('Dialog.Trigger must be used within <Dialog>');
    expect(() => render(<Dialog.Close>x</Dialog.Close>)).toThrow('Dialog.Close must be used within <Dialog>');
    spy.mockRestore();
    cleanup();
    {
      render(
        <Dialog>
          <Dialog.Trigger onClick={(e) => e.preventDefault()}>Открыть</Dialog.Trigger>
          <Dialog.Content>
            <Dialog.Close>x</Dialog.Close>
          </Dialog.Content>
        </Dialog>,
      );
      fireEvent.click(openBtn());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(openBtn().getAttribute('aria-expanded')).toBe('false');
    }
  });

});

describe('Dialog: состояние', () => {
  it('контролируемый режим: Escape просит закрыть, но окно остаётся, пока родитель не передаст open', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Basic open onOpenChange={onOpenChange} />);
    esc();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
    rerender(<Basic open={false} onOpenChange={onOpenChange} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('неконтролируемый: defaultOpen открывает при монтировании, Close закрывает и зовёт onOpenChange(false) один раз', () => {
    const onOpenChange = vi.fn();
    render(<Basic defaultOpen onOpenChange={onOpenChange} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onOpenChange.mock.calls).toEqual([[false]]);
  });

  it('клик по оверлею закрывает, клик по содержимому – нет; alertdialog по оверлею не закрывается, по Escape – закрывается', () => {
    const { unmount } = render(<Basic />);
    fireEvent.click(openBtn());
    fireEvent.click(dialogEl());
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.click(dialogEl().parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    render(<Basic role="alertdialog" />);
    fireEvent.click(openBtn());
    fireEvent.click(screen.getByRole('alertdialog').parentElement!);
    expect(screen.queryByRole('alertdialog')).not.toBeNull();
    esc();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('Dialog: фокус', () => {
  it('начальный фокус: data-autofocus важнее первого табулируемого', () => {
    render(
      <Basic defaultOpen>
        <button>Первая</button>
        <button data-autofocus>Главная</button>
      </Basic>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Главная' }));
  });

  it('начальный фокус пропускает disabled, tabindex=-1, hidden и input[type=hidden]; без табулируемых – на самом окне', () => {
    const { unmount } = render(
      <Basic defaultOpen>
        <button disabled>Отключена</button>
        <button tabIndex={-1}>Минус</button>
        <div hidden><button>Скрытая</button></div>
        <input type="hidden" />
        <a href="#x">Ссылка</a>
      </Basic>,
    );
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Ссылка' }));
    unmount();
    render(
      <Basic defaultOpen>
        <p>Только текст</p>
      </Basic>,
    );
    expect(document.activeElement).toBe(dialogEl());
  });

  it('Tab и Shift+Tab: на краях переходят на другой край и гасятся; в середине не гасятся', () => {
    render(<Basic defaultOpen />);
    const [a, b] = [screen.getByLabelText('A'), screen.getByLabelText('B')];
    const close = screen.getByRole('button', { name: 'Закрыть' });
    expect(document.activeElement).toBe(a);
    expect(tab()).toBe(true);
    b.focus();
    expect(tab()).toBe(true);
    close.focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(a);
    cleanup();
    {
      render(<Basic defaultOpen />);
      const close = screen.getByRole('button', { name: 'Закрыть' });
      expect(tab(true)).toBe(false);
      expect(document.activeElement).toBe(close);
      screen.getByLabelText('B').focus();
      expect(tab(true)).toBe(true);
      dialogEl().focus();
      expect(tab(true)).toBe(false);
      expect(document.activeElement).toBe(close);
    }
  });


  it('без табулируемых Tab гасится, фокус остаётся на окне; с body – Tab уводит внутрь', () => {
    const { unmount } = render(
      <Basic defaultOpen>
        <p>текст</p>
      </Basic>,
    );
    expect(tab()).toBe(false);
    expect(tab(true)).toBe(false);
    expect(document.activeElement).toBe(dialogEl());
    unmount();

    render(<Basic defaultOpen />);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('A'));
    (document.activeElement as HTMLElement).blur();
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть' }));
  });

  it('программный фокус наружу возвращается на последнее место внутри окна', () => {
    render(
      <>
        <button>Снаружи</button>
        <Basic defaultOpen />
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Снаружи', hidden: true });
    screen.getByLabelText('B').focus();
    outside.focus();
    expect(document.activeElement).toBe(screen.getByLabelText('B'));
  });

  it('возврат фокуса: на элемент, бывший в фокусе при открытии; иначе на триггер; исчезнувший элемент не ломает закрытие', () => {
    function Ctl() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Внешняя</button>
          <Dialog open={open} onOpenChange={setOpen}>
            <Dialog.Content>
              <Dialog.Close>Закрыть</Dialog.Close>
            </Dialog.Content>
          </Dialog>
        </>
      );
    }
    render(<Ctl />);
    const ext = screen.getByRole('button', { name: 'Внешняя' });
    ext.focus();
    fireEvent.click(ext);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть' }));
    esc();
    expect(document.activeElement).toBe(ext);
    cleanup();
    {

      render(<Basic />);
      const t = openBtn();
      expect(document.activeElement).toBe(document.body);
      fireEvent.click(t);
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
      expect(document.activeElement).toBe(t);
    }
  });

  it('если вернуть фокус некуда (элемент убран из документа), закрытие проходит без ошибок', () => {
    const holder = document.createElement('button');
    document.body.appendChild(holder);
    holder.focus();
    const { rerender } = render(<Basic open>{<Dialog.Close>x</Dialog.Close>}</Basic>);
    expect(dialogEl()).toBeTruthy();
    holder.remove();
    expect(() => rerender(<Basic open={false} />)).not.toThrow();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Dialog: фон, прокрутка, размонтирование', () => {
  it('фон получает aria-hidden, прокрутка body блокируется на время открытия, прежние значения восстанавливаются', () => {
    const sibling = document.createElement('div');
    sibling.setAttribute('aria-hidden', 'true');
    const other = document.createElement('div');
    other.setAttribute('aria-hidden', 'false');
    document.body.append(sibling, other);
    const { container } = render(<Basic />);
    expect(container.getAttribute('aria-hidden')).toBeNull();
    fireEvent.click(openBtn());
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(other.getAttribute('aria-hidden')).toBe('true');
    expect(dialogEl().parentElement!.hasAttribute('aria-hidden')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Открыть' })).toBeNull();
    esc();
    expect(container.hasAttribute('aria-hidden')).toBe(false);
    expect(other.getAttribute('aria-hidden')).toBe('false');
    expect(sibling.getAttribute('aria-hidden')).toBe('true');
    sibling.remove();
    other.remove();
    cleanup();
    {
      document.body.style.overflow = 'scroll';
      render(<Basic />);
      fireEvent.click(openBtn());
      expect(document.body.style.overflow).toBe('hidden');
      esc();
      expect(document.body.style.overflow).toBe('scroll');
    }
  });


  it('размонтирование открытого окна снимает все эффекты и слушатели', () => {
    document.body.style.overflow = 'auto';
    const onOpenChange = vi.fn();
    const { unmount, container } = render(<Basic defaultOpen onOpenChange={onOpenChange} />);
    expect(container.getAttribute('aria-hidden')).toBe('true');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Dialog: вложенные окна', () => {
  function Nested({ onOuter, onInner }: { onOuter?: (o: boolean) => void; onInner?: (o: boolean) => void }) {
    return (
      <Dialog defaultOpen onOpenChange={onOuter}>
        <Dialog.Content>
          <Dialog.Title>Внешнее</Dialog.Title>
          <input aria-label="O1" />
          <Dialog onOpenChange={onInner}>
            <Dialog.Trigger>Глубже</Dialog.Trigger>
            <Dialog.Content>
              <Dialog.Title>Внутреннее</Dialog.Title>
              <input aria-label="I1" />
              <Dialog.Close>Назад</Dialog.Close>
            </Dialog.Content>
          </Dialog>
        </Dialog.Content>
      </Dialog>
    );
  }

  it('ловушка и Escape работают только для верхнего окна; внешнее не отбирает фокус', () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<Nested onOuter={onOuter} onInner={onInner} />);
    const deeper = screen.getByRole('button', { name: 'Глубже' });
    deeper.focus();
    fireEvent.click(deeper);
    const inner = screen.getByRole('dialog', { name: 'Внутреннее' });
    expect(inner.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('I1'));
    // ловушка внутреннего окна
    const back = screen.getByRole('button', { name: 'Назад' });
    back.focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('I1'));
    // внешнее окно скрыто от скринридеров целиком
    expect(screen.queryByRole('dialog', { name: 'Внешнее' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Внешнее', hidden: true }).parentElement!.getAttribute('aria-hidden')).toBe('true');
    // Escape закрывает только внутреннее
    esc();
    expect(onInner).toHaveBeenLastCalledWith(false);
    expect(onOuter).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Внутреннее' })).toBeNull();
    expect(document.activeElement).toBe(deeper);
    // внешнее снова верхнее: его фон и ловушка работают
    expect(screen.getByRole('dialog', { name: 'Внешнее' }).parentElement!.hasAttribute('aria-hidden')).toBe(false);
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('O1'));
    esc();
    expect(onOuter).toHaveBeenCalledWith(false);
    cleanup();
    {
      render(<Nested />);
      fireEvent.click(screen.getByRole('button', { name: 'Глубже' }));
      fireEvent.click(screen.getByRole('dialog', { name: 'Внутреннее' }).parentElement!);
      expect(screen.queryByRole('dialog', { name: 'Внутреннее' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Внешнее' })).toBeTruthy();
    }
  });

  it('прокрутка остаётся заблокированной, пока открыто хотя бы одно окно; восстанавливается исходное значение', () => {
    document.body.style.overflow = 'clip';
    render(<Nested />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Глубже' }));
    expect(document.body.style.overflow).toBe('hidden');
    esc();
    expect(document.body.style.overflow).toBe('hidden');
    esc();
    expect(document.body.style.overflow).toBe('clip');
  });

});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});

