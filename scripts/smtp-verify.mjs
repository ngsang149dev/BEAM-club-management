import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { loadEnvFiles } from './load-env.mjs';

const DEFAULT_SMTP_PORT = 587;
const IMPLICIT_TLS_PORT = 465;
const DEFAULT_SMTP_TIMEOUT_MS = 15_000;
const VERIFY_SUBJECT = '[BEAM Club] Kiểm tra kết nối SMTP / SMTP Verification';
const HEADER_CONTROL_RE = /[\r\n\0]/;

export function maskEmailForLog(rawEmail) {
  if (typeof rawEmail !== 'string') return '(redacted)';
  const cleaned = rawEmail.replace(/[\r\n\0\s<>]+/g, '').trim().toLowerCase();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === cleaned.length - 1) {
    return '(redacted)';
  }
  return `***@${cleaned.slice(atIdx + 1)}`;
}

export function parseSmtpVerifyCliArgs(argv = process.argv.slice(2)) {
  const parsed = { to: undefined, locale: undefined };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--pass' || arg.startsWith('--pass=') || arg === '--password' || arg.startsWith('--password=')) {
      throw new Error(
        'Passing SMTP password on the command line is forbidden. Configure SMTP_PASS in .env.local or environment.',
      );
    }
    if (arg === '--to' || arg === '--locale') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      if (arg === '--to') parsed.to = next;
      else parsed.locale = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--to=')) {
      parsed.to = arg.slice('--to='.length);
      continue;
    }
    if (arg.startsWith('--locale=')) {
      parsed.locale = arg.slice('--locale='.length);
      continue;
    }
    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  return parsed;
}

function encodeRfc2047Utf8(value) {
  const clean = value.replace(/[\r\n\0]+/g, ' ').trim();
  if (!/[^\x20-\x7e]/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function parseEmailAddress(raw, label) {
  if (typeof raw !== 'string' || HEADER_CONTROL_RE.test(raw)) {
    throw new Error(`Invalid ${label} email address.`);
  }
  const clean = raw.trim();
  const angled = /^(.*)<([^<>]+)>$/.exec(clean);
  const displayName = angled ? angled[1].trim().replace(/^"|"$/g, '') : '';
  const address = (angled ? angled[2] : clean).trim();
  if (!address || /[\s<>]/.test(address) || !address.includes('@')) {
    throw new Error(`Invalid ${label} email address.`);
  }
  const parts = address.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
    throw new Error(`Invalid ${label} email address.`);
  }
  return { displayName, address };
}

function formatAddressHeader(parsed) {
  if (!parsed.displayName) return parsed.address;
  if (/[^\x20-\x7e]/.test(parsed.displayName)) {
    return `${encodeRfc2047Utf8(parsed.displayName)} <${parsed.address}>`;
  }
  const escaped = parsed.displayName.replace(/["\\]/g, '\\$&');
  return `"${escaped}" <${parsed.address}>`;
}

function buildVerificationBody(locale, sentAtVn) {
  const viText = [
    VERIFY_SUBJECT,
    '',
    'Xin chào Ban quản trị CLB BEAM,',
    '',
    'Đây là email kiểm tra kết nối SMTP trước khi triển khai Production (E10-01).',
    'Nếu bạn đọc được thư này trong Hộp thư chính (Inbox), cấu hình SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM đã hoạt động chính xác.',
    `Thời điểm gửi (GMT+7): ${sentAtVn}`,
  ].join('\n');

  const enText = [
    VERIFY_SUBJECT,
    '',
    'Hello BEAM Club Administrators,',
    '',
    'This is a bilingual SMTP delivery verification email prior to Production Go-Live (E10-01).',
    'If this message landed directly in your primary Inbox, your SMTP configuration is ready for Vercel Production.',
    `Sent at (GMT+7): ${sentAtVn}`,
  ].join('\n');

  const orderedText =
    locale === 'en'
      ? `${enText}\n\n---\n\n${viText}`
      : `${viText}\n\n---\n\n${enText}`;

  const headingHtml = `<h2 style="margin:0 0 12px;font-size:16px">${VERIFY_SUBJECT}</h2>`;
  const viHtml = `<p><strong>[VI]</strong> Đây là email kiểm tra kết nối SMTP của hệ thống quản lý CLB BEAM. Nếu thư vào thẳng <strong>Inbox</strong>, cấu hình SMTP đã sẵn sàng đưa lên Vercel Production.</p>`;
  const enHtml = `<p><strong>[EN]</strong> This is a verification email from BEAM Club Management. Landing directly in your <strong>Inbox</strong> confirms your SMTP credentials are ready for Vercel Production.</p>`;
  const orderedHtml =
    locale === 'en' ? `${enHtml}<hr/>${viHtml}` : `${viHtml}<hr/>${enHtml}`;

  const html = `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#111">${headingHtml}${orderedHtml}<p style="color:#555;font-size:12px">Timestamp (Asia/Ho_Chi_Minh): ${sentAtVn}</p></body></html>`;
  return { text: orderedText, html };
}

function buildMimePayload({ from, to, subject, text, html }) {
  const domain = from.address.split('@')[1] ?? 'localhost';
  const boundary = `----=_BeamVerify_${randomUUID().replace(/-/g, '')}`;
  const rawMime = [
    `From: ${formatAddressHeader(from)}`,
    `To: ${formatAddressHeader(to)}`,
    `Subject: ${encodeRfc2047Utf8(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text.replace(/\r\n|\r|\n/g, '\r\n'),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html.replace(/\r\n|\r|\n/g, '\r\n'),
    `--${boundary}--`,
  ].join('\r\n');

  const dotStuffed = rawMime.replace(/\r\n|\r|\n/g, '\r\n').replace(/^\./gm, '..');
  return `${dotStuffed}\r\n.\r\n`;
}

class SimpleSmtpSession {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.lineQueue = [];
    this.waiter = null;
    this.rejectWaiter = null;
    this.terminalError = null;
    this.closed = false;

    this.onData = (chunk) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
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
    };
    this.onError = (err) => this.fail(err);
    this.onTimeout = () => {
      this.fail(new Error('SMTP socket timeout'));
      this.socket.destroy();
    };
    this.onClose = () => {
      this.closed = true;
      this.fail(new Error('SMTP connection closed unexpectedly'));
    };

    this.attach(socket);
  }

  attach(sock) {
    sock.setTimeout(this.timeoutMs);
    sock.on('data', this.onData);
    sock.on('error', this.onError);
    sock.on('timeout', this.onTimeout);
    sock.on('close', this.onClose);
  }

  detach(sock) {
    sock.off('data', this.onData);
    sock.off('error', this.onError);
    sock.off('timeout', this.onTimeout);
    sock.off('close', this.onClose);
  }

  fail(error) {
    if (!this.terminalError) this.terminalError = error;
    if (this.rejectWaiter) {
      const reject = this.rejectWaiter;
      this.waiter = null;
      this.rejectWaiter = null;
      reject(error);
    }
  }

  nextLine() {
    if (this.lineQueue.length > 0) return Promise.resolve(this.lineQueue.shift());
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.closed) return Promise.reject(new Error('SMTP connection closed'));
    return new Promise((resolve, reject) => {
      this.waiter = resolve;
      this.rejectWaiter = reject;
    });
  }

  async readResponse() {
    const lines = [];
    while (true) {
      const line = await this.nextLine();
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        throw new Error(`Malformed SMTP response: ${line}`);
      }
      const code = Number(match[1]);
      lines.push(match[3] ?? '');
      if (match[2] === ' ') return { code, lines };
    }
  }

  writeAll(chunk) {
    if (this.terminalError) return Promise.reject(this.terminalError);
    return new Promise((resolve, reject) => {
      this.socket.write(chunk, 'utf8', (err) => (err ? reject(err) : resolve()));
    });
  }

  async sendCommand(command, expectedCodes) {
    await this.writeAll(`${command}\r\n`);
    const res = await this.readResponse();
    if (!expectedCodes.includes(res.code)) {
      throw new Error(`SMTP error ${res.code}: ${res.lines.join(' ')}`);
    }
    return res;
  }

  async upgradeToTls(host, rejectUnauthorized) {
    this.detach(this.socket);
    this.buffer = '';
    this.lineQueue.length = 0;
    const upgraded = await new Promise((resolve, reject) => {
      const tlsSock = tls.connect({
        socket: this.socket,
        servername: host,
        rejectUnauthorized,
      });
      tlsSock.setTimeout(this.timeoutMs);
      const onFail = (err) => {
        tlsSock.destroy();
        reject(err);
      };
      const onTlsTimeout = () => onFail(new Error('SMTP STARTTLS handshake timeout'));
      tlsSock.once('secureConnect', () => {
        tlsSock.off('error', onFail);
        tlsSock.off('timeout', onTlsTimeout);
        resolve(tlsSock);
      });
      tlsSock.once('error', onFail);
      tlsSock.once('timeout', onTlsTimeout);
    });
    this.socket = upgraded;
    this.attach(upgraded);
  }

  destroy() {
    this.detach(this.socket);
    if (!this.socket.destroyed) this.socket.destroy();
  }
}

function openInitialSocket({ host, port, timeoutMs, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const sock =
      port === IMPLICIT_TLS_PORT
        ? tls.connect({ host, port, servername: host, rejectUnauthorized })
        : net.createConnection({ host, port });
    const readyEvent = port === IMPLICIT_TLS_PORT ? 'secureConnect' : 'connect';
    sock.setTimeout(timeoutMs);

    const cleanup = () => {
      sock.off('error', onErr);
      sock.off('timeout', onTimeout);
    };
    const onErr = (err) => {
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
  });
}

function parseAuthMechanisms(ehloLines) {
  const set = new Set();
  for (const line of ehloLines) {
    const match = /^AUTH[\s=]+(.+)$/i.exec(line.trim());
    if (!match) continue;
    for (const token of match[1].split(/\s+/)) {
      const upper = token.trim().toUpperCase();
      if (upper) set.add(upper);
    }
  }
  return set;
}

function sanitizeSmtpError(error, { toAddress, maskedTo, fromAddress, user, pass }) {
  const rawMsg =
    error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  const errCode =
    error && typeof error === 'object' && 'code' in error && error.code
      ? String(error.code)
      : '';
  let message = rawMsg || errCode || 'SMTP delivery failed';

  if (toAddress) {
    const escapedTo = toAddress.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    message = message.replace(new RegExp(escapedTo, 'gi'), maskedTo);
  }
  for (const secret of [pass, user, fromAddress]) {
    if (typeof secret === 'string' && secret.length > 0) {
      message = message.split(secret).join('[REDACTED]');
    }
  }
  return message;
}

export async function runSmtpVerify(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (!options.env) {
    loadEnvFiles(cwd);
  }
  const env = options.env ?? process.env;
  const writeOut = options.writeOut ?? console.log;

  const rawTo = options.to ?? env.SMTP_VERIFY_TO;
  if (!rawTo || typeof rawTo !== 'string' || rawTo.trim().length === 0) {
    throw new Error('Recipient email is required: pass --to <email>.');
  }
  const toParsed = parseEmailAddress(rawTo, 'recipient');
  const maskedTo = maskEmailForLog(toParsed.address);

  const locale = (options.locale ?? 'vi').trim().toLowerCase();
  if (locale !== 'vi' && locale !== 'en') {
    throw new Error('Invalid --locale: expected "vi" or "en".');
  }

  const host = (options.host ?? env.SMTP_HOST ?? '').trim();
  if (!host || /[\s\r\n\0]/.test(host)) {
    throw new Error('SMTP_HOST is required in environment (.env.local) to verify SMTP.');
  }

  const port = Number(options.port ?? env.SMTP_PORT ?? DEFAULT_SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid SMTP_PORT: expected integer 1..65535.');
  }

  const rawFrom = (options.from ?? env.SMTP_FROM ?? '').trim();
  if (!rawFrom) {
    throw new Error('SMTP_FROM is required in environment (.env.local) to verify SMTP.');
  }
  const fromParsed = parseEmailAddress(rawFrom, 'sender (SMTP_FROM)');

  const user = (options.user ?? env.SMTP_USER ?? '').trim() || undefined;
  const rawPass = options.pass ?? env.SMTP_PASS ?? '';
  const pass = typeof rawPass === 'string' && rawPass.length > 0 ? rawPass : undefined;
  if ((user && !pass) || (!user && pass)) {
    throw new Error('Both SMTP_USER and SMTP_PASS must be set together when using SMTP authentication.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
  const rejectUnauthorized = options.rejectUnauthorized ?? true;

  const sentAtVn = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());

  const { text, html } = buildVerificationBody(locale, sentAtVn);
  const payload = buildMimePayload({
    from: fromParsed,
    to: toParsed,
    subject: VERIFY_SUBJECT,
    text,
    html,
  });

  let session = null;
  try {
    const socket = await openInitialSocket({
      host,
      port,
      timeoutMs,
      rejectUnauthorized,
    });
    session = new SimpleSmtpSession(socket, timeoutMs);

    const greeting = await session.readResponse();
    if (greeting.code !== 220) {
      throw new Error(`Unexpected SMTP greeting (${greeting.code})`);
    }

    const ehloDomain = fromParsed.address.split('@')[1] ?? 'localhost';
    let ehlo = await session.sendCommand(`EHLO ${ehloDomain}`, [250]);

    const supportsStartTls = ehlo.lines.some(
      (line) => line.trim().toUpperCase() === 'STARTTLS',
    );
    if (port !== IMPLICIT_TLS_PORT && supportsStartTls) {
      await session.sendCommand('STARTTLS', [220]);
      await session.upgradeToTls(host, rejectUnauthorized);
      ehlo = await session.sendCommand(`EHLO ${ehloDomain}`, [250]);
    }

    if (user && pass) {
      const mechanisms = parseAuthMechanisms(ehlo.lines);
      if (mechanisms.has('LOGIN') && !mechanisms.has('PLAIN')) {
        await session.sendCommand('AUTH LOGIN', [334]);
        await session.sendCommand(Buffer.from(user, 'utf8').toString('base64'), [334]);
        await session.sendCommand(Buffer.from(pass, 'utf8').toString('base64'), [235]);
      } else if (mechanisms.size > 0 && !mechanisms.has('PLAIN')) {
        throw new Error('SMTP server does not advertise AUTH PLAIN or AUTH LOGIN.');
      } else {
        const token = Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64');
        await session.sendCommand(`AUTH PLAIN ${token}`, [235]);
      }
    }

    await session.sendCommand(`MAIL FROM:<${fromParsed.address}>`, [250]);
    await session.sendCommand(`RCPT TO:<${toParsed.address}>`, [250, 251]);
    await session.sendCommand('DATA', [354]);
    await session.writeAll(payload);
    const dataRes = await session.readResponse();
    if (dataRes.code !== 250) {
      throw new Error(`SMTP DATA rejected (${dataRes.code}): ${dataRes.lines.join(' ')}`);
    }
    await session.sendCommand('QUIT', [221]).catch(() => undefined);

    if (!options.quiet) {
      writeOut(
        `[smtp:verify] Sent bilingual verification email via ${host}:${port} to ${maskedTo} (locale=${locale})`,
      );
    }

    return {
      ok: true,
      host,
      port,
      recipient: maskedTo,
      locale,
      subject: VERIFY_SUBJECT,
    };
  } catch (error) {
    const safeMsg = sanitizeSmtpError(error, {
      toAddress: toParsed.address,
      maskedTo,
      fromAddress: fromParsed.address,
      user,
      pass,
    });
    throw new Error(`SMTP verification failed (${host}:${port} -> ${maskedTo}): ${safeMsg}`);
  } finally {
    session?.destroy();
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    const cli = parseSmtpVerifyCliArgs();
    runSmtpVerify(cli).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
