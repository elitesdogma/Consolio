/* ============================================================================
   Native IBKR Activity Statement (CSV) -> Consolio import.

   Pure functions, no DOM. parseIbkrCsv reads the multi-section IBKR CSV and
   pulls the current US-stock holdings from the Open Positions section plus a
   ticker -> name map from Financial Instrument Information. buildImportPlan
   merges those into a portfolio for one holder.

   Merge rule (idempotent): the import replaces that holder's IBKR-sourced lots
   with the imported set and leaves manual lots and every other holder
   untouched, so re-importing an updated statement refreshes rather than
   duplicates. Securities are added for any new ticker; existing securities
   (and any sector you set on them) are preserved.
============================================================================ */

// CSV line splitter that respects double-quoted fields (descriptions can hold
// commas). Handles "" as an escaped quote inside a quoted field.
function splitCsvLine(line) {
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

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Parse a native IBKR Activity Statement CSV.
 * @returns {{positions: {ticker:string, shares:number, costPerShare:number}[],
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

  // ticker -> instrument metadata (covers more symbols than are currently held)
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
  let positions = raw.filter((p) => (tickersWithLot.has(p.ticker) ? p.disc === 'Lot' : p.disc === 'Summary'));

  positions = positions.filter((p) => {
    if (!Number.isFinite(p.shares) || !Number.isFinite(p.costPerShare)) {
      warnings.push(`Skipped ${p.ticker} (missing quantity or cost).`);
      return false;
    }
    return true;
  }).map((p) => ({ ticker: p.ticker, shares: p.shares, costPerShare: p.costPerShare }));

  return { positions, instruments, warnings, ok: positions.length > 0 };
}

/**
 * Merge parsed IBKR positions into a Consolio portfolio for one holder.
 * @param {{holders:Array, securities:Array, lots:Array}} portfolio
 * @param {ReturnType<typeof parseIbkrCsv>} parsed
 * @param {{holderCode:string, holderName?:string, makeId:() => string}} opts
 * @returns {{next:object, summary:{holderCode:string, holderCreated:boolean,
 *            positionsImported:number, lotsReplaced:number, securitiesAdded:number}}}
 */
export function buildImportPlan(portfolio, parsed, { holderCode, holderName, makeId }) {
  const code = String(holderCode || '').trim();
  if (!code) throw new Error('A holder code is required to import.');

  const holders = [...(portfolio.holders ?? [])];
  const securities = [...(portfolio.securities ?? [])];
  const lots = [...(portfolio.lots ?? [])];

  const holderExisted = holders.some((h) => h.code === code);
  if (!holderExisted) holders.push({ code, name: (holderName || code).trim() || code, type: 'Individual' });

  // Replace this holder's prior IBKR lots only.
  const before = lots.length;
  const kept = lots.filter((l) => !(l.holderCode === code && l.source === 'IBKR'));
  const lotsReplaced = before - kept.length;

  for (const p of parsed.positions) {
    kept.push({ id: makeId(), holderCode: code, ticker: p.ticker, source: 'IBKR', shares: p.shares, costPerShare: p.costPerShare });
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
    summary: { holderCode: code, holderCreated: !holderExisted, positionsImported: parsed.positions.length, lotsReplaced, securitiesAdded },
  };
}
