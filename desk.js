/* Grok Desk page script (index.html, dashboard.html, app.html). Read-only: no order UI, no keys.
   Source order: local /api/state (serve.py) -> LIVE PUBLIC (Polymarket Gamma + CLOB book, Binance BTC)
   -> data.json snapshot. Chart, ticker and trades are BTC spot from Binance public market data.
   All rendering via textContent / CSSOM (CSP: script-src 'self', style-src 'self'). Times in PT. */
(function () {
  'use strict';
  var LC = window.LightweightCharts, PT = window.PTFMT, FEEDS = window.DeskFeeds;
  var UP = '#58d0a8', DN = '#f03068';
  var S = { tf: '1m', side: 'up', source: '', st: null, jr: null, an: null, intel: null, t24: null, firstMid: {} };
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function num(v) { var n = (v === null || v === undefined || v === '') ? NaN : Number(v); return isFinite(n) ? n : null; }
  function f(v, d) { v = num(v); return v === null ? '—' : v.toFixed(d); }
  function usd(v) { v = num(v); return v === null ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2); }
  function sgn(v, d) { v = num(v); return v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d); }
  function big(v) { v = num(v); if (v === null) return '—'; return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(2); }
  function cls(v) { v = num(v); return v === null || v === 0 ? '' : (v > 0 ? 'pos' : 'neg'); }
  var PTF = {
    hms: new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
    clock: new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  };
  function hmsPT(ms) { return PTF.hms.format(new Date(ms)); }
  function mmss(s) { s = num(s); if (s === null) return '—'; s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function setText(id, t, c) { var e = $(id); if (!e) return; e.textContent = t; if (c !== undefined) e.className = c; }
  function A() { return (S.an && S.an.analysis) || (S.st && S.st.analysis) || {}; }

  // ---------------------------------------------------------------- chart
  var chart = LC.createChart($('chart'), {
    layout: { background: { color: '#19223f' }, textColor: '#a8b0c0', fontSize: 11, attributionLogo: false },  // logo injects a <style>; attribution is in the footer
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },  // Webull shows no gridlines
    crosshair: { mode: LC.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#1a2238', minimumWidth: 66, scaleMargins: { top: 0.08, bottom: 0.14 } },
    leftPriceScale: { visible: true, borderColor: '#1a2238', mode: LC.PriceScaleMode.Percentage, scaleMargins: { top: 0.08, bottom: 0.14 } },
    timeScale: { borderColor: '#1a2238', timeVisible: true, secondsVisible: false, tickMarkFormatter: PT.tickMark },
    localization: { timeFormatter: PT.crosshair }, autoSize: true
  });
  chart.applyOptions({ timeScale: { tickMarkFormatter: PT.tickMark } });
  // Lightweight Charts defaults (#26a69a / #ef5350) overridden with Webull teal / pink (spec §1)
  var candles = chart.addCandlestickSeries({ upColor: UP, downColor: DN, borderVisible: false, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN,
    priceLineStyle: LC.LineStyle.Dashed, priceLineColor: DN, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
  var pct = chart.addLineSeries({ priceScaleId: 'left', color: 'rgba(0,0,0,0)', lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, baseLineVisible: false });
  var vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  vol.priceScale().applyOptions({ scaleMargins: { top: 0.88, bottom: 0 }, visible: false });
  var openLine = null;

  function drawChart(cs) {
    candles.setData(cs.map(function (c) { return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }; }));
    pct.setData(cs.map(function (c) { return { time: c.time, value: c.close }; }));
    vol.setData(cs.map(function (c) { return { time: c.time, value: c.volume || 0, color: c.close >= c.open ? 'rgba(88,208,168,.7)' : 'rgba(240,48,104,.7)' }; }));
    var lc = cs[cs.length - 1];  // dashed last-price line in up/down by direction of the last bar
    if (lc) candles.applyOptions({ priceLineColor: lc.close >= lc.open ? UP : DN });
    var hi = null, lo = null;
    cs.forEach(function (c) { if (!hi || c.high > hi.high) hi = c; if (!lo || c.low < lo.low) lo = c; });
    var mk = [];
    if (hi) mk.push({ time: hi.time, position: 'aboveBar', color: '#c9d1e0', shape: 'arrowDown', text: f(hi.high, 2) });
    if (lo && lo !== hi) mk.push({ time: lo.time, position: 'belowBar', color: '#c9d1e0', shape: 'arrowUp', text: f(lo.low, 2) });
    mk.sort(function (a, b) { return a.time - b.time; });
    candles.setMarkers(mk);
    var w = (S.st && S.st.window) || {};
    if (openLine) { candles.removePriceLine(openLine); openLine = null; }
    if (num(w.open_btc) !== null) openLine = candles.createPriceLine({ price: num(w.open_btc), color: '#3088f8', lineWidth: 1, lineStyle: LC.LineStyle.Dotted, axisLabelVisible: true, title: '5m open' });
    setText('chartTag', 'BTCUSDT · Binance spot · ' + S.tf + ' · ' + cs.length + ' bars · times PT');
  }
  function loadChart(fit) {
    if (!FEEDS) return Promise.resolve();
    return FEEDS.candles(S.tf).then(function (cs) { drawChart(cs); if (fit) chart.timeScale().fitContent(); })
      .catch(function (e) { setText('chartTag', 'BTC chart unavailable (' + e.message + ')'); });
  }

  // ---------------------------------------------------------------- watchlist + header
  function wlItem(sym, name, price, chg, chgCls, sel, onclick) {
    var d = el('div', 'wl-item' + (sel ? ' sel' : ''));
    d.appendChild(el('div', 'sym', sym)); d.appendChild(el('div', 'px', price));
    d.appendChild(el('div', 'nm', name)); d.appendChild(el('div', 'ch ' + (chgCls || 'muted'), chg));
    if (onclick) { d.addEventListener('click', onclick); d.setAttribute('role', 'button'); d.tabIndex = 0; }
    return d;
  }
  function midChange(key, v) {
    v = num(v); if (v === null) return null;
    var slug = (S.st && S.st.slug) || '';
    if (!S.firstMid[key] || S.firstMid[key].slug !== slug) S.firstMid[key] = { slug: slug, v: v };
    return v - S.firstMid[key].v;
  }
  function paintWatchlist() {
    var st = S.st || {}, a = A(), t = S.t24, box = $('wlList');
    box.textContent = '';
    box.appendChild(wlItem('BTCUSDT', 'Bitcoin spot · Binance', t ? f(t.last, 2) : f(st.last_price, 2),
      t ? sgn(t.change_pct, 2) + '% 24h' : '—', t ? cls(t.change_pct) : 'muted', false, null));
    var cu = midChange('up', st.mid_up), cd = midChange('down', st.mid_down);
    box.appendChild(wlItem('BTC Up · 5m', 'Polymarket · ' + (st.slug || '—'), f(st.mid_up, 3), cu === null ? '—' : sgn(cu, 3) + ' since load', cls(cu), S.side === 'up', function () { S.side = 'up'; paintAll(); }));
    box.appendChild(wlItem('BTC Down · 5m', 'Polymarket · same window', f(st.mid_down, 3), cd === null ? '—' : sgn(cd, 3) + ' since load', cls(cd), S.side === 'down', function () { S.side = 'down'; paintAll(); }));
    (a.related_markets || []).forEach(function (r) {
      box.appendChild(wlItem('BTC Up · 15m', 'Polymarket · ' + (r.slug || ''), f(r.mid_up, 3), r.gap === null || r.gap === undefined ? '—' : 'gap ' + sgn(r.gap, 3), cls(r.gap), false, null));
    });
  }
  function timeLeft() {
    var a = A();
    if (num(a.window_end_ms) !== null) return Math.max(0, (num(a.window_end_ms) - Date.now()) / 1000);
    return num(a.time_remaining_sec);
  }
  function paintHeader() {
    var st = S.st || {}, a = A(), t = S.t24 || {}, w = st.window || {};
    setText('qSym', 'BTC Up or Down · 5 min');
    setText('qName', st.question || st.slug || '');
    var last = num(t.last) !== null ? t.last : st.last_price, open = num(w.open_btc);
    setText('qLast', f(last, 2));
    var ch = (open !== null && num(last) !== null) ? num(last) - open : null;
    setText('qChg', ch === null ? '—' : sgn(ch, 2) + ' (' + sgn(100 * ch / open, 3) + '%) vs 5m open', 'chg ' + cls(ch));
    setText('qSub', 'BTCUSDT spot · window ' + (st.slug || '—') + ' · last tick ' + (st.last_tick_pt || '—'));
    setText('qHigh', f(t.high, 2)); setText('qLow', f(t.low, 2)); setText('qVol', big(t.volume) + ' BTC');
    setText('qOpen', f(open, 2)); setText('qPrev', f(t.prev_close, 2));
    setText('qUp', f(st.mid_up, 3)); setText('qDown', f(st.mid_down, 3)); setText('qFair', f(a.fair_up, 3));
    setText('qEdge', sgn(a.edge_up, 3), cls(a.edge_up)); setText('qLeft', mmss(timeLeft()));
    var b = $('srcBadge'); b.textContent = S.source || '—';
    b.className = 'badge' + (/SNAPSHOT/.test(S.source) ? ' snap' : /local/.test(S.source) ? ' local' : '');
  }

  // ---------------------------------------------------------------- order book (Polymarket CLOB, Up or Down token)
  function lastBook() {
    var a = A();
    if (a.public_book) return a.public_book;
    var ev = ((S.jr && S.jr.events) || []).filter(function (e) { return e && e.event === 'BOOK'; });
    return ev.length ? ev[ev.length - 1] : null;
  }
  function paintBook() {
    var b = lastBook(), side = b && b[S.side], box = $('obRows');
    box.textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('#bookSide button'), function (x) { x.classList.toggle('on', x.getAttribute('data-side') === S.side); });
    var bids = (side && side.bids) || [], asks = (side && side.asks) || [];
    var n = Math.min(15, Math.max(bids.length, asks.length)), mx = 0;
    // depth bar width = size / max size in view (spec §5); bids grow left from centre, asks right
    for (var j = 0; j < n; j++) mx = Math.max(mx, (bids[j] && num(bids[j].size)) || 0, (asks[j] && num(asks[j].size)) || 0);
    mx = mx || 1;
    for (var i = 0; i < n; i++) {
      var bi = bids[i], ai = asks[i], r = el('div', 'ob-row'), bb = el('div', 'bb'), ab = el('div', 'ab');
      bb.style.width = (bi ? 50 * (num(bi.size) || 0) / mx : 0) + '%';  // CSSOM, not a style attribute
      ab.style.width = (ai ? 50 * (num(ai.size) || 0) / mx : 0) + '%';
      r.appendChild(bb); r.appendChild(ab);
      r.appendChild(el('span', '', bi ? big(bi.size) : ''));
      r.appendChild(el('span', 'b' + (i === 0 ? ' best' : ''), bi ? f(bi.price, 3) : ''));
      r.appendChild(el('span', 'a' + (i === 0 ? ' best' : ''), ai ? f(ai.price, 3) : ''));
      r.appendChild(el('span', '', ai ? big(ai.size) : ''));
      box.appendChild(r);
    }
    setText('obCnt', String(n), 'cnt');
    if (!n) box.appendChild(el('div', 'empty', 'Order book data is not available right now (public CLOB).'));
    var bb0 = bids[0] ? num(bids[0].price) : null, ba0 = asks[0] ? num(asks[0].price) : null;
    setText('spread', (S.side === 'up' ? 'Up' : 'Down') + ' token · spread ' + (bb0 !== null && ba0 !== null ? f(ba0 - bb0, 3) : '—') + ' · mid ' + f(side && side.mid, 3));
    setText('bookSrc', b ? 'Polymarket CLOB · ' + (b.ts_pt || '') : '');
  }

  // ---------------------------------------------------------------- live trades (BTCUSDT spot, Binance)
  function loadTrades() {
    if (!FEEDS) return Promise.resolve();
    return FEEDS.trades(40).then(function (ts) {
      var box = $('tsRows'), seen = S.lastTrade || 0; box.textContent = '';
      ts.forEach(function (t) {
        var r = el('div', 'ts-row ' + t.side + (seen && t.ts_ms > seen ? ' new' : ''));
        r.appendChild(el('span', '', hmsPT(t.ts_ms)));
        r.appendChild(el('span', '', f(t.price, 2)));
        r.appendChild(el('span', '', t.size >= 1 ? f(t.size, 3) : f(t.size, 5)));
        r.appendChild(el('span', 'sd', t.side === 'up' ? '↑' : t.side === 'down' ? '↓' : '—'));
        box.appendChild(r);
      });
      if (ts.length) S.lastTrade = ts[0].ts_ms;
      stamp();
      setText('tsSrc', 'BTCUSDT · tick vs prev');
    }).catch(function (e) { setText('tsSrc', 'trades unavailable (' + e.message + ')'); });
  }

  // ---------------------------------------------------------------- analysis panels (below)
  function kv(parent, k, v, c) { var d = el('div', 'kv'); d.appendChild(el('span', '', k)); d.appendChild(el('b', c || '', v)); parent.appendChild(d); }
  function bar(parent, v, scale) {
    var b = el('div', 'bar'), i = el('i', num(v) !== null && v < 0 ? 'neg' : '');
    var w = Math.min(50, Math.abs(num(v) || 0) / scale * 50);
    i.style.width = w + '%'; if (num(v) !== null && v < 0) i.style.left = (50 - w) + '%';
    b.appendChild(i); parent.appendChild(b);
  }
  function card(title, wide) { var c = el('div', 'card' + (wide ? ' wide' : '')); c.appendChild(el('h3', '', title)); $('an').appendChild(c); return c; }
  function paintAnalysis() {
    var st = S.st || {}, a = A(), intel = S.intel || {};
    $('an').textContent = '';
    var c = card('Fair vs mid (5m window)');
    kv(c, 'Fair Up / Down', f(a.fair_up, 3) + ' / ' + f(a.fair_down, 3));
    kv(c, 'Mid Up / Down', f(a.mid_up, 3) + ' / ' + f(a.mid_down, 3));
    kv(c, 'Edge Up (fair − mid)', sgn(a.edge_up, 3), cls(a.edge_up)); bar(c, a.edge_up, 0.15);
    kv(c, 'Edge Down', sgn(a.edge_down, 3), cls(a.edge_down)); bar(c, a.edge_down, 0.15);
    c.appendChild(el('div', 'tiny muted', 'Training distance-to-open model; not a quote and not an order.'));
    c = card('Regime');
    kv(c, 'Time left', mmss(timeLeft())); kv(c, 'Time pressure', f(a.time_pressure, 2));
    kv(c, 'Volatility', a.vol_regime || '—'); kv(c, 'Momentum', a.momentum_regime || '—');
    kv(c, 'Book imbalance (Up vs Down bids)', sgn(a.book_imbalance, 2), cls(a.book_imbalance)); bar(c, a.book_imbalance, 1);
    kv(c, 'Ask depth Up / Down', big(a.ask_depth_up) + ' / ' + big(a.ask_depth_down));
    c = card('15-minute sibling');
    var rel = a.related_markets || [];
    if (!rel.length) c.appendChild(el('div', 'muted', 'No 15m market found for this window.'));
    rel.forEach(function (r) { kv(c, 'Slug', r.slug || '—'); kv(c, 'Mid Up', f(r.mid_up, 3)); kv(c, 'Fair Up', f(r.fair_up, 3)); kv(c, 'Gap', sgn(r.gap, 3), cls(r.gap)); });
    c = card('Session (local only)');
    kv(c, 'Bankroll', usd(st.bankroll)); kv(c, 'Realized PnL', usd(st.realized_pnl), cls(st.realized_pnl));
    kv(c, 'Daily PnL', usd(st.daily_pnl), cls(st.daily_pnl)); kv(c, 'Fills', st.fills === null || st.fills === undefined ? '—' : String(st.fills));
    kv(c, 'Windows W / L', (st.windows_won === null || st.windows_won === undefined) ? '—' : st.windows_won + ' / ' + st.windows_lost);
    kv(c, 'Halted', st.halted ? 'yes' + (st.halt_reason ? ' (' + st.halt_reason + ')' : '') : 'no');
    c.appendChild(el('div', 'tiny muted', st.bankroll === null || st.bankroll === undefined ? 'No local session: PnL, fills and bankroll stay blank.' : 'From the local paper session.'));
    if (intel && (intel.grade || intel.win_rate !== undefined)) {
      c = card('Strategy intel');
      kv(c, 'Grade', intel.grade || '—'); kv(c, 'Win rate', num(intel.win_rate) === null ? '—' : (100 * intel.win_rate).toFixed(1) + '%');
      kv(c, 'Settled windows', String(intel.windows_settled === undefined ? '—' : intel.windows_settled)); kv(c, 'Max drawdown', usd(intel.max_drawdown));
    }
    c = card('Why (' + (a.action || 'WATCH') + ' · ' + (a.structure || '—') + ')');
    var ul = el('ul'); (a.reasons || [st.last_reason || 'no reasons']).forEach(function (r) { ul.appendChild(el('li', '', String(r))); }); c.appendChild(ul);
    c = card('Recent ticks (PT)', true);
    var tbl = el('table', 'tbl'), hr = el('tr');
    ['Time', 'Event', 'Mid Up', 'Fair Up', 'Edge Up', 'Left'].forEach(function (h) { hr.appendChild(el('th', '', h)); });
    var thead = el('thead'); thead.appendChild(hr); tbl.appendChild(thead);
    var tb = el('tbody');
    ((S.jr && S.jr.events) || []).filter(function (e) { return e && e.event !== 'BOOK'; }).slice(-10).reverse().forEach(function (e) {
      var tr = el('tr');
      [String(e.ts_pt || '').replace(/^\d{4}-\d{2}-\d{2} /, '').replace(/^.*?, /, ''), e.event || '', f(e.mid_up, 3), f(e.fair_up, 3), sgn(e.edge_up, 3), mmss(e.remaining_sec)].forEach(function (v, i) {
        tr.appendChild(el('td', i === 4 ? cls(e.edge_up) : '', v));
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); c.appendChild(tbl);
    setText('disclaimer', st.disclaimer || 'Not financial advice. No profit guarantee. This page does not place orders.');
  }
  function paintAll() { paintHeader(); paintWatchlist(); paintBook(); paintAnalysis(); }

  // ---------------------------------------------------------------- data sources (unchanged order)
  function loadSnapshot() {
    var base = location.pathname.replace(/[^/]*$/, '');
    return fetch(base + 'data.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('data.json ' + r.status);
      return r.json();
    }).then(function (snap) {
      var st = Object.assign({}, snap.state || snap.st || {});
      st.mode = 'SNAPSHOT'; st.live_polymarket = false; st.live_armed = false;
      var note = 'SNAPSHOT — not live. Not financial advice. No profit guarantee. This page does not place orders.';
      st.disclaimer = note + (st.disclaimer ? (' ' + st.disclaimer) : '');
      return { st: st, jr: snap.journal || snap.jr || { events: [] }, an: snap.analysis || snap.an || {}, intel: snap.intel || {} };
    });
  }
  function getJson(url, signal) { return fetch(url, { cache: 'no-store', signal: signal }); }
  function loadLocal() {
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 2500);
    var soft = function (p) { return p.catch(function () { return { ok: false }; }); };
    return Promise.all([getJson('/api/state', ctrl.signal), getJson('/api/journal', ctrl.signal), soft(getJson('/api/analysis', ctrl.signal)), soft(getJson('/api/intel', ctrl.signal))])
      .then(function (p) {
        clearTimeout(timer);
        if (!p[0].ok) throw new Error('api/state ' + p[0].status);
        return Promise.all([p[0].json(), p[1].ok ? p[1].json() : { events: [] }, p[2].ok ? p[2].json() : {}, p[3].ok ? p[3].json() : {}]);
      }, function (e) { clearTimeout(timer); throw e; })
      .then(function (v) { if (!v[0] || v[0].error) throw new Error((v[0] && v[0].error) || 'empty state'); return { st: v[0], jr: v[1], an: v[2], intel: v[3] }; });
  }
  function use(d, label) { S.st = d.st; S.jr = d.jr; S.an = d.an; S.intel = d.intel; S.source = label; paintAll(); stamp(); }
  // read-only status strip in the slot Webull uses for Trade (spec §6.1)
  function stamp() { setText('asOf', PTF.clock.format(new Date())); }
  function refresh() {
    var t24 = FEEDS ? FEEDS.ticker24h().then(function (t) { S.t24 = t; }).catch(function () { S.t24 = null; }) : Promise.resolve();
    var data = loadLocal().then(function (d) { use(d, 'local /api'); }).catch(function () {
      if (typeof window.fetchLivePublic !== 'function') throw new Error('live fetch missing');
      return window.fetchLivePublic().then(function (d) { use(d, 'LIVE PUBLIC (read-only)'); });
    }).catch(function () {
      return loadSnapshot().then(function (d) { use(d, 'SNAPSHOT (not live)'); });
    }).catch(function () {
      setText('disclaimer', 'API unreachable and public feeds failed. Not financial advice. No profit guarantee. This page does not place orders.');
    });
    return Promise.all([t24, data]).then(function () { if (S.st) paintHeader(); paintWatchlist(); });
  }

  Array.prototype.forEach.call(document.querySelectorAll('#tf button'), function (b) {
    b.addEventListener('click', function () {
      S.tf = b.getAttribute('data-tf');
      Array.prototype.forEach.call(document.querySelectorAll('#tf button'), function (x) { x.classList.toggle('on', x === b); });
      loadChart(true);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#bookSide button'), function (b) {
    b.addEventListener('click', function () { S.side = b.getAttribute('data-side'); paintAll(); });
  });
  // iPad portrait / phone: watchlist drawer, pane tabs, collapsed Details (spec §4)
  var wlEl = $('wl'), scrim = $('scrim');
  function drawer(open) { wlEl.classList.toggle('open', open); scrim.classList.toggle('open', open); $('drawerBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); }
  $('drawerBtn').addEventListener('click', function () { drawer(!wlEl.classList.contains('open')); });
  scrim.addEventListener('click', function () { drawer(false); });
  wlEl.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.wl-item[role=button]')) drawer(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') drawer(false); });
  Array.prototype.forEach.call(document.querySelectorAll('#paneSeg button'), function (b) {
    b.addEventListener('click', function () {
      $('shell').setAttribute('data-pane', b.getAttribute('data-pane'));
      Array.prototype.forEach.call(document.querySelectorAll('#paneSeg button'), function (x) { x.classList.toggle('on', x === b); });
    });
  });
  if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) $('qdet').removeAttribute('open');
  function tick() { setText('clock', PTF.clock.format(new Date()) + ' PT'); setText('qLeft', mmss(timeLeft())); }
  tick(); setInterval(tick, 1000);
  var rb = $('refreshBtn'); if (rb) rb.addEventListener('click', function () { refresh(); loadChart(false); loadTrades(); });
  refresh().then(function () { return loadChart(true); });
  loadTrades();
  setInterval(refresh, 8000);
  setInterval(function () { loadChart(false); }, 15000);
  setInterval(loadTrades, 5000);
  if ('serviceWorker' in navigator && document.body.getAttribute('data-sw') === '1') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
