import { randomUUID } from 'node:crypto';
import type net from 'node:net';
import tls from 'node:tls';

export interface ParsedEmailAddress {
  readonly displayName: string;
  readonly address: string;
}

export interface SmtpResponse {
  readonly code: number;
  readonly lines: string[];
}

export type SmtpSocket = net.Socket | tls.TLSSocket;

export function stripHeaderControlChars(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').trim();
}

export function encodeRfc2047Utf8(value: string): string {
  const clean = stripHeaderControlChars(value);
  if (!/[^\x20-\x7e]/.test(clean)) {
    return clean;
  }
  const b64 = Buffer.from(clean, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

export function parseEmailAddress(raw: string): ParsedEmailAddress {
  if (/[\r\n\0]/.test(raw)) {
    throw new Error('Invalid SMTP email address');
  }
  const clean = raw.trim();
  const angled = /^(.*)<([^<>]+)>$/.exec(clean);
  const displayName = angled ? angled[1]!.trim().replace(/^"|"$/g, '') : '';
  const address = (angled ? angled[2]! : clean).trim();
  if (!address || /[\s<>]/.test(address) || !address.includes('@')) {
    throw new Error('Invalid SMTP email address');
  }
  return { displayName, address };
}

export function formatAddressHeader(parsed: ParsedEmailAddress): string {
  if (!parsed.displayName) {
    return parsed.address;
  }
  if (/[^\x20-\x7e]/.test(parsed.displayName)) {
    return `${encodeRfc2047Utf8(parsed.displayName)} <${parsed.address}>`;
  }
  const escaped = parsed.displayName.replace(/["\\]/g, '\\$&');
  return `"${escaped}" <${parsed.address}>`;
}

export function applyDotStuffing(content: string): string {
  return content.replace(/\r\n|\r|\n/g, '\r\n').replace(/^\./gm, '..');
}

export function buildMimePayload(params: {
  readonly from: ParsedEmailAddress;
  readonly to: ParsedEmailAddress;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly now?: Date;
}): string {
  const domain = params.from.address.split('@')[1] ?? 'localhost';
  const dateHeader = (params.now ?? new Date()).toUTCString();
  const headers = [
    `From: ${formatAddressHeader(params.from)}`,
    `To: ${formatAddressHeader(params.to)}`,
    `Subject: ${encodeRfc2047Utf8(params.subject)}`,
    `Date: ${dateHeader}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
  ];
  const body = buildMimeBody(params.text, params.html, headers);
  return `${applyDotStuffing(body)}\r\n.\r\n`;
}

function buildMimeBody(text: string, html: string | undefined, headers: string[]): string {
  const normalizedText = text.replace(/\r\n|\r|\n/g, '\r\n');
  if (!html) {
    return [
      ...headers,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      normalizedText,
    ].join('\r\n');
  }
  const boundary = `----=_BeamPart_${randomUUID().replace(/-/g, '')}`;
  const normalizedHtml = html.replace(/\r\n|\r|\n/g, '\r\n');
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedText,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizedHtml,
    `--${boundary}--`,
  ].join('\r\n');
}

export function parseAuthMechanisms(ehloLines: readonly string[]): Set<string> {
  const mechanisms = new Set<string>();
  for (const line of ehloLines) {
    const match = /^AUTH[\s=]+(.+)$/i.exec(line.trim());
    if (!match) continue;
    for (const token of match[1]!.split(/\s+/)) {
      const upper = token.trim().toUpperCase();
      if (upper) mechanisms.add(upper);
    }
  }
  return mechanisms;
}

export function supportsStartTls(ehloLines: readonly string[]): boolean {
  return ehloLines.some((line) => line.trim().toUpperCase() === 'STARTTLS');
}

export class SmtpLineSession {
  private socket: SmtpSocket;
  private buffer = '';
  private readonly lineQueue: string[] = [];
  private waiter: ((line: string) => void) | null = null;
  private rejectWaiter: ((error: Error) => void) | null = null;
  private terminalError: Error | null = null;
  private closed = false;

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.drainBufferedLines();
  };

  private readonly onError = (error: Error): void => {
    this.failPending(error);
  };

  private readonly onTimeout = (): void => {
    const err = new Error('SMTP socket timeout');
    this.failPending(err);
    this.socket.destroy();
  };

  private readonly onClose = (): void => {
    this.closed = true;
    this.failPending(new Error('SMTP connection closed unexpectedly'));
  };

  constructor(socket: SmtpSocket, private readonly timeoutMs: number) {
    this.socket = socket;
    this.attachListeners(socket);
  }

  async readResponse(): Promise<SmtpResponse> {
    const lines: string[] = [];
    let code = 0;
    while (true) {
      const line = await this.nextLine();
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        throw new Error(`Malformed SMTP response line: ${line}`);
      }
      code = Number(match[1]);
      lines.push(match[3] ?? '');
      if (match[2] === ' ') {
        return { code, lines };
      }
    }
  }

  async sendCommand(
    command: string,
    expectedCodes: readonly number[],
  ): Promise<SmtpResponse> {
    await this.writeAll(`${command}\r\n`);
    const response = await this.readResponse();
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP error ${response.code}: ${response.lines.join(' ')}`);
    }
    return response;
  }

  async sendDataPayload(payload: string): Promise<SmtpResponse> {
    await this.writeAll(payload);
    const response = await this.readResponse();
    if (response.code !== 250) {
      throw new Error(`SMTP DATA rejected (${response.code}): ${response.lines.join(' ')}`);
    }
    return response;
  }

  async upgradeToTls(options: {
    readonly host: string;
    readonly rejectUnauthorized: boolean;
  }): Promise<void> {
    this.detachListeners(this.socket);
    this.buffer = '';
    this.lineQueue.length = 0;
    const upgraded = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket: this.socket,
        servername: options.host,
        rejectUnauthorized: options.rejectUnauthorized,
      });
      tlsSocket.setTimeout(this.timeoutMs);
      const fail = (err: Error) => {
        tlsSocket.destroy();
        reject(err);
      };
      tlsSocket.once('secureConnect', () => {
        tlsSocket.off('error', fail);
        tlsSocket.off('timeout', onTlsTimeout);
        resolve(tlsSocket);
      });
      const onTlsTimeout = () => fail(new Error('SMTP STARTTLS handshake timeout'));
      tlsSocket.once('error', fail);
      tlsSocket.once('timeout', onTlsTimeout);
    });
    this.socket = upgraded;
    this.attachListeners(upgraded);
  }

  destroy(): void {
    this.detachListeners(this.socket);
    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  private attachListeners(socket: SmtpSocket): void {
    socket.setTimeout(this.timeoutMs);
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('timeout', this.onTimeout);
    socket.on('close', this.onClose);
  }

  private detachListeners(socket: SmtpSocket): void {
    socket.off('data', this.onData);
    socket.off('error', this.onError);
    socket.off('timeout', this.onTimeout);
    socket.off('close', this.onClose);
  }

  private drainBufferedLines(): void {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx < 0) return;
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        this.rejectWaiter = null;
        resolve(line);
      } else {
        this.lineQueue.push(line);
      }
    }
  }

  private nextLine(): Promise<string> {
    if (this.lineQueue.length > 0) {
      return Promise.resolve(this.lineQueue.shift()!);
    }
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }
    if (this.closed) {
      return Promise.reject(new Error('SMTP connection closed'));
    }
    return new Promise<string>((resolve, reject) => {
      this.waiter = resolve;
      this.rejectWaiter = reject;
    });
  }

  private writeAll(chunk: string): Promise<void> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }
    return new Promise<void>((resolve, reject) => {
      this.socket.write(chunk, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private failPending(error: Error): void {
    if (!this.terminalError) {
      this.terminalError = error;
    }
    if (this.rejectWaiter) {
      const reject = this.rejectWaiter;
      this.waiter = null;
      this.rejectWaiter = null;
      reject(error);
    }
  }
}
