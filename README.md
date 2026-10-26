# Grok Desk

Public Polymarket BTC Up/Down desk.

When this site is opened on GitHub Pages, `/api/state` is not available. The page then loads **live public data in the browser** and labels itself **LIVE PUBLIC (read-only)**. It does not place orders and does not hold a private key.

Public calls:

- `https://gamma-api.polymarket.com/events/keyset?slug=btc-updown-5m-{floor(unix/300)*300}`
- the 15-minute sibling `btc-updown-15m-{floor(unix/900)*900}`
- `https://clob.polymarket.com/book?token_id=…` for the Up and Down tokens
- `https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT`
- `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m` and `interval=5m` (fair model: `limit=40` / `limit=24`)
- chart candles: the same `klines` route with `interval=1m|5m` (`limit=120`) and `interval=15m|1h` (`limit=96`)
- Time & Sales: `https://data-api.binance.vision/api/v3/trades?symbol=BTCUSDT&limit=40` (public BTC spot trades, not Polymarket fills)
- watchlist 24h row: `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT`

Binance: every page (`index.html`, `app.html`, `dashboard.html`) loads `public-live.js`, which tries `data-api.binance.vision` first and falls back to `api.binance.us` for each call. `api.binance.com` is not used; it can return 451 from US networks. The pages' CSP `connect-src` allows only Gamma, CLOB, those two Binance hosts and `'self'`.

Mid prices: the 5-minute Up/Down mid and the 15-minute Up mid are the CLOB book mid (best bid + best ask) / 2, the same rule as the local trader (`core/related.py`). The 15m Up book is used only if it is the book that was asked for (`asset_id` = the 15m Up token), has `bids` and `asks` as lists, every price in them is a number strictly between 0 and 1, both sides are present, and best bid < best ask. If it is missing, malformed, has a price outside (0, 1), is empty, one-sided, crossed, for another token, or slow (the whole request, body included, is aborted after 4 s, so it can never push a refresh past its 10 s limit), the page falls back to Gamma `outcomePrices` and says so (**Mid source: Gamma price**). The 15m **Gap** is fair − mid; when the 15m fair is not available it shows —. Gamma can lag the book badly: on 2026-10-19 at 09:33 PT Gamma said 0.445 for 15m Up while the CLOB book was 0.21 / 0.22. The 15m sibling costs one extra public `GET /book` per refresh.

Timeouts: every public fetch gives up after 9 s and a whole refresh after 10 s; the header and analysis cards switch to the `data.json` snapshot (badge SNAPSHOT; the strip shows its capture time). The chart and Time & Sales stay live Binance and say so. If `data.json` cannot be loaded either, the page shows **NO DATA** (no 'loading…', no clock time; the footer says 'No data loaded') and keeps retrying every 8 s. While the first refresh is still loading, the header clock shows —, not the current time. In snapshot mode the header clock shows the snapshot's capture time, not the current time.

Fair vs mid reuses the training distance-to-open model (BTC vs the window open, time left, short-term vol and momentum). It is not a quote and not an order.

PnL, fills, and bankroll stay blank (`—` / no local session) unless a local `serve.py` answers `/api/state`. On `*.github.io` (and any `https` host) the page does not try `/api/*` at all; only a plain-`http` page that is not on `github.io` tries it (2.5 s limit) before going LIVE PUBLIC. `data.json` is only a last-resort snapshot if those public feeds fail.

## Notes for editors

- **Gamma endpoint.** Market lookup uses `https://gamma-api.polymarket.com/events/keyset?slug=…`. The older `/events?slug=…` is deprecated by Polymarket (sunset 2026-05-01) and only works for now. `/events/keyset` returns `{ "events": [ … ] }`, so code reads `events[0]` from that wrapper and still accepts a bare list; a missing or empty `events` means no event.
- **Pages base path.** GitHub Pages serves this site under `/grok-desk/`, so in-page navigation must use **relative** links (`app.html`, `dashboard.html`), never root-absolute ones (`/app.html`). Root-absolute URLs resolve to `https://jamlock.github.io/app.html` and 404 (expected). Commit `13e0961` switched the HTML to relative links; keep it that way.
- **iPad title.** The iPad home-screen title (`apple-mobile-web-app-title`) is `Grok Desk` (it was `PM Trader`).
- **Files.** The pages are thin shells. `public-live.js` = public data + fair model (no orders), `desk.js` / `deskview.js` = Webull-style layout, `ptfmt.js` = Pacific-time formatting (every time on the page is PT), `desk.css` = styles. `vendor/lightweight-charts/` is TradingView Lightweight Charts 4.2.3 (Apache-2.0); keep its `LICENSE` and `VERSION.txt` next to the file.
- **Polymarket and public BTC prices only.** Data from the separate local exchange recorder must never be published into `data.json` or anywhere on Pages (that exchange's developer agreement bars redistribution, and it is Jack's rule).

Not financial advice. No profit guarantee. This page does not place orders.
