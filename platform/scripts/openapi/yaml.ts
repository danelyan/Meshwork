// Минимальный YAML-эмиттер и разборщик для документа OpenAPI. Без зависимостей: в проекте нет yaml-библиотеки,
// а добавлять её ради одного файла незачем. Подмножество: блочные mapping/sequence, скаляры, `{}` и `[]`.
// Строки, которые нельзя записать «голыми», пишутся в двойных кавычках (синтаксис JSON — валидный YAML).

const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n', '~']);
const PLAIN = /^[A-Za-z][A-Za-z0-9_-]*( [A-Za-z0-9_-]+)*$/;
const PLAIN_KEY = /^[A-Za-z_$][A-Za-z0-9_.$-]*$/;

function scalar(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return PLAIN.test(v) && !RESERVED.has(v.toLowerCase()) ? v : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Error(`YAML: неподдерживаемый скаляр ${typeof v}`);
}

function key(k: string): string {
  return PLAIN_KEY.test(k) && !RESERVED.has(k.toLowerCase()) ? k : JSON.stringify(k);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function emit(v: unknown, indent: number, out: string[]): void {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    for (const item of v) {
      if (Array.isArray(item) ? item.length > 0 : isObj(item) ? Object.keys(item).length > 0 : false) {
        // вложенная структура: «-» на отдельной строке, содержимое глубже
        out.push(`${pad}-`);
        emit(item, indent + 2, out);
      } else {
        out.push(`${pad}- ${inline(item)}`);
      }
    }
    return;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined) continue;
    if (Array.isArray(val) ? val.length > 0 : isObj(val) ? Object.keys(val).length > 0 : false) {
      out.push(`${pad}${key(k)}:`);
      emit(val, indent + 2, out);
    } else {
      out.push(`${pad}${key(k)}: ${inline(val)}`);
    }
  }
}

function inline(v: unknown): string {
  if (Array.isArray(v)) return '[]';
  if (isObj(v)) return '{}';
  return scalar(v);
}

export function toYaml(doc: Record<string, unknown>): string {
  const out: string[] = [];
  emit(doc, 0, out);
  return out.join('\n') + '\n';
}

// --- разборщик того же подмножества (для тестов и проверки круговым прогоном) ---

interface Line {
  indent: number;
  text: string;
}

function parseScalar(s: string): unknown {
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"')) return JSON.parse(s);
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Делит «ключ: значение» с учётом ключа в кавычках. */
function splitKey(text: string): { k: string; rest: string } {
  if (text.startsWith('"')) {
    let i = 1;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    return { k: JSON.parse(text.slice(0, i + 1)) as string, rest: text.slice(i + 2).replace(/^ /, '') };
  }
  const i = text.indexOf(':');
  return { k: text.slice(0, i), rest: text.slice(i + 1).replace(/^ /, '') };
}

function parseBlock(lines: Line[], pos: { i: number }, indent: number): unknown {
  const first = lines[pos.i];
  if (first?.text.startsWith('-')) {
    const arr: unknown[] = [];
    while (pos.i < lines.length && lines[pos.i]!.indent === indent && lines[pos.i]!.text.startsWith('-')) {
      const rest = lines[pos.i]!.text.slice(1).trim();
      pos.i += 1;
      arr.push(rest === '' ? parseBlock(lines, pos, indent + 2) : parseScalar(rest));
    }
    return arr;
  }
  const obj: Record<string, unknown> = {};
  while (pos.i < lines.length && lines[pos.i]!.indent === indent) {
    const { k, rest } = splitKey(lines[pos.i]!.text);
    pos.i += 1;
    obj[k] = rest === '' ? parseBlock(lines, pos, indent + 2) : parseScalar(rest);
  }
  return obj;
}

export function parseYaml(src: string): unknown {
  const lines: Line[] = src
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
  return parseBlock(lines, { i: 0 }, 0);
}
