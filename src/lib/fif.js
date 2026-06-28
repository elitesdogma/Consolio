/* ============================================================================
   Indicative NZD cost of FIF interests, per holder, for the de minimis test.

   Every holding in Consolio is a US-listed share, which for a New Zealand tax
   resident is an attributing interest in a FIF. A natural person stays outside
   the FIF rules while the total cost of those interests is at or below the de
   minimis threshold; trusts and companies have no de minimis, so the rules apply
   to them regardless of cost. The threshold is set in NZD, but Consolio stores
   cost in USD, so each lot is converted at the USD to NZD reference rate on its
   purchase date (Frankfurter, ECB daily rates), falling back to the current rate
   for lots that carry no date.

   This figure is indicative, not the legal one:
   - the source CSVs are in USD, so a reference rate is applied rather than the
     actual rate at which the broker settled, and Sharesies in particular debited
     NZD that the USD export does not contain;
   - the de minimis test looks at the highest total cost during the income year,
     while this sums only currently-held lots, so a holder who bought and sold
     within the year can have reached a higher peak than is shown here.

   The historical FX lookup is injected (rateFor) so the aggregation can be tested
   without a network, and a module-level cache means a repeated compute never
   refetches a date already seen.
============================================================================ */

const DEFAULT_ENDPOINT = 'https://api.frankfurter.app';

// date 'YYYY-MM-DD' -> NZD per 1 USD. Shared across computes within a session.
const rateCache = new Map();

/**
 * Build a historical USD to NZD rate lookup backed by Frankfurter.
 * Frankfurter returns the nearest prior working-day rate for weekend or holiday
 * dates, which is the correct reference for a trade settled on such a date.
 * @param {string} [endpoint]
 * @returns {(date:string) => Promise<number>}
 */
export function makeFrankfurterRate(endpoint = DEFAULT_ENDPOINT) {
  return async function rateFor(date) {
    if (rateCache.has(date)) return rateCache.get(date);
    const res = await fetch(`${endpoint}/${date}?from=USD&to=NZD`);
    if (!res.ok) throw new Error(`FX lookup failed for ${date} (${res.status}).`);
    const json = await res.json();
    const rate = json && json.rates ? json.rates.NZD : NaN;
    if (!Number.isFinite(rate)) throw new Error(`No USD to NZD rate for ${date}.`);
    rateCache.set(date, rate);
    return rate;
  };
}

// The de minimis applies to natural persons only. Treat a holder as a
// non-individual (no de minimis) when its free-text type names an entity, and as
// an individual otherwise, including when the type is blank (the default is
// Individual). Surfaced per holder so the classification is visible.
const ENTITY = /trust|compan|\bltd\b|limited|incorporat|\binc\b|partnership|estate|fund|nominee|holdings|\bllc\b|\bplc\b/i;

export function isIndividualType(type) {
  const t = String(type || '').trim();
  if (!t) return true;
  return !ENTITY.test(t);
}

/**
 * Indicative NZD FIF cost per holder.
 * @param {{holders:Array<{code:string,name?:string,type?:string}>,
 *          lots:Array<{holderCode:string,ticker:string,shares:number,costPerShare:number,date?:string|null}>}} portfolio
 * @param {{ rateFor:(date:string)=>Promise<number>, spotRate:number }} opts
 * @returns {Promise<{rows:Array<{code:string,name:string,type:string,isIndividual:boolean,
 *           nzdCost:number,usdCost:number,lots:number,undatedLots:number,fallbackLots:number}>,
 *           anyUndated:boolean, ok:boolean, error?:string}>}
 */
export async function computeFifByHolder(portfolio, { rateFor, spotRate }) {
  const holders = (portfolio && portfolio.holders) || [];
  const lots = ((portfolio && portfolio.lots) || []).filter(
    (l) => Number.isFinite(l.shares) && l.shares > 0 && Number.isFinite(l.costPerShare) && l.costPerShare > 0
  );

  // Resolve every distinct purchase date once; a failed lookup is left unset and
  // falls back to the current rate below.
  const dates = [...new Set(lots.map((l) => l.date).filter(Boolean))];
  const rates = new Map();
  for (const d of dates) {
    try { rates.set(d, await rateFor(d)); } catch { /* fall back to spot */ }
  }

  const byCode = new Map();
  const ensure = (code) => {
    if (!byCode.has(code)) {
      const h = holders.find((x) => x.code === code);
      byCode.set(code, {
        code,
        name: (h && h.name) || code,
        type: (h && h.type) || '',
        isIndividual: isIndividualType(h && h.type),
        nzdCost: 0,
        usdCost: 0,
        lots: 0,
        undatedLots: 0,
        fallbackLots: 0,
      });
    }
    return byCode.get(code);
  };

  let anyUndated = false;
  for (const l of lots) {
    const row = ensure(l.holderCode);
    const usd = l.shares * l.costPerShare;
    let rate = l.date && rates.has(l.date) ? rates.get(l.date) : null;
    if (rate == null) {
      rate = spotRate;
      if (Number.isFinite(rate)) { anyUndated = true; row.fallbackLots += 1; }
    }
    if (!l.date) row.undatedLots += 1;
    row.usdCost += usd;
    if (Number.isFinite(rate)) row.nzdCost += usd * rate;
    row.lots += 1;
  }

  const rows = [...byCode.values()].filter((r) => r.lots > 0).sort((a, b) => b.nzdCost - a.nzdCost);
  return { rows, anyUndated, ok: true };
}
