import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';

const PASSWORD_KEY_BYTES = 64;
const SCRYPT_OPTIONS = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;
const FAKE_SALT = Buffer.alloc(16, 0x49).toString('base64');

export interface StoredAdministrator {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordSalt: string;
  passwordHash: string;
}

export interface NewAdministrator {
  username: string;
  normalizedUsername: string;
  passwordSalt: string;
  passwordHash: string;
}

export interface StoredAdminSession {
  adminId: string;
  username: string;
  tokenHash: string;
  csrfTokenHash: string;
  expiresAt: string;
}

export interface NewAdminSession {
  adminId: string;
  tokenHash: string;
  csrfTokenHash: string;
  expiresAt: string;
}

export interface AuthRepository {
  countAdministrators(): Promise<number>;
  createAdministrator(
    administrator: NewAdministrator,
  ): Promise<StoredAdministrator | null>;
  findAdministrator(
    normalizedUsername: string,
  ): Promise<StoredAdministrator | null>;
  createSession(session: NewAdminSession): Promise<void>;
  findSession(tokenHash: string): Promise<StoredAdminSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;
  healthCheck(): Promise<void>;
  close?(): Promise<void>;
}

export interface AuthenticatedSession {
  adminId: string;
  username: string;
  tokenHash: string;
  csrfTokenHash: string;
  expiresAt: string;
}

export interface CreatedAuthSession extends AuthenticatedSession {
  sessionToken: string;
  csrfToken: string;
}

export class AdministratorAlreadyConfiguredError extends Error {}
export class InvalidCredentialsError extends Error {}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt, 'base64'),
      PASSWORD_KEY_BYTES,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export function normalizeUsername(username: string): string {
  return username.normalize('NFKC').toLowerCase();
}

export async function createPasswordRecord(password: string): Promise<{
  passwordSalt: string;
  passwordHash: string;
}> {
  const passwordSalt = randomBytes(16).toString('base64');
  const passwordHash = (await derivePassword(password, passwordSalt)).toString(
    'base64',
  );
  return { passwordSalt, passwordHash };
}

export async function verifyPassword(
  password: string,
  passwordSalt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await derivePassword(password, passwordSalt);
  const expected = Buffer.from(expectedHash, 'base64');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMs = 7 * 24 * 60 * 60 * 1_000,
  ) {}

  async isSetupRequired(): Promise<boolean> {
    return (await this.repository.countAdministrators()) === 0;
  }

  async setup(username: string, password: string): Promise<CreatedAuthSession> {
    const passwordRecord = await createPasswordRecord(password);
    const administrator = await this.repository.createAdministrator({
      username,
      normalizedUsername: normalizeUsername(username),
      ...passwordRecord,
    });
    if (!administrator) {
      throw new AdministratorAlreadyConfiguredError(
        'Administrator setup is already complete',
      );
    }
    return this.issueSession(administrator);
  }

  async login(username: string, password: string): Promise<CreatedAuthSession> {
    const administrator = await this.repository.findAdministrator(
      normalizeUsername(username),
    );
    const passwordMatches = administrator
      ? await verifyPassword(
          password,
          administrator.passwordSalt,
          administrator.passwordHash,
        )
      : await verifyPassword(
          password,
          FAKE_SALT,
          Buffer.alloc(PASSWORD_KEY_BYTES).toString('base64'),
        );
    if (!administrator || !passwordMatches) {
      throw new InvalidCredentialsError('Invalid username or password');
    }
    return this.issueSession(administrator);
  }

  async authenticate(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!sessionToken) return null;
    const session = await this.repository.findSession(
      hashAuthToken(sessionToken),
    );
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    return session;
  }

  verifyCsrf(session: AuthenticatedSession, csrfToken: string): boolean {
    const actual = Buffer.from(hashAuthToken(csrfToken), 'hex');
    const expected = Buffer.from(session.csrfTokenHash, 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) return;
    await this.repository.deleteSession(hashAuthToken(sessionToken));
  }

  async cleanupExpiredSessions(): Promise<number> {
    return this.repository.cleanupExpiredSessions();
  }

  async healthCheck(): Promise<void> {
    await this.repository.healthCheck();
  }

  async close(): Promise<void> {
    await this.repository.close?.();
  }

  private async issueSession(
    administrator: StoredAdministrator,
  ): Promise<CreatedAuthSession> {
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const session: CreatedAuthSession = {
      adminId: administrator.id,
      username: administrator.username,
      sessionToken,
      csrfToken,
      tokenHash: hashAuthToken(sessionToken),
      csrfTokenHash: hashAuthToken(csrfToken),
      expiresAt: new Date(Date.now() + this.sessionTtlMs).toISOString(),
    };
    await this.repository.createSession(session);
    return session;
  }
}

interface LoginAttempt {
  failures: number;
  blockedUntil: number;
  lastFailure: number;
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttempt>();

  constructor(
    private readonly maximumFailures = 5,
    private readonly windowMs = 15 * 60 * 1_000,
  ) {}

  retryAfterSeconds(key: string, now = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt) return 0;
    if (now - attempt.lastFailure >= this.windowMs) {
      this.attempts.delete(key);
      return 0;
    }
    return attempt.blockedUntil > now
      ? Math.ceil((attempt.blockedUntil - now) / 1_000)
      : 0;
  }

  recordFailure(key: string, now = Date.now()): number {
    const current = this.attempts.get(key);
    const failures =
      current && now - current.lastFailure < this.windowMs
        ? current.failures + 1
        : 1;
    const blockedUntil =
      failures >= this.maximumFailures ? now + this.windowMs : 0;
    this.attempts.set(key, { failures, blockedUntil, lastFailure: now });
    return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1_000) : 0;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export class PostgresAuthRepository implements AuthRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 3 });
  }

  async countAdministrators(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_account',
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async createAdministrator(
    administrator: NewAdministrator,
  ): Promise<StoredAdministrator | null> {
    try {
      const result = await this.pool.query<{
        id: string;
        username: string;
        normalized_username: string;
        password_salt: string;
        password_hash: string;
      }>(
        `INSERT INTO admin_account (
           username, normalized_username, password_salt, password_hash
         ) VALUES ($1, $2, $3, $4)
         RETURNING id, username, normalized_username, password_salt, password_hash`,
        [
          administrator.username,
          administrator.normalizedUsername,
          administrator.passwordSalt,
          administrator.passwordHash,
        ],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            username: row.username,
            normalizedUsername: row.normalized_username,
            passwordSalt: row.password_salt,
            passwordHash: row.password_hash,
          }
        : null;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null;
      throw error;
    }
  }

  async findAdministrator(
    normalizedUsername: string,
  ): Promise<StoredAdministrator | null> {
    const result = await this.pool.query<{
      id: string;
      username: string;
      normalized_username: string;
      password_salt: string;
      password_hash: string;
    }>(
      `SELECT id, username, normalized_username, password_salt, password_hash
       FROM admin_account
       WHERE normalized_username = $1`,
      [normalizedUsername],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          username: row.username,
          normalizedUsername: row.normalized_username,
          passwordSalt: row.password_salt,
          passwordHash: row.password_hash,
        }
      : null;
  }

  async createSession(session: NewAdminSession): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM admin_session WHERE expires_at <= NOW()');
      await client.query(
        `INSERT INTO admin_session (
           admin_id, token_hash, csrf_token_hash, expires_at
         ) VALUES ($1, $2, $3, $4)`,
        [
          session.adminId,
          session.tokenHash,
          session.csrfTokenHash,
          session.expiresAt,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findSession(tokenHash: string): Promise<StoredAdminSession | null> {
    const result = await this.pool.query<{
      admin_id: string;
      username: string;
      token_hash: string;
      csrf_token_hash: string;
      expires_at: Date | string;
    }>(
      `SELECT session.admin_id, administrator.username, session.token_hash,
              session.csrf_token_hash, session.expires_at
       FROM admin_session session
       JOIN admin_account administrator ON administrator.id = session.admin_id
       WHERE session.token_hash = $1 AND session.expires_at > NOW()`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          adminId: row.admin_id,
          username: row.username,
          tokenHash: row.token_hash,
          csrfTokenHash: row.csrf_token_hash,
          expiresAt: new Date(row.expires_at).toISOString(),
        }
      : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM admin_session WHERE token_hash = $1', [
      tokenHash,
    ]);
  }

  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM admin_session WHERE expires_at <= NOW()',
    );
    return result.rowCount ?? 0;
  }

  async healthCheck(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
