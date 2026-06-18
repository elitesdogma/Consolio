/**
 * Live quote provider. Default implementation targets Finnhub's free
 * /quote endpoint, which returns real-time US equity prices.
 *
 * Swap providers by setting QUOTES_PROVIDER and adding a branch in
 * `fetchOne` — keep the returned shape `{ price, dayPct, asOf }`.
 */

const PROVIDER = process.env.QUOTES_PROVIDER ?? 'finnhub';
const API_KEY = process.env.QUOTES_API_KEY ?? '';
const CACHE_TTL_MS = 60_000;

export class QuotesUnavailableError extends Error {}

const cache = new Map(); // ticker -> { quote, cachedAt }

function fromCache(ticker) {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.quote;
  return null;
}

async function fetchFinnhub(ticker) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${API_KEY}`;
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new QuotesUnavailableError('Quotes API key rejected');
  }
  if (res.status === 429) {
    throw new QuotesUnavailableError('Quotes provider rate limit reached');
  }
  if (!res.ok) {
    throw new Error(`Quotes provider returned ${res.status}`);
  }
  const data = await res.json();
  const price = Number(data.c);
  // Finnhub returns c=0 (and pc=0) for unrecognised symbols.
  if (!Number.isFinite(price) || price === 0) {
    throw new Error('No price for symbol');
  }
  const dayPct = Number.isFinite(Number(data.dp))
    ? Number(data.dp)
    : (Number.isFinite(Number(data.pc)) && Number(data.pc) !== 0
        ? ((price - Number(data.pc)) / Number(data.pc)) * 100
        : 0);
  const asOf = Number.isFinite(Number(data.t)) && Number(data.t) > 0
    ? new Date(Number(data.t) * 1000).toISOString()
    : new Date().toISOString();
  return { price, dayPct, asOf };
}

async function fetchOne(ticker) {
  if (PROVIDER !== 'finnhub') {
    throw new Error(`Unknown QUOTES_PROVIDER: ${PROVIDER}`);
  }
  return fetchFinnhub(ticker);
}

/**
 * Fetch quotes for many symbols. Returns successes and per-symbol errors
 * separately so one bad ticker never sinks the whole response.
 *
 * @param {string[]} tickers
 * @returns {Promise<{ quotes: Record<string, {price:number, dayPct:number, asOf:string}>, errors: Record<string,string> }>}
 */
export async function getQuotes(tickers) {
  if (!API_KEY) throw new QuotesUnavailableError('QUOTES_API_KEY is not set');

  const quotes = {};
  const errors = {};
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];

  await Promise.all(
    unique.map(async (ticker) => {
      const cached = fromCache(ticker);
      if (cached) {
        quotes[ticker] = cached;
        return;
      }
      try {
        const quote = await fetchOne(ticker);
        cache.set(ticker, { quote, cachedAt: Date.now() });
        quotes[ticker] = quote;
      } catch (err) {
        if (err instanceof QuotesUnavailableError) throw err; // key/rate problems are global
        errors[ticker] = err.message;
      }
    })
  );

  return { quotes, errors };
}
