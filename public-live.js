/* Read-only public desk. No keys, no orders, no invented PnL. */
(function (global) {
  var WINDOW_5 = 300;
  var WINDOW_15 = 900;
  var GAMMA = 'https://gamma-api.polymarket.com';
  var CLOB = 'https://clob.polymarket.com';
  var BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.us'];  // primary, then fallback (api.binance.com can 451)
  var MIN_P = 0.02;
  var MAX_P = 0.98;
  var BASE_VOL_FLOOR = 0.00015;
  var SIGNAL_WEIGHT = 0.55;
  var MOMENTUM_WEIGHT = 0.25;
  var VOL_LOOKBACK = 30;
  var MOMENTUM_BARS = 5;
  var sessionTicks = [];

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function clampProb(p) { return clamp(p, MIN_P, MAX_P); }

  // N1 (redesign-1018c): every fetch has a hard timeout (AbortController), so a hanging Gamma / CLOB /
  // Binance request can never leave the page stuck on 'loading…'. The caller falls back to the snapshot.
  var FETCH_TIMEOUT_MS = 9000;   // per request
  var LIVE_DEADLINE_MS = 10000;  // whole fetchLivePublic() call
  var BOOK15_MS = 4000;          // review-1019: the extra 15m book may never push a refresh past LIVE_DEADLINE_MS
  function ms(name, dflt) { var v = Number(global[name]); return v > 0 ? v : dflt; }  // test hook (node test shortens it)
  function timedFetch(url, opts) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null, limit = ms('DESK_FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS), timer;
    var o = Object.assign({}, opts || {}); if (ctrl) o.signal = ctrl.signal;
    var hard = new Promise(function (_, rej) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); rej(new Error('timeout after ' + limit + ' ms: ' + url)); }, limit);
    });
    return Promise.race([fetch(url, o), hard]).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }
  function withDeadline(p, limit, what) {
    var timer, hard = new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error(what + ' timed out after ' + limit + ' ms')); }, limit); });
    return Promise.race([p, hard]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  // review-1019b: ONE AbortController timer covers headers AND body. When it fires the request itself is
  // aborted (a trickling body is cancelled, not left open in the background). limitMs defaults to the N1
  // per-request timeout; the 15m book passes its own, shorter, cap.
  function fetchJson(url, limitMs) {
    var limit = limitMs || ms('DESK_FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS), timer;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var o = { headers: { Accept: 'application/json' }, mode: 'cors', cache: 'no-store' }; if (ctrl) o.signal = ctrl.signal;
    var hard = new Promise(function (_, rej) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); rej(new Error('timeout after ' + limit + ' ms: ' + url)); }, limit);
    });
    var p = fetch(url, o).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
    return Promise.race([p, hard]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  // BTC spot from Binance public market data: try data-api.binance.vision, then api.binance.us.
  function binance(path) {
    var i = 0;
    function next(err) {
      if (i >= BINANCE_HOSTS.length) return Promise.reject(err || new Error('binance unavailable'));
      var host = BINANCE_HOSTS[i++];
      return fetchJson(host + path).catch(next);
    }
    return next();
  }

  var TF = { '1m': ['1m', 120], '5m': ['5m', 120], '15m': ['15m', 96], '1h': ['1h', 96] };
  // OHLCV candles for the chart; time = UTC epoch seconds (lightweight-charts format).
  function fetchCandles(tf) {
    var t = TF[tf] || TF['1m'];
    return binance('/api/v3/klines?symbol=BTCUSDT&interval=' + t[0] + '&limit=' + t[1]).then(function (rows) {
      return (rows || []).map(function (k) {
        return { time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
      }).filter(function (c) { return isFinite(c.open) && isFinite(c.close) && isFinite(c.high) && isFinite(c.low); });
    });
  }
  // Recent public BTCUSDT spot trades (Binance), newest first. Webull-style tick rule (spec §5):
  // side = 'up' / 'down' / 'flat' versus the PREVIOUS trade's price; taker = 'buy' / 'sell' kept for reference.
  // The oldest trade in the batch has no previous trade, so it is 'flat'.
  function tickSides(ts) {
    var prev = null;
    ts.forEach(function (t) { t.side = prev === null || t.price === prev ? 'flat' : (t.price > prev ? 'up' : 'down'); prev = t.price; });
    return ts;
  }
  function fetchTrades(limit) {
    return binance('/api/v3/trades?symbol=BTCUSDT&limit=' + (limit || 40)).then(function (rows) {
      var ts = (rows || []).map(function (t) {
        return { id: Number(t.id), ts_ms: Number(t.time), price: +t.price, size: +t.qty, taker: t.isBuyerMaker ? 'sell' : 'buy' };
      }).filter(function (t) { return isFinite(t.price) && isFinite(t.size) && isFinite(t.ts_ms); });
      ts.sort(function (a, b) { return a.ts_ms - b.ts_ms || a.id - b.id; });
      return tickSides(ts).reverse();
    });
  }
  function fetchTicker24h() {
    return binance('/api/v3/ticker/24hr?symbol=BTCUSDT').then(function (d) {
      return { last: +d.lastPrice, change: +d.priceChange, change_pct: +d.priceChangePercent, high: +d.highPrice,
               low: +d.lowPrice, open: +d.openPrice, prev_close: +d.prevClosePrice, volume: +d.volume };
    });
  }

  function windowTs(sec, nowS) {
    var n = nowS == null ? Math.floor(Date.now() / 1000) : nowS;
    return n - (n % sec);
  }

  function sortLevels(rows, desc) {
    return (rows || []).map(function (x) {
      return { price: x.price, size: x.size };
    }).filter(function (x) {
      return isFinite(+x.price);
    }).sort(function (a, b) {
      return desc ? (+b.price - +a.price) : (+a.price - +b.price);
    }).slice(0, 12);
  }

  function midFromBook(book) {
    var bids = (book.bids || []).map(function (x) { return +x.price; }).filter(function (n) { return isFinite(n); });
    var asks = (book.asks || []).map(function (x) { return +x.price; }).filter(function (n) { return isFinite(n); });
    var bb = bids.length ? Math.max.apply(null, bids) : null;
    var ba = asks.length ? Math.min.apply(null, asks) : null;
    var mid = null;
    if (bb != null && ba != null) mid = (bb + ba) / 2;
    else if (ba != null) mid = ba;
    else if (bb != null) mid = bb;
    return { mid: mid, bid: bb, ask: ba };
  }

  // Where a mid came from: 'clob' (public book), 'gamma' (outcomePrices fallback, can lag), or null.
  function midSource(book, gammaPx) {
    if (book && book.mid && book.mid.mid != null) return 'clob';
    return gammaPx != null ? 'gamma' : null;
  }

  function depth(rows) {
    return (rows || []).reduce(function (s, x) { return s + (Number(x.size) || 0); }, 0);
  }

  function parseMaybe(v) {
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch (e) { return v; }
    }
    return v;
  }

  function realizedVol(closes) {
    if (closes.length < 3) return BASE_VOL_FLOOR;
    var use = closes.slice(-(VOL_LOOKBACK + 1));
    var rets = [];
    for (var i = 1; i < use.length; i++) {
      if (use[i - 1] > 0 && use[i] > 0) rets.push(Math.log(use[i] / use[i - 1]));
    }
    if (rets.length < 2) return BASE_VOL_FLOOR;
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var variance = rets.reduce(function (a, r) { return a + (r - mean) * (r - mean); }, 0) / (rets.length - 1);
    return Math.max(Math.sqrt(variance), BASE_VOL_FLOOR);
  }

  function momentum(closes) {
    if (closes.length < MOMENTUM_BARS + 1) return 0.5;
    var a = closes[closes.length - 1 - MOMENTUM_BARS];
    var b = closes[closes.length - 1];
    if (!(a > 0)) return 0.5;
    return clamp(0.5 + Math.tanh(((b - a) / a) / 0.003) * 0.5, 0, 1);
  }

  function baseProbability(btc, openBtc, timeRemaining, vol, windowSeconds) {
    var tau = clamp(timeRemaining / Math.max(windowSeconds, 1), 0, 1);
    var sigma = Math.max(vol, BASE_VOL_FLOOR);
    var minutesLeft = Math.max(timeRemaining / 60, 0.05);
    var pathSigma = sigma * Math.sqrt(minutesLeft) * openBtc;
    var z = openBtc > 0 ? (btc - openBtc) / Math.max(pathSigma, 1e-9) : 0;
    var shrink = 0.45 + 0.55 * (1 - tau);
    var base = 1 / (1 + Math.exp(-1.8 * z * shrink));
    var pull = 0.25 * tau;
    base = pull * 0.5 + (1 - pull) * base;
    return { base: clampProb(base), z: z, tau: tau };
  }

  function updateContract(base, signal) {
    base = clampProb(base);
    signal = clamp(signal, 0, 1);
    var delta = SIGNAL_WEIGHT * (signal - 0.5) * 2 * base * (1 - base);
    return clampProb(base + delta);
  }

  /* Same distance-to-open fair as core/pricing.py (training model, not a quote). */
  function fairOf(btc, openBtc, remain, closes, windowSeconds) {
    var vol = realizedVol(closes);
    var mom = momentum(closes);
    var bp = baseProbability(btc, openBtc, remain, vol, windowSeconds);
    var signal = clamp((1 - MOMENTUM_WEIGHT) * bp.base + MOMENTUM_WEIGHT * mom, 0, 1);
    var fairUp = updateContract(bp.base, signal);
    return { fair_up: fairUp, fair_down: clampProb(1 - fairUp), vol: vol, mom: mom, z: bp.z, tau: bp.tau };
  }

  function volRegime(vol) {
    if (vol < BASE_VOL_FLOOR * 1.5) return 'low';
    if (vol < BASE_VOL_FLOOR * 4) return 'normal';
    if (vol < BASE_VOL_FLOOR * 10) return 'elevated';
    return 'extreme';
  }

  function momRegime(mom) {
    if (mom >= 0.58) return 'up';
    if (mom <= 0.42) return 'down';
    return 'flat';
  }

  function round4(v) {
    return v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000;
  }

  function ptStamp(d) {
    try {
      return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }) + ' PT';
    } catch (e) {
      return d.toISOString();
    }
  }

  function marketBySlug(slug) {
    return fetchJson(GAMMA + '/events/keyset?slug=' + encodeURIComponent(slug)).then(function (events) {
      var ev = Array.isArray(events) ? events[0] : (events && Array.isArray(events.events) ? events.events[0] : null);  // /events/keyset wraps results in .events; missing/empty -> no event
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw new Error('No Gamma event for ' + slug);  // events[0] must be a plain object
      var m = (ev.markets || [])[0] || {};
      var outcomes = parseMaybe(m.outcomes) || ['Up', 'Down'];
      var prices = parseMaybe(m.outcomePrices);
      var tokenIds = parseMaybe(m.clobTokenIds);
      var upIdx = -1;
      var downIdx = -1;
      outcomes.forEach(function (o, i) {
        var name = String(o).toLowerCase();
        if (name === 'up') upIdx = i;
        if (name === 'down') downIdx = i;
      });
      var ui = upIdx >= 0 ? upIdx : 0;
      var di = downIdx >= 0 ? downIdx : 1;
      return {
        question: m.question || ev.title || '',
        gammaUp: prices && prices[ui] != null ? parseFloat(prices[ui]) : null,
        gammaDown: prices && prices[di] != null ? parseFloat(prices[di]) : null,
        upTok: tokenIds && tokenIds[ui],
        downTok: tokenIds && tokenIds[di]
      };
    });
  }

  function bookSide(tokenId) {
    if (!tokenId) return Promise.resolve(null);
    return fetchJson(CLOB + '/book?token_id=' + encodeURIComponent(tokenId)).then(function (book) {
      return {
        bids: sortLevels(book.bids, true),
        asks: sortLevels(book.asks, false),
        n_bids: (book.bids || []).length,
        n_asks: (book.asks || []).length,
        mid: midFromBook(book),
        rawDepthBid: depth(book.bids),
        rawDepthAsk: depth(book.asks)
      };
    });
  }

  // review-1019b/1019c: the 15m Up book is used only if it is the book we asked for (asset_id), bids and asks
  // are arrays of levels whose prices are all finite and strictly inside (0, 1), it has BOTH sides and it is
  // not crossed/locked (best bid < best ask). Anything else -> null + reason ('no_book', 'wrong_token',
  // 'malformed', 'out_of_range', 'one_sided', 'crossed'), and the caller falls back to Gamma (labelled 'can
  // lag the book'). Parsing never throws: any error is 'malformed'. The whole request (headers + body) is
  // capped at BOOK15_MS.
  function px15(level) {
    if (!level || typeof level !== 'object') return NaN;
    var p = level.price;
    if (typeof p === 'string') p = p.trim() === '' ? NaN : Number(p);
    return typeof p === 'number' ? p : NaN;
  }
  function parse15(book, tokenId) {
    if (!book || typeof book !== 'object' || Array.isArray(book)) return { reject: 'no_book' };
    if (String(book.asset_id) !== String(tokenId)) return { reject: 'wrong_token' };
    if (!Array.isArray(book.bids) || !Array.isArray(book.asks)) return { reject: 'malformed' };
    var bids = book.bids.map(px15), asks = book.asks.map(px15), all = bids.concat(asks);
    for (var i = 0; i < all.length; i++) if (!isFinite(all[i])) return { reject: 'malformed' };
    for (var j = 0; j < all.length; j++) if (!(all[j] > 0 && all[j] < 1)) return { reject: 'out_of_range' };
    if (!bids.length || !asks.length) return { reject: 'one_sided' };
    var bb = Math.max.apply(null, bids), ba = Math.min.apply(null, asks);
    if (!(bb < ba)) return { reject: 'crossed' };
    return { reject: null, book: { mid: { mid: (bb + ba) / 2, bid: bb, ask: ba }, n_bids: bids.length, n_asks: asks.length } };
  }
  function book15(tokenId) {
    if (!tokenId) return Promise.resolve({ book: null, reject: 'no_token' });
    var limit = Math.min(ms('DESK_BOOK15_MS', BOOK15_MS), ms('DESK_FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS));
    return fetchJson(CLOB + '/book?token_id=' + encodeURIComponent(tokenId), limit).then(function (book) {
      try {
        var r = parse15(book, tokenId);
        return r.reject ? { book: null, reject: r.reject } : { book: r.book, reject: null };
      } catch (e) { return { book: null, reject: 'malformed' }; }
    }, function (e) { return { book: null, reject: /timeout/.test(String(e && e.message)) ? 'timeout' : 'error' }; });
  }

  function openAt(klines, tsMs) {
    var open = null;
    (klines || []).forEach(function (k) {
      if (Number(k[0]) === tsMs) open = parseFloat(k[1]);
    });
    return open;
  }

  function fetchLivePublic() {
    return withDeadline(fetchLivePublicInner(), ms('DESK_LIVE_DEADLINE_MS', LIVE_DEADLINE_MS), 'live public fetch');
  }
  function fetchLivePublicInner() {
    var now = Date.now();
    var nowS = Math.floor(now / 1000);
    var w5 = windowTs(WINDOW_5, nowS);
    var w15 = windowTs(WINDOW_15, nowS);
    var slug5 = 'btc-updown-5m-' + w5;
    var slug15 = 'btc-updown-15m-' + w15;
    var remain5 = Math.max(0, w5 + WINDOW_5 - nowS);
    var remain15 = Math.max(0, w15 + WINDOW_15 - nowS);

    return Promise.all([
      binance('/api/v3/ticker/price?symbol=BTCUSDT'),
      binance('/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=40'),
      binance('/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=24'),
      marketBySlug(slug5),
      marketBySlug(slug15).catch(function () { return null; })
    ]).then(function (parts) {
      var px = parts[0];
      var k1 = parts[1];
      var k5 = parts[2];
      var m5 = parts[3];
      var m15 = parts[4];
      var btc = parseFloat(px.price);
      var closes = k1.map(function (k) { return parseFloat(k[4]); }).filter(function (n) { return isFinite(n); });
      var open5 = openAt(k5, w5 * 1000);
      if (open5 == null && k5.length) {
        var cur = k5.filter(function (k) { return Number(k[0]) <= now; });
        if (cur.length) open5 = parseFloat(cur[cur.length - 1][1]);
      }
      var fair5 = (open5 != null && isFinite(btc)) ? fairOf(btc, open5, remain5, closes, WINDOW_5) : null;
      var open15 = openAt(k5, w15 * 1000);
      var fair15 = (m15 && open15 != null && isFinite(btc)) ? fairOf(btc, open15, remain15, closes, WINDOW_15) : null;
      return Promise.all([
        bookSide(m5.upTok).catch(function () { return null; }),
        bookSide(m5.downTok).catch(function () { return null; }),
        // mid15-clob: the 15m Up mid now comes from its CLOB book too (Gamma outcomePrices can lag the
        // book by 0.2+); Gamma stays the fallback. A failed 15m book never fails the 5m tick.
        // review-1019/1019b: capped at BOOK15_MS (abort covers the body) and validated (parse15).
        m15 ? book15(m15.upTok) : Promise.resolve({ book: null, reject: 'no_market' })
      ]).then(function (books) {
        var upBook = books[0];
        var dnBook = books[1];
        var up15Book = books[2].book, up15Reject = books[2].reject;
        var midUp = upBook && upBook.mid.mid != null ? upBook.mid.mid : m5.gammaUp;
        var midDown = dnBook && dnBook.mid.mid != null ? dnBook.mid.mid : m5.gammaDown;
        var midUpSource = midSource(upBook, m5.gammaUp);
        var midDownSource = midSource(dnBook, m5.gammaDown);
        var edgeUp = (fair5 && midUp != null) ? fair5.fair_up - midUp : null;
        var edgeDown = (fair5 && midDown != null) ? fair5.fair_down - midDown : null;
        var bidUp = upBook ? upBook.rawDepthBid : 0;
        var bidDn = dnBook ? dnBook.rawDepthBid : 0;
        var bookImbalance = (bidUp + bidDn) > 0 ? (bidUp - bidDn) / (bidUp + bidDn) : null;
        var ts = ptStamp(new Date(now));
        var candles = k5.map(function (k) {
          return { open: parseFloat(k[1]), close: parseFloat(k[4]), t: ptStamp(new Date(Number(k[0]))) };
        }).filter(function (c) { return isFinite(c.open) && isFinite(c.close); });
        var related = [];
        if (m15) {
          var mid15 = up15Book && up15Book.mid.mid != null ? up15Book.mid.mid : m15.gammaUp;
          var mid15Source = midSource(up15Book, m15.gammaUp);
          var gap = null;
          // review-1019b: 'Gap' is fair15 - mid15 only; without fair15 it is '—' (no 15m-minus-5m stand-in)
          if (fair15 && mid15 != null) gap = round4(fair15.fair_up - mid15);
          related.push({
            label: 'btc_15m',
            slug: slug15,
            gap: gap,
            mid_up: round4(mid15),
            mid_source: mid15Source,
            book_reject: up15Reject,
            fair_up: fair15 ? round4(fair15.fair_up) : null
          });
        }
        var analysis = {
          window_start_ms: w5 * 1000,
          window_end_ms: (w5 + WINDOW_5) * 1000,
          ts_pt: ts,
          slug: slug5,
          btc: btc,
          fair_up: fair5 ? round4(fair5.fair_up) : null,
          fair_down: fair5 ? round4(fair5.fair_down) : null,
          mid_up: round4(midUp),
          mid_down: round4(midDown),
          mid_up_source: midUpSource,
          mid_down_source: midDownSource,
          edge_up: round4(edgeUp),
          edge_down: round4(edgeDown),
          mispricing_up_vs_mid: round4(edgeUp),
          mispricing_down_vs_mid: round4(edgeDown),
          book_imbalance: round4(bookImbalance),
          ask_depth_up: upBook ? upBook.rawDepthAsk : null,
          ask_depth_down: dnBook ? dnBook.rawDepthAsk : null,
          time_remaining_sec: remain5,
          time_pressure: fair5 ? round4(1 - fair5.tau) : null,
          vol_regime: fair5 ? volRegime(fair5.vol) : null,
          momentum_regime: fair5 ? momRegime(fair5.mom) : null,
          book_source: 'polymarket-clob-public',
          action: 'WATCH',
          structure: 'PUBLIC',
          reasons: [
            'LIVE PUBLIC read-only · fair is the training distance-to-open model, not a quote',
            edgeUp == null ? 'fair vs mid unavailable' : ('fair_up − mid_up = ' + round4(edgeUp)),
            'no local session · this page does not place orders'
          ],
          related_markets: related,
          public_book: (upBook || dnBook) ? {
            event: 'BOOK',
            ts_pt: ts,
            up: upBook ? { bids: upBook.bids, asks: upBook.asks, n_bids: upBook.n_bids, n_asks: upBook.n_asks, mid: round4(midUp) } : null,
            down: dnBook ? { bids: dnBook.bids, asks: dnBook.asks, n_bids: dnBook.n_bids, n_asks: dnBook.n_asks, mid: round4(midDown) } : null
          } : null
        };
        var tick = {
          event: 'PUBLIC_TICK',
          ts_pt: ts,
          fair_up: analysis.fair_up,
          mid_up: analysis.mid_up,
          edge_up: analysis.edge_up,
          edge_down: analysis.edge_down,
          remaining_sec: remain5,
          btc: btc,
          open_btc: open5,
          reason: 'public read-only tick · no local session'
        };
        var prev = sessionTicks[sessionTicks.length - 1];
        if (!prev || prev.mid_up !== tick.mid_up || prev.fair_up !== tick.fair_up || prev.remaining_sec !== tick.remaining_sec) {
          sessionTicks.push(tick);
          if (sessionTicks.length > 60) sessionTicks.shift();
        }
        var disclaimer = 'LIVE PUBLIC (read-only). Not financial advice. No profit guarantee. This page does not place orders. No private key. PnL and fills need a local session and are not shown here.';
        var st = {
          mode: 'LIVE_PUBLIC',
          live_polymarket: false,
          live_armed: false,
          slug: slug5,
          question: m5.question,
          last_price: btc,
          mid_up: analysis.mid_up,
          mid_down: analysis.mid_down,
          edge_up: analysis.edge_up,
          edge_down: analysis.edge_down,
          bankroll: null,
          realized_pnl: null,
          daily_pnl: null,
          fills: null,
          windows_won: null,
          windows_lost: null,
          halted: false,
          book_source: 'public gamma + clob + binance',
          last_reason: 'no local session',
          last_tick_pt: ts,
          disclaimer: disclaimer,
          inventory: {},
          window: { slug: slug5, open_btc: open5, last_btc: btc, spent_usdc: null },
          public_candles: candles,
          analysis: analysis
        };
        return {
          st: st,
          jr: { events: sessionTicks.slice(), disclaimer: disclaimer },
          an: { analysis: analysis },
          intel: null
        };
      });
    });
  }

  global.fetchLivePublic = fetchLivePublic;
  global.DeskFeeds = { candles: fetchCandles, trades: fetchTrades, tickSides: tickSides, ticker24h: fetchTicker24h, hosts: BINANCE_HOSTS.slice(),
                       timedFetch: timedFetch, withDeadline: withDeadline };
})(typeof globalThis !== 'undefined' ? globalThis : window);
