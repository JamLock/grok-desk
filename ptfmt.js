/* PT (America/Los_Angeles, DST-aware) formatters for lightweight-charts. Loaded before the page script;
   also require()-able from node for tests. Chart times are UTC epoch seconds. */
(function (root) {
  'use strict';
  var TZ = 'America/Los_Angeles';
  var F = {
    year: new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric' }),
    month: new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', year: '2-digit' }),
    day: new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }),
    time: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    secs: new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
    full: new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
  };
  function toDate(t) {
    if (typeof t === 'number') return new Date(t * 1000);
    if (typeof t === 'string') return new Date(t + 'T00:00:00Z');
    if (t && typeof t === 'object' && 'year' in t) return new Date(Date.UTC(t.year, t.month - 1, t.day));
    return new Date(NaN);
  }
  // lightweight-charts TickMarkType: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds
  var U = {  // calendar dates (business-day objects / 'YYYY-MM-DD') have no time zone: format as-is
    year: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric' }),
    month: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' }),
    day: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  };
  function tickMark(time, type) {
    var d = toDate(time);
    if (typeof time !== 'number') return (type === 0 ? U.year : type === 1 ? U.month : U.day).format(d);
    switch (type) {
      case 0: return F.year.format(d);
      case 1: return F.month.format(d);
      case 2: return F.day.format(d);
      case 3: return F.time.format(d);
      case 4: return F.secs.format(d);
      default: return F.secs.format(d);
    }
  }
  function crosshair(time) { return F.full.format(toDate(time)); }  // e.g. "Oct 14, 11:07:00 PDT"
  var api = { TZ: TZ, tickMark: tickMark, crosshair: crosshair };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PTFMT = api;
})(this);
