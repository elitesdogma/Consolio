/**
 * Foreign-exchange rates. Uses the keyless open.er-api.com endpoint, which
 * publishes daily reference rates (not intraday spot). Good enough for a
 * holdings display; swap the endpoint if you need live tick-level FX.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE_URL = 'https://open.er-api.com/v6/latest/USD';

let cache = null; // { rates: Record<string, number>, asOf: string, cachedAt: number }

async function loadUsdRates() {
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) return cache;
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`FX provider returned ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success' || !data.rates) {
    throw new Error('FX provider returned no rates');
  }
  cache = {
    rates: data.rates,
    asOf: data.time_last_update_utc ?? new Date().toISOString(),
    cachedAt: Date.now(),
  };
  return cache;
}

/**
 * @param {string} base
 * @param {string} quote
 * @returns {Promise<{ base:string, quote:string, rate:number, asOf:string }>}
 */
export async function getRate(base, quote) {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  const { rates, asOf } = await loadUsdRates();
  if (b === q) return { base: b, quote: q, rate: 1, asOf };

  const usdToBase = b === 'USD' ? 1 : rates[b];
  const usdToQuote = q === 'USD' ? 1 : rates[q];
  if (!Number.isFinite(usdToBase) || !Number.isFinite(usdToQuote)) {
    throw new Error(`Unsupported currency pair ${b}/${q}`);
  }
  return { base: b, quote: q, rate: usdToQuote / usdToBase, asOf };
}
