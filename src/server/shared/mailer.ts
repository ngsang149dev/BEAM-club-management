import net from 'node:net';
import tls from 'node:tls';
import type { Config } from './config';
import {
  buildMimePayload,
  parseAuthMechanisms,
  parseEmailAddress,
  type ParsedEmailAddress,
  SmtpLineSession,
  type SmtpSocket,
  supportsStartTls,
} from './smtp-protocol';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class NoopMailer implements Mailer {
  async send(_message: MailMessage): Promise<void> {
    void _message;
  }
}

export interface SmtpMailerOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly user?: string;
  readonly pass?: string;
  readonly timeoutMs?: number;
  readonly rejectUnauthorized?: boolean;
}

const DEFAULT_SMTP_PORT = 587;
const IMPLICIT_TLS_PORT = 465;
const DEFAULT_SMTP_TIMEOUT_MS = 10_000;

export class SmtpMailer implements Mailer {
  private readonly fromAddress: ParsedEmailAddress;
  private readonly timeoutMs: number;
  private readonly rejectUnauthorized: boolean;

  constructor(private readonly options: SmtpMailerOptions) {
    this.fromAddress = parseEmailAddress(options.from);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
    this.rejectUnauthorized = options.rejectUnauthorized ?? true;
  }

  async send(message: MailMessage): Promise<void> {
    const toAddress = parseEmailAddress(message.to);
    const payload = buildMimePayload({
      from: this.fromAddress,
      to: toAddress,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    const socket = await this.openSocket();
    const session = new SmtpLineSession(socket, this.timeoutMs);
    try {
      await this.executeSmtpTransaction(session, toAddress.address, payload);
    } finally {
      session.destroy();
    }
  }

  private async openSocket(): Promise<SmtpSocket> {
    const { host, port } = this.options;
    if (port === IMPLICIT_TLS_PORT) {
      return new Promise<tls.TLSSocket>((resolve, reject) => {
        const sock = tls.connect({
          host,
          port,
          servername: host,
          rejectUnauthorized: this.rejectUnauthorized,
        });
        this.bindConnectHandlers(sock, 'secureConnect', resolve, reject);
      });
    }
    return new Promise<net.Socket>((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      this.bindConnectHandlers(sock, 'connect', resolve, reject);
    });
  }

  private bindConnectHandlers<T extends SmtpSocket>(
    sock: T,
    readyEvent: 'connect' | 'secureConnect',
    resolve: (sock: T) => void,
    reject: (err: Error) => void,
  ): void {
    sock.setTimeout(this.timeoutMs);
    const cleanup = () => {
      sock.off('error', onErr);
      sock.off('timeout', onTimeout);
    };
    const onErr = (err: Error) => {
      cleanup();
      sock.destroy();
      reject(err);
    };
    const onTimeout = () => {
      cleanup();
      sock.destroy();
      reject(new Error('SMTP connection timeout'));
    };
    sock.once(readyEvent, () => {
      cleanup();
      resolve(sock);
    });
    sock.once('error', onErr);
    sock.once('timeout', onTimeout);
  }

  private async executeSmtpTransaction(
    session: SmtpLineSession,
    recipientAddress: string,
    payload: string,
  ): Promise<void> {
    const greeting = await session.readResponse();
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting (${greeting.code})`);
    }
    const ehloDomain = this.fromAddress.address.split('@')[1] ?? 'localhost';
    let ehlo = await session.sendCommand(`EHLO ${ehloDomain}`, [250]);
    if (this.options.port !== IMPLICIT_TLS_PORT && supportsStartTls(ehlo.lines)) {
      await session.sendCommand('STARTTLS', [220]);
      await session.upgradeToTls({
        host: this.options.host,
        rejectUnauthorized: this.rejectUnauthorized,
      });
      ehlo = await session.sendCommand(`EHLO ${ehloDomain}`, [250]);
    }
    await this.authenticateIfConfigured(session, ehlo.lines);
    await session.sendCommand(`MAIL FROM:<${this.fromAddress.address}>`, [250]);
    await session.sendCommand(`RCPT TO:<${recipientAddress}>`, [250, 251]);
    await session.sendCommand('DATA', [354]);
    await session.sendDataPayload(payload);
    await session.sendCommand('QUIT', [221]).catch(() => undefined);
  }

  private async authenticateIfConfigured(
    session: SmtpLineSession,
    ehloLines: readonly string[],
  ): Promise<void> {
    const { user, pass } = this.options;
    if (!user || !pass) {
      return;
    }
    const mechanisms = parseAuthMechanisms(ehloLines);
    if (mechanisms.has('LOGIN') && !mechanisms.has('PLAIN')) {
      await session.sendCommand('AUTH LOGIN', [334]);
      await session.sendCommand(Buffer.from(user, 'utf8').toString('base64'), [334]);
      await session.sendCommand(Buffer.from(pass, 'utf8').toString('base64'), [235]);
      return;
    }
    if (mechanisms.size > 0 && !mechanisms.has('PLAIN')) {
      throw new Error('SMTP server does not support AUTH PLAIN or AUTH LOGIN');
    }
    const token = Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64');
    await session.sendCommand(`AUTH PLAIN ${token}`, [235]);
  }
}

export function createMailerFromConfig(config: Pick<Config, 'smtp'>): Mailer {
  if (config.smtp.host && config.smtp.from) {
    return new SmtpMailer({
      host: config.smtp.host,
      port: config.smtp.port ?? DEFAULT_SMTP_PORT,
      user: config.smtp.user,
      pass: config.smtp.pass,
      from: config.smtp.from,
    });
  }
  return new NoopMailer();
}
