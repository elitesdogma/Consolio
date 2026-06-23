import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Railway's internal Postgres host (`*.railway.internal`) speaks plain TCP and
 * rejects SSL; the public proxy host requires SSL but uses a cert chain Node
 * does not trust by default. PGSSL lets you force either mode.
 */
function sslConfig(url) {
  const override = process.env.PGSSL;
  if (override === 'disable') return false;
  if (override === 'require') return { rejectUnauthorized: false };
  if (!url || url.includes('.railway.internal') || url.includes('localhost') || url.includes('127.0.0.1')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

export const hasDatabase = Boolean(DATABASE_URL);

const pool = hasDatabase
  ? new Pool({ connectionString: DATABASE_URL, ssl: sslConfig(DATABASE_URL), max: 5 })
  : null;

const PORTFOLIO_ID = 'default';

const EMPTY_PORTFOLIO = { holders: [], securities: [], lots: [] };

export async function initDb() {
  if (!pool) throw new Error('DATABASE_URL is not set');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id       BIGSERIAL PRIMARY KEY,
      ticker   TEXT NOT NULL,
      price    NUMERIC NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS price_snapshots_ticker_time
      ON price_snapshots (ticker, taken_at DESC);
  `);
}

/** @returns {Promise<{data: object, updatedAt: string|null}>} */
export async function getPortfolio() {
  if (!pool) throw new Error('DATABASE_URL is not set');
  const { rows } = await pool.query(
    `SELECT data,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
       FROM portfolio WHERE id = $1`,
    [PORTFOLIO_ID]
  );
  if (rows.length === 0) return { data: EMPTY_PORTFOLIO, updatedAt: null };
  return { data: rows[0].data, updatedAt: rows[0].updated_at };
}

/**
 * Persist the portfolio with optimistic concurrency control.
 *
 * The concurrency token is the row's `updated_at`, handed to the client on read
 * and echoed back here as `expectedUpdatedAt`. It is compared as an instant
 * (not as text) and carried at full microsecond precision, so a token loaded
 * from an existing row round-trips and matches exactly rather than failing on
 * the millisecond truncation a JS Date would impose.
 *
 * Behaviour:
 *  - force === true              -> unconditional write (explicit overwrite).
 *  - expectedUpdatedAt undefined -> unconditional write (legacy client predating
 *                                   OCC; keeps an open old tab saving during a
 *                                   deploy rather than erroring).
 *  - otherwise (guarded)         -> writes only if the stored token still
 *                                   matches. A null token matches only a row
 *                                   that does not yet exist (the first save).
 *                                   Any mismatch returns { conflict: true } with
 *                                   no write.
 *
 * @returns {Promise<{conflict: boolean, updatedAt: string|null}>}
 */
export async function savePortfolio(data, { expectedUpdatedAt, force } = {}) {
  if (!pool) throw new Error('DATABASE_URL is not set');
  const tokenSql = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const guarded = !force && expectedUpdatedAt !== undefined;

  if (!guarded) {
    const { rows } = await pool.query(
      `INSERT INTO portfolio (id, data, updated_at)
         VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING ${tokenSql} AS updated_at`,
      [PORTFOLIO_ID, data]
    );
    return { conflict: false, updatedAt: rows[0].updated_at };
  }

  // Guarded: the conflict branch only updates when the stored instant still
  // matches the token the client loaded. A non-existent row inserts; a present
  // row with a different (or null) token leaves the statement affecting zero
  // rows, which we surface as a conflict.
  const { rows } = await pool.query(
    `INSERT INTO portfolio (id, data, updated_at)
       VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       WHERE portfolio.updated_at = $3::timestamptz
     RETURNING ${tokenSql} AS updated_at`,
    [PORTFOLIO_ID, data, expectedUpdatedAt]
  );
  if (rows.length === 0) return { conflict: true, updatedAt: null };
  return { conflict: false, updatedAt: rows[0].updated_at };
}

/**
 * Record a price point per ticker, but only if the most recent snapshot for
 * that ticker is older than `minIntervalMs`. This keeps the sparkline series
 * evenly spaced and the table small even when the app is left open.
 */
export async function recordSnapshots(entries, minIntervalMs) {
  if (!pool || entries.length === 0) return;
  const tickers = entries.map((e) => e.ticker);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (ticker) ticker, taken_at
       FROM price_snapshots
      WHERE ticker = ANY($1)
      ORDER BY ticker, taken_at DESC`,
    [tickers]
  );
  const lastByTicker = new Map(rows.map((r) => [r.ticker, new Date(r.taken_at).getTime()]));
  const now = Date.now();
  const due = entries.filter((e) => {
    const last = lastByTicker.get(e.ticker);
    return last === undefined || now - last >= minIntervalMs;
  });
  if (due.length === 0) return;

  const values = [];
  const params = [];
  due.forEach((e, i) => {
    values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    params.push(e.ticker, e.price);
  });
  await pool.query(
    `INSERT INTO price_snapshots (ticker, price) VALUES ${values.join(', ')}`,
    params
  );
}

/**
 * Latest `perTicker` snapshots per ticker, oldest-first, as a map suitable for
 * drawing sparklines. Returns `{ TICKER: [{ t, price }, ...] }`.
 */
export async function getSparks(tickers, perTicker) {
  if (!pool || tickers.length === 0) return {};
  const { rows } = await pool.query(
    `SELECT ticker, price, taken_at FROM (
        SELECT ticker, price, taken_at,
               row_number() OVER (PARTITION BY ticker ORDER BY taken_at DESC) AS rn
          FROM price_snapshots
         WHERE ticker = ANY($1)
     ) ranked
     WHERE rn <= $2
     ORDER BY ticker, taken_at ASC`,
    [tickers, perTicker]
  );
  const out = {};
  for (const r of rows) {
    (out[r.ticker] ??= []).push({ t: r.taken_at, price: Number(r.price) });
  }
  return out;
}
