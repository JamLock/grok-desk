/* Grok Desk header view-model. Pure functions, no DOM, so they can be tested under node.
   Rule (redesign-1018b D1): live and snapshot values are never mixed. In SNAPSHOT mode the
   header shows only snapshot values stamped with the snapshot's own capture time (or a dash);
   the live Binance 24h ticker is ignored. Times in PT. */
(function (root) {
  'use strict';
  function num(v) { var n = (v === null || v === undefined || v === '') ? NaN : Number(v); return isFinite(n) ? n : null; }
  function f(v, d) { v = num(v); return v === null ? '—' : v.toFixed(d); }
  function sgn(v, d) { v = num(v); return v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d); }
  function big(v) { v = num(v); if (v === null) return '—'; return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K' : v.toFixed(2); }
  function cls(v) { v = num(v); return v === null || v === 0 ? '' : (v > 0 ? 'pos' : 'neg'); }
  var PT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true });
  var PT_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' });
  var PT_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  function isSnapshot(source, st) { return /SNAPSHOT/.test(source || '') || (st && st.mode === 'SNAPSHOT'); }

  // "Bitcoin Up or Down - September 10, 2:25AM-2:30AM ET" -> "Bitcoin Up or Down - September 9, 11:25PM–11:30PM PT"
  // using the window's own start/end ms; a title we cannot convert loses its ET clause (never shown in ET).
  function ptTitle(q, startMs, endMs) {
    q = String(q || '');
    var m = /^(.*?)\s+-\s+[A-Z][a-z]+ \d{1,2},\s*\d{1,2}(:\d{2})?\s*[AP]M\s*[-–]\s*\d{1,2}(:\d{2})?\s*[AP]M\s+ET\s*$/.exec(q);
    if (!m) return q.replace(/\s+ET\s*$/, '');
    var s = num(startMs), e = num(endMs);
    if (s === null || e === null) return m[1];
    var t = function (ms) { return PT_TIME.format(new Date(ms)).replace(/\s/g, ''); };
    return m[1] + ' - ' + PT_DAY.format(new Date(s)) + ', ' + t(s) + '–' + t(e) + ' PT';
  }

  // window start/end ms: state.window, else the slug "btc-updown-5m-<epoch s>" (live public state has no window ms)
  function windowMs(st) {
    var w = (st && st.window) || {}, s = num(w.start_ms), e = num(w.end_ms);
    var m = /-(\d+)m-(\d{9,11})$/.exec(String((st && st.slug) || w.slug || ''));
    if (s === null && m) s = Number(m[2]) * 1000;
    if (e === null && s !== null && m) e = s + Number(m[1]) * 60000;
    return { s: s, e: e };
  }

  // st = state, t24 = live Binance 24h ticker (or null), source = S.source, snap = {captured_pt} for snapshots
  function header(st, t24, source, snap) {
    st = st || {}; var w = st.window || {}, snapMode = isSnapshot(source, st), t = snapMode ? {} : (t24 || {});
    var last = snapMode ? num(st.last_price) : (num(t.last) !== null ? num(t.last) : num(st.last_price));
    var open = num(w.open_btc);
    var ch = (open !== null && last !== null) ? last - open : null;
    var capt = (snap && snap.captured_pt) || st.last_tick_pt || null;
    var win = windowMs(st);
    return {
      snapshot: snapMode,
      title: ptTitle(st.question || st.slug || '', win.s, win.e),
      last: f(last, 2),
      chg: ch === null ? '—' : sgn(ch, 2) + ' (' + sgn(100 * ch / open, 3) + '%) vs 5m open' + (snapMode ? ' (snapshot)' : ''),
      chgCls: 'chg ' + cls(ch),
      sub: (snapMode ? 'SNAPSHOT (not live) · ' : 'BTCUSDT spot · ') + 'window ' + (st.slug || '—') + ' · last tick ' + (st.last_tick_pt || '—'),
      high: f(t.high, 2), low: f(t.low, 2), vol: snapMode ? '—' : big(t.volume) + ' BTC', prev: f(t.prev_close, 2),
      open: f(open, 2),
      // status strip: snapshot -> its own capture time, never "now"
      asOf: snapMode ? (capt ? 'snapshot ' + String(capt).replace(/ P[DS]T$/, '') : 'snapshot (time unknown)') : PT_CLOCK.format(new Date())
    };
  }

  // review-1019 D1a: data.json carries blocks captured at different times (state + journal at the snapshot,
  // analysis/intel from a later run). In snapshot mode only blocks from the snapshot itself are used: a block
  // stamped after the snapshot's last tick, or for another window, is dropped. When the analysis block is
  // dropped, an analysis is built from the snapshot state alone (fields it lacks stay blank -> '—').
  // There is no countdown: the time left is the snapshot's own value, labelled as such.
  function blockTs(b) { return b ? num(b.ts_ms) : null; }
  function fromSnapshot(b, st, needSlug) {
    if (!b || typeof b !== 'object') return false;
    var cut = num(st.last_tick_ms), t = blockTs(b);
    if (cut !== null && t !== null && t > cut + 1000) return false;      // captured after the snapshot
    if (needSlug && b.slug && st.slug && b.slug !== st.slug) return false;  // another market window
    return true;
  }
  function snapshotData(snap) {
    snap = snap || {};
    var st = Object.assign({}, snap.state || snap.st || {}), raw = snap.analysis || snap.an || {};
    var a = raw.analysis || null, w = st.window || {}, dropped = [];
    if (!fromSnapshot(a, st, true)) {
      if (a) dropped.push('analysis ' + (a.ts_pt || a.slug || ''));
      a = { slug: st.slug, mid_up: st.mid_up, mid_down: st.mid_down, fair_up: st.fair_up, fair_down: st.fair_down,
            edge_up: st.edge_up, edge_down: st.edge_down, reasons: st.last_reason ? [st.last_reason] : [], related_markets: [] };
    }
    var e = num(w.end_ms), lt = num(st.last_tick_ms);
    a = Object.assign({}, a);
    a.snapshot_time_left_sec = (e !== null && lt !== null) ? Math.max(0, (e - lt) / 1000) : null;
    delete a.window_end_ms; delete a.time_remaining_sec;               // never a live countdown in snapshot mode
    if (st.analysis && !fromSnapshot(st.analysis, st, true)) { dropped.push('state.analysis ' + (st.analysis.ts_pt || '')); }
    delete st.analysis;
    var intel = snap.intel || raw.intel || st.intel || null;
    if (intel && !fromSnapshot(intel, st, false)) { dropped.push('intel ' + (intel.ts_pt || '')); intel = null; }
    if (st.intel && !fromSnapshot(st.intel, st, false)) delete st.intel;
    if (st.meta && typeof st.meta === 'object') {                     // state.meta nests the same later blocks
      st.meta = Object.assign({}, st.meta);
      if (st.meta.analysis && !fromSnapshot(st.meta.analysis, st, true)) delete st.meta.analysis;
      if (st.meta.intel && !fromSnapshot(st.meta.intel, st, false)) delete st.meta.intel;
    }
    return { st: st, an: { analysis: a }, intel: intel || {}, jr: snap.journal || snap.jr || { events: [] },
             snap: { captured_pt: snap.captured_pt || st.last_tick_pt || null, dropped: dropped } };
  }
  // short PT capture label for snapshot captions: "2026-09-09 23:29:30 PT"
  function snapLabel(snap) { var c = snap && snap.captured_pt; return c ? String(c).replace(/ P[DS]T$/, '') + ' PT' : 'unknown time'; }

  var api = { header: header, ptTitle: ptTitle, isSnapshot: isSnapshot, snapshotData: snapshotData, snapLabel: snapLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeskView = api;
})(typeof window !== 'undefined' ? window : this);
