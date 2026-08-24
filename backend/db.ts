import dotenv from 'dotenv';
import sql from 'mssql';

// Load .env here, not only in server.ts. Imports are hoisted, so this module's
// body runs BEFORE server.ts calls dotenv.config() — without this line every
// DB_* variable below silently falls back to its hardcoded default.
dotenv.config();

const config: sql.config = {
  user: process.env.DB_USER || 'carecall',
  password: process.env.DB_PASSWORD || 'carecallInvade@707',
  server: process.env.DB_SERVER || '20.163.9.187',
  database: process.env.DB_DATABASE || 'care-call',
  port: Number(process.env.DB_PORT) || 1433,
  connectionTimeout: Number(process.env.DB_CONNECT_TIMEOUT) || 15000,
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT) || 60000,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true' || false,
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true' || true,
  },
  pool: {
    max: Number(process.env.DB_POOL_MAX) || 10,
    // Keep one warm connection so an idle service still has a socket that gets
    // validated (SELECT 1) and replaced when the network silently drops it.
    min: Number(process.env.DB_POOL_MIN) || 1,
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
    // Fail fast instead of hanging forever when every connection is broken.
    acquireTimeoutMillis: Number(process.env.DB_POOL_ACQUIRE_TIMEOUT) || 20000,
    createTimeoutMillis: Number(process.env.DB_POOL_CREATE_TIMEOUT) || 20000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
  },
};

// Cache the in-flight promise, not the resolved pool: concurrent callers during
// startup would otherwise each kick off their own sql.connect().
let poolPromise: Promise<sql.ConnectionPool> | null = null;
let currentPool: sql.ConnectionPool | null = null;

function invalidate(pool: sql.ConnectionPool | null) {
  if (pool && pool !== currentPool) return; // a newer pool already replaced it
  poolPromise = null;
  currentPool = null;
}

async function createPool(): Promise<sql.ConnectionPool> {
  console.log('DB config at runtime:', {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user ? '***' : undefined,
  });

  // Own the pool instead of sql.connect()'s global singleton, so a bad pool can
  // be closed and replaced without leaking its sessions on the SQL Server.
  const pool = new sql.ConnectionPool(config);

  // Without this handler a pool-level error is an unhandled 'error' event; with
  // it, the dead pool is dropped so the next getPool() builds a fresh one.
  pool.on('error', (err) => {
    console.error('DB pool error, discarding pool:', err);
    invalidate(pool);
    pool.close().catch(() => {});
  });

  await pool.connect();
  currentPool = pool;
  console.log('DB connection pool created');
  return pool;
}

export async function getPool(): Promise<sql.ConnectionPool> {
  // Reuse only a pool that is actually usable. `healthy` goes false when every
  // connection attempt is failing; `connected` goes false after pool.close().
  if (currentPool && currentPool.connected && currentPool.healthy) {
    return currentPool;
  }
  if (currentPool && !(currentPool.connected && currentPool.healthy)) {
    const dead = currentPool;
    invalidate(dead);
    // Close it so its server-side sessions go away now, not on TCP timeout.
    dead.close().catch((err) => console.error('Failed to close stale DB pool:', err));
  }

  if (!poolPromise) {
    poolPromise = createPool().catch((err) => {
      console.error('Failed to create DB pool:', err);
      poolPromise = null; // let the next request retry instead of caching failure
      currentPool = null;
      throw err;
    });
  }
  return poolPromise;
}

/** Close the pool so SQL Server releases its sessions immediately. */
export async function closePool(): Promise<void> {
  const pool = currentPool;
  poolPromise = null;
  currentPool = null;
  if (!pool) return;
  try {
    await pool.close();
    console.log('DB connection pool closed');
  } catch (err) {
    console.error('Error closing DB pool:', err);
  }
}

/** Pool counters for the /api/health endpoint. */
export function getPoolStats() {
  const pool = currentPool;
  if (!pool) return { connected: false };
  // size/available/borrowed/pending read through to the inner tarn pool, which
  // close() sets to null — so only touch them while the pool is connected.
  if (!pool.connected) return { connected: false, healthy: pool.healthy };
  return {
    connected: pool.connected,
    healthy: pool.healthy,
    size: pool.size,
    available: pool.available,
    borrowed: pool.borrowed,
    pending: pool.pending,
  };
}

export { sql };
