import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { buildModel, createFormatters, chartPath, tone, toneChip, fxSensitivity } from './lib/model.js';
import { loadPortfolio, savePortfolio, fetchQuotes, fetchFx, fetchSparks } from './lib/api.js';
import { parseIbkrCsv, buildImportPlan } from './lib/ibkr.js';

const REFRESH_INTERVAL_MS = 120_000;
const EASE = 'cubic-bezier(0.22,1,0.36,1)';
const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const genId = () => 'lot_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const uniqueTickers = (p) =>
  [...new Set([...(p?.securities ?? []).map((s) => s.ticker), ...(p?.lots ?? []).map((l) => l.ticker)])];

/* Format a millisecond epoch as "HH:MM · DD Mon" in the viewer's local zone.
   Used for the prices-as-of line; FX freshness is deliberately not shown. */
const fmtStamp = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' });
  return `${time} · ${date}`;
};

/* ------------------------------- icons ------------------------------- */
const IBack = () => (<svg viewBox="0 0 24 24" style={{ width: 19, height: 19, strokeWidth: 2 }}><path d="M15 5l-7 7 7 7" /></svg>);
const ISun = () => (<svg viewBox="0 0 24 24" style={{ width: 17, height: 17, strokeWidth: 1.7 }}><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" /></svg>);
const IMoon = () => (<svg viewBox="0 0 24 24" style={{ width: 17, height: 17, strokeWidth: 1.7 }}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>);
const IPlus = () => (<svg viewBox="0 0 24 24" style={{ width: 18, height: 18, strokeWidth: 2 }}><path d="M12 5v14M5 12h14" /></svg>);
const IChevR = () => (<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>);
const IArrowR = () => (<svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>);
const IX = () => (<svg viewBox="0 0 24 24" style={{ width: 15, height: 15, strokeWidth: 2 }}><path d="M6 6l12 12M18 6L6 18" /></svg>);
const IUpload = () => (<svg viewBox="0 0 24 24" style={{ width: 16, height: 16, strokeWidth: 1.9 }}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>);

/* ------------------------------- top bar ------------------------------- */
function TopBar({ showBack, showBrand, title, sub, currency, currencyDisabledNote, isDark, onBack, onToggleCurrency, onAdd, onToggleTheme }) {
  return (
    <header className="topbar glass-2">
      {showBack && (<button className="iconbtn" onClick={onBack} aria-label="Back"><IBack /></button>)}
      {showBrand && <div className="brandmk" />}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <b style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</b>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--ink-3)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
      </div>
      <button className={`curbtn ${currency === 'NZD' ? 'on' : ''}`} onClick={onToggleCurrency} title={currencyDisabledNote || 'Toggle display currency'} aria-label="Toggle currency">{currency}</button>
      <button className="iconbtn" onClick={onAdd} aria-label="Add holding"><IPlus /></button>
      <button className="iconbtn" onClick={onToggleTheme} aria-label="Toggle theme">{isDark ? <ISun /> : <IMoon />}</button>
    </header>
  );
}

/* ------------------------------- depth rail ------------------------------- */
function DepthRail({ rail, fillW }) {
  return (
    <nav className="depthrail glass-2">
      <div className="rail-track">
        <div className="rail-fill" style={{ width: fillW + '%' }} />
        {rail.map((node, i) => (
          <button key={i} className={`rnode ${node.state}`} onClick={node.onClick}>
            <span className="rdot" /><span className="rlabel">{node.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ------------------------------- row helper ------------------------------- */
function HoldingRow({ name, sub, mvStr, gainStr, gainColor, onClick }) {
  return (
    <button className="row" onClick={onClick} style={{ gridTemplateColumns: '1fr auto 18px' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{sub}</span>
      </span>
      <span style={{ textAlign: 'right' }}>
        <span className="mono" style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{mvStr}</span>
        <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: gainColor }}>{gainStr}</span>
      </span>
      <span className="chev"><IChevR /></span>
    </button>
  );
}

function Sparkline({ data, color }) {
  const chart = chartPath(data, 320, 118);
  if (!chart) {
    return (
      <div style={{ position: 'relative', height: 118, marginTop: 4, display: 'grid', placeItems: 'center' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', lineHeight: 1.5 }}>
          Price history builds<br />as quotes are recorded
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', height: 118, marginTop: 4 }}>
      <svg viewBox="0 0 320 118" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <path d={chart.area} fill={color} opacity="0.12" />
        <path className="chart-line" d={chart.line} fill="none" stroke={color} strokeWidth="2.2" />
      </svg>
    </div>
  );
}

/* ---- concentration colour bands (display heuristics; tune to taste) ---- */
const CONC_BANDS = [
  { min: 0.30, key: 'crit', colour: 'var(--crit)' },
  { min: 0.20, key: 'high', colour: 'var(--high)' },
  { min: 0.12, key: 'med', colour: 'var(--med)' },
  { min: 0, key: 'low', colour: 'var(--low)' },
];
const concBand = (w) => CONC_BANDS.find((b) => w >= b.min) ?? CONC_BANDS[CONC_BANDS.length - 1];

/* Single-name concentration over the priced firm-wide book. Read-only. */
function ConcentrationPanel({ conc }) {
  if (!conc || conc.weights.length === 0) return null;
  const largestBand = concBand(conc.largest.weight);
  const lead =
    largestBand.key === 'low'
      ? { chip: 'low', text: 'Spread across names' }
      : { chip: largestBand.key, text: `Single-name weight: ${conc.largest.key} ${(conc.largest.weight * 100).toFixed(0)}%` };
  const stats = [
    { label: 'Largest', value: `${(conc.largest.weight * 100).toFixed(1)}%`, sub: conc.largest.key },
    { label: 'Top 5', value: `${(conc.top5 * 100).toFixed(0)}%`, sub: `${conc.weights.length} names` },
    { label: 'Effective', value: conc.effectiveNames != null ? conc.effectiveNames.toFixed(1) : '—', sub: 'equal-wt eq.' },
  ];
  return (
    <section className="glass-2" style={{ borderRadius: 22, padding: '16px 18px', marginBottom: 14 }}>
      <div className="sec-t" style={{ marginBottom: 12 }}><span>Concentration</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
        {stats.map((s, i) => (
          <div key={i} className="stat">
            <div className="eyebrow">{s.label}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 5 }}>{s.value}</div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--ink-4)', marginTop: 3, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {conc.weights.slice(0, 5).map((w) => (
          <div key={w.key} style={{ display: 'grid', gridTemplateColumns: '46px 1fr 44px', gap: 10, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{w.key}</span>
            <span style={{ height: 8, borderRadius: 5, background: 'rgba(127,127,127,0.16)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${(w.weight * 100).toFixed(1)}%`, background: concBand(w.weight).colour, transition: 'width var(--dur) var(--ease)' }} />
            </span>
            <span className="mono" style={{ fontSize: 11, textAlign: 'right', color: 'var(--ink-2)' }}>{(w.weight * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 13 }}>
        <span className={`chip ${lead.chip}`}><span className="dot" />{lead.text}</span>
      </div>
    </section>
  );
}

/* NZD value of the USD book under daily FX moves. Always shown in NZD because
   it is a home-currency exposure lens, independent of the display toggle. */
function FxPanel({ usdTotal, fx }) {
  if (!fx?.rate || !(usdTotal > 0)) return null;
  const nzdMoney = createFormatters('USD', 1).money; // '$' + K/M abbreviation on a raw NZD number
  const baseNzd = usdTotal * fx.rate;
  const rows = fxSensitivity(usdTotal, fx.rate).filter((r) => r.shock !== 0);
  const label = (s) => `NZD ${s > 0 ? 'stronger' : 'weaker'} ${Math.abs(s * 100).toFixed(0)}%`;
  return (
    <section className="glass-2" style={{ borderRadius: 22, padding: '16px 18px', marginBottom: 14 }}>
      <div className="sec-t" style={{ marginBottom: 12 }}><span>NZD exposure</span></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>{nzdMoney(baseNzd)}</div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>at {fx.rate.toFixed(4)} NZD/USD</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 11 }}>
        {rows.map((r) => {
          const delta = r.nzd - baseNzd;
          return (
            <div key={r.shock} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center', padding: '7px 2px', borderTop: '1px solid var(--line-soft)' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{label(r.shock)}</span>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right' }}>{nzdMoney(r.nzd)}</span>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, textAlign: 'right', minWidth: 58, color: tone(delta) }}>{(delta >= 0 ? '+' : '-') + nzdMoney(Math.abs(delta))}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 11, fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>
        A stronger NZD lowers the NZD value of USD assets. Daily reference rate, not intraday spot.
      </div>
    </section>
  );
}

/* ===================== L0 · TOTAL ===================== */
function TotalSurface({ model, fmt, currency, fx, axis, setAxis, openHolder, openSecurity, quoteNotice, pricesAsOf, holdingSort, setHoldingSort, holdingQuery, setHoldingQuery, onAdd }) {
  const { firm, holderCards, securityCards } = model;
  const empty = firm.holdersCount === 0;
  const [sortOpen, setSortOpen] = useState(false);

  const SORT_LABELS = { value: 'Value', lifetime: 'Return', return: 'Day', symbol: 'Symbol', holder: 'Holders' };

  // Firm-wide holdings list with filter (symbol / name / sector) plus sort.
  // Derived only; securityCards already aggregates per ticker across holders.
  const visibleSecurities = (() => {
    const q = holdingQuery.trim().toLowerCase();
    const list = securityCards.filter(
      (c) =>
        !q ||
        c.ticker.toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.sector || '').toLowerCase().includes(q)
    );
    const cmp = {
      value: (a, b) => (b.mv ?? -1) - (a.mv ?? -1),
      lifetime: (a, b) => (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity),
      return: (a, b) => (b.dayPct ?? -Infinity) - (a.dayPct ?? -Infinity),
      symbol: (a, b) => a.ticker.localeCompare(b.ticker),
      holder: (a, b) => b.accountsCount - a.accountsCount || (b.mv ?? -1) - (a.mv ?? -1),
    };
    return list.slice().sort(cmp[holdingSort] ?? cmp.value);
  })();

  return (
    <>
      {quoteNotice && (
        <div className="banner">
          <span>{quoteNotice} Live prices stay blank until this is resolved; everything else still works.</span>
        </div>
      )}

      <section className="glass-2" style={{ borderRadius: 22, padding: '18px 18px 17px', marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 11 }}>Total portfolio value · {currency}</div>
        <div className="mono" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1 }}>{fmt.money(firm.total)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
          <span className={`chip ${toneChip(firm.dayPct)}`}><span className="dot" />{fmt.pct(firm.dayPct)} today</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{firm.holdersCount} holders · {firm.positionsCount} positions</span>
          {firm.unpricedCount > 0 && (<span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{firm.unpricedCount} awaiting price</span>)}
        </div>
        {firm.gainPct != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <span className={`chip ${toneChip(firm.gainPct)}`}><span className="dot" />{fmt.pct(firm.gainPct)} all time</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmt.signedMoney(firm.gain)} unrealised</span>
            {firm.returnExcluded > 0 && (<span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{firm.returnExcluded} w/o cost</span>)}
          </div>
        )}
        {pricesAsOf != null && (
          <div style={{ marginTop: 9, fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)', letterSpacing: '0.02em' }}>
            Prices as of {fmtStamp(pricesAsOf)}
          </div>
        )}
        {firm.sectorBars.length > 0 && (
          <div style={{ marginTop: 17, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div className="eyebrow">Allocation by sector</div>
            <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
              {firm.sectorBars.map((s, i) => (<span key={i} style={{ height: '100%', width: `${s.w}%`, background: s.colour || 'var(--calm)' }} />))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', marginTop: 2 }}>
              {firm.sectorBars.map((s, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--ink-3)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: s.colour || 'var(--calm)' }} />{s.name} {s.pct}%
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {empty ? (
        <section className="glass-2" style={{ borderRadius: 22, padding: '26px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>No holdings yet</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 16 }}>
            Add a holder, then record holdings from Sharesies, IBKR or anywhere else.
          </div>
          <button className="pill accent" onClick={onAdd} style={{ margin: '0 auto' }}>Add a holding<IArrowR /></button>
        </section>
      ) : (
        <>
          <ConcentrationPanel conc={firm.concentration} />
          <FxPanel usdTotal={firm.total} fx={fx} />
          <div className="segmented">
            <button className={`seg ${axis === 'accounts' ? 'on' : ''}`} onClick={() => setAxis('accounts')}>Holders</button>
            <button className={`seg ${axis === 'securities' ? 'on' : ''}`} onClick={() => setAxis('securities')}>Securities</button>
          </div>

          {axis === 'accounts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 13 }}>
              {holderCards.map((c) => (
                <button key={c.code} className="card" onClick={() => openHolder(c.code)}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 3 }}>{c.code} · {c.type}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="mono" style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>{fmt.money(c.total)}</div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 600, marginTop: 3, color: tone(c.dayPct) }}>{fmt.pct(c.dayPct)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 11 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.count} positions</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.topSector} weighted</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {axis === 'securities' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 13, alignItems: 'center' }}>
                <label className="search" style={{ flex: 1, height: 38 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                  <input type="text" placeholder="Filter by symbol or sector…" value={holdingQuery} onChange={(e) => setHoldingQuery(e.target.value)} style={{ fontSize: 13.5 }} />
                </label>
                <div style={{ position: 'relative' }}>
                  <button className={`fbtn ${sortOpen ? 'on' : ''}`} onClick={() => setSortOpen((v) => !v)} style={{ height: 38 }}>
                    {SORT_LABELS[holdingSort]}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {sortOpen && (
                    <div className="glass-3" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, borderRadius: 14, padding: 5, minWidth: 168 }}>
                      {[['value', 'Value (high–low)'], ['lifetime', 'Return · lifetime'], ['return', 'Return · today'], ['symbol', 'Symbol (A–Z)'], ['holder', 'Most held']].map(([key, label]) => (
                        <button key={key} onClick={() => { setHoldingSort(key); setSortOpen(false); }}
                          style={{ width: '100%', textAlign: 'left', border: 0, background: holdingSort === key ? 'var(--calm-g)' : 'none', color: holdingSort === key ? 'var(--calm)' : 'var(--ink)', fontSize: 13, fontWeight: holdingSort === key ? 600 : 500, padding: '9px 10px', borderRadius: 9, cursor: 'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 11 }}>
                {visibleSecurities.length === 0 && (
                  <div className="empty">No holdings match “{holdingQuery}”.</div>
                )}
                {visibleSecurities.map((c) => (
                  <button key={c.ticker} className="row" onClick={() => openSecurity(c.ticker)} style={{ gridTemplateColumns: '48px 1fr auto 18px' }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{c.ticker}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{c.accountsCount} {c.accountsCount === 1 ? 'holder' : 'holders'} · {c.sector}</span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span className="mono" style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{fmt.money(c.mv)}</span>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: c.priced ? tone(c.dayPct) : 'var(--ink-4)' }}>{c.priced ? fmt.pct(c.dayPct) : 'no price'}</span>
                    </span>
                    <span className="chev"><IChevR /></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

/* ===================== L1 · ACCOUNT (holder) ===================== */
function AccountSurface({ holder, fmt, search, setSearch, sector, toggleSector, openPosition, onRemoveHolder }) {
  const sectorsPresent = [...new Set(holder.positions.map((p) => p.sector))];
  const q = search.trim().toLowerCase();
  const rows = holder.positions.filter((p) => {
    if (sector && p.sector !== sector) return false;
    if (q && !(`${p.ticker} ${p.name} ${p.sector}`.toLowerCase().includes(q))) return false;
    return true;
  });

  return (
    <>
      <section className="glass-2" style={{ borderRadius: 22, padding: '17px 18px', marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 9 }}>{holder.code} · {holder.type}</div>
        <div className="mono" style={{ fontSize: 31, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{fmt.money(holder.total)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <span className={`chip ${toneChip(holder.dayPct)}`}><span className="dot" />{fmt.pct(holder.dayPct)} today</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{holder.count} positions</span>
          {holder.unpricedCount > 0 && (<span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{holder.unpricedCount} awaiting price</span>)}
        </div>
        {holder.gainPct != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <span className={`chip ${toneChip(holder.gainPct)}`}><span className="dot" />{fmt.pct(holder.gainPct)} all time</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmt.signedMoney(holder.gain)} unrealised</span>
            {holder.largest && (<span style={{ fontSize: 11, color: 'var(--ink-4)' }}>top {holder.largest.key} {(holder.largest.weight * 100).toFixed(0)}%</span>)}
          </div>
        )}
      </section>

      <label className="search">
        <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'var(--ink-4)', fill: 'none', strokeWidth: 1.8 }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input type="text" placeholder="Search holdings…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      {sectorsPresent.length > 0 && (
        <div style={{ display: 'flex', gap: 7, margin: '11px 0 4px', overflowX: 'auto' }}>
          {sectorsPresent.map((name) => (
            <button key={name} className={`fbtn ${sector === name ? 'on' : ''}`} onClick={() => toggleSector(name)}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ink-4)' }} />{name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto 18px', gap: 10, padding: '8px 12px 6px', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        <span>Sym</span><span>Holding</span><span style={{ textAlign: 'right' }}>Value · Return</span><span />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((p) => (
          <button key={p.ticker} className="row" onClick={() => openPosition(p.ticker)} style={{ gridTemplateColumns: '48px 1fr auto 18px' }}>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.ticker}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
              <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{fmt.shares(p.shares)} sh · {p.weight != null ? p.weight.toFixed(1) + '% of holder' : 'no price'}</span>
            </span>
            <span style={{ textAlign: 'right' }}>
              <span className="mono" style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{fmt.money(p.mv)}</span>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: p.priced ? tone(p.gainPct) : 'var(--ink-4)' }}>{p.priced ? fmt.pct(p.gainPct) : '—'}</span>
            </span>
            <span className="chev"><IChevR /></span>
          </button>
        ))}
        {rows.length === 0 && <div className="empty">No matching holdings</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
        <button className="linkbtn danger" onClick={onRemoveHolder}>Remove this holder</button>
      </div>
    </>
  );
}

/* ===================== L2 · POSITION ===================== */
function PositionSurface({ pos, holderName, fmt, spark, openSecurity, openPositionFor, addLot, editLot, deleteLot, alsoHeldBy }) {
  const circ = 2 * Math.PI * 42;
  const weightVal = pos.weight != null ? pos.weight : 0;
  const gaugeOffset = (circ * (1 - Math.min(100, weightVal) / 100)).toFixed(1);
  const stats = [
    { label: 'Shares', value: fmt.shares(pos.shares), color: 'var(--ink)' },
    { label: 'Avg cost', value: fmt.price(pos.avgCost), color: 'var(--ink)' },
    { label: 'Last price', value: pos.priced ? fmt.price(pos.price) : '—', color: 'var(--ink)' },
    { label: 'Unrealised', value: pos.priced ? fmt.signedMoney(pos.gain) : '—', color: pos.priced ? tone(pos.gain) : 'var(--ink-3)' },
  ];

  return (
    <>
      <section className="glass-3" style={{ borderRadius: 24, padding: '20px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{pos.ticker} · {pos.sector}</div>
            <h2 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.12 }}>{pos.name}</h2>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 7, lineHeight: 1.4 }}>{fmt.shares(pos.shares)} shares · {holderName}</div>
          </div>
          <div className="gauge">
            <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(127,127,127,0.18)" strokeWidth="7" />
              <circle className="gauge-arc" cx="50" cy="50" r="42" fill="none" stroke="var(--calm)" strokeWidth="7" strokeLinecap="round" style={{ strokeDasharray: circ.toFixed(1), strokeDashoffset: gaugeOffset }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
              <div>
                <div className="mono" style={{ fontSize: 21, fontWeight: 600, color: 'var(--calm)' }}>{pos.weight != null ? pos.weight.toFixed(1) : '—'}%</div>
                <div className="mono" style={{ fontSize: 8, letterSpacing: '0.12em', color: 'var(--ink-4)' }}>OF HOLDER</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '17px 0 2px', flexWrap: 'wrap' }}>
          <div className="mono" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.03em' }}>{fmt.money(pos.mv)}</div>
          {pos.priced
            ? (<span className={`chip ${toneChip(pos.dayPct)}`}><span className="dot" />{fmt.pct(pos.dayPct)} today</span>)
            : (<span className="chip neutral"><span className="dot" />no live price</span>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, margin: '15px 0' }}>
          {stats.map((st, i) => (
            <div key={i} className="stat"><div className="eyebrow">{st.label}</div><div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 5, color: st.color }}>{st.value}</div></div>
          ))}
        </div>
        <div className="sec-t" style={{ marginBottom: 8 }}><span>{pos.ticker} · trailing price</span></div>
        <Sparkline data={spark} color={pos.priced ? tone(pos.dayPct) : 'var(--calm)'} />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="pill accent" style={{ flex: 1 }} onClick={openSecurity}>View security<IArrowR /></button>
        </div>
      </section>

      <div className="sec-t" style={{ margin: '2px 4px 11px' }}><span>Lots · by source</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pos.lots.map((lot) => (
          <div key={lot.id} className="row" style={{ gridTemplateColumns: '1fr auto auto', cursor: 'default' }}>
            <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="chip neutral">{lot.source}</span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{fmt.shares(lot.shares)} sh @ {fmt.price(lot.costPerShare)}</span>
            </span>
            <button className="delbtn" onClick={() => editLot(lot)} aria-label="Edit lot" title="Edit lot" style={{ width: 'auto', padding: '0 11px', fontFamily: 'var(--mono)', fontSize: 11 }}>Edit</button>
            <button className="delbtn" onClick={() => deleteLot(lot.id)} aria-label="Delete lot" title="Delete lot"><IX /></button>
          </div>
        ))}
        <button className="pill" onClick={addLot} style={{ marginTop: 4 }}><IPlus />Add lot</button>
      </div>

      <div className="sec-t" style={{ margin: '20px 4px 11px' }}><span>Also held by</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {alsoHeldBy.map((h) => (
          <HoldingRow key={h.holderCode} name={h.holderName} sub={`${fmt.shares(h.shares)} sh · ${h.weight != null ? h.weight.toFixed(1) + '% of holder' : 'no price'}`} mvStr={fmt.money(h.mv)} gainStr={h.priced ? fmt.pct(h.gainPct) : '—'} gainColor={h.priced ? tone(h.gainPct) : 'var(--ink-4)'} onClick={() => openPositionFor(h.holderCode)} />
        ))}
        {alsoHeldBy.length === 0 && <div className="empty">No other holders hold {pos.ticker}</div>}
      </div>
    </>
  );
}

/* ===================== SECURITY (firm-wide) ===================== */
function SecuritySurface({ sec, fmt, spark, openPositionFor, onEditSecurity, onRemoveSecurity }) {
  const stats = [
    { label: 'Total shares', value: fmt.shares(sec.firmShares) },
    { label: 'Market value', value: fmt.money(sec.mv) },
    { label: 'Holders', value: String(sec.accountsCount) },
    { label: 'Avg cost', value: fmt.price(sec.wAvg) },
    { label: 'Unrealised', value: sec.priced ? fmt.signedMoney(sec.gain) : '—', color: sec.priced && sec.gain != null ? tone(sec.gain) : 'var(--ink-3)' },
    { label: 'Lifetime return', value: sec.priced ? fmt.pct(sec.gainPct) : '—', color: sec.priced && sec.gainPct != null ? tone(sec.gainPct) : 'var(--ink-3)' },
  ];
  return (
    <>
      <section className="glass-3" style={{ borderRadius: 24, padding: '20px 18px', marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{sec.ticker} · {sec.sector}</div>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{sec.name}</h2>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 13, flexWrap: 'wrap' }}>
          <div className="mono" style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.02em' }}>{sec.priced ? fmt.price(sec.price) : '—'}</div>
          {sec.priced
            ? (<span className={`chip ${toneChip(sec.dayPct)}`}><span className="dot" />{fmt.pct(sec.dayPct)} today</span>)
            : (<span className="chip neutral"><span className="dot" />no live price</span>)}
        </div>
        <div style={{ marginTop: 15 }}><Sparkline data={spark} color={sec.priced ? tone(sec.dayPct) : 'var(--calm)'} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 17 }}>
          {stats.map((st, i) => (
            <div key={i} className="stat"><div className="eyebrow">{st.label}</div><div className="mono" style={{ fontSize: 17, fontWeight: 600, marginTop: 5, color: st.color || 'var(--ink)' }}>{st.value}</div></div>
          ))}
        </div>
      </section>

      <div className="sec-t" style={{ margin: '2px 4px 11px' }}><span>Held by {sec.accountsCount} {sec.accountsCount === 1 ? 'holder' : 'holders'}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sec.holders.map((h) => (
          <HoldingRow key={h.holderCode} name={h.holderName} sub={`${fmt.shares(h.shares)} sh · ${h.weight != null ? h.weight.toFixed(1) + '% of holder' : 'no price'}`} mvStr={fmt.money(h.mv)} gainStr={h.priced ? fmt.pct(h.gainPct) : '—'} gainColor={h.priced ? tone(h.gainPct) : 'var(--ink-4)'} onClick={() => openPositionFor(h.holderCode)} />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 18 }}>
        <button className="linkbtn" onClick={onEditSecurity}>Edit details</button>
        <button className="linkbtn danger" onClick={onRemoveSecurity}>Remove security</button>
      </div>
    </>
  );
}

/* ===================== add / edit sheet ===================== */
function AddSheet({ sheet, model, fmt, setDraft, setTab, onSubmitLot, onSubmitHolder, onSubmitSecurity, onDeleteHolder, onEditSecurityInForm, onDeleteSecurity, onClose, onOpenImport }) {
  const d = sheet.draft;
  const holders = model.registry.holders;
  const securities = model.registry.securities;
  const tab = sheet.tab;

  const lotValid = d.holderCode && (d.ticker || '').trim() && parseFloat(d.shares) > 0;
  const holderValid = (d.code || '').trim().length > 0;
  const securityValid = (d.ticker || '').trim().length > 0;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet-wrap">
        <div className="sheet glass-3">
          <div className="sheet-handle" />
          <div className="sheet-title">
            <h3>{sheet.lotId ? 'Edit lot' : sheet.singleTab ? (tab === 'security' ? 'Edit security' : 'Add lot') : 'Add to portfolio'}</h3>
            <button className="iconbtn" onClick={onClose} aria-label="Close"><IX /></button>
          </div>

          {!sheet.singleTab && (
            <div className="segmented" style={{ marginBottom: 16 }}>
              <button className={`seg ${tab === 'lot' ? 'on' : ''}`} onClick={() => setTab('lot')}>Lot</button>
              <button className={`seg ${tab === 'holder' ? 'on' : ''}`} onClick={() => setTab('holder')}>Holder</button>
              <button className={`seg ${tab === 'security' ? 'on' : ''}`} onClick={() => setTab('security')}>Security</button>
            </div>
          )}

          {tab === 'lot' && (
            <>
              {holders.length === 0 ? (
                <div className="banner calm"><span>Add a holder first (use the Holder tab), then you can record their holdings here.</span></div>
              ) : (
                <>
                  <div className="field-group">
                    <label className="field-label">Holder</label>
                    {sheet.lockHolder
                      ? (<input className="input" value={(model.byHolder.get(d.holderCode)?.name) || d.holderCode} disabled />)
                      : (
                        <select className="select" value={d.holderCode || ''} onChange={(e) => setDraft({ holderCode: e.target.value })}>
                          <option value="" disabled>Select holder…</option>
                          {holders.map((h) => (<option key={h.code} value={h.code}>{h.name ? `${h.name} (${h.code})` : h.code}</option>))}
                        </select>
                      )}
                  </div>
                  <div className="field-group">
                    <label className="field-label">Ticker (US stock)</label>
                    <input className="input mono" list="known-tickers" placeholder="e.g. AAPL" value={d.ticker || ''} disabled={sheet.lockTicker} onChange={(e) => setDraft({ ticker: e.target.value.toUpperCase() })} style={{ textTransform: 'uppercase' }} />
                    <datalist id="known-tickers">{securities.map((s) => (<option key={s.ticker} value={s.ticker}>{s.name}</option>))}</datalist>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Source</label>
                    <select className="select" value={d.source || 'Sharesies'} onChange={(e) => setDraft({ source: e.target.value })}>
                      <option value="Sharesies">Sharesies</option>
                      <option value="IBKR">IBKR</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="field-row field-group">
                    <div>
                      <label className="field-label">Shares</label>
                      <input className="input mono" inputMode="decimal" placeholder="0" value={d.shares || ''} onChange={(e) => setDraft({ shares: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">Cost / share (USD)</label>
                      <input className="input mono" inputMode="decimal" placeholder="0.00" value={d.costPerShare || ''} onChange={(e) => setDraft({ costPerShare: e.target.value })} />
                    </div>
                  </div>
                  <button className="pill accent" disabled={!lotValid} onClick={onSubmitLot} style={{ width: '100%', marginTop: 4 }}>{sheet.lotId ? 'Save lot' : 'Add lot'}</button>
                </>
              )}
            </>
          )}

          {tab === 'holder' && (
            <>
              <div className="field-group">
                <label className="field-label">Initials / code</label>
                <input className="input mono" placeholder="e.g. JS" value={d.code || ''} maxLength={12} onChange={(e) => setDraft({ code: e.target.value.toUpperCase() })} style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="field-row field-group">
                <div>
                  <label className="field-label">Name (optional)</label>
                  <input className="input" placeholder="Display name" value={d.name || ''} onChange={(e) => setDraft({ name: e.target.value })} />
                </div>
                <div>
                  <label className="field-label">Type (optional)</label>
                  <input className="input" placeholder="e.g. Trust" value={d.type || ''} onChange={(e) => setDraft({ type: e.target.value })} />
                </div>
              </div>
              <button className="pill accent" disabled={!holderValid} onClick={onSubmitHolder} style={{ width: '100%', marginTop: 4 }}>Add holder</button>

              {holders.length > 0 && (
                <>
                  <div className="sec-t" style={{ margin: '20px 0 10px' }}><span>Holders</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {holders.map((h) => (
                      <div key={h.code} className="row" style={{ gridTemplateColumns: '1fr auto', cursor: 'default' }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{h.name || h.code}</span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>{h.code}{h.type ? ' · ' + h.type : ''}</span>
                        </span>
                        <button className="delbtn" onClick={() => onDeleteHolder(h.code)} aria-label="Delete holder"><IX /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'security' && (
            <>
              <div className="field-group">
                <label className="field-label">Ticker</label>
                <input className="input mono" placeholder="e.g. MSFT" value={d.ticker || ''} maxLength={12} onChange={(e) => setDraft({ ticker: e.target.value.toUpperCase() })} style={{ textTransform: 'uppercase' }} />
              </div>
              <div className="field-group">
                <label className="field-label">Company name (optional)</label>
                <input className="input" placeholder="e.g. Microsoft" value={d.name || ''} onChange={(e) => setDraft({ name: e.target.value })} />
              </div>
              <div className="field-group">
                <label className="field-label">Sector (optional)</label>
                <input className="input" placeholder="e.g. Software" value={d.sector || ''} onChange={(e) => setDraft({ sector: e.target.value })} />
              </div>
              <button className="pill accent" disabled={!securityValid} onClick={onSubmitSecurity} style={{ width: '100%', marginTop: 4 }}>{sheet.singleTab ? 'Save security' : 'Save security'}</button>

              {!sheet.singleTab && securities.length > 0 && (
                <>
                  <div className="sec-t" style={{ margin: '20px 0 10px' }}><span>Securities</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {securities.map((s) => (
                      <div key={s.ticker} className="row" style={{ gridTemplateColumns: '1fr auto', cursor: 'default' }}>
                        <button onClick={() => onEditSecurityInForm(s)} style={{ background: 'none', border: 0, textAlign: 'left', minWidth: 0, cursor: 'pointer', color: 'var(--ink)' }}>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{s.ticker}{s.name ? ' · ' + s.name : ''}</span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.06em' }}>{s.sector || 'tap to edit'}</span>
                        </button>
                        <button className="delbtn" onClick={() => onDeleteSecurity(s.ticker)} aria-label="Delete security"><IX /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {!sheet.singleTab && (
            <button className="pill" onClick={onOpenImport} style={{ width: '100%', marginTop: 16 }}><IUpload />Import holdings from IBKR</button>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================== import sheet ============================== */
function ImportSheet({ portfolio, onImport, onClose }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [holderCode, setHolderCode] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const holders = portfolio?.holders ?? [];
  const code = holderCode.trim();
  const existing = holders.find((h) => h.code === code);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    const stem = file.name.replace(/\.[^.]+$/, '').trim().toUpperCase().slice(0, 12);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = parseIbkrCsv(String(reader.result));
        if (!res.ok) {
          setParsed(null);
          setError('No US stock positions found. Is this an IBKR Activity Statement with an Open Positions section?');
          return;
        }
        setParsed(res);
        setHolderCode((cur) => cur || stem);
      } catch {
        setParsed(null);
        setError('Could not read this file as an IBKR CSV.');
      }
    };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file);
  };

  const muted = (size) => ({ fontSize: size, color: 'var(--ink-3)' });

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet-wrap">
        <div className="sheet glass-3">
          <div className="sheet-handle" />
          <div className="sheet-title">
            <h3>Import from IBKR</h3>
            <button className="iconbtn" onClick={onClose} aria-label="Close"><IX /></button>
          </div>

          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />

          {!parsed ? (
            <div>
              <p style={{ ...muted(13), lineHeight: 1.5, margin: '2px 0 16px' }}>
                Upload a native IBKR Activity Statement (CSV). Consolio reads the Open Positions section: your current US stock holdings, their quantities and cost basis.
              </p>
              <button className="pill accent" onClick={() => fileRef.current?.click()} style={{ width: '100%' }}><IUpload />Choose CSV file</button>
              {error && <div className="banner" style={{ marginTop: 12 }}><span>{error}</span></div>}
            </div>
          ) : (
            <div>
              <div style={{ ...muted(12), marginBottom: 12 }}>{fileName} · {parsed.positions.length} positions</div>

              <div className="field-group">
                <label className="field-label">Import into holder</label>
                <input className="input mono" value={holderCode} placeholder="e.g. JC" onChange={(e) => setHolderCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} />
              </div>
              <div style={{ ...muted(11.5), margin: '-6px 0 14px' }}>
                {existing
                  ? `Updates ${existing.name || existing.code}. Replaces ${existing.code}'s IBKR holdings; manually added lots are kept.`
                  : code ? `Creates a new holder “${code}”.` : 'Enter a holder code (e.g. your initials).'}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
                {parsed.positions.map((p) => (
                  <div key={p.ticker} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'baseline', padding: '5px 2px', borderTop: '1px solid var(--line-soft)' }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{p.ticker}</span>
                    <span className="mono" style={{ ...muted(12) }}>{p.shares} sh</span>
                    <span className="mono" style={{ fontSize: 12, textAlign: 'right', minWidth: 78 }}>${p.costPerShare.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {parsed.warnings.length > 0 && (
                <div className="banner" style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 12 }}>{parsed.warnings.length} row(s) skipped. {parsed.warnings.slice(0, 2).join(' ')}{parsed.warnings.length > 2 ? ' …' : ''}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="pill" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
                <button className="pill accent" disabled={!code} onClick={() => onImport(parsed, code)} style={{ flex: 2 }}>Import {parsed.positions.length} positions</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ================================ App ================================ */
export default function App() {
  const [portfolio, setPortfolio] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [currency, setCurrency] = useState('USD');
  const [fx, setFx] = useState(null);
  const [quotes, setQuotes] = useState({ quotes: {}, errors: {} });
  const [sparks, setSparks] = useState({});
  const [quoteNotice, setQuoteNotice] = useState(null);
  const [stack, setStack] = useState([{ type: 'total' }]);
  const [axis, setAxis] = useState('accounts');
  const [holdingSort, setHoldingSort] = useState('value');
  const [holdingQuery, setHoldingQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(null);
  const [navKey, setNavKey] = useState(0);
  const [conflict, setConflict] = useState(null);

  const screenRef = useRef(null);
  const versionRef = useRef(null);
  const saveTimer = useRef(null);
  const statusTimer = useRef(null);
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;

  /* ---- theme ---- */
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  /* ---- price map (live quote, else last stored snapshot) ---- */
  const priceMap = useMemo(() => {
    const map = {};
    const tickers = uniqueTickers(portfolio);
    for (const t of tickers) {
      const live = quotes.quotes[t];
      if (live && Number.isFinite(live.price)) {
        map[t] = { price: live.price, dayPct: live.dayPct, source: 'live' };
        continue;
      }
      const series = sparks[t];
      if (series && series.length) {
        map[t] = { price: series[series.length - 1].price, dayPct: 0, source: 'snapshot' };
      }
    }
    return map;
  }, [portfolio, quotes, sparks]);

  /* ---- freshest live-price timestamp (prices only; FX age not shown) ---- */
  const pricesAsOf = useMemo(() => {
    let latest = null;
    for (const q of Object.values(quotes.quotes)) {
      const t = q?.asOf ? Date.parse(q.asOf) : NaN;
      if (Number.isFinite(t) && (latest == null || t > latest)) latest = t;
    }
    return latest;
  }, [quotes]);

  const fmt = useMemo(() => createFormatters(currency, fx?.rate), [currency, fx]);
  const model = useMemo(
    () => (portfolio ? buildModel({ ...portfolio, priceMap }) : null),
    [portfolio, priceMap]
  );

  const sparkArr = useCallback((ticker) => (sparks[ticker] ?? []).map((p) => p.price), [sparks]);

  /* ---- data fetching ---- */
  const refreshMarket = useCallback(async (tickers) => {
    fetchFx('USD', 'NZD').then((r) => setFx({ rate: r.rate, asOf: r.asOf })).catch(() => setFx(null));
    if (tickers.length === 0) return;
    fetchQuotes(tickers)
      .then((q) => { setQuotes(q); setQuoteNotice(null); })
      .catch((e) => { if (e.status === 503) setQuoteNotice(e.message); });
    fetchSparks(tickers).then((s) => setSparks(s.sparks ?? {})).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPortfolio()
      .then((res) => {
        if (cancelled) return;
        setPortfolio(res.portfolio);
        versionRef.current = res.updatedAt ?? null;
        refreshMarket(uniqueTickers(res.portfolio));
      })
      .catch((e) => { if (!cancelled) setLoadError(e.message); });
    const id = setInterval(() => refreshMarket(uniqueTickers(portfolioRef.current)), REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [refreshMarket]);

  /* ---- persistence ---- */
  const flashStatus = useCallback((text, kind = 'info', holdMs = 1600) => {
    setStatus({ text, kind });
    clearTimeout(statusTimer.current);
    if (holdMs) statusTimer.current = setTimeout(() => setStatus(null), holdMs);
  }, []);

  const persist = useCallback((next) => {
    clearTimeout(saveTimer.current);
    flashStatus('Saving…', 'info', 0);
    saveTimer.current = setTimeout(() => {
      savePortfolio(next, versionRef.current)
        .then((res) => {
          if (res?.updatedAt) versionRef.current = res.updatedAt;
          flashStatus('Saved');
        })
        .catch((e) => {
          if (e.status === 409 && e.body) {
            setConflict({
              latestPortfolio: e.body.portfolio,
              latestVersion: e.body.updatedAt ?? null,
            });
            flashStatus('Save conflict', 'err', 0);
          } else {
            flashStatus(e.message || 'Save failed', 'err', 4000);
          }
        });
    }, 500);
  }, [flashStatus]);

  const applyChange = useCallback((updater) => {
    const prev = portfolioRef.current;
    const next = updater(prev);
    portfolioRef.current = next;
    setPortfolio(next);
    persist(next);
    const before = new Set(uniqueTickers(prev));
    const after = uniqueTickers(next);
    if (after.some((t) => !before.has(t))) refreshMarket(after);
  }, [persist, refreshMarket]);

  /* ---- concurrency conflict resolution ---- */
  const reloadLatest = useCallback(() => {
    if (!conflict) return;
    portfolioRef.current = conflict.latestPortfolio;
    setPortfolio(conflict.latestPortfolio);
    versionRef.current = conflict.latestVersion;
    setConflict(null);
    refreshMarket(uniqueTickers(conflict.latestPortfolio));
    flashStatus('Loaded latest');
  }, [conflict, refreshMarket, flashStatus]);

  const overwriteWithMine = useCallback(() => {
    if (!conflict) return;
    const mine = portfolioRef.current;
    setConflict(null);
    flashStatus('Saving…', 'info', 0);
    savePortfolio(mine, versionRef.current, true)
      .then((res) => { if (res?.updatedAt) versionRef.current = res.updatedAt; flashStatus('Saved'); })
      .catch((e) => flashStatus(e.message || 'Save failed', 'err', 4000));
  }, [conflict, flashStatus]);

  /* ---- navigation ---- */
  const bump = () => setNavKey((k) => k + 1);
  const push = useCallback((entry) => { setStack((s) => [...s, entry]); setSearch(''); setSector(null); bump(); }, []);
  const popTo = useCallback((i) => { setStack((s) => s.slice(0, i + 1)); setSearch(''); setSector(null); bump(); }, []);
  const pop = useCallback(() => { setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)); setSearch(''); setSector(null); bump(); }, []);

  /* ---- keep the nav stack valid as data changes ---- */
  useEffect(() => {
    if (!model) return;
    setStack((prev) => {
      const trimmed = [];
      for (const s of prev) {
        if (s.type === 'total') { trimmed.push(s); continue; }
        if (s.type === 'account') { if (model.byHolder.has(s.code)) trimmed.push(s); else break; }
        else if (s.type === 'position') {
          const h = model.byHolder.get(s.code);
          if (h && h.positions.some((p) => p.ticker === s.ticker)) trimmed.push(s); else break;
        } else if (s.type === 'security') { if (model.byTicker.has(s.ticker)) trimmed.push(s); else break; }
      }
      if (trimmed.length === prev.length) return prev;
      return trimmed.length ? trimmed : [{ type: 'total' }];
    });
  }, [model]);

  /* ---- entrance animation ---- */
  useEffect(() => {
    const root = screenRef.current;
    if (!root || reduceMotion()) return;
    const id = requestAnimationFrame(() => {
      root.animate?.(
        [{ opacity: 0, transform: 'translateY(10px) scale(0.985)' }, { opacity: 1, transform: 'none' }],
        { duration: 340, easing: EASE }
      );
      const arc = root.querySelector('.gauge-arc');
      if (arc?.animate) {
        const circ = parseFloat(arc.style.strokeDasharray) || 263.9;
        const off = parseFloat(arc.style.strokeDashoffset) || 0;
        arc.animate([{ strokeDashoffset: circ }, { strokeDashoffset: off }], { duration: 1000, easing: EASE, delay: 120 });
      }
      const line = root.querySelector('.chart-line');
      if (line?.getTotalLength && line.animate) {
        const L = line.getTotalLength();
        line.style.strokeDasharray = L;
        line.style.strokeDashoffset = 0;
        line.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 900, easing: EASE });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [navKey]);

  /* ---- currency ---- */
  const toggleCurrency = useCallback(() => {
    if (currency === 'USD') {
      if (!fx?.rate) { flashStatus('NZD rate unavailable', 'err'); return; }
      setCurrency('NZD');
    } else setCurrency('USD');
  }, [currency, fx, flashStatus]);

  /* ---- mutations ---- */
  const handleImport = useCallback((parsed, holderCode) => {
    const plan = buildImportPlan(portfolioRef.current, parsed, { holderCode, makeId: genId });
    applyChange(() => plan.next);
    setImporting(false);
    flashStatus(`Imported ${plan.summary.positionsImported} positions${plan.summary.holderCreated ? ` · created ${plan.summary.holderCode}` : ''}`);
  }, [applyChange, flashStatus]);

  const openSheet = (init) => setSheet(init);
  const closeSheet = () => setSheet(null);
  const setDraft = (patch) => setSheet((s) => ({ ...s, draft: { ...s.draft, ...patch } }));
  const setTab = (tab) => setSheet((s) => ({ ...s, tab }));

  const submitLot = useCallback(() => {
    const s = sheetRef.current;
    if (!s) return;
    const d = s.draft;
    const ticker = (d.ticker || '').trim().toUpperCase();
    const holderCode = d.holderCode;
    const shares = parseFloat(d.shares);
    const costPerShare = parseFloat(d.costPerShare) || 0;
    if (!holderCode || !ticker || !(shares > 0)) return;
    const source = d.source || 'Sharesies';

    applyChange((prev) => {
      const securities = prev.securities.some((x) => x.ticker === ticker)
        ? prev.securities
        : [...prev.securities, { ticker, name: '', sector: '' }];
      const lots = s.lotId
        ? prev.lots.map((l) => (l.id === s.lotId ? { ...l, holderCode, ticker, source, shares, costPerShare } : l))
        : [...prev.lots, { id: genId(), holderCode, ticker, source, shares, costPerShare }];
      return { ...prev, securities, lots };
    });

    flashStatus(s.lotId ? 'Lot updated' : 'Lot added');
    if (s.lotId) setSheet(null);
    else setSheet((cur) => (cur ? { ...cur, draft: { ...cur.draft, shares: '', costPerShare: '' } } : cur));
  }, [applyChange, flashStatus]);

  const submitHolder = useCallback(() => {
    const s = sheetRef.current;
    if (!s) return;
    const code = (s.draft.code || '').trim().toUpperCase().slice(0, 12);
    if (!code) return;
    const name = (s.draft.name || '').trim();
    const type = (s.draft.type || '').trim();
    applyChange((prev) => {
      const exists = prev.holders.some((h) => h.code === code);
      const holders = exists
        ? prev.holders.map((h) => (h.code === code ? { ...h, name, type } : h))
        : [...prev.holders, { code, name, type }];
      return { ...prev, holders };
    });
    flashStatus('Holder saved');
    setSheet((cur) => (cur ? { ...cur, draft: {} } : cur));
  }, [applyChange, flashStatus]);

  const submitSecurity = useCallback(() => {
    const s = sheetRef.current;
    if (!s) return;
    const ticker = (s.draft.ticker || '').trim().toUpperCase().slice(0, 12);
    if (!ticker) return;
    const name = (s.draft.name || '').trim();
    const sectorVal = (s.draft.sector || '').trim();
    applyChange((prev) => {
      const exists = prev.securities.some((x) => x.ticker === ticker);
      const securities = exists
        ? prev.securities.map((x) => (x.ticker === ticker ? { ...x, name, sector: sectorVal } : x))
        : [...prev.securities, { ticker, name, sector: sectorVal }];
      return { ...prev, securities };
    });
    flashStatus('Security saved');
    if (s.singleTab) setSheet(null);
    else setSheet((cur) => (cur ? { ...cur, draft: {} } : cur));
  }, [applyChange, flashStatus]);

  const deleteHolder = useCallback((code) => {
    if (!window.confirm(`Remove holder ${code} and all of its lots?`)) return;
    applyChange((prev) => ({
      ...prev,
      holders: prev.holders.filter((h) => h.code !== code),
      lots: prev.lots.filter((l) => l.holderCode !== code),
    }));
    flashStatus('Holder removed');
  }, [applyChange, flashStatus]);

  const deleteSecurity = useCallback((ticker) => {
    const held = (portfolioRef.current?.lots ?? []).some((l) => l.ticker === ticker);
    if (held) { flashStatus(`${ticker} still has lots — delete those first`, 'err', 3000); return; }
    if (!window.confirm(`Remove ${ticker} from the security list?`)) return;
    applyChange((prev) => ({ ...prev, securities: prev.securities.filter((x) => x.ticker !== ticker) }));
    flashStatus('Security removed');
  }, [applyChange, flashStatus]);

  const deleteLot = useCallback((lotId) => {
    applyChange((prev) => ({ ...prev, lots: prev.lots.filter((l) => l.id !== lotId) }));
    flashStatus('Lot removed');
  }, [applyChange, flashStatus]);

  /* ---- render ---- */
  if (loadError) {
    return (
      <>
        <div className="field" />
        <div className="device">
          <main className="screen" style={{ display: 'grid', placeItems: 'center' }}>
            <div className="glass-2" style={{ borderRadius: 22, padding: 24, textAlign: 'center', maxWidth: 320 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Couldn’t load your data</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{loadError}</div>
            </div>
          </main>
        </div>
      </>
    );
  }

  if (!model) {
    return (
      <>
        <div className="field" />
        <div className="device"><main className="screen" style={{ display: 'grid', placeItems: 'center' }}><div className="eyebrow">Loading…</div></main></div>
      </>
    );
  }

  const cur = stack[stack.length - 1];
  const labelFor = (s) => (s.type === 'total' ? 'Total' : s.type === 'account' ? s.code : s.ticker);
  const rail = stack.map((s, i) => ({ label: labelFor(s), state: i === stack.length - 1 ? 'on' : 'done', onClick: () => popTo(i) }));

  let title = 'Holdings', sub = 'CONSOLIO · BOOK';
  if (cur.type === 'account') { const h = model.byHolder.get(cur.code); title = h?.name || cur.code; sub = `${cur.code} · ${h?.type || 'Holder'}`; }
  else if (cur.type === 'position') { const s = model.byTicker.get(cur.ticker); title = s?.name || cur.ticker; sub = `${cur.ticker} · ${cur.code}`; }
  else if (cur.type === 'security') { const s = model.byTicker.get(cur.ticker); title = s?.name || cur.ticker; sub = `${cur.ticker} · ALL HOLDERS`; }

  return (
    <>
      <div className="field" />
      {status && <div className={`status show ${status.kind === 'err' ? 'err' : ''}`}>{status.text}</div>}
      {conflict && (
        <div className="conflict-bar" role="alertdialog" aria-live="assertive">
          <div className="msg"><strong>Saved elsewhere.</strong> Another change was saved while you were editing, so your unsaved edits have not been stored.</div>
          <div className="acts">
            <button className="fbtn" onClick={reloadLatest}>Load latest</button>
            <button className="fbtn danger" onClick={overwriteWithMine}>Overwrite with mine</button>
          </div>
        </div>
      )}

      <div className="device">
        <TopBar
          showBack={stack.length > 1}
          showBrand={stack.length === 1}
          title={title}
          sub={sub}
          currency={currency}
          currencyDisabledNote={!fx?.rate ? 'NZD rate unavailable' : null}
          isDark={theme === 'dark'}
          onBack={pop}
          onToggleCurrency={toggleCurrency}
          onAdd={() => openSheet({ tab: 'lot', draft: { source: 'Sharesies' }, singleTab: false })}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />

        <main className="screen" ref={screenRef}>
          {cur.type === 'total' && (
            <TotalSurface
              model={model} fmt={fmt} currency={currency} fx={fx} axis={axis} setAxis={setAxis}
              openHolder={(code) => push({ type: 'account', code })}
              openSecurity={(ticker) => push({ type: 'security', ticker })}
              quoteNotice={quoteNotice}
              pricesAsOf={pricesAsOf}
              holdingSort={holdingSort} setHoldingSort={setHoldingSort}
              holdingQuery={holdingQuery} setHoldingQuery={setHoldingQuery}
              onAdd={() => openSheet({ tab: 'lot', draft: { source: 'Sharesies' }, singleTab: false })}
            />
          )}

          {cur.type === 'account' && (() => {
            const holder = model.byHolder.get(cur.code);
            return (
              <AccountSurface
                holder={holder} fmt={fmt} search={search} setSearch={setSearch}
                sector={sector} toggleSector={(name) => setSector((v) => (v === name ? null : name))}
                openPosition={(ticker) => push({ type: 'position', code: cur.code, ticker })}
                onRemoveHolder={() => deleteHolder(cur.code)}
              />
            );
          })()}

          {cur.type === 'position' && (() => {
            const holder = model.byHolder.get(cur.code);
            if (!holder) return null;
            const pos = holder.positions.find((p) => p.ticker === cur.ticker);
            if (!pos) return null;
            const secVM = model.byTicker.get(cur.ticker);
            const alsoHeldBy = (secVM?.holders ?? []).filter((h) => h.holderCode !== cur.code);
            return (
              <PositionSurface
                pos={pos} holderName={holder.name} fmt={fmt} spark={sparkArr(cur.ticker)}
                openSecurity={() => push({ type: 'security', ticker: cur.ticker })}
                openPositionFor={(code) => push({ type: 'position', code, ticker: cur.ticker })}
                addLot={() => openSheet({ tab: 'lot', draft: { holderCode: cur.code, ticker: cur.ticker, source: 'Sharesies' }, singleTab: true, lockHolder: true, lockTicker: true })}
                editLot={(lot) => openSheet({ tab: 'lot', draft: { holderCode: cur.code, ticker: cur.ticker, source: lot.source, shares: String(lot.shares), costPerShare: String(lot.costPerShare) }, lotId: lot.id, singleTab: true, lockHolder: true, lockTicker: true })}
                deleteLot={deleteLot}
                alsoHeldBy={alsoHeldBy}
              />
            );
          })()}

          {cur.type === 'security' && (() => {
            const secVM = model.byTicker.get(cur.ticker);
            if (!secVM) return null;
            return (
              <SecuritySurface
                sec={secVM} fmt={fmt} spark={sparkArr(cur.ticker)}
                openPositionFor={(code) => push({ type: 'position', code, ticker: cur.ticker })}
                onEditSecurity={() => openSheet({ tab: 'security', draft: { ticker: secVM.ticker, name: secVM.name === secVM.ticker ? '' : secVM.name, sector: secVM.sector === 'Uncategorised' ? '' : secVM.sector }, singleTab: true })}
                onRemoveSecurity={() => deleteSecurity(cur.ticker)}
              />
            );
          })()}
        </main>

        <DepthRail rail={rail} fillW={stack.length > 1 ? 100 : 0} />
      </div>

      {sheet && (
        <AddSheet
          sheet={sheet} model={model} fmt={fmt} setDraft={setDraft} setTab={setTab}
          onSubmitLot={submitLot} onSubmitHolder={submitHolder} onSubmitSecurity={submitSecurity}
          onDeleteHolder={deleteHolder} onDeleteSecurity={deleteSecurity}
          onEditSecurityInForm={(s) => setSheet((st) => ({ ...st, draft: { ticker: s.ticker, name: s.name, sector: s.sector } }))}
          onClose={closeSheet}
          onOpenImport={() => { setSheet(null); setImporting(true); }}
        />
      )}
      {importing && (
        <ImportSheet portfolio={portfolio} onImport={handleImport} onClose={() => setImporting(false)} />
      )}
    </>
  );
}
