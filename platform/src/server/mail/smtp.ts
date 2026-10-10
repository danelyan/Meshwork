import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';

/**
 * Минимальный SMTP-клиент на `node:net`/`node:tls` (почтовой библиотеки в стеке нет,
 * docs/stack.md). Умеет то, что нужно Mailpit и обычному релею: EHLO, AUTH PLAIN,
 * одно письмо на соединение, TLS с первого байта (`secure`, порт 465). STARTTLS нет.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  timeoutMs?: number;
}

export class SmtpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface Reply {
  code: number;
  text: string;
}

function replyReader(socket: net.Socket) {
  let buf = '';
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  socket.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    poke();
  });
  socket.on('error', (err) => {
    failure ??= err;
    poke();
  });
  socket.on('close', () => {
    failure ??= new SmtpError('SMTP: соединение закрыто');
    poke();
  });

  /** Ответ сервера целиком: строки `250-…` продолжаются, `250 …` — последняя. */
  return async function read(): Promise<Reply> {
    for (;;) {
      let start = 0;
      const lines: string[] = [];
      for (;;) {
        const end = buf.indexOf('\n', start);
        if (end === -1) break;
        const line = buf.slice(start, end).replace(/\r$/, '');
        start = end + 1;
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) {
          buf = buf.slice(start);
          return { code: Number(line.slice(0, 3)), text: lines.map((l) => l.slice(4)).join('\n') };
        }
      }
      if (failure) throw failure;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };
}

/** Адрес из `Имя <addr>` или `addr`. */
export function addressOf(mailbox: string): string {
  const m = /<([^<>\s]+)>\s*$/.exec(mailbox);
  return (m ? m[1]! : mailbox).trim();
}

function assertNoCrlf(...values: string[]) {
  for (const v of values) if (/[\r\n]/.test(v)) throw new SmtpError('SMTP: перевод строки в адресе или заголовке');
}

/** Отправить готовое RFC 5322-сообщение (`data` — заголовки + тело, строки через CRLF). */
export async function smtpSend(cfg: SmtpConfig, from: string, to: string, data: string): Promise<void> {
  assertNoCrlf(from, to);
  const timeout = cfg.timeoutMs ?? 10_000;
  const socket = cfg.secure
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  socket.setTimeout(timeout, () => socket.destroy(new SmtpError('SMTP: таймаут')));
  const read = replyReader(socket);
  const command = async (line: string | null, ok: number[]) => {
    if (line !== null) socket.write(`${line}\r\n`);
    const r = await read();
    if (!ok.includes(r.code)) {
      // Текст ответа без команды: в AUTH команде — учётные данные.
      throw new SmtpError(`SMTP: ответ ${r.code} на ${line?.split(' ')[0] ?? 'приветствие'}`, r.code);
    }
    return r;
  };
  try {
    await command(null, [220]);
    await command(`EHLO ${os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost'}`, [250]);
    if (cfg.user) {
      const token = Buffer.from(`\0${cfg.user}\0${cfg.password ?? ''}`).toString('base64');
      await command(`AUTH PLAIN ${token}`, [235]);
    }
    await command(`MAIL FROM:<${addressOf(from)}>`, [250]);
    await command(`RCPT TO:<${addressOf(to)}>`, [250, 251]);
    await command('DATA', [354]);
    // Тело в base64 — строк, начинающихся с точки, не бывает; dot-stuffing всё равно делаем.
    const body = data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    await command(`${body}\r\n.`, [250]);
    await command('QUIT', [221]).catch(() => undefined);
  } finally {
    socket.end();
    socket.destroy();
  }
}

const b64Header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`);

function encodeMailbox(mailbox: string): string {
  const m = /^(.*?)\s*<([^<>\s]+)>\s*$/.exec(mailbox);
  if (!m || !m[1]) return addressOf(mailbox);
  return `${b64Header(m[1].replace(/^"|"$/g, ''))} <${m[2]}>`;
}

/** Текстовое письмо UTF-8: заголовки + тело в base64 (строки по 76 символов). */
export function buildMessage(p: { from: string; to: string; subject: string; text: string; date?: Date; messageId?: string }): string {
  assertNoCrlf(p.from, p.to, p.subject);
  const body = Buffer.from(p.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  const domain = addressOf(p.from).split('@')[1] ?? 'localhost';
  return [
    `From: ${encodeMailbox(p.from)}`,
    `To: ${addressOf(p.to)}`,
    `Subject: ${b64Header(p.subject)}`,
    `Date: ${(p.date ?? new Date()).toUTCString()}`,
    `Message-ID: <${p.messageId ?? `${Date.now()}.${Math.random().toString(36).slice(2)}`}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body.trimEnd(),
  ].join('\r\n');
}
