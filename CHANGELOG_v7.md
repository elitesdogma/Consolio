# Consolio v0.7.0 — change summary

Per-purchase lots. Click into a holding and you now see each individual buy you
still hold, with its date, share count and price, instead of one blended line.
This required a two-file Sharesies import and a reconstruction engine. Frontend
only and additive: parsing and reconstruction happen in the browser, saves go
through the existing path, no server, database, schema or API change.

## What changed in the flow
Sharesies now takes TWO CSVs, not one. After you pick Sharesies you get two
slots: the Investment holdings report and the Transaction report. Both are
required. IBKR is unchanged, still a single statement, still one consolidated
lot per holding.

The two files do different jobs. The holdings report is the authority on what
you currently hold and the correct, split-adjusted share count. The transaction
report supplies the individual buy prices and dates. Consolio reconstructs your
currently-held lots by replaying the transactions oldest-first and letting each
sale consume the earliest open buys (FIFO), leaving the shares you still hold.
It then checks that reconstructed total against the holdings report. If they
match, the holding is broken out into its individual dated lots. If they do not,
which is the signal of an unhandled split, it falls back to a single
consolidated line at the holdings-report cost and marks it, so a holding is
never shown as wrong lots.

Export both Sharesies reports from the earliest available date, so starting
balances are zero and every holding reconciles.

## NVDA and the split (your one-off)
NVDA is the only holding affected by a split, and its raw transactions are
pre-split, so they reconstruct to 32.83 shares, not your real 39. The app
therefore leaves NVDA consolidated unless the data reconciles. To break NVDA out
into its real buys, import the corrected transaction CSV shipped alongside this
note (transaction-report_NVDA-split-corrected.csv). It rewrites exactly one row,
your March 2024 NVDA buy, from 0.685 shares at $895.99 to its post-split
equivalent of 6.855 shares at $89.60, dollar amount unchanged. With that one
row fixed, NVDA reconstructs to exactly 39 and breaks out into 16 dated lots.
This is a genuine one-off: it is your only split holding and you are not buying
fractional going forward, so future imports reconcile on their own.

If you prefer, do nothing: import the unmodified transaction report and NVDA
stays as one correct line at $153.51, while everything else still breaks out.

## Read this: cost basis changes when a holding breaks out
Individual lots show your actual transaction prices and use FIFO to decide which
shares remain. That gives a different cost figure from the holdings-report
average, and for NVDA the difference is large and not a bug:

- Holdings-report figure, $153.51, is the average-cost method: total dollars
  divided by total shares. Selling does not change it.
- Broken-out figure, about $167.22, is FIFO: your three NVDA sales consumed your
  oldest, cheapest, post-split shares first, so the 39 you still hold are the
  newer, more expensive 2025 buys. Their weighted average is higher.

Neither is wrong; they are different conventions. Breaking NVDA out trades the
simple average for a true, dated picture of the specific shares you hold, at a
higher blended cost. NOK shifts too, but only by fees: it shows its real price
of $15.03 rather than $14.74, which was that figure net of the $2 brokerage.

## Files changed (5) plus one data file
- src/lib/imports.js   — adds reconstructLots (FIFO match + reconcile against the
                         authoritative share count); buildImportPlan now takes a
                         flat list of lots and carries an optional purchase date.
- src/lib/sharesies.js — adds parseSharesiesTransactions (transaction report).
                         The holdings parser is unchanged.
- src/lib/ibkr.js      — returns lots instead of positions (shape only; IBKR is
                         still one consolidated lot per holding).
- src/App.jsx          — Sharesies import is now two slots with reconstruction
                         and a preview that flags broken-out versus consolidated;
                         lots show their purchase date; import status updated.
- package.json         — version 0.6.0 -> 0.7.0.
- transaction-report_NVDA-split-corrected.csv — the one-off NVDA correction,
                         delivered separately, not part of the code zip.

Lots gained an optional `date` field. It is additive: manual and IBKR lots
simply have no date, and editing a dated lot preserves its date.

## What this does NOT do yet
IBKR still imports as one consolidated lot per holding. Per-purchase IBKR lots
use the same engine, reconstructing from the statement's Trades section and
reconciling against Open Positions, and are the natural next step. Realised P&L
is still out of scope; this is currently-held shares only.

## Verification done in sandbox
- All libs pass `node --check`; App.jsx passes the bracket-balance check; the
  import wiring and icons resolve.
- Full reconstruction tested against your real wide-window files. Uncorrected:
  NVDA falls back to consolidated (32.83 vs 39), NOK breaks out. Corrected: NVDA
  breaks out into 16 dated lots totalling exactly 39.0000, NOK 7. FIFO
  weighted-average cost computed and reported ($167.22 vs the $153.51 average).
- IBKR single-file import re-tested through the new merge: 7 holdings, 7 lots,
  all correctly marked.
- Full JSX build not run here (no esbuild offline). deploy.sh and the pre-push
  hook both run `npm run build`, so a compile error is caught before Railway.

## To ship
  ./deploy.sh ~/Downloads/consolio_v7.zip "Two-CSV Sharesies, per-purchase lots"

Then: + sheet, Import holdings from CSV, Sharesies, drop in both reports (use the
corrected transaction CSV to break NVDA out), set the holder, import. Click into
NVDA to see the individual dated buys.
