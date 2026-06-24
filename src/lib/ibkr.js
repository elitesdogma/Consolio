/* ============================================================================
   Native IBKR Activity Statement (CSV) -> Consolio positions.

   parseIbkrCsv reads the multi-section IBKR CSV and pulls current US-stock
   holdings from the Open Positions section plus a ticker -> name map from
   Financial Instrument Information. The merge into a portfolio lives in
   imports.js (buildImportPlan), shared with the Sharesies importer.
============================================================================ */

import { splitCsvLine, num } from './imports.js';

/**
 * Parse a native IBKR Activity Statement CSV.
 * @returns {{lots: {ticker:string, shares:number, costPerShare:number, date:null}[],
 *            instruments: Record<string,{name:string,type:string,exch:string,isin:string}>,
 *            warnings: string[], ok: boolean}}
 */
export function parseIbkrCsv(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  // IBKR groups rows by section; a "Header" row names the columns for the
  // "Data" rows that follow it within the same section.
  const headers = {};
  const rows = [];
  for (const line of lines) {
    const cells = splitCsvLine(line);
    const section = cells[0];
    const kind = cells[1];
    if (kind === 'Header') {
      headers[section] = cells.slice(2);
    } else if (kind === 'Data' && headers[section]) {
      const cols = headers[section];
      const vals = cells.slice(2);
      const obj = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = vals[i];
      rows.push({ section, obj });
    }
  }

  const warnings = [];

  const instruments = {};
  for (const { section, obj } of rows) {
    if (section !== 'Financial Instrument Information') continue;
    const ticker = (obj.Symbol || '').trim();
    if (!ticker) continue;
    instruments[ticker] = {
      name: (obj.Description || '').trim(),
      type: (obj.Type || '').trim(),
      exch: (obj['Listing Exch'] || '').trim(),
      isin: (obj['Security ID'] || '').trim(),
    };
  }

  // Current holdings from Open Positions. A statement carries either per-symbol
  // "Summary" rows or per-lot "Lot" rows; prefer Lot rows when present so we
  // never double-count, and ignore the section Total/SubTotal rows.
  const raw = [];
  for (const { section, obj } of rows) {
    if (section !== 'Open Positions') continue;
    const disc = (obj.DataDiscriminator || '').trim();
    if (disc !== 'Summary' && disc !== 'Lot') continue;
    const ticker = (obj.Symbol || '').trim();
    if (!ticker) continue;
    const assetCat = (obj['Asset Category'] || '').trim();
    const currency = (obj.Currency || '').trim();
    if (assetCat !== 'Stocks') { warnings.push(`Skipped ${ticker} (${assetCat || 'non-stock'}).`); continue; }
    if (currency !== 'USD') { warnings.push(`Skipped ${ticker} (${currency}, only USD imported).`); continue; }
    raw.push({ ticker, shares: num(obj.Quantity), costPerShare: num(obj['Cost Price']), disc });
  }

  const tickersWithLot = new Set(raw.filter((p) => p.disc === 'Lot').map((p) => p.ticker));
  const chosen = raw.filter((p) => (tickersWithLot.has(p.ticker) ? p.disc === 'Lot' : p.disc === 'Summary'));

  const lots = chosen.filter((p) => {
    if (!Number.isFinite(p.shares) || !Number.isFinite(p.costPerShare)) {
      warnings.push(`Skipped ${p.ticker} (missing quantity or cost).`);
      return false;
    }
    return true;
  }).map((p) => ({ ticker: p.ticker, shares: p.shares, costPerShare: p.costPerShare, date: null }));

  return { lots, instruments, warnings, ok: lots.length > 0 };
}
