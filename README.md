# Grok Desk

Public Polymarket BTC Up/Down desk.

When this site is opened on GitHub Pages, `/api/state` is not available. The page then loads **live public data in the browser** and labels itself **LIVE PUBLIC (read-only)**. It does not place orders and does not hold a private key.

Public calls:

- `https://gamma-api.polymarket.com/events/keyset?slug=btc-updown-5m-{floor(unix/300)*300}`
- the 15-minute sibling `btc-updown-15m-{floor(unix/900)*900}`
- `https://clob.polymarket.com/book?token_id=…` for the Up and Down tokens
- `https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT`
- `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m` and `interval=5m`

Binance: `data-api.binance.vision` is the primary host (the only one in `public-live.js`). The iPad page (`app.html`) falls back to `api.binance.us`. `api.binance.com` is not used; it can return 451 from some networks.

Fair vs mid reuses the training distance-to-open model (BTC vs the window open, time left, short-term vol and momentum). It is not a quote and not an order.

PnL, fills, and bankroll stay blank (`—` / no local session) unless a local `serve.py` answers `/api/state`. `data.json` is only a last-resort snapshot if those public feeds fail.

## Notes for editors

- **Gamma endpoint.** Market lookup uses `https://gamma-api.polymarket.com/events/keyset?slug=…`. The older `/events?slug=…` is deprecated by Polymarket (sunset 2026-05-01) and only works for now. `/events/keyset` returns `{ "events": [ … ] }`, so code reads `events[0]` from that wrapper and still accepts a bare list; a missing or empty `events` means no event.
- **Pages base path.** GitHub Pages serves this site under `/grok-desk/`, so in-page navigation must use **relative** links (`app.html`, `dashboard.html`), never root-absolute ones (`/app.html`). Root-absolute URLs resolve to `https://jamlock.github.io/app.html` and 404 (expected). Commit `13e0961` switched the HTML to relative links; keep it that way.
- **iPad title.** The iPad home-screen title (`apple-mobile-web-app-title`) is `Grok Desk` (it was `PM Trader`).
- **No Kalshi data on this site.** Kalshi recorder data must never be published into `data.json` or anywhere on Pages (Kalshi developer agreement and Jack's rule).

Not financial advice. No profit guarantee. This page does not place orders.
