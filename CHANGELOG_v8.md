# Consolio v0.8.0 — change summary

Four changes, all frontend, all additive: no server, database, schema or API
change. Cumulative on v0.7.0. The two-CSV Sharesies flow, the FIFO engine and
the locked design system are untouched; this build extends them.

## 1. IBKR breaks out into dated lots

IBKR used to import as one consolidated line per holding. It now uses the same
engine as Sharesies. The parser reads Open Positions as the authority on current
share counts and the Trades section for each individual stock execution, then
replays the trades oldest-first, FIFO, and reconciles the result against the
current share count. Where they match, the holding breaks out into its dated
lots; where they do not, the signal of an unhandled split, it falls back to one
consolidated line at the Open Positions cost and marks it, so a holding is never
shown as wrong lots.

It is still a single file. Forex rows in the Trades section (NZD.USD and the
like) are excluded, and the quoted Date/Time field that contains its own comma
is parsed correctly.

Cost basis convention, the same trade-off v0.7.0 documented for Sharesies: a
broken-out lot uses the trade execution price (IBKR T. Price), which excludes
commission. The consolidated fallback uses the Open Positions cost, which
includes it. So a holding that breaks out shows a marginally lower per-share cost
than the same holding left consolidated, by the commission. This keeps IBKR and
Sharesies lots on the same footing (both raw execution prices), and the
reconciliation is on share count, not cost, so it is unaffected.

Tested against your real statement: nine US-stock holdings, twenty-six stock
trades, all nine reconcile and break out into dated lots (AVGO 1, AXTI 2, CRDO 2,
INTC 1, IONQ 1, MU 4, NOK 1, RKLB 1, SNDK 2). CRWV, bought and fully sold inside
the period, correctly does not appear.

## 2. Overwrite or add on import

Re-importing a broker has always replaced that holder's lots from that source,
which is right for a fresh statement but wrong if you want to layer two exports.
The import sheet now has a checkbox, ticked by default. Ticked, it replaces this
holder's lots for this source, as before, and stays idempotent. Unticked, it
appends, so a second statement adds to the holder rather than replacing. Either
way, manual lots and every other source and holder are left alone. The action
button reads Import or Add to match.

## 3. Per-lot profit and loss

Each lot row on a holding now shows its own unrealised gain or loss, that lot's
shares at its own purchase price against the current market price, with the
percentage. Zero-cost lots (a Sharesies holding held before its report window)
show no figure rather than a false one. This is display only; it adds nothing to
what is stored.

## 4. FIF threshold panel (indicative)

A new panel on the home screen, alongside Concentration and NZD exposure, shows
the NZD cost of each holder's FIF interests against the de minimis threshold.

Every holding in Consolio is a US-listed share, which for a NZ tax resident is an
attributing interest in a FIF. A natural person stays outside the FIF rules while
the total cost of those interests is at or below the threshold. Trusts and
companies have no de minimis, so the panel marks them and notes the rules apply
regardless of cost. Holder type is the existing free-text field: a type naming an
entity (trust, company, ltd, partnership, estate and so on) is treated as a
non-individual, everything else, including blank, as an individual. The
classification is shown per holder so it is visible and you can correct it by
editing the holder type.

A toggle switches the threshold between the current $50,000 and the proposed
$100,000. The cost does not depend on the threshold, so the toggle only changes
the comparison, headroom and colour band.

NZD cost is each lot converted at the USD to NZD reference rate on its purchase
date, via Frankfurter (ECB daily rates, no key, CORS-enabled), summed per holder.
Lots with no date, manual lots and any consolidated fallback, use the current
rate and the panel flags it.

This is indicative, and the panel says so. Two reasons it is not the legal
figure, both material if you are near the line:
- the source CSVs are in USD, so a reference rate is applied, not the rate at
  which the broker actually settled; Sharesies in particular debited NZD that the
  USD export does not contain;
- the de minimis test looks at the highest total cost during the income year,
  while this sums only currently-held lots, so a holder who bought and sold within
  the year can have reached a higher peak than is shown.

Treat it as a planning lens, not a return figure. If a holder is close to the
threshold, check it properly.

## On concurrency, for the record

The optimistic concurrency control flagged as outstanding is already present in
the client as of this code: saves carry the last-seen version, a stale save is
rejected, and you get a visible conflict notice with a choice to load the latest
or keep yours. The earlier open question, silent reload versus a visible notice,
has in effect been answered as a visible notice. This build does not touch it.
Confirming the server enforces the version guard needs server.js, which is not in
this delta and was not changed.

## Files changed (5), one new

- src/lib/ibkr.js   — returns positions (Open Positions, authoritative) and trades
                      (Stocks orders), excludes Forex, parses the quoted Date/Time.
- src/lib/imports.js — buildImportPlan takes an additive option; overwrite stays
                      the default and stays idempotent.
- src/lib/fif.js    — NEW. Historical USD to NZD via Frankfurter (injected and
                      cached), holder individual/entity classification, per-holder
                      NZD cost aggregation. Self-contained.
- src/App.jsx       — IBKR import reconstructs dated lots; import sheet overwrite
                      checkbox; per-lot P&L on lot rows; FIF threshold panel.
- package.json      — version 0.7.0 -> 0.8.0.

src/lib/sharesies.js is unchanged and is not in the zip.

## Verification done in sandbox

- All libraries pass `node --check`; App.jsx passes a bracket-balance check that
  ignores comments and string and template contents, so apostrophes in text are
  not false positives.
- IBKR reconstruction tested against your real statement (see section 1).
- Sharesies two-CSV reconstruction re-run against your real wide-window files to
  confirm the existing path is intact: NVDA falls back to consolidated on its
  split, the other current holding breaks out, as documented in v0.7.0.
- buildImportPlan: overwrite idempotent, additive doubles, manual lots survive an
  overwrite of the same holder.
- FIF aggregation tested with a mock historical rate: NZD conversion, dated versus
  spot fallback, zero-cost exclusion, individual versus entity classification, and
  descending sort all correct.
- The live Frankfurter call and the full JSX build are not run here (no network,
  no esbuild offline). deploy.sh and the pre-push hook run `npm run build`, so a
  compile error is caught before Railway. The FX call runs in the browser.

## To ship

  ./deploy.sh ~/Downloads/consolio_v8.zip "IBKR dated lots, overwrite/add, per-lot P&L, FIF panel"

Then on the home screen: the FIF threshold panel sits under NZD exposure. Re-import
your IBKR statement to break its holdings into dated lots, and click into one to
see each buy with its own gain or loss.
