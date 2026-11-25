import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '@/server/shared/config';
import {
  createMailerFromConfig,
  NoopMailer,
  SmtpMailer,
} from '@/server/shared/mailer';
import {
  applyDotStuffing,
  encodeRfc2047Utf8,
} from '@/server/shared/smtp-protocol';

interface MockSmtpExchange {
  readonly commands: string[];
  readonly authPayloads: string[];
  readonly dataPayload: string;
}

interface MockSmtpOptions {
  readonly ehloCapabilities?: string[];
  readonly failAfterGreeting?: boolean;
  readonly rejectRcptWith?: string;
}

function createMockSmtpServer(options: MockSmtpOptions = {}) {
  const exchanges: MockSmtpExchange[] = [];
  const sockets = new Set<net.Socket>();
  const capabilities = options.ehloCapabilities ?? ['localhost'];

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    const commands: string[] = [];
    const authPayloads: string[] = [];
    let buffer = '';
    let state: 'cmd' | 'auth_user' | 'auth_pass' | 'data' = 'cmd';
    let dataBuffer = '';

    socket.write('220 mock-smtp.local ESMTP\r\n');
    if (options.failAfterGreeting) return;

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const rawLine = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);

        if (state === 'data') {
          if (rawLine === '.') {
            state = 'cmd';
            exchanges.push({ commands, authPayloads, dataPayload: dataBuffer });
            socket.write('250 2.0.0 OK queued\r\n');
          } else {
            dataBuffer += `${rawLine}\r\n`;
          }
          continue;
        }
        if (state === 'auth_user') {
          authPayloads.push(rawLine);
          state = 'auth_pass';
          socket.write('334 UGFzc3dvcmQ6\r\n');
          continue;
        }
        if (state === 'auth_pass') {
          authPayloads.push(rawLine);
          state = 'cmd';
          socket.write('235 2.7.0 Authentication successful\r\n');
          continue;
        }

        commands.push(rawLine);
        const upper = rawLine.toUpperCase();
        if (upper.startsWith('EHLO ')) {
          for (let i = 0; i < capabilities.length; i += 1) {
            const sep = i === capabilities.length - 1 ? ' ' : '-';
            socket.write(`250${sep}${capabilities[i]}\r\n`);
          }
        } else if (upper.startsWith('AUTH PLAIN ')) {
          authPayloads.push(rawLine.slice('AUTH PLAIN '.length));
          socket.write('235 2.7.0 Authentication successful\r\n');
        } else if (upper === 'AUTH LOGIN') {
          state = 'auth_user';
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          if (options.rejectRcptWith) {
            socket.write(`${options.rejectRcptWith}\r\n`);
          } else {
            socket.write('250 2.1.5 Ok\r\n');
          }
        } else if (upper === 'DATA') {
          state = 'data';
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('502 Command not implemented\r\n');
        }
      }
    });
  });

  return {
    exchanges,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as net.AddressInfo;
          resolve(addr.port);
        });
      }),
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('SmtpMailer & createMailerFromConfig', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close();
    }
  });

  it('returns NoopMailer when SMTP config is incomplete and SmtpMailer when host and from are set', () => {
    const emptyCfg: Pick<Config, 'smtp'> = { smtp: {} };
    expect(createMailerFromConfig(emptyCfg)).toBeInstanceOf(NoopMailer);

    const partialCfg: Pick<Config, 'smtp'> = { smtp: { host: 'smtp.example.org' } };
    expect(createMailerFromConfig(partialCfg)).toBeInstanceOf(NoopMailer);

    const fullCfg: Pick<Config, 'smtp'> = {
      smtp: {
        host: 'smtp.example.org',
        port: 587,
        user: 'bot@eiu.edu.vn',
        pass: 'secret',
        from: 'BEAM <noreply@eiu.edu.vn>',
      },
    };
    expect(createMailerFromConfig(fullCfg)).toBeInstanceOf(SmtpMailer);
  });

  it('sends plain SMTP without auth, encodes RFC 2047 UTF-8 headers, strips CR/LF injection, and dot-stuffs lines', async () => {
    const mock = createMockSmtpServer({ ehloCapabilities: ['mock.local', 'PIPELINING'] });
    servers.push(mock);
    const port = await mock.listen();

    const mailer = new SmtpMailer({
      host: '127.0.0.1',
      port,
      from: 'Câu lạc bộ BEAM <noreply@eiu.edu.vn>',
      timeoutMs: 2000,
    });

    const subject = 'Thông báo công việc mới\r\nBcc: attacker@evil.com';
    await mailer.send({
      to: 'member@eiu.edu.vn',
      subject,
      text: 'Xin chào\n.Dòng bắt đầu bằng dấu chấm\nKết thúc',
      html: '<p>Xin chào</p>\n.Line',
    });

    expect(mock.exchanges).toHaveLength(1);
    const ex = mock.exchanges[0]!;
    expect(ex.commands[0]).toBe('EHLO eiu.edu.vn');
    expect(ex.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
    expect(ex.commands).toContain('MAIL FROM:<noreply@eiu.edu.vn>');
    expect(ex.commands).toContain('RCPT TO:<member@eiu.edu.vn>');

    expect(ex.dataPayload).toContain(`From: ${encodeRfc2047Utf8('Câu lạc bộ BEAM')} <noreply@eiu.edu.vn>`);
    expect(ex.dataPayload).toContain(`Subject: ${encodeRfc2047Utf8(subject)}`);
    expect(ex.dataPayload).not.toContain('\r\nBcc: attacker@evil.com');
    expect(ex.dataPayload).toContain('..Dòng bắt đầu bằng dấu chấm');
    expect(ex.dataPayload).toContain('..Line');
    expect(applyDotStuffing('a\n.b\n..c')).toBe('a\r\n..b\r\n...c');
  });

  it('authenticates using AUTH PLAIN and AUTH LOGIN based on server EHLO capabilities', async () => {
    const plainMock = createMockSmtpServer({
      ehloCapabilities: ['mock.local', 'AUTH PLAIN LOGIN'],
    });
    servers.push(plainMock);
    const plainPort = await plainMock.listen();

    const plainMailer = new SmtpMailer({
      host: '127.0.0.1',
      port: plainPort,
      from: 'noreply@eiu.edu.vn',
      user: 'smtp-user',
      pass: 'smtp-pass',
    });
    await plainMailer.send({ to: 'a@eiu.edu.vn', subject: 'Plain', text: 'Body' });
    expect(
      Buffer.from(plainMock.exchanges[0]!.authPayloads[0]!, 'base64').toString('utf8'),
    ).toBe('\0smtp-user\0smtp-pass');

    const loginMock = createMockSmtpServer({
      ehloCapabilities: ['mock.local', 'AUTH LOGIN'],
    });
    servers.push(loginMock);
    const loginPort = await loginMock.listen();

    const loginMailer = new SmtpMailer({
      host: '127.0.0.1',
      port: loginPort,
      from: 'noreply@eiu.edu.vn',
      user: 'login-user',
      pass: 'login-pass',
    });
    await loginMailer.send({ to: 'b@eiu.edu.vn', subject: 'Login', text: 'Body' });
    expect(
      loginMock.exchanges[0]!.authPayloads.map((p) =>
        Buffer.from(p, 'base64').toString('utf8'),
      ),
    ).toEqual(['login-user', 'login-pass']);
  });

  it('rejects cleanly on socket timeout, SMTP 550 errors, and injected email addresses', async () => {
    const stallMock = createMockSmtpServer({ failAfterGreeting: true });
    servers.push(stallMock);
    const stallPort = await stallMock.listen();

    const fastTimeoutMailer = new SmtpMailer({
      host: '127.0.0.1',
      port: stallPort,
      from: 'noreply@eiu.edu.vn',
      timeoutMs: 80,
    });
    await expect(
      fastTimeoutMailer.send({ to: 'a@eiu.edu.vn', subject: 'Timeout', text: 'Hi' }),
    ).rejects.toThrow(/timeout/i);

    const errMock = createMockSmtpServer({ rejectRcptWith: '550 5.1.1 User unknown' });
    servers.push(errMock);
    const errPort = await errMock.listen();
    const errMailer = new SmtpMailer({
      host: '127.0.0.1',
      port: errPort,
      from: 'noreply@eiu.edu.vn',
    });
    await expect(
      errMailer.send({ to: 'missing@eiu.edu.vn', subject: 'Err', text: 'Hi' }),
    ).rejects.toThrow(/SMTP error 550/);

    await expect(
      errMailer.send({
        to: 'Victim <v@eiu.edu.vn>\r\nBcc: evil@attacker.com',
        subject: 'Inject',
        text: 'Hi',
      }),
    ).rejects.toThrow('Invalid SMTP email address');

    await expect(
      errMailer.send({
        to: 'v@eiu.edu.vn\r\n',
        subject: 'Inject',
        text: 'Hi',
      }),
    ).rejects.toThrow('Invalid SMTP email address');

    await expect(
      errMailer.send({
        to: 'v@eiu.edu.vn\r\nBcc:evil@evil.com',
        subject: 'Inject',
        text: 'Hi',
      }),
    ).rejects.toThrow('Invalid SMTP email address');
  });
});
