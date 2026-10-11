import net from 'node:net';

import { addressOf, buildMessage, smtpSend } from '@/server/mail/smtp';

/** Фейковый SMTP-сервер: записывает команды, отвечает по сценарию Mailpit. */
function fakeServer(opts: { rejectRcpt?: boolean } = {}) {
  const commands: string[] = [];
  let data = '';
  const server = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          sock.write('250 OK queued\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        commands.push(line);
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250-AUTH PLAIN\r\n250 SIZE 1000\r\n');
        else if (line.startsWith('AUTH')) sock.write('235 ok\r\n');
        else if (line.startsWith('MAIL')) sock.write('250 ok\r\n');
        else if (line.startsWith('RCPT')) sock.write(opts.rejectRcpt ? '550 no such user\r\n' : '250 ok\r\n');
        else if (line === 'DATA') {
          sock.write('354 go\r\n');
          inData = true;
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise<{ port: number; commands: string[]; data: () => string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, commands, data: () => data, close: () => server.close() });
    });
  });
}

describe('SMTP-клиент', () => {
  it('EHLO → AUTH PLAIN → MAIL → RCPT → DATA → QUIT; тело UTF-8 в base64', async () => {
    const srv = await fakeServer();
    const msg = buildMessage({ from: 'ФСП Карьера <no-reply@fsp.test>', to: 'ivan@example.test', subject: 'Код: 123456', text: 'Привет, код 123456' });
    await smtpSend({ host: '127.0.0.1', port: srv.port, secure: false, user: 'u', password: 'p' }, 'ФСП Карьера <no-reply@fsp.test>', 'ivan@example.test', msg);
    srv.close();
    expect(srv.commands.map((c) => c.split(' ')[0])).toEqual(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    expect(srv.commands).toContain('MAIL FROM:<no-reply@fsp.test>');
    expect(srv.commands).toContain('RCPT TO:<ivan@example.test>');
    const sent = srv.data();
    expect(sent).toContain('Subject: =?UTF-8?B?');
    const body = sent.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Привет, код 123456');
  });

  it('отказ сервера — SmtpError с кодом; перевод строки в адресе — отказ до соединения', async () => {
    const srv = await fakeServer({ rejectRcpt: true });
    await expect(smtpSend({ host: '127.0.0.1', port: srv.port, secure: false }, 'a@b.test', 'x@y.test', 'Subject: t\r\n\r\nhi')).rejects.toMatchObject({ code: 550 });
    srv.close();
    await expect(smtpSend({ host: '127.0.0.1', port: 1, secure: false }, 'a@b.test', 'x@y.test\r\nRCPT TO:<z@z>', '')).rejects.toThrow(/перевод строки/);
  });

  it('с html — multipart/alternative: текст, затем HTML, обе части UTF-8 в base64', () => {
    const html = `<p>Привет, код <b>123456</b></p>${'<span>длинная строка</span>'.repeat(20)}`;
    const msg = buildMessage({ from: 'a@b.test', to: 'x@y.test', subject: 'Код', text: 'Привет, код 123456', html, boundary: 'fsp_test.1' });
    const headEnd = msg.indexOf('\r\n\r\n');
    const head = msg.slice(0, headEnd);
    expect(head).toContain('Content-Type: multipart/alternative; boundary="fsp_test.1"');
    expect(head).not.toContain('Content-Transfer-Encoding');
    const parts = msg.slice(headEnd + 4).split(/(?:^|\r\n)--fsp_test\.1(?:--)?(?:\r\n|$)/).filter(Boolean);
    expect(parts).toHaveLength(2);
    const decoded = parts.map((part) => {
      const [headers, body] = part.split('\r\n\r\n');
      expect(body!.split('\r\n').every((line) => line.length <= 76)).toBe(true);
      return { headers, text: Buffer.from(body!.replace(/\r\n/g, ''), 'base64').toString('utf8') };
    });
    expect(decoded[0]).toEqual({ headers: 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64', text: 'Привет, код 123456' });
    expect(decoded[1]).toEqual({ headers: 'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64', text: html });
    expect(msg.endsWith('\r\n--fsp_test.1--')).toBe(true);
  });

  it('граница частей: своя у каждого письма; с переводом строки или кавычкой — отказ', () => {
    const boundaryOf = () => /boundary="([^"]+)"/.exec(buildMessage({ from: 'a@b.test', to: 'x@y.test', subject: 't', text: 't', html: '<p>t</p>' }))![1];
    expect(boundaryOf()).toMatch(/^fsp_[A-Za-z0-9.]+$/);
    expect(boundaryOf()).not.toBe(boundaryOf());
    for (const boundary of ['x"\r\nBcc: z@z.test', 'a b', '']) {
      expect(() => buildMessage({ from: 'a@b.test', to: 'x@y.test', subject: 't', text: 't', html: '<p>t</p>', boundary })).toThrow(/граница/);
    }
  });

  it('addressOf: из «Имя <addr>» и голого адреса', () => {
    expect(addressOf('ФСП <a@b.test>')).toBe('a@b.test');
    expect(addressOf(' a@b.test ')).toBe('a@b.test');
  });
});
