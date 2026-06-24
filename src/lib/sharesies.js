/* ============================================================================
   Sharesies "Investment holdings report" (CSV) -> Consolio positions.

   This report is period-based and has no cost-basis column. It gives, per
   instrument over the selected window: starting/ending shareholding, shares
   purchased/sold and the dollar value of each, plus market values.

   Current holdings are the rows with an ending shareholding > 0. Cost basis is
   derived as (dollar value purchased / number of shares purchased), which under
   average-cost accounting is the per-share cost of the shares still held — but
   ONLY when the starting shareholding is zero, i.e. every held share was bought
   inside the report window. If a holding was already held at the report's start
   date, the cost of those earlier shares is not in this report, so cost is left
   unknown (0) and the holding is flagged. To get complete cost basis, export
   the report with the From date set before your first purchase.

   The merge into a portfolio lives in imports.js (buildImportPlan).
============================================================================ */

import { splitCsvLine, num } from './imports.js';

const COL = {
  ticker: 'Investment ticker symbol',
  name: 'Investment name',
  currency: 'Currency',
  starting: 'Starting shareholding',
  ending: 'Ending shareholding',
  numBought: 'Number of shares purchased',
  valBought: 'Dollar value of shares purchased (including the value of transferred shares)',
};

/**
 * Parse a Sharesies Investment holdings report CSV.
 * @returns {{positions: {ticker:string, shares:number, costPerShare:number}[],
 *            instruments: Record<string,{name:string}>,
 *            warnings: string[], ok: boolean}}
 */
export function parseSharesiesCsv(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  if (lines.length < 2) return { positions: [], instruments: {}, warnings: ['File is empty.'], ok: false };

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const at = (name) => header.indexOf(name);
  const iTicker = at(COL.ticker);
  const iEnd = at(COL.ending);
  const iValBuy = at(COL.valBought);
  if (iTicker < 0 || iEnd < 0 || iValBuy < 0) {
    return { positions: [], instruments: {}, warnings: ['This does not look like a Sharesies investment holdings report.'], ok: false };
  }
  const iName = at(COL.name);
  const iCur = at(COL.currency);
  const iStart = at(COL.starting);
  const iNumBuy = at(COL.numBought);

  const warnings = [];
  const positions = [];
  const instruments = {};
  let closedSkipped = 0;
  let noCost = 0;

  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    const ticker = (cells[iTicker] || '').trim();
    if (!ticker) continue;

    const ending = num(cells[iEnd]);
    if (!Number.isFinite(ending) || ending <= 0) { closedSkipped++; continue; } // not currently held

    const currency = iCur >= 0 ? (cells[iCur] || '').trim() : 'USD';
    if (currency && currency !== 'USD') { warnings.push(`Skipped ${ticker} (${currency}, only USD imported).`); continue; }

    const starting = iStart >= 0 ? num(cells[iStart]) : 0;
    const numBuy = iNumBuy >= 0 ? num(cells[iNumBuy]) : NaN;
    const valBuy = num(cells[iValBuy]);

    const costKnown = starting === 0 && Number.isFinite(numBuy) && numBuy > 0 && Number.isFinite(valBuy) && valBuy > 0;
    const costPerShare = costKnown ? valBuy / numBuy : 0;
    if (!costKnown) {
      noCost++;
      warnings.push(`${ticker}: cost basis not in this report (held before the report's start date); imported with no cost.`);
    }

    positions.push({ ticker, shares: ending, costPerShare });
    instruments[ticker] = { name: iName >= 0 ? (cells[iName] || '').trim() : ticker };
  }

  if (closedSkipped > 0) warnings.push(`${closedSkipped} fully-sold position(s) ignored.`);
  if (noCost > 0) warnings.push(`Tip: re-export with the From date before your first purchase so cost basis is complete.`);

  return { positions, instruments, warnings, ok: positions.length > 0 };
}

/* ----------------------------------------------------------------------------
   Sharesies "Transaction report" (CSV) -> individual BUY/SELL transactions.

   Each row is one trade with its own price and date. This is the per-purchase
   detail the holdings report lacks. It is NOT split-adjusted and includes
   shares later sold, so it is only used in combination with the holdings report
   (the authority on current share counts) via reconstructLots, which FIFO-matches
   sells against buys and reconciles the result against the holdings report.

   Columns used: Trade date, Instrument code, Instrument name, Quantity, Price,
   Transaction type (BUY/SELL), Currency (lowercase 'usd').
---------------------------------------------------------------------------- */

const TX = {
  date: 'Trade date',
  ticker: 'Instrument code',
  name: 'Instrument name',
  qty: 'Quantity',
  price: 'Price',
  type: 'Transaction type',
  currency: 'Currency',
};

/**
 * Parse a Sharesies transaction report CSV.
 * @returns {{transactions: {ticker:string, side:'BUY'|'SELL', shares:number, price:number, ts:number, date:string}[],
 *            instruments: Record<string,{name:string}>, warnings: string[], ok: boolean}}
 */
export function parseSharesiesTransactions(text) {
  const lines = String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

  if (lines.length < 2) return { transactions: [], instruments: {}, warnings: ['File is empty.'], ok: false };

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const at = (name) => header.indexOf(name);
  const iTicker = at(TX.ticker);
  const iQty = at(TX.qty);
  const iPrice = at(TX.price);
  const iType = at(TX.type);
  if (iTicker < 0 || iQty < 0 || iPrice < 0 || iType < 0) {
    return { transactions: [], instruments: {}, warnings: ['This does not look like a Sharesies transaction report.'], ok: false };
  }
  const iDate = at(TX.date);
  const iName = at(TX.name);
  const iCur = at(TX.currency);

  const transactions = [];
  const instruments = {};
  let skipped = 0;

  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r]);
    const ticker = (cells[iTicker] || '').trim();
    if (!ticker) continue;

    const type = (cells[iType] || '').trim().toUpperCase();
    if (type !== 'BUY' && type !== 'SELL') { skipped++; continue; }

    const currency = iCur >= 0 ? (cells[iCur] || '').trim().toUpperCase() : 'USD';
    if (currency && currency !== 'USD') { skipped++; continue; }

    const shares = num(cells[iQty]);
    const price = num(cells[iPrice]);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price)) { skipped++; continue; }

    const rawDate = iDate >= 0 ? (cells[iDate] || '').trim() : '';
    const date = rawDate.slice(0, 10); // YYYY-MM-DD
    const clean = rawDate.replace(/\s*\(UTC\)\s*$/i, '').replace(' ', 'T');
    const ts = Date.parse(clean.endsWith('Z') ? clean : clean + 'Z');

    transactions.push({ ticker, side: type, shares, price, ts: Number.isFinite(ts) ? ts : 0, date });
    if (iName >= 0 && !instruments[ticker]) instruments[ticker] = { name: (cells[iName] || '').trim() };
  }

  const warnings = [];
  if (skipped > 0) warnings.push(`${skipped} non-trade or non-USD row(s) ignored.`);

  return { transactions, instruments, warnings, ok: transactions.length > 0 };
}
