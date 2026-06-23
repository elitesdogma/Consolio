# Consolio v0.2.0 — change summary

Five additive UI changes. No change to the data model, database schema,
server, API contract, or persistence. The stored portfolio (holders,
securities, lots) is byte-for-byte compatible with v0.1.0; existing Railway
Postgres data loads unchanged.

## Files changed (4)
- src/lib/model.js   — money formatter; sector ramp colour
- src/App.jsx        — prices timestamp; firm-wide holdings filter + sort
- src/styles.css     — fluid iPhone respacing; safe-area insets
- package.json       — version 0.1.0 -> 0.2.0 (deploy marker)

## Files deliberately untouched
db.js, server.js, lib/quotes.js, lib/fx.js, src/lib/api.js, src/main.jsx,
index.html, vite.config.js, .env.example, .gitignore

## What each change does
1. Respacing: .screen / .topbar / .depthrail padding now scale with viewport
   via clamp(), so the 375pt SE is no longer cramped and the 430pt Max no
   longer empty. Adds env(safe-area-inset-*) so the depth rail clears the home
   indicator and the top bar clears the notch/Dynamic Island.
2. One-decimal abbreviations: $14.2K instead of $14K (K tier only; M and B
   were already one/two decimals). Affects every money figure app-wide.
3. Prices timestamp: a muted "Prices as of HH:MM · DD Mon" line under the firm
   total, bound to the freshest live-quote asOf across held symbols. FX
   freshness is intentionally not shown. Shows nothing until a live quote
   arrives (so the snapshot-only / no-key state stays clean).
4. Sector ramp: allocation bar + legend now use an on-system tonal ramp (the
   calm accent hue walked through lightness with slight hue drift) rather than
   a flat accent at stepped opacity. Distinguishable without a rainbow; reads
   in both themes.
5. Holdings filter + sort: the Total > Securities list gains a filter box
   (symbol / name / sector) and a sort menu: Value, Return, Symbol, Most held.
   NOTE: "Return" sorts by today's % change (dayPct) — the only return metric
   aggregated at security level. Lifetime unrealised return is not available
   firm-wide without a small model addition.

## Verification done in sandbox
- model.js and api.js pass `node --check`.
- App.jsx brace/paren/bracket balance verified; all new identifiers resolve;
  the added hook sits above the component's single return.
- Full transpile/build NOT run: the sandbox has no network so npm/esbuild
  cannot install. Run `npm run build` locally or let Railway build to confirm
  the JSX compiles before relying on the deploy.

## To ship
Replace these 4 files in your repo with the versions in this zip, commit, push.
Railway rebuilds. Confirm the footer/version shows 0.2.0 and that existing
holdings still load (they will; storage is unchanged).
