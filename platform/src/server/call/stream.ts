// Потоковый вопрос интервьюера (лейн call-speed, 11.10): модель отдаёт JSON по схеме кусками, отсюда вопрос
// уходит кандидату по предложениям – TTS первого предложения стартует до конца генерации. Транскрипт и оценщик
// не меняются: в транскрипт пишется итоговая реплика целиком, и она всегда начинается с уже прозвучавших
// предложений (иначе счёт услышанного для POST /interrupt разошёлся бы).
//
// Защиты интервьюера работают и здесь, выбор – «проверять по мере поступления»:
//  - поля до вопроса (тема/компетенция, сигнал, где нужно – done) проверяются до первого предложения: пока их
//    нет – ждём, нарушение – поток стоп, дальше обычный путь (переформулировка или шаблон);
//  - пересказ профиля и кириллица проверяются на всём полученном тексте вопроса перед каждым предложением;
//  - сбой после того, как что-то прозвучало (таймаут, мусор, пересказ в хвосте), не даёт повторного запроса:
//    реплика = прозвучавшее (если в нём уже есть вопрос) или прозвучавшее + вопрос из шаблона.
import { splitSentences, stableSentences } from '../../lib/sentences';

export type GateState = 'ok' | 'wait' | 'stop';

export interface QuestionGateOptions {
  /** Поле JSON с текстом вопроса. */
  field: string;
  /** Поля, пришедшие целиком (кроме недописанного вопроса): можно ли начинать озвучку. */
  ready(fields: Readonly<Record<string, unknown>>): GateState;
  /** Весь полученный текст вопроса проходит проверки содержания (пересказ профиля, кириллица). */
  textOk(question: string): boolean;
  /** Вводная фраза перед первым предложением (отказ подсказывать), по первому предложению; null – без неё. */
  lead?(first: string): string | null;
  /** Предложение готово к озвучке: n – его номер в итоговой реплике (с 0). */
  onSentence(text: string, n: number): void;
}

/** Итог потокового вопроса. */
export interface Composed {
  text: string;
  /** true – реплика = вопрос модели целиком; false – прозвучавшее (+ шаблон). */
  usedChosen: boolean;
  /** Прозвучавшее уже содержит вопрос, шаблон не добавлялся. */
  cut: boolean;
}

export class QuestionGate {
  readonly emitted: string[] = [];
  private buf = '';
  private stopped = false;
  private leadText: string | null | undefined;

  constructor(private readonly opts: QuestionGateOptions) {}

  /** Хоть одно предложение ушло кандидату: повторный запрос к модели после этого запрещён. */
  get started(): boolean {
    return this.emitted.length > 0;
  }

  /** Новая попытка (переформулировка): только пока ничего не прозвучало. */
  reset(): void {
    if (this.started) return;
    this.buf = '';
    this.stopped = false;
    this.leadText = undefined;
  }

  push(chunk: string): void {
    this.buf += chunk;
    if (this.stopped) return;
    try {
      this.pump();
    } catch (err) {
      // Разбор потока не должен ронять ход: просто перестаём озвучивать по частям.
      this.stopped = true;
      console.warn('[call] stream gate failed:', err instanceof Error ? err.message : err);
    }
  }

  private pump(): void {
    const { fields, open } = scanTopLevel(this.buf);
    const closed = typeof fields[this.opts.field] === 'string';
    const question = closed ? (fields[this.opts.field] as string) : open?.key === this.opts.field ? open.value : null;
    if (question === null) return;
    const rest = { ...fields };
    delete rest[this.opts.field];
    const state = this.opts.ready(rest);
    if (state === 'stop') {
      this.stopped = true;
      return;
    }
    if (state === 'wait') return;
    const sentences = closed ? splitSentences(question) : stableSentences(question);
    if (!sentences.length) return;
    if (this.leadText === undefined) {
      this.leadText = this.opts.lead?.(sentences[0]!) ?? null;
      if (this.leadText) this.emit(this.leadText);
    }
    const offset = this.leadText ? 1 : 0;
    for (let i = this.emitted.length - offset; i < sentences.length; i++) {
      if (!this.opts.textOk(question)) {
        this.stopped = true;
        return;
      }
      this.emit(sentences[i]!);
    }
  }

  private emit(text: string): void {
    const n = this.emitted.length;
    this.emitted.push(text);
    this.opts.onSentence(text, n);
  }

  /**
   * Итоговая реплика. chosen – вопрос модели, прошедший все проверки (без вводной), иначе null; template –
   * запасной вопрос. null – ничего не прозвучало, вызывающий собирает реплику как раньше.
   */
  compose(chosen: string | null, template: string): Composed | null {
    if (!this.started) return null;
    const head = this.emitted.join(' ');
    if (chosen && chosen.trim()) {
      const full = this.leadText ? `${this.leadText} ${chosen.trim()}` : chosen.trim();
      if (startsWithSentences(full, this.emitted)) return { text: full, usedChosen: true, cut: false };
    }
    if (head.includes('?')) return { text: head, usedChosen: false, cut: true };
    return { text: `${head} ${template.trim()}`, usedChosen: false, cut: false };
  }
}

/** Разбиение текста начинается ровно с этих предложений. */
export function startsWithSentences(text: string, head: readonly string[]): boolean {
  const s = splitSentences(text);
  return head.every((h, i) => s[i] === h);
}

// ---------------------------------------------------------------------------
// Разбор недописанного JSON
// ---------------------------------------------------------------------------

/**
 * Поля верхнего уровня недописанного JSON-объекта: целиком пришедшие значения (строки, true/false/null, числа;
 * вложенные объекты и массивы пропускаются) и недописанная строка в конце. Перед объектом допускается мусор
 * (```json, пояснение) – разбор начинается с первой `{`. Порядок полей любой: модель не обязана держать порядок
 * схемы (живой замер 11.10: deepseek ставил done раньше question).
 */
export function scanTopLevel(buf: string): { fields: Record<string, unknown>; open: { key: string; value: string } | null } {
  const fields: Record<string, unknown> = {};
  let i = buf.indexOf('{');
  if (i < 0) return { fields, open: null };
  i++;
  const n = buf.length;
  const ws = () => {
    while (i < n && /\s/.test(buf[i]!)) i++;
  };
  /** Строка с позиции открывающей кавычки: значение и закрыта ли. */
  const str = (): { value: string; closed: boolean } => {
    i++; // "
    let out = '';
    while (i < n) {
      const c = buf[i]!;
      if (c === '"') {
        i++;
        return { value: out, closed: true };
      }
      if (c === '\\') {
        if (i + 1 >= n) break;
        const e = buf[i + 1]!;
        if (e === 'u') {
          if (i + 6 > n) break;
          out += String.fromCharCode(parseInt(buf.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === 'b' ? '\b' : e === 'f' ? '\f' : e;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    i = n;
    return { value: out, closed: false };
  };
  /** Пропуск вложенного объекта/массива; false – не дописан. */
  const skipNested = (): boolean => {
    let depth = 0;
    while (i < n) {
      const c = buf[i]!;
      if (c === '"') {
        if (!str().closed) return false;
        continue;
      }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          i++;
          return true;
        }
      }
      i++;
    }
    return false;
  };
  for (;;) {
    ws();
    if (i >= n || buf[i] === '}') break;
    if (buf[i] === ',') {
      i++;
      continue;
    }
    if (buf[i] !== '"') break;
    const key = str();
    if (!key.closed) break;
    ws();
    if (buf[i] !== ':') break;
    i++;
    ws();
    if (i >= n) break;
    const c = buf[i]!;
    if (c === '"') {
      const v = str();
      if (!v.closed) return { fields, open: { key: key.value, value: v.value } };
      fields[key.value] = v.value;
    } else if (c === '{' || c === '[') {
      if (!skipNested()) break;
    } else {
      const m = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/.exec(buf.slice(i));
      if (!m) break;
      fields[key.value] = m[1] === 'true' ? true : m[1] === 'false' ? false : m[1] === 'null' ? null : Number(m[1]);
      i += m[1]!.length;
    }
  }
  return { fields, open: null };
}

/** Потоковый режим для интервьюера: куда отдавать предложения и может ли этот ход закрыть созвон. */
export interface InterviewerStream {
  onSentence(text: string, n: number): void;
  /**
   * Ответ модели «достаточно» (done) этим ходом заменит вопрос итогом или этапом разбора (минимум вопросов
   * набран, это не дополнительный вопрос). Тогда вопрос озвучивается заранее, только если done уже пришёл и он false.
   */
  closable: boolean;
}
