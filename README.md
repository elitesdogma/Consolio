# Consolio

A mobile-first web app for consolidating US-stock holdings across multiple holders into one view. Holders are identified by initials; holdings are entered as lots tagged by source (Sharesies, IBKR or Other); the app shows live value, unrealised profit and loss, sector allocation and per-security cross-holdings. Values are in USD with an optional NZD display toggle.

It reuses the Aperture "liquid glass" design language: a single navigation stack drilling Total to Holder to Position, a parallel Securities axis, and a bottom depth rail breadcrumb.

## Architecture

One Node service does everything. Vite builds the React app to `dist/`, and an Express server serves those static files plus a small JSON API on a single port. State lives in Postgres as one portfolio document (holders, securities, lots) plus a `price_snapshots` table that accumulates quote history for sparklines and last-known-price fallback.

External data: live quotes come from Finnhub's free `/quote` endpoint (price and day change), cached for 60 seconds. FX uses the keyless open.er-api.com daily reference rate, cached for six hours. Both degrade gracefully: if quotes are unavailable the app still runs and shows holdings as "awaiting price"; if FX is unavailable the NZD toggle is disabled.

Positions are derived, not stored. A holding's shares and average cost are the aggregate of its lots (total shares, share-weighted average cost), so the Sharesies/IBKR/Other breakdown is preserved and shown on each position.

## Prerequisites

A Railway account, a GitHub account (or the Railway CLI), and a free Finnhub API key from https://finnhub.io. Node 20+ if you want to run it locally.

## Deploy to Railway

1. Get the code into a GitHub repository. From this folder: `git init`, `git add .`, `git commit -m "Consolio"`, then push to a new repo. (Alternatively, install the Railway CLI and run `railway up` from this folder to skip GitHub.)

2. In Railway, create a new project and choose "Deploy from GitHub repo", selecting your repository. Railway detects Node and uses Nixpacks, which runs `npm install`, then `npm run build` (Vite), then `npm start` (the Express server). No Dockerfile or build configuration is required. The server binds `0.0.0.0` on the platform-provided `PORT`.

3. In the same project, click "New" and add a "Database" of type "PostgreSQL". Railway provisions it and exposes connection variables on that service.

4. Open your app service, go to "Variables", and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`. Use the exact name of your database service in the reference; Railway names it `Postgres` by default. If your app and database are in the same project you can instead use `${{Postgres.DATABASE_PRIVATE_URL}}`, which routes over Railway's internal network and avoids egress.
   - `QUOTES_API_KEY` = your Finnhub key.
   - You do not need to set `PORT`; Railway injects it. SSL is auto-detected, so `PGSSL` is only needed if your provider differs from the defaults described in `.env.example`.

5. Trigger a deploy if one has not started. Watch the build logs; the schema is created automatically on first boot (you will see "Database ready"). If Railway ever fails to infer the commands, set them explicitly under Settings: build `npm run build`, start `npm start`.

6. Under Settings, "Networking", click "Generate Domain" to get a public URL. Optionally set the health check path to `/api/health`.

7. Open the URL. The portfolio starts empty. Tap the plus icon in the top bar to add a holder, then add holdings (lots). Add a security's name and sector from the Security tab or a security's own screen; tickers are also created automatically when you add a lot for a new symbol. Live prices appear once `QUOTES_API_KEY` is set; sparklines fill in over the following hours as quote snapshots accumulate.

## Local development

Install dependencies with `npm install`. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (a local Postgres instance, or a Railway database's public connection string) and `QUOTES_API_KEY`. Then run the API and the Vite dev server in two terminals:

```
npm run dev:api     # Express on :8080, restarts on change, loads .env
npm run dev         # Vite on :5173, proxies /api to :8080
```

Open http://localhost:5173. To sanity-check a production-style build locally, run `npm run build` then `npm start` and open http://localhost:8080.

## What to know before relying on it

There is no authentication. Anyone with the URL sees and can edit all data. This is a deliberate simplification for a small personal tool, but it is a standing exposure: if the URL leaks, your holdings are public and mutable. Mitigations, in rough order of effort, are to keep the URL private, put Railway's access controls or a reverse proxy with basic auth in front of the service, or add a shared passphrase gate. Treat the current state as suitable for private use only.

Cost: Railway's smallest always-on footprint (the web service plus a Postgres instance) sits around the low single-digit dollars per month on the Hobby plan, billed by usage. There is no free always-on tier.

Quotes and FX have real limits. Finnhub's free tier covers US equities and allows roughly 60 requests per minute; the 60-second server cache keeps you well under that for a handful of symbols. The day-change percentage is the provider's; outside US market hours it reflects the last session. FX is a once-daily reference rate, not an intraday spot, so NZD figures are indicative rather than execution-grade. A security with no live quote and no stored snapshot is treated as unpriced and excluded from totals rather than valued at zero, with an "awaiting price" note, so aggregates never silently misstate value.

Concurrency is last-write-wins. Two people editing at once can overwrite each other; there is no locking or merge. For single-user or low-contention use this is fine.

Sparklines are built from snapshots this app records (throttled to at most one point per symbol every 15 minutes while the app is open), so they start sparse and lengthen over time rather than showing deep history from day one. If you want immediate multi-month charts, wire a historical-candle provider into `lib/quotes.js` and a new endpoint; the chart code already handles arbitrary-length series.

## Project layout

```
server.js          Express: serves the SPA and the /api routes, validates input, boots the DB
db.js              Postgres: schema, portfolio document, price snapshots, sparkline queries
lib/quotes.js      Finnhub quote adapter with a 60s cache
lib/fx.js          USD-base daily FX with a 6h cache
index.html         Vite entry
src/main.jsx       React mount
src/styles.css     Aperture design system (tokens, glass material, components)
src/lib/model.js   Pure derivations and currency-aware formatters
src/lib/api.js     Frontend API client
src/App.jsx        Navigation stack, four surfaces, depth rail, add/edit sheet
```
To deploy: cd /Users/jc/Developer/Consolio && ./deploy.sh ~/Downloads/consolio_vN.zip "description"
