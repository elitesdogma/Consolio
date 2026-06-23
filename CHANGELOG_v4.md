# Consolio v0.4.0 — change summary

Optimistic concurrency control (OCC) on the portfolio save. This closes the
last-write-wins race where two people saving close together would silently
overwrite each other. Unlike v0.2.0 and v0.3.0, this release does touch the
server and database layer, because a concurrency guard cannot live in the
frontend alone. It is deliberately scoped to the save path and changes nothing
about the stored shape.

## How it works
The concurrency token is the row's existing `updated_at`. The server returns it
on read; the client holds it and echoes it back on save; the server writes only
if the stored token still matches. On a mismatch the save is rejected with 409
and the client shows a conflict bar. No schema change: the `updated_at` column
already exists, so there is no migration and no new stored field.

The one real trap, handled: node-postgres returns a timestamp as a JS Date
truncated to milliseconds, but Postgres stores microseconds, so a naive
comparison would make every save against an existing row falsely conflict. The
token is therefore returned as a full-microsecond ISO string and compared as an
instant in SQL (`updated_at = $token::timestamptz`). This also means it matches
your existing Railway rows from the first save, with no reset step.

## Files changed (6)
- db.js            — getPortfolio returns updated_at as a full-precision ISO
                     string; savePortfolio takes { expectedUpdatedAt, force } and
                     does a conditional upsert that reports { conflict, updatedAt }.
- server.js        — PUT reads the token and force flag off the body, calls the
                     guarded save, and returns 409 with the latest state on
                     conflict (so the client can show or reload it).
- src/lib/api.js   — request() now attaches the response body to thrown errors;
                     savePortfolio(portfolio, expectedUpdatedAt, force) sends the
                     token (and force when overwriting).
- src/App.jsx      — holds the token in a ref, captured on load and refreshed on
                     each save; routes a 409 to a persistent conflict bar with
                     two actions; resolution handlers for reload and overwrite.
- src/styles.css   — .conflict-bar and .fbtn.danger, built from the existing
                     glass and crit tokens.
- package.json     — version 0.3.0 -> 0.4.0.

## Files untouched
lib/quotes.js, lib/fx.js, src/lib/model.js, src/main.jsx, index.html,
vite.config.js, .env.example, .gitignore. No new dependency, no new env var.

## Conflict resolution: the design choice
A rejected save shows a bar with two explicit actions and no auto-dismiss:
  - Load latest: discards your unsaved edits and loads the other person's saved
    version.
  - Overwrite with mine: keeps your edits and discards the other person's saved
    change (sends force, bypassing the guard).
Neither happens silently. A whole-document auto-merge was rejected: this is a
single-JSONB-document model, so a correct merge would need a structural diff of
arbitrary edits (add holder, edit lot, remove security), and a buggy silent
merge is a worse failure than an explicit choice. Both actions lose something,
which is the nature of a conflict without merge; the UI states this plainly and
lets the user decide. The overwrite action is styled crit as the more
consequential choice.

## Deploy and backward compatibility
Same flow as before: replace the files, commit, push, Railway rebuilds. No
migration. During the rollout, a client that loaded the page before the deploy
(old api.js, sends no token) writes unconditionally, so an open old tab keeps
working rather than erroring. New clients always send the token, so every
updated client is guarded. Once you are confident all clients are updated, the
server could be tightened to require the token; that is a one-line follow-up,
not needed now.

Data is not at risk: the change makes saves safer, the stored shape is
unchanged, and existing rows load and save normally.

## Verification done in sandbox
- db.js, server.js and api.js pass `node --check`.
- App.jsx and styles.css pass the string/comment/template-aware bracket-balance
  check; new identifiers resolve.
- A 10-case simulation of the contract (client payload shaping, the server's
  token extraction, and the DB guarded/unconditional/conflict branches) passes:
  matching token writes; stale token and null-against-existing conflict; first
  save inserts; force overwrites; legacy client writes unconditionally; the
  token and force flag are shaped correctly on the wire.

NOT verified here, because the sandbox has no database or network:
  - The Postgres conditional upsert itself. The SQL relies on documented
    behaviour (ON CONFLICT DO UPDATE ... WHERE affecting zero rows on a false
    condition, and timestamptz instant equality), but confirm it on Railway.
  - The JSX build (no esbuild offline). Run `npm run build` locally first.

## Confirm OCC on Railway (two minutes)
1. Open the app in two browser tabs, A and B. Let both load.
2. In tab A, make any edit and let it save (status shows Saved).
3. In tab B (still on the old data), make a different edit.
4. Tab B should show the conflict bar. Test both paths: Load latest pulls A's
   change; Overwrite with mine forces B's version and clears the bar.
5. Confirm a normal single-tab edit still saves silently as before, and that
   the footer/version reads 0.4.0.

## Residual risk
Two saves landing inside the same microsecond would carry an identical token and
could both match. now() resolution is microseconds and saves are human-paced, so
this is negligible for this user base. If you ever want it eliminated, a serial
integer version column removes any time dependence, at the cost of a one-column
additive migration.

## Now unlocked
With the save guarded, Tier 2 and Tier 3 (value-history charting, dividend
tracking, target/drift, transaction ledger) can add their stored fields and new
write surface on a safe foundation.
