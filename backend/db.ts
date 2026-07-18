import sql from 'mssql';

const config: sql.config = {
  user: process.env.DB_USER || 'carecall',
  password: process.env.DB_PASSWORD || 'carecallInvade@707',
  server: process.env.DB_SERVER || '20.163.9.187',
  database: process.env.DB_DATABASE || 'care-call',
  port: Number(process.env.DB_PORT) || 1433,
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT) || 60000,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true' || false,
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true' || true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool() {
  if (pool) return pool;
    try {
      console.log('DB config at runtime:', {
        server: config.server,
        port: config.port,
        database: config.database,
        user: config.user ? '***' : undefined,
      });

      pool = await sql.connect(config);
      console.log('DB connection pool created');
      return pool;
    } catch (err) {
      console.error('Failed to create DB pool:', err);
      throw err;
    }
}

export { sql };
