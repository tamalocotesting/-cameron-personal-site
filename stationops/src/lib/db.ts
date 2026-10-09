import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings. They are restaurant-local
// calendar dates; turning them into JS Dates would shift them by the server's
// UTC offset.
types.setTypeParser(1082, (value) => value);

/**
 * One connection pool per process. In `next dev` modules are re-evaluated on
 * every change, so the pool is parked on globalThis to avoid leaking
 * connections.
 */
const globalForPool = globalThis as unknown as { stationopsPool?: Pool };

export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  }
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
  });
}

export function pool(): Pool {
  if (!globalForPool.stationopsPool) globalForPool.stationopsPool = createPool();
  return globalForPool.stationopsPool;
}

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run `fn` inside a transaction; rolls back if it throws. */
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>, p: Pool = pool()): Promise<T> {
  const client = await p.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
