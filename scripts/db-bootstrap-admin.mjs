import { randomBytes, scrypt } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parsePgConnection } from './db-cli.mjs';
import { formatSafeDbTarget, loadEnvFiles } from './load-env.mjs';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const STUDENT_ID_MAX_LENGTH = 64;
const FULL_NAME_MAX_LENGTH = 120;
const DEFAULT_ALLOWED_EMAIL_DOMAIN = 'eiu.edu.vn';

export const DEFAULT_BOOTSTRAP_PERMISSIONS = [
  'member.view',
  'task.update_assigned',
  'comment.create',
];

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const WHITESPACE_OR_CONTROL_RE = /[\s\u0000-\u001F\u007F]/;
const BASIC_EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PG_URI_REDACT_RE = /postgres(?:ql)?:\/\/[^\s'"]+/gi;

function extractSafeErrorDetail(error, redactList = []) {
  const rawMsg =
    error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  const errCode =
    error && typeof error === 'object' && 'code' in error && error.code
      ? String(error.code)
      : '';
  let text = (rawMsg || errCode || 'database error').replace(
    PG_URI_REDACT_RE,
    '[REDACTED_DB_URL]',
  );
  for (const secret of redactList) {
    if (typeof secret === 'string' && secret.length > 0) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  return text;
}

export function parseBootstrapAdminCliArgs(argv = process.argv.slice(2)) {
  const parsed = {
    useTest: false,
    studentId: undefined,
    email: undefined,
    fullName: undefined,
    locale: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--test') {
      parsed.useTest = true;
      continue;
    }
    if (arg === '--password' || arg.startsWith('--password=') || arg === '-p') {
      throw new Error(
        'Passing --password on the command line is forbidden for security. Set BOOTSTRAP_ADMIN_PASSWORD or enter it at the hidden TTY prompt.',
      );
    }

    const flagMap = {
      '--student-id': 'studentId',
      '--email': 'email',
      '--full-name': 'fullName',
      '--locale': 'locale',
    };

    if (arg in flagMap) {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      parsed[flagMap[arg]] = next;
      i += 1;
      continue;
    }

    let matchedInline = false;
    for (const [flag, prop] of Object.entries(flagMap)) {
      const prefix = `${flag}=`;
      if (arg.startsWith(prefix)) {
        parsed[prop] = arg.slice(prefix.length);
        matchedInline = true;
        break;
      }
    }
    if (matchedInline) continue;

    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  return parsed;
}

export function validateBootstrapAdminInput(params) {
  const rawStudentId = typeof params.studentId === 'string' ? params.studentId.trim() : '';
  if (
    rawStudentId.length < 1 ||
    rawStudentId.length > STUDENT_ID_MAX_LENGTH ||
    WHITESPACE_OR_CONTROL_RE.test(rawStudentId)
  ) {
    throw new Error(
      `Invalid studentId: must be 1..${STUDENT_ID_MAX_LENGTH} characters with no whitespace or control characters.`,
    );
  }
  const studentId = rawStudentId;

  const normalizedDomain = (
    params.allowedEmailDomain ?? DEFAULT_ALLOWED_EMAIL_DOMAIN
  )
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
  if (!normalizedDomain || WHITESPACE_OR_CONTROL_RE.test(normalizedDomain)) {
    throw new Error('Invalid ALLOWED_EMAIL_DOMAIN configuration.');
  }

  const rawEmail = typeof params.email === 'string' ? params.email.trim().toLowerCase() : '';
  if (
    !rawEmail ||
    CONTROL_CHAR_RE.test(rawEmail) ||
    !BASIC_EMAIL_RE.test(rawEmail)
  ) {
    throw new Error(`Invalid admin email: must be a valid @${normalizedDomain} address.`);
  }
  const emailParts = rawEmail.split('@');
  if (emailParts.length !== 2 || !emailParts[0] || emailParts[1] !== normalizedDomain) {
    throw new Error(
      `Admin email domain is not allowed: expected @${normalizedDomain}.`,
    );
  }

  const fullName = typeof params.fullName === 'string' ? params.fullName.trim() : '';
  if (
    fullName.length < 1 ||
    fullName.length > FULL_NAME_MAX_LENGTH ||
    CONTROL_CHAR_RE.test(fullName)
  ) {
    throw new Error(
      `Invalid fullName: must be 1..${FULL_NAME_MAX_LENGTH} characters without control characters.`,
    );
  }

  const locale = (params.locale ?? 'vi').trim().toLowerCase();
  if (locale !== 'vi' && locale !== 'en') {
    throw new Error('Invalid locale: expected "vi" or "en".');
  }

  const password = typeof params.password === 'string' ? params.password : '';
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH ||
    password.trim().length === 0
  ) {
    throw new Error(
      `Invalid initial password: must be ${PASSWORD_MIN_LENGTH}..${PASSWORD_MAX_LENGTH} non-whitespace characters.`,
    );
  }

  return {
    studentId,
    email: rawEmail,
    fullName,
    locale,
    password,
  };
}

export function hashBootstrapPassword(password) {
  const saltHex = randomBytes(SALT_BYTES).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      saltHex,
      KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      },
      (error, derived) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(
          [
            'scrypt',
            String(SCRYPT_N),
            String(SCRYPT_R),
            String(SCRYPT_P),
            saltHex,
            derived.toString('hex'),
          ].join('$'),
        );
      },
    );
  });
}

async function promptVisibleFieldsIfNeeded(partial) {
  const needsVisiblePrompt =
    !partial.studentId || !partial.email || !partial.fullName;
  if (!needsVisiblePrompt) {
    return partial;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Missing required admin bootstrap fields (--student-id, --email, --full-name) in non-interactive mode.',
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const studentId =
      partial.studentId || (await rl.question('Admin Student ID (MSSV): '));
    const email = partial.email || (await rl.question('Admin Club/EIU Email: '));
    const fullName = partial.fullName || (await rl.question('Admin Full Name: '));
    return { ...partial, studentId, email, fullName };
  } finally {
    rl.close();
  }
}

function promptHiddenPasswordFromTty(promptLabel = 'Initial Admin Password (hidden): ') {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return Promise.reject(
      new Error(
        'Admin password is required via BOOTSTRAP_ADMIN_PASSWORD or an interactive TTY prompt.',
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    let value = '';

    process.stderr.write(promptLabel);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') {
          process.stderr.write('\n');
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stderr.write('\n');
          cleanup();
          reject(new Error('Bootstrap cancelled by user.'));
          return;
        }
        if (ch === '\u007F' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (!CONTROL_CHAR_RE.test(ch)) {
          value += ch;
        }
      }
    };

    stdin.on('data', onData);
  });
}

export async function runDbBootstrapAdmin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (!options.env && !options.connectionString) {
    loadEnvFiles(cwd);
  }
  const env = options.env ?? process.env;
  const useTest = Boolean(options.useTest);

  const rawConnectionString =
    options.connectionString ??
    (useTest ? env.TEST_DATABASE_URL : env.DATABASE_URL);
  const connectionString = rawConnectionString?.trim();

  if (!connectionString) {
    throw new Error(
      useTest ? 'TEST_DATABASE_URL is required.' : 'DATABASE_URL is required.',
    );
  }

  parsePgConnection(connectionString);
  const target = formatSafeDbTarget(connectionString);
  const writeOut = options.writeOut ?? console.log;

  const filledFields = await promptVisibleFieldsIfNeeded({
    studentId: options.studentId ?? env.BOOTSTRAP_ADMIN_STUDENT_ID,
    email: options.email ?? env.BOOTSTRAP_ADMIN_EMAIL,
    fullName: options.fullName ?? env.BOOTSTRAP_ADMIN_FULL_NAME,
    locale: options.locale ?? env.BOOTSTRAP_ADMIN_LOCALE ?? 'vi',
  });

  const resolvedPassword =
    options.password ??
    env.BOOTSTRAP_ADMIN_PASSWORD ??
    (options.promptPassword
      ? await options.promptPassword()
      : await promptHiddenPasswordFromTty());

  const validated = validateBootstrapAdminInput({
    ...filledFields,
    password: resolvedPassword,
    allowedEmailDomain:
      options.allowedEmailDomain ??
      env.ALLOWED_EMAIL_DOMAIN ??
      DEFAULT_ALLOWED_EMAIL_DOMAIN,
  });

  const passwordHash = await hashBootstrapPassword(validated.password);
  const sensitiveValues = [
    validated.studentId,
    validated.email,
    validated.fullName,
    validated.password,
    passwordHash,
  ];

  const client = options.createClient
    ? options.createClient(connectionString)
    : new pg.Client({ connectionString });

  try {
    await client.connect();
    await client.query('BEGIN');

    try {
      const permCheck = await client.query(
        'SELECT code FROM "public"."permissions" WHERE code = ANY($1::text[])',
        [DEFAULT_BOOTSTRAP_PERMISSIONS],
      );
      if (permCheck.rows.length < DEFAULT_BOOTSTRAP_PERMISSIONS.length) {
        throw new Error(
          'System permissions catalog is incomplete. Run "npm run db:migrate" first.',
        );
      }

      const existingRes = await client.query(
        `SELECT id, student_id, purged_at
         FROM "public"."profiles"
         WHERE student_id = $1 OR lower(email) = lower($2)
         FOR UPDATE`,
        [validated.studentId, validated.email],
      );

      if (existingRes.rows.length > 1) {
        throw new Error(
          'Conflicting existing profiles match the provided student ID and email separately.',
        );
      }

      let userId;
      let created = false;

      if (existingRes.rows.length === 1) {
        const existing = existingRes.rows[0];
        if (existing.purged_at) {
          throw new Error('Cannot bootstrap an archived and purged profile.');
        }
        if (existing.student_id !== validated.studentId) {
          throw new Error(
            'An existing profile already uses this email under a different student ID.',
          );
        }

        await client.query(
          `UPDATE "public"."profiles"
           SET email = $2,
               full_name = $3,
               password_hash = $4,
               must_change_password = true,
               is_admin = true,
               is_active = true,
               left_at = NULL,
               locale = $5,
               updated_at = now()
           WHERE id = $1`,
          [
            existing.id,
            validated.email,
            validated.fullName,
            passwordHash,
            validated.locale,
          ],
        );
        await client.query(
          `UPDATE "public"."sessions"
           SET revoked_at = now(), updated_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [existing.id],
        );
        userId = existing.id;
      } else {
        const insertRes = await client.query(
          `INSERT INTO "public"."profiles" (
             student_id, email, full_name, password_hash,
             must_change_password, is_admin, is_active, left_at, locale
           )
           VALUES ($1, $2, $3, $4, true, true, true, NULL, $5)
           RETURNING id`,
          [
            validated.studentId,
            validated.email,
            validated.fullName,
            passwordHash,
            validated.locale,
          ],
        );
        userId = insertRes.rows[0]?.id;
        created = true;
      }

      if (!userId) {
        throw new Error('Failed to resolve bootstrap admin profile ID.');
      }

      for (const permCode of DEFAULT_BOOTSTRAP_PERMISSIONS) {
        await client.query(
          `INSERT INTO "public"."user_permissions" (user_id, permission_code, granted_by)
           VALUES ($1, $2, $1)
           ON CONFLICT (user_id, permission_code) DO NOTHING`,
          [userId, permCode],
        );
      }

      await client.query(
        `INSERT INTO "public"."audit_logs" (actor_id, action, target_user_id, detail)
         VALUES ($1, 'member.bootstrap_admin', $1, $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            created,
            isAdmin: true,
            mustChangePassword: true,
            locale: validated.locale,
            defaultPermissions: DEFAULT_BOOTSTRAP_PERMISSIONS,
          }),
        ],
      );

      await client.query('COMMIT');

      if (!options.quiet) {
        writeOut(
          `[db:bootstrap-admin] ${created ? 'Created' : 'Updated'} active admin (userId=${userId}, mustChangePassword=true) on ${target}`,
        );
      }

      return {
        userId,
        created,
        target,
        defaultPermissions: [...DEFAULT_BOOTSTRAP_PERMISSIONS],
      };
    } catch (txError) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw txError;
    }
  } catch (error) {
    throw new Error(
      `Bootstrap admin failed on ${target}: ${extractSafeErrorDetail(error, sensitiveValues)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    const cli = parseBootstrapAdminCliArgs();
    runDbBootstrapAdmin(cli).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
