import pg from 'pg';

export type Row = Record<string, any>;

/** Minimal query surface shared by node-postgres and PGlite (used in tests). */
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction; everything inside must use the `tx` handle. */
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Runs `fn` only if no other server instance holds the named lock; returns false if skipped. */
  withLock(key: number, fn: () => Promise<void>): Promise<boolean>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async withLock(key, fn) {
      const client = await pool.connect();
      try {
        const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [key]);
        if (!rows[0].ok) return false;
        try {
          await fn();
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [key]);
        }
        return true;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

const MIGRATIONS: string[] = [
  // 1: core schema
  `
  CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    is_pro boolean NOT NULL DEFAULT false,
    pro_checked_at timestamptz,
    stripe_account_id text UNIQUE,
    stripe_charges_enabled boolean NOT NULL DEFAULT false
  );

  CREATE TABLE login_codes (
    email text PRIMARY KEY,
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts int NOT NULL DEFAULT 0
  );

  CREATE TABLE devices (
    push_token text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform text,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE SEQUENCE records_seq;

  -- Every synced object (documents, clients, catalog items, profile) as JSON.
  CREATE TABLE records (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    id text NOT NULL,
    data jsonb,
    updated_at timestamptz NOT NULL,
    deleted boolean NOT NULL DEFAULT false,
    seq bigint NOT NULL,
    PRIMARY KEY (user_id, type, id)
  );
  CREATE INDEX records_user_seq ON records (user_id, seq);

  CREATE TABLE shares (
    token text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    viewed_at timestamptz,
    UNIQUE (user_id, doc_id)
  );

  CREATE TABLE online_payments (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id text NOT NULL,
    payment jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX online_payments_doc ON online_payments (user_id, doc_id);

  CREATE TABLE reminder_log (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id text NOT NULL,
    kind text NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, doc_id, kind)
  );
  `,
];

export async function migrate(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ version: number }>(`SELECT version FROM schema_migrations`);
  const applied = new Set(rows.map((r) => Number(r.version)));
  for (const [index, sql] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (applied.has(version)) continue;
    await db.tx(async (tx) => {
      // Split on statement boundaries: PGlite's extended protocol takes one statement per query.
      for (const statement of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [version]);
    });
  }
}
