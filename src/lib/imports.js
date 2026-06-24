/* ============================================================================
   Shared import plumbing: CSV helpers and the merge that folds parsed
   positions from any broker into a Consolio portfolio for one holder.

   Merge rule (idempotent, per source): an import replaces only that holder's
   lots from the same import source and leaves manual lots and every other
   import untouched. Imported lots carry an `imported` marker so a manual lot
   is never removed even when it happens to use the same broker name as its
   source (Sharesies is the default manual source, so this matters). Lots from
   the original pre-marker IBKR import are also matched, so re-import stays
   idempotent across the upgrade.
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

/**
 * Merge parsed positions into a Consolio portfolio for one holder and source.
 * @param {{holders:Array, securities:Array, lots:Array}} portfolio
 * @param {{positions:{ticker:string,shares:number,costPerShare:number}[], instruments:Record<string,{name:string}>}} parsed
 * @param {{holderCode:string, source:string, holderName?:string, makeId:() => string}} opts
 * @returns {{next:object, summary:{holderCode:string, source:string, holderCreated:boolean,
 *            positionsImported:number, lotsReplaced:number, securitiesAdded:number}}}
 */
export function buildImportPlan(portfolio, parsed, { holderCode, source, holderName, makeId }) {
  const code = String(holderCode || '').trim();
  if (!code) throw new Error('A holder code is required to import.');
  const importKey = String(source || '').trim();
  if (!importKey) throw new Error('An import source is required.');

  const holders = [...(portfolio.holders ?? [])];
  const securities = [...(portfolio.securities ?? [])];
  const lots = [...(portfolio.lots ?? [])];

  const holderExisted = holders.some((h) => h.code === code);
  if (!holderExisted) holders.push({ code, name: (holderName || code).trim() || code, type: 'Individual' });

  const isPriorImport = (l) => {
    if (l.holderCode !== code) return false;
    if (l.imported === importKey) return true;
    // Legacy IBKR import (tagged by source only, before the marker existed).
    if (importKey === 'IBKR' && l.imported == null && l.source === 'IBKR') return true;
    return false;
  };
  const before = lots.length;
  const kept = lots.filter((l) => !isPriorImport(l));
  const lotsReplaced = before - kept.length;

  for (const p of parsed.positions) {
    kept.push({ id: makeId(), holderCode: code, ticker: p.ticker, source: importKey, imported: importKey, shares: p.shares, costPerShare: p.costPerShare });
  }

  const known = new Set(securities.map((s) => s.ticker));
  let securitiesAdded = 0;
  for (const p of parsed.positions) {
    if (known.has(p.ticker)) continue;
    known.add(p.ticker);
    securitiesAdded++;
    securities.push({ ticker: p.ticker, name: parsed.instruments[p.ticker]?.name || p.ticker, sector: '' });
  }

  return {
    next: { ...portfolio, holders, securities, lots: kept },
    summary: { holderCode: code, source: importKey, holderCreated: !holderExisted, positionsImported: parsed.positions.length, lotsReplaced, securitiesAdded },
  };
}
