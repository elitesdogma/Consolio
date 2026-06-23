/* ============================================================================
   Pure derivation layer. No React, no I/O — turns the stored portfolio
   (holders, securities, lots) plus a live price map into the derived view
   data every surface needs. Mirrors the prototype's helpers but is null-safe:
   a security with no live or stored price is treated as "unpriced" and kept
   out of every aggregate rather than being silently valued at zero.
============================================================================ */

/** Build currency-aware number formatters. USD is the base; NZD multiplies. */
export function createFormatters(currency, rate) {
  const fx = currency === 'NZD' && Number.isFinite(rate) ? rate : 1;
  const money = (usd) => {
    if (usd == null || !Number.isFinite(usd)) return '—';
    const v = usd * fx;
    const a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  };
  const price = (usd) => (usd == null || !Number.isFinite(usd) ? '—' : '$' + (usd * fx).toFixed(2));
  const pct = (p) => (p == null || !Number.isFinite(p) ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%');
  const signedMoney = (usd) =>
    usd == null || !Number.isFinite(usd) ? '—' : (usd >= 0 ? '+' : '-') + money(Math.abs(usd));
  const shares = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—');
  return { money, price, pct, signedMoney, shares };
}

export const tone = (p) => (p != null && p >= 0 ? 'var(--low)' : 'var(--crit)');
export const toneChip = (p) => (p != null && p >= 0 ? 'low' : 'crit');

/** SVG path data for a trailing sparkline. Returns null with < 2 points. */
export function chartPath(data, w, h) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const mx = Math.max(...data);
  const mn = Math.min(...data);
  const pad = 9;
  const span = mx - mn || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - pad - ((v - mn) / span) * (h - pad * 2),
  ]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return { line, area: line + ` L${w} ${h} L0 ${h} Z` };
}

const priceOf = (priceMap, ticker) => {
  const p = priceMap[ticker]?.price;
  return Number.isFinite(p) ? p : null;
};
const dayOf = (priceMap, ticker) => {
  const d = priceMap[ticker]?.dayPct;
  return Number.isFinite(d) ? d : 0;
};

/**
 * @param {{holders:Array, securities:Array, lots:Array, priceMap:Object}} input
 */
export function buildModel({ holders, securities, lots, priceMap }) {
  const secMeta = new Map(securities.map((s) => [s.ticker, s]));
  const metaFor = (ticker) => secMeta.get(ticker) ?? { ticker, name: '', sector: '' };

  // lots -> { holderCode -> { ticker -> {shares,costSum,lots[]} } }
  const grouped = new Map();
  for (const lot of lots) {
    if (!grouped.has(lot.holderCode)) grouped.set(lot.holderCode, new Map());
    const byTicker = grouped.get(lot.holderCode);
    if (!byTicker.has(lot.ticker)) byTicker.set(lot.ticker, { shares: 0, costSum: 0, lots: [] });
    const agg = byTicker.get(lot.ticker);
    agg.shares += lot.shares;
    agg.costSum += lot.shares * lot.costPerShare;
    agg.lots.push({ id: lot.id, source: lot.source, shares: lot.shares, costPerShare: lot.costPerShare });
  }

  const byHolder = new Map();
  for (const holder of holders) {
    const tickerMap = grouped.get(holder.code) ?? new Map();
    const positions = [];
    for (const [ticker, agg] of tickerMap) {
      const meta = metaFor(ticker);
      const avgCost = agg.shares > 0 ? agg.costSum / agg.shares : 0;
      const price = priceOf(priceMap, ticker);
      const priced = price != null;
      const dayPct = dayOf(priceMap, ticker);
      const mv = priced ? agg.shares * price : null;
      const gain = priced ? (price - avgCost) * agg.shares : null;
      const gainPct = priced && avgCost > 0 ? (price / avgCost - 1) * 100 : null;
      positions.push({
        ticker, name: meta.name || ticker, sector: meta.sector || 'Uncategorised',
        shares: agg.shares, avgCost, price, dayPct, priced, mv, gain, gainPct,
        weight: null, lots: agg.lots, holderCode: holder.code, holderName: holder.name || holder.code,
      });
    }
    const total = positions.reduce((s, p) => s + (p.mv ?? 0), 0);
    const dayPnl = positions.reduce((s, p) => s + (p.priced ? p.mv * p.dayPct / 100 : 0), 0);
    for (const p of positions) p.weight = p.priced && total > 0 ? (p.mv / total) * 100 : null;
    positions.sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1));
    const sectorTotals = {};
    for (const p of positions) if (p.priced) sectorTotals[p.sector] = (sectorTotals[p.sector] ?? 0) + p.mv;
    const topSector = Object.keys(sectorTotals).sort((a, b) => sectorTotals[b] - sectorTotals[a])[0] ?? '—';
    byHolder.set(holder.code, {
      code: holder.code, name: holder.name || holder.code, type: holder.type || 'Holder',
      total, dayPnl, dayPct: total > 0 ? (dayPnl / total) * 100 : 0,
      count: positions.length, unpricedCount: positions.filter((p) => !p.priced).length,
      topSector, positions,
    });
  }

  // securities firm-wide (only tickers that are actually held)
  const heldTickers = new Set(lots.map((l) => l.ticker));
  const byTicker = new Map();
  for (const ticker of heldTickers) {
    const meta = metaFor(ticker);
    const price = priceOf(priceMap, ticker);
    const priced = price != null;
    const dayPct = dayOf(priceMap, ticker);
    const holderPositions = [];
    for (const h of byHolder.values()) {
      const pos = h.positions.find((p) => p.ticker === ticker);
      if (pos) holderPositions.push(pos);
    }
    holderPositions.sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1));
    const firmShares = holderPositions.reduce((s, p) => s + p.shares, 0);
    const costSum = holderPositions.reduce((s, p) => s + p.avgCost * p.shares, 0);
    byTicker.set(ticker, {
      ticker, name: meta.name || ticker, sector: meta.sector || 'Uncategorised',
      price, dayPct, priced,
      firmShares, mv: priced ? firmShares * price : null,
      wAvg: firmShares > 0 ? costSum / firmShares : 0,
      accountsCount: holderPositions.length, holders: holderPositions,
    });
  }

  // firm roll-up
  const holderList = [...byHolder.values()];
  const firmTotal = holderList.reduce((s, h) => s + h.total, 0);
  const firmDayPnl = holderList.reduce((s, h) => s + h.dayPnl, 0);
  const firmSectorTotals = {};
  for (const h of holderList) {
    for (const p of h.positions) if (p.priced) firmSectorTotals[p.sector] = (firmSectorTotals[p.sector] ?? 0) + p.mv;
  }
  const sectorNames = Object.keys(firmSectorTotals)
    .sort((a, b) => firmSectorTotals[b] - firmSectorTotals[a])
    .slice(0, 6);
  // On-system tonal ramp: one accent family (the --calm hue, ~205deg) walked
  // through lightness with a small hue drift so sectors separate without
  // becoming a categorical rainbow. Returned as a ready-to-use hsl() string so
  // the UI need not know the maths. Lightness is theme-neutral here; the CSS
  // var --ramp-l-shift (set per theme) nudges it for dark vs light glass.
  const rampColour = (i, n) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    const h = 205 + (t - 0.5) * 46;   // 182 .. 228, centred on the calm accent
    const l = 50 + t * 22;            // 50% .. 72%
    return `hsl(${h.toFixed(0)} 72% ${l.toFixed(0)}%)`;
  };
  const sectorBars = sectorNames.map((name, i) => ({
    name,
    w: firmTotal > 0 ? (firmSectorTotals[name] / firmTotal) * 100 : 0,
    pct: firmTotal > 0 ? Math.round((firmSectorTotals[name] / firmTotal) * 100) : 0,
    opacity: (1 - i * 0.13).toFixed(2),
    colour: rampColour(i, sectorNames.length),
  }));

  return {
    firm: {
      total: firmTotal, dayPnl: firmDayPnl, dayPct: firmTotal > 0 ? (firmDayPnl / firmTotal) * 100 : 0,
      holdersCount: holders.length,
      positionsCount: holderList.reduce((s, h) => s + h.count, 0),
      unpricedCount: holderList.reduce((s, h) => s + h.unpricedCount, 0),
      sectorBars,
    },
    holderCards: [...holderList].sort((a, b) => b.total - a.total),
    securityCards: [...byTicker.values()].sort((a, b) => (b.mv ?? -1) - (a.mv ?? -1)),
    byHolder,
    byTicker,
    registry: { holders, securities },
  };
}
