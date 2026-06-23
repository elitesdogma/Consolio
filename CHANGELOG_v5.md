# Consolio v0.5.0 — change summary

IBKR CSV import. You can now load current US-stock holdings from a native IBKR
Activity Statement instead of typing them in. Frontend-only and additive: it
parses in the browser and saves through the existing OCC-guarded path, so there
is no server, database, schema, or API change. Builds on v0.4.0 (already
deployed).

## How it works
Open the add sheet (the + button), tap "Import holdings from IBKR", choose your
exported CSV. Consolio reads two sections of the statement: Open Positions (your
current holdings, quantities and cost basis) and Financial Instrument
Information (for security names). It shows a preview of the parsed positions and
the holder they will import into, then on confirm it merges them and saves.

Validated against your real export (JC.csv): 7 US-stock positions parsed with
correct quantities and cost prices, names resolved, no rows mis-handled.

## The merge rule (important)
The import is idempotent. For the chosen holder it replaces that holder's
IBKR-sourced lots with the imported set, and leaves manually added lots and
every other holder untouched. So re-importing an updated statement refreshes the
position rather than duplicating it. Securities are added for any new ticker;
existing securities, and any sector you set on them, are preserved. This was
unit-tested: re-import keeps the lot count stable, a manual lot for the same
holder survives, another holder's lots are untouched, and an existing security's
sector is not overwritten.

What it imports: USD stocks from Open Positions. It skips non-USD and non-stock
rows (forex, options) and tells you how many it skipped. Cost basis comes from
IBKR's Cost Price (per share). It does not yet read the Trades section, so it is
a position snapshot, not a transaction history.

## Files changed (3)
- src/lib/ibkr.js  — NEW. parseIbkrCsv (section-aware CSV reader, quoted-field
                     safe) and buildImportPlan (the merge). Pure, no DOM.
- src/App.jsx      — IUpload icon; an "Import holdings from IBKR" button on the
                     add sheet; an ImportSheet overlay (file pick, parse,
                     preview, holder selection); the import handler, which runs
                     the merge and saves via the existing applyChange/OCC path.
- package.json     — version 0.4.0 -> 0.5.0.

No change to db.js, server.js, src/lib/api.js, src/lib/model.js or src/styles.css
(the overlay reuses existing sheet, field and banner classes). No new
dependency: the CSV parser is hand-written, so nothing is added to the build.

## Holder targeting
The import prefills the holder code from the file name (JC.csv -> JC), which you
can change. If the code matches an existing holder it updates that holder; if
not, it creates the holder. You see which will happen before importing.

## Data safety
The parse and merge are pure functions over the uploaded file and the current
portfolio; the save goes through the same optimistic-concurrency guard added in
v0.4.0, so a concurrent change still raises the conflict bar rather than being
lost. Existing data is preserved by the merge rule above.

## Verification done in sandbox
- ibkr.js and model.js pass `node --check`; App.jsx passes the bracket-balance
  check; new identifiers resolve.
- 25-case test of the parser and merge against the real JC.csv: correct
  position extraction (tickers, shares, cost), name resolution, idempotent
  re-import, preservation of manual lots, other holders and existing security
  sectors.
- Full JSX build not run here (no esbuild offline). Your deploy.sh and the
  pre-push hook both run `npm run build`, so a compile error is caught before it
  reaches Railway.

## To ship
Run your usual:
  ./deploy.sh ~/Downloads/consolio_v5.zip "IBKR import"

Then in the live app: open the + sheet, tap "Import holdings from IBKR", pick
JC.csv, confirm JC as the holder, and check the 7 positions appear with their
cost basis and the new lifetime-return and concentration figures populate.

## Natural next steps
- Read the Trades section to build the transaction ledger (the Tier 3 feature),
  which would unlock realised gains and true time-weighted return.
- Map IBKR sectors if you later want sector data on imported securities (the
  statement does not carry GICS sectors, so this would need a lookup).
