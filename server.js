import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hasDatabase,
  initDb,
  getPortfolio,
  savePortfolio,
  recordSnapshots,
  getSparks,
} from './db.js';
import { getQuotes, QuotesUnavailableError } from './lib/quotes.js';
import { getRate } from './lib/fx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const SNAPSHOT_MIN_INTERVAL_MS = 15 * 60 * 1000;
const SPARK_POINTS = 48;

let dbReady = false;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireDb(res) {
  if (!hasDatabase) {
    res.status(503).json({ error: 'Storage is not configured. Set DATABASE_URL.' });
    return false;
  }
  if (!dbReady) {
    res.status(503).json({ error: 'Storage is not ready. Check the database connection.' });
    return false;
  }
  return true;
}

// ---- input sanitisation (trust boundary: the PUT body is user-supplied) ----

const toStr = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ALLOWED_SOURCES = new Set(['Sharesies', 'IBKR', 'Other']);

function sanitisePortfolio(body) {
  const input = body && typeof body === 'object' ? body : {};
  const holders = Array.isArray(input.holders) ? input.holders : [];
  const securities = Array.isArray(input.securities) ? input.securities : [];
  const lots = Array.isArray(input.lots) ? input.lots : [];

  return {
    holders: holders
      .map((h) => ({
        code: toStr(h?.code, 12).toUpperCase(),
        name: toStr(h?.name, 80),
        type: toStr(h?.type, 40),
      }))
      .filter((h) => h.code),
    securities: securities
      .map((s) => ({
        ticker: toStr(s?.ticker, 12).toUpperCase(),
        name: toStr(s?.name, 80),
        sector: toStr(s?.sector, 40),
      }))
      .filter((s) => s.ticker),
    lots: lots
      .map((l) => ({
        id: toStr(l?.id, 40) || cryptoId(),
        holderCode: toStr(l?.holderCode, 12).toUpperCase(),
        ticker: toStr(l?.ticker, 12).toUpperCase(),
        source: ALLOWED_SOURCES.has(l?.source) ? l.source : 'Other',
        shares: Math.max(0, toNum(l?.shares)),
        costPerShare: Math.max(0, toNum(l?.costPerShare)),
      }))
      .filter((l) => l.holderCode && l.ticker && l.shares > 0),
  };
}

function cryptoId() {
  return 'lot_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------------------------------- API ----------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: dbReady, quotes: Boolean(process.env.QUOTES_API_KEY) });
});

app.get(
  '/api/portfolio',
  asyncHandler(async (_req, res) => {
    if (!requireDb(res)) return;
    const { data, updatedAt } = await getPortfolio();
    res.json({ portfolio: sanitisePortfolio(data), updatedAt });
  })
);

app.put(
  '/api/portfolio',
  asyncHandler(async (req, res) => {
    if (!requireDb(res)) return;
    const clean = sanitisePortfolio(req.body);
    const updatedAt = await savePortfolio(clean);
    res.json({ portfolio: clean, updatedAt });
  })
);

app.get(
  '/api/quotes',
  asyncHandler(async (req, res) => {
    const symbols = String(req.query.symbols ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (symbols.length === 0) return res.json({ quotes: {}, errors: {} });

    try {
      const { quotes, errors } = await getQuotes(symbols);
      if (dbReady) {
        const entries = Object.entries(quotes).map(([ticker, q]) => ({ ticker, price: q.price }));
        recordSnapshots(entries, SNAPSHOT_MIN_INTERVAL_MS).catch((e) =>
          console.error('snapshot write failed:', e.message)
        );
      }
      res.json({ quotes, errors });
    } catch (err) {
      if (err instanceof QuotesUnavailableError) {
        return res.status(503).json({ error: err.message });
      }
      throw err;
    }
  })
);

app.get(
  '/api/fx',
  asyncHandler(async (req, res) => {
    const base = toStr(req.query.base, 8) || 'USD';
    const quote = toStr(req.query.quote, 8) || 'NZD';
    try {
      res.json(await getRate(base, quote));
    } catch (err) {
      res.status(503).json({ error: err.message });
    }
  })
);

app.get(
  '/api/sparks',
  asyncHandler(async (req, res) => {
    if (!requireDb(res)) return;
    const symbols = String(req.query.symbols ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    res.json({ sparks: await getSparks(symbols, SPARK_POINTS) });
  })
);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ------------------------------ static + SPA ------------------------------

app.use(express.static(DIST_DIR));
app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));

// --------------------------- error handler / boot ---------------------------

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  if (hasDatabase) {
    try {
      await initDb();
      dbReady = true;
      console.log('Database ready.');
    } catch (err) {
      console.error('Database init failed; data routes will return 503:', err.message);
    }
  } else {
    console.warn('DATABASE_URL not set; data routes will return 503.');
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Consolio listening on :${PORT}`));
}

start();
