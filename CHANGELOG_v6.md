# Consolio v0.6.0 — change summary

Sharesies CSV import, alongside the existing IBKR import. The add sheet's
import button now asks which broker, then takes that broker's CSV. Frontend
only and additive: parsing happens in the browser and saves go through the
existing OCC path, so no server, database, schema or API change. Builds on
v0.4.0; this zip also contains the IBKR importer, so it is fine to apply even
if v0.5.0 was skipped.

## The Sharesies cost-basis limitation (read this)
The Sharesies "Investment holdings report" has no cost-basis column. It is
period-based: per instrument it gives starting/ending shares, shares
bought/sold and their dollar values, and market values. Consolio derives cost
as dollar-value-purchased / shares-purchased, which is the correct per-share
cost of the shares still held under average-cost accounting — but only when the
holding's starting shareholding is zero, i.e. every held share was bought
inside the report window. If a holding was already held at the report's start
date, the cost of those earlier shares is not in the file, so that holding is
imported with no cost and flagged in the preview.

Practical consequence, tested on your real export (window 2025-06-01 to
2026-06-30): of 11 rows, 9 are fully sold and ignored; NOK (7 shares) imports
with cost ($14.74), and NVDA (39 shares) imports with no cost because you held
13.6 shares before the window started. To get complete cost basis, re-export
the report with the From date set before your first purchase, so every holding
starts at zero. The importer handles any window; only the From date affects how
much cost it can recover.

## What it imports
Current US-stock holdings (ending shareholding > 0) from the report. It skips
fully-sold positions and any non-USD rows, and tells you what it skipped. The
ticker name comes from the report; sector is not in the file, so imported
securities arrive without a sector until you set one.

## Files changed (5)
- src/lib/imports.js   — NEW. Shared CSV helpers plus buildImportPlan, now
                         source-aware (moved here from ibkr.js).
- src/lib/sharesies.js — NEW. parseSharesiesCsv.
- src/lib/ibkr.js      — now imports the shared helpers; parser only.
- src/App.jsx          — the import overlay gained a broker chooser (IBKR /
                         Sharesies) and passes the chosen source through.
- package.json         — version 0.5.0 -> 0.6.0.

No change to db.js, server.js, src/lib/api.js, src/lib/model.js or
src/styles.css. No new dependency.

## How imports stay separate (and safe)
Imported lots now carry an `imported` marker (the broker key) in addition to
the visible source. An import replaces only that holder's lots from the same
import source; it never touches manual lots, even though the manual add form
defaults its source to "Sharesies". So a manual Sharesies lot is preserved when
you import a Sharesies file. Lots from the original IBKR import (tagged by
source before the marker existed) are still matched, so re-import stays
idempotent across this upgrade. One holder can hold IBKR, Sharesies and manual
lots at once; each import refreshes only its own set, and the model still
consolidates across them (a name held via both brokers shows the combined
position).

The whole-portfolio replace behaviour you wanted is unchanged, now scoped per
source: re-importing a holder's Sharesies file replaces that holder's Sharesies
import and leaves everything else alone.

## Verification done in sandbox
- imports.js, ibkr.js, sharesies.js pass `node --check`; App.jsx passes the
  bracket-balance check; wiring resolves.
- 21-case test across both importers against the real files: correct Sharesies
  extraction (NOK with cost, NVDA flagged no-cost, 9 closed ignored), name
  resolution, manual Sharesies lot preserved, legacy IBKR lot replaced not
  duplicated on re-import, IBKR and Sharesies imports leaving each other
  untouched.
- Full JSX build not run here (no esbuild offline). deploy.sh and the pre-push
  hook both run `npm run build`, so a compile error is caught before Railway.

## To ship
  ./deploy.sh ~/Downloads/consolio_v6.zip "Sharesies import"

Then: open the + sheet, tap "Import holdings from CSV", choose Sharesies, pick
the file, set the holder, and confirm. For complete cost basis, first re-export
the Sharesies report with the From date before your first purchase.
