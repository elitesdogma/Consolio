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
