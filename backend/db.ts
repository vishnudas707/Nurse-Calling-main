import dotenv from 'dotenv';
import sql from 'mssql';

// Load .env here, not only in server.ts. Imports are hoisted, so this module's
// body runs BEFORE server.ts calls dotenv.config() - without this line every
// DB_* variable below silently falls back to its hardcoded default.
dotenv.config();

const REQUEST_TIMEOUT = Number(process.env.DB_REQUEST_TIMEOUT) || 60000;
// Must be >= requestTimeout. The pool hands a connection to one query at a
// time, so a caller queued behind a slow query has to be allowed to wait at
// least as long as that query may run. When acquire < request, one slow query
// turns into a burst of acquire failures on every other caller.
const ACQUIRE_TIMEOUT = Number(process.env.DB_POOL_ACQUIRE_TIMEOUT) || REQUEST_TIMEOUT + 10000;

const config: sql.config = {
  user: process.env.DB_USER || 'carecall',
  password: process.env.DB_PASSWORD || 'carecallInvade@707',
  server: process.env.DB_SERVER || '20.163.9.187',
  database: process.env.DB_DATABASE || 'care-call',
  port: Number(process.env.DB_PORT) || 1433,
  connectionTimeout: Number(process.env.DB_CONNECT_TIMEOUT) || 15000,
  requestTimeout: REQUEST_TIMEOUT,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true' || false,
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true' || true,
    // The DB is reached over the public internet, so a half-open socket is a
    // real possibility. Cap how long a cancel may hang before the driver gives
    // up, instead of leaving the connection borrowed from the pool forever.
    cancelTimeout: Number(process.env.DB_CANCEL_TIMEOUT) || 5000,
  },
  pool: {
    max: Number(process.env.DB_POOL_MAX) || 20,
    // Keep one warm connection so an idle service still has a socket that the
    // heartbeat below exercises and replaces when the network silently drops it.
    min: Number(process.env.DB_POOL_MIN) || 1,
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
    acquireTimeoutMillis: ACQUIRE_TIMEOUT,
    createTimeoutMillis: Number(process.env.DB_POOL_CREATE_TIMEOUT) || 20000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
  },
};

// How often the heartbeat proves the pool can still reach SQL Server, and how
// many consecutive failures it takes before the pool is recycled. The interval
// also keeps the idle connection's NAT/firewall mapping alive on the long-haul
// link to the DB host, which is what silently dies after hours of quiet.
const HEARTBEAT_INTERVAL = Number(process.env.DB_HEARTBEAT_INTERVAL) || 60000;
const HEARTBEAT_TIMEOUT = Number(process.env.DB_HEARTBEAT_TIMEOUT) || 15000;
const HEARTBEAT_MAX_FAILURES = Number(process.env.DB_HEARTBEAT_MAX_FAILURES) || 3;
// The probe borrows a connection like any other query, so a pool that is merely
// busy fails it without being dead. Saturation therefore gets its own, much
// longer fuse: nothing in this app legitimately keeps every connection busy for
// this many minutes, so if it lasts that long the pool really is stuck.
const HEARTBEAT_MAX_SATURATED = Number(process.env.DB_HEARTBEAT_MAX_SATURATED) || 10;

// Cache the in-flight promise, not the resolved pool: concurrent callers during
// startup would otherwise each kick off their own sql.connect().
let poolPromise: Promise<sql.ConnectionPool> | null = null;
let currentPool: sql.ConnectionPool | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatFailures = 0;
let heartbeatSaturated = 0;
let lastPoolError: { message: string; at: string } | null = null;

function invalidate(pool: sql.ConnectionPool | null) {
  if (pool && pool !== currentPool) return; // a newer pool already replaced it
  poolPromise = null;
  currentPool = null;
  heartbeatFailures = 0;
  heartbeatSaturated = 0;
}

/** Drop a pool and close it, so SQL Server releases its sessions right away. */
function discard(pool: sql.ConnectionPool, reason: string) {
  if (pool !== currentPool) return; // already replaced; nothing to do
  console.error(`Discarding DB pool: ${reason}`);
  invalidate(pool);
  pool.close().catch((err) => console.error('Failed to close discarded DB pool:', err));
}

/**
 * Proves the pool can still round-trip a query. A dead TCP socket does not
 * always surface as an error - it can simply never answer - so the probe is
 * raced against its own timeout rather than trusted to reject on its own.
 */
async function heartbeat() {
  const pool = currentPool;
  if (!pool || !pool.connected) return;

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.request().query('SELECT 1 AS ok'),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`heartbeat timed out after ${HEARTBEAT_TIMEOUT}ms`)),
          HEARTBEAT_TIMEOUT
        );
      }),
    ]);
    if (heartbeatFailures > 0 || heartbeatSaturated > 0) {
      console.log(`DB heartbeat recovered after ${heartbeatFailures + heartbeatSaturated} bad probe(s)`);
    }
    heartbeatFailures = 0;
    heartbeatSaturated = 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Nothing free and callers still queued: the probe was most likely stuck
    // waiting for a connection rather than waiting on SQL Server, so this says
    // nothing about whether the link is alive.
    const saturated = pool.connected && pool.available === 0 && pool.pending > 0;

    if (saturated) {
      heartbeatSaturated += 1;
      console.warn(
        `DB heartbeat could not get a connection - pool saturated ` +
          `(${pool.borrowed}/${config.pool?.max} busy, ${pool.pending} waiting, ` +
          `${heartbeatSaturated}/${HEARTBEAT_MAX_SATURATED}): ${message}`
      );
      if (heartbeatSaturated >= HEARTBEAT_MAX_SATURATED) {
        discard(pool, `pool saturated for ${heartbeatSaturated} consecutive probes`);
      }
      return;
    }

    heartbeatFailures += 1;
    console.error(`DB heartbeat failed (${heartbeatFailures}/${HEARTBEAT_MAX_FAILURES}): ${message}`);
    if (heartbeatFailures >= HEARTBEAT_MAX_FAILURES) {
      // This is what removes the need to restart SQL Server by hand: a wedged
      // pool is torn down here and rebuilt by the next getPool().
      discard(pool, `${heartbeatFailures} consecutive heartbeat failures`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, HEARTBEAT_INTERVAL);
  // Never hold the event loop open just for the probe.
  heartbeatTimer.unref?.();
}

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function createPool(): Promise<sql.ConnectionPool> {
  console.log('DB config at runtime:', {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user ? '***' : undefined,
    poolMax: config.pool?.max,
  });

  // Own the pool instead of sql.connect()'s global singleton, so a bad pool can
  // be closed and replaced without leaking its sessions on the SQL Server.
  const pool = new sql.ConnectionPool(config);

  // mssql emits 'error' here for EVERY failed acquire() as well as for real
  // connection faults, so an acquireTimeoutMillis expiry under load lands here
  // too. Closing the pool on those would kill every in-flight query and turn
  // one slow query into a cascade, so this only records the error - the
  // heartbeat decides when a pool is genuinely dead. The handler still has to
  // exist: an emitted 'error' with no listener is an unhandled event and takes
  // the process down.
  pool.on('error', (err) => {
    lastPoolError = { message: err?.message ?? String(err), at: new Date().toISOString() };
    console.error('DB pool error (pool kept; heartbeat will recycle it if it is dead):', err);
  });

  try {
    await pool.connect();
  } catch (err) {
    // connect() failed part-way: close so a half-opened session is not left
    // behind on the server.
    await pool.close().catch(() => {});
    throw err;
  }
  currentPool = pool;
  heartbeatFailures = 0;
  startHeartbeat();
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
    const attempt: Promise<sql.ConnectionPool> = createPool().catch((err) => {
      console.error('Failed to create DB pool:', err);
      // Only clear the cache when this attempt is still the current one, so a
      // late failure cannot wipe out a newer pool that already succeeded.
      if (poolPromise === attempt) {
        poolPromise = null; // let the next request retry instead of caching failure
        currentPool = null;
      }
      throw err;
    });
    poolPromise = attempt;
  }
  return poolPromise;
}

/** Close the pool so SQL Server releases its sessions immediately. */
export async function closePool(): Promise<void> {
  stopHeartbeat();
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
  if (!pool) return { connected: false, heartbeatFailures, heartbeatSaturated, lastPoolError };
  // size/available/borrowed/pending read through to the inner tarn pool, which
  // close() sets to null - so only touch them while the pool is connected.
  if (!pool.connected) return { connected: false, healthy: pool.healthy, heartbeatFailures, heartbeatSaturated, lastPoolError };
  return {
    connected: pool.connected,
    healthy: pool.healthy,
    size: pool.size,
    available: pool.available,
    borrowed: pool.borrowed,
    pending: pool.pending,
    max: config.pool?.max,
    heartbeatFailures,
    heartbeatSaturated,
    lastPoolError,
  };
}

export { sql };
