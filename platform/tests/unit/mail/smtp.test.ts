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

  it('addressOf: из «Имя <addr>» и голого адреса', () => {
    expect(addressOf('ФСП <a@b.test>')).toBe('a@b.test');
    expect(addressOf(' a@b.test ')).toBe('a@b.test');
  });
});
