/* ============================================================================
   Shared import plumbing: CSV helpers, FIFO holdings reconstruction, and the
   merge that folds imported lots into a Consolio portfolio for one holder.

   Merge rule (idempotent, per source): an import replaces only that holder's
   lots from the same import source and leaves manual lots and every other
   import untouched. Imported lots carry an `imported` marker so a manual lot is
   never removed even when it uses the same broker name as its source (Sharesies
   is the default manual source, so this matters). Lots from the original
   pre-marker IBKR import are also matched, so re-import stays idempotent.
============================================================================ */

// CSV line splitter that respects double-quoted fields and "" escapes.
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
};

const RECON_TOLERANCE = 0.01; // shares; reconstructed total must match the authority within this

/**
 * Reconstruct currently-held lots from a transaction history, matched FIFO, and
 * reconcile each holding against an authoritative current share count.
 *
 * For each authoritative holding: replay its BUY/SELL transactions oldest-first,
 * letting sells consume the earliest open buys (FIFO). The remaining open buys
 * are the shares still held, each with its own buy price and date. If that
 * reconstructed total matches the authoritative share count, the holding is
 * broken out into those individual lots. If it does not (the signal of an
 * unhandled split or a data gap), it falls back to a single consolidated lot at
 * the authoritative cost, so a holding is never shown as wrong lots.
 *
 * @param {{ticker:string, side:'BUY'|'SELL', shares:number, price:number, ts:number, date:string}[]} transactions
 * @param {{ticker:string, shares:number, costPerShare:number}[]} authoritative
 * @returns {{lots:{ticker:string,shares:number,costPerShare:number,date:string|null}[],
 *            perTicker:Record<string,{mode:'lots'|'consolidated',count:number,reconShares:number,authShares:number}>}}
 */
export function reconstructLots(transactions, authoritative) {
  const byTicker = {};
  for (const t of transactions) (byTicker[t.ticker] ??= []).push(t);

  const openByTicker = {};
  for (const [ticker, txs] of Object.entries(byTicker)) {
    const sorted = [...txs].sort((a, b) => a.ts - b.ts);
    const queue = []; // open buy lots, oldest first
    for (const t of sorted) {
      if (t.side === 'BUY') {
        queue.push({ shares: t.shares, price: t.price, date: t.date });
      } else {
        let remaining = t.shares;
        while (remaining > 1e-9 && queue.length) {
          const lot = queue[0];
          if (lot.shares <= remaining + 1e-9) { remaining -= lot.shares; queue.shift(); }
          else { lot.shares -= remaining; remaining = 0; }
        }
      }
    }
    openByTicker[ticker] = queue;
  }

  const lots = [];
  const perTicker = {};
  for (const pos of authoritative) {
    const open = openByTicker[pos.ticker] ?? [];
    const reconShares = open.reduce((s, l) => s + l.shares, 0);
    const reconciles = open.length > 0 && Math.abs(reconShares - pos.shares) <= RECON_TOLERANCE;
    if (reconciles) {
      for (const l of open) lots.push({ ticker: pos.ticker, shares: l.shares, costPerShare: l.price, date: l.date });
      perTicker[pos.ticker] = { mode: 'lots', count: open.length, reconShares, authShares: pos.shares };
    } else {
      lots.push({ ticker: pos.ticker, shares: pos.shares, costPerShare: pos.costPerShare, date: null });
      perTicker[pos.ticker] = { mode: 'consolidated', count: 1, reconShares, authShares: pos.shares };
    }
  }
  return { lots, perTicker };
}

/**
 * Merge imported lots into a Consolio portfolio for one holder and source.
 * @param {{holders:Array, securities:Array, lots:Array}} portfolio
 * @param {{lots:{ticker:string,shares:number,costPerShare:number,date?:string|null}[], instruments:Record<string,{name:string}>}} parsed
 * @param {{holderCode:string, source:string, holderName?:string, makeId:() => string}} opts
 */
export function buildImportPlan(portfolio, parsed, { holderCode, source, holderName, makeId, additive = false }) {
  const code = String(holderCode || '').trim();
  if (!code) throw new Error('A holder code is required to import.');
  const importKey = String(source || '').trim();
  if (!importKey) throw new Error('An import source is required.');

  const holders = [...(portfolio.holders ?? [])];
  const securities = [...(portfolio.securities ?? [])];
  const lots = [...(portfolio.lots ?? [])];
  const incoming = parsed.lots ?? [];

  const holderExisted = holders.some((h) => h.code === code);
  if (!holderExisted) holders.push({ code, name: (holderName || code).trim() || code, type: 'Individual' });

  const isPriorImport = (l) => {
    if (l.holderCode !== code) return false;
    if (l.imported === importKey) return true;
    if (importKey === 'IBKR' && l.imported == null && l.source === 'IBKR') return true; // legacy IBKR
    return false;
  };
  const before = lots.length;
  // Overwrite (default): drop this holder's prior lots from the same source, then
  // append the incoming lots, so a re-import stays idempotent. Additive: keep
  // every existing lot and append, so a second import adds to rather than
  // replaces the holder's lots for this source.
  const kept = additive ? [...lots] : lots.filter((l) => !isPriorImport(l));
  const lotsReplaced = additive ? 0 : before - kept.length;

  for (const l of incoming) {
    const lot = { id: makeId(), holderCode: code, ticker: l.ticker, source: importKey, imported: importKey, shares: l.shares, costPerShare: l.costPerShare };
    if (l.date) lot.date = l.date;
    kept.push(lot);
  }

  const known = new Set(securities.map((s) => s.ticker));
  let securitiesAdded = 0;
  for (const l of incoming) {
    if (known.has(l.ticker)) continue;
    known.add(l.ticker);
    securitiesAdded++;
    securities.push({ ticker: l.ticker, name: parsed.instruments?.[l.ticker]?.name || l.ticker, sector: '' });
  }

  const tickers = new Set(incoming.map((l) => l.ticker));
  return {
    next: { ...portfolio, holders, securities, lots: kept },
    summary: { holderCode: code, source: importKey, holderCreated: !holderExisted, lotsImported: incoming.length, positionsImported: tickers.size, lotsReplaced, securitiesAdded },
  };
}
