/* ============================================================================
   Native IBKR Activity Statement (CSV) -> Consolio holdings and trades.

   parseIbkrCsv reads the multi-section IBKR CSV and returns:
   - positions:   current US-stock holdings from the Open Positions section, the
                  authoritative current share count (IBKR average cost per share);
   - trades:      individual stock BUY/SELL executions from the Trades section,
                  used to reconstruct dated per-purchase lots via reconstructLots;
   - instruments: a ticker -> name map from Financial Instrument Information.

   Forex rows in Trades (for example NZD.USD) are excluded. The Trades Date/Time
   is a quoted field that itself contains a comma ("YYYY-MM-DD, HH:MM:SS"), which
   the shared quote-aware splitCsvLine handles. The merge into a portfolio lives
   in imports.js (buildImportPlan); the FIFO reconstruction in reconstructLots.
============================================================================ */

import { splitCsvLine, num } from './imports.js';

/**
 * Parse a native IBKR Activity Statement CSV.
 * @returns {{positions: {ticker:string, shares:number, costPerShare:number}[],
 *            trades: {ticker:string, side:'BUY'|'SELL', shares:number, price:number, ts:number, date:string}[],
 *            instruments: Record<string,{name:string,type:string,exch:string,isin:string}>,
 *            warnings: string[], ok: boolean}}
 */
export function parseIbkrCsv(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  // IBKR groups rows by section; a "Header" row names the columns for the "Data"
  // rows that follow it. A section can carry more than one Header (the Trades
  // section has separate column layouts for Stocks and Forex), so headers are
  // applied in stream order: each Data row uses the most recent Header seen for
  // its own section.
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
  const rawPos = [];
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
    rawPos.push({ ticker, shares: num(obj.Quantity), costPerShare: num(obj['Cost Price']), disc });
  }

  const tickersWithLot = new Set(rawPos.filter((p) => p.disc === 'Lot').map((p) => p.ticker));
  const chosen = rawPos.filter((p) => (tickersWithLot.has(p.ticker) ? p.disc === 'Lot' : p.disc === 'Summary'));

  const positions = chosen.filter((p) => {
    if (!Number.isFinite(p.shares) || !Number.isFinite(p.costPerShare)) {
      warnings.push(`Skipped ${p.ticker} (missing quantity or cost).`);
      return false;
    }
    return true;
  }).map((p) => ({ ticker: p.ticker, shares: p.shares, costPerShare: p.costPerShare }));

  // Individual stock executions from the Trades section. The Quantity sign gives
  // the side (positive buy, negative sell); T. Price is the execution price
  // excluding commission, consistent with how Sharesies lots are priced. Forex
  // and any non-stock rows are excluded, so only US-stock buys and sells feed
  // the FIFO reconstruction.
  const trades = [];
  for (const { section, obj } of rows) {
    if (section !== 'Trades') continue;
    const disc = (obj.DataDiscriminator || '').trim();
    if (disc !== 'Order') continue;
    const assetCat = (obj['Asset Category'] || '').trim();
    if (assetCat !== 'Stocks') continue; // excludes Forex and any non-stock rows
    const currency = (obj.Currency || '').trim();
    if (currency !== 'USD') continue;
    const ticker = (obj.Symbol || '').trim();
    if (!ticker) continue;
    const qty = num(obj.Quantity);
    const price = num(obj['T. Price']);
    if (!Number.isFinite(qty) || qty === 0 || !Number.isFinite(price)) continue;

    const rawDt = (obj['Date/Time'] || '').trim(); // "YYYY-MM-DD, HH:MM:SS"
    const date = rawDt.slice(0, 10);
    const ts = Date.parse(rawDt.replace(/,\s*/, 'T') + 'Z');

    trades.push({
      ticker,
      side: qty > 0 ? 'BUY' : 'SELL',
      shares: Math.abs(qty),
      price,
      ts: Number.isFinite(ts) ? ts : 0,
      date,
    });
  }

  return { positions, trades, instruments, warnings, ok: positions.length > 0 };
}
