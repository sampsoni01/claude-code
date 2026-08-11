/* STRATEGIAN — utilities: RNG, math, formatting, DOM, charts */
window.S = window.S || {};
(function (S) {
  'use strict';

  /* ---------------------------------------------------------------- RNG -- */
  // mulberry32 — deterministic, serialisable in a save file.
  S.makeRng = function (seed) {
    let a = seed >>> 0;
    const rng = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.state = () => a >>> 0;
    rng.setState = (s) => { a = s >>> 0; };
    rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    rng.range = (lo, hi) => lo + rng() * (hi - lo);
    // Approximately normal via sum of uniforms (Irwin–Hall, n=3).
    rng.normal = (mean, sd) => {
      const u = rng() + rng() + rng() - 1.5;
      return mean + u * sd * 1.4142;
    };
    rng.chance = (p) => rng() < p;
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    rng.shuffle = (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    };
    rng.weighted = (items, weightOf) => {
      let total = 0;
      for (const it of items) total += Math.max(0, weightOf(it));
      if (total <= 0) return null;
      let r = rng() * total;
      for (const it of items) {
        r -= Math.max(0, weightOf(it));
        if (r <= 0) return it;
      }
      return items[items.length - 1];
    };
    return rng;
  };

  /* --------------------------------------------------------------- math -- */
  S.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  S.lerp = (a, b, t) => a + (b - a) * t;
  S.inv = (v) => 100 - v;
  // Pulls a value toward a target by a fraction — the workhorse of the sim.
  S.drift = (v, target, rate) => v + (target - v) * rate;
  S.round = (v, d) => { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; };
  S.sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  S.avg = (arr, f) => (arr.length ? S.sum(arr, f) / arr.length : 0);
  // Smooth 0..1 response curve; used for saturating effects (diminishing returns).
  S.sat = (x, half) => x / (x + half);
  S.mean = S.avg;

  /* --------------------------------------------------------- formatting -- */
  S.fmtScaled = function (v, sym) {
    sym = sym == null ? '' : sym;
    const n = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (n >= 1e6) return sign + sym + (n / 1e6).toFixed(2) + 'Qa';
    if (n >= 1e3) return sign + sym + (n / 1e3).toFixed(2) + 'T';
    if (n >= 1) return sign + sym + n.toFixed(n >= 100 ? 0 : 1) + 'B';
    return sign + sym + (n * 1000).toFixed(0) + 'M';
  };
  // Money values in the sim are stored in billions of the national unit.
  S.money = function (v) {
    const st = S.game && S.game.state;
    const sym = st ? st.economy.currencySymbol : '$';
    return S.fmtScaled(v, sym);
  };
  S.pct = (v, d) => (v >= 0 ? '' : '') + (v).toFixed(d == null ? 1 : d) + '%';
  S.signed = (v, d) => (v > 0 ? '+' : '') + v.toFixed(d == null ? 1 : d);
  S.signedPct = (v, d) => (v > 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%';
  S.num = function (v, d) {
    return Number(v).toLocaleString('en-US', {
      minimumFractionDigits: d || 0, maximumFractionDigits: d || 0
    });
  };
  S.people = function (v) { // v in millions
    if (v >= 1000) return (v / 1000).toFixed(2) + 'bn';
    if (v >= 1) return v.toFixed(1) + 'm';
    return (v * 1000).toFixed(0) + 'k';
  };
  S.ordinal = function (n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* ------------------------------------------------------------- dates -- */
  S.MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  S.MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  S.DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  S.dateLabel = function (d) {
    return S.MONTHS_SHORT[d.month] + ' ' + d.day + ', ' + d.year;
  };
  S.dateLong = function (d) {
    return S.MONTHS[d.month] + ' ' + S.ordinal(d.day) + ', ' + d.year;
  };
  // Absolute day index — used for deadlines and elapsed-time maths.
  S.absDay = function (d) { return d.year * 365 + d.dayOfYear; };

  /* ---------------------------------------------------------------- DOM -- */
  S.el = function (tag, attrs, children) {
    const parts = tag.split(/([#.])/);
    const node = document.createElement(parts[0] || 'div');
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i] === '#') node.id = parts[i + 1];
      else node.classList.add(parts[i + 1]);
    }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className += (node.className ? ' ' : '') + v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'data' && typeof v === 'object') {
          for (const dk in v) node.dataset[dk] = v[dk];
        } else node.setAttribute(k, v === true ? '' : v);
      }
    }
    S.append(node, children);
    return node;
  };
  S.append = function (node, children) {
    if (children == null || children === false) return node;
    if (Array.isArray(children)) { children.forEach((c) => S.append(node, c)); return node; }
    if (children instanceof Node) node.appendChild(children);
    else node.appendChild(document.createTextNode(String(children)));
    return node;
  };
  S.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  S.qs = (sel, root) => (root || document).querySelector(sel);
  S.qsa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  S.esc = function (str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  };

  /* ------------------------------------------------------- object paths -- */
  S.getPath = function (obj, path) {
    const keys = path.split('.');
    let cur = obj;
    for (const k of keys) { if (cur == null) return undefined; cur = cur[k]; }
    return cur;
  };
  S.setPath = function (obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  };
  S.addPath = function (obj, path, delta) {
    const cur = S.getPath(obj, path);
    if (typeof cur === 'number') S.setPath(obj, path, cur + delta);
  };

  /* -------------------------------------------------------------- ring -- */
  // Fixed-length history buffer for charts.
  S.pushHistory = function (arr, value, cap) {
    arr.push(value);
    if (arr.length > (cap || 240)) arr.splice(0, arr.length - (cap || 240));
    return arr;
  };

  /* ------------------------------------------------------------ charts -- */
  function pathFrom(values, w, h, pad, min, max) {
    if (!values.length) return '';
    const span = (max - min) || 1;
    const n = values.length;
    const dx = n > 1 ? (w - pad * 2) / (n - 1) : 0;
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = pad + i * dx;
      const y = h - pad - ((values[i] - min) / span) * (h - pad * 2);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    return d.trim();
  }

  S.sparkline = function (values, opts) {
    opts = opts || {};
    const w = opts.w || 120, h = opts.h || 30, pad = 2;
    if (!values || values.length < 2) return '<svg class="spark" width="' + w + '" height="' + h + '"></svg>';
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const d = pathFrom(values, w, h, pad, min, max);
    const up = values[values.length - 1] >= values[0];
    const cls = opts.color || (opts.invert ? (up ? 'bad' : 'good') : (up ? 'good' : 'bad'));
    const last = values[values.length - 1];
    const span = (max - min) || 1;
    const cy = h - pad - ((last - min) / span) * (h - pad * 2);
    const cx = w - pad;
    return '<svg class="spark spark-' + cls + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="1.9" fill="currentColor"/></svg>';
  };

  // Multi-series line chart with axes and a light grid.
  S.lineChart = function (series, opts) {
    opts = opts || {};
    const w = opts.w || 620, h = opts.h || 200, padL = 46, padR = 12, padT = 12, padB = 22;
    const all = [];
    series.forEach((s) => { all.push.apply(all, s.values); });
    if (!all.length) return '<div class="chart-empty">No data yet.</div>';
    let min = opts.min != null ? opts.min : Math.min.apply(null, all);
    let max = opts.max != null ? opts.max : Math.max.apply(null, all);
    if (opts.zero) min = Math.min(min, 0);
    if (max - min < 1e-6) { max = min + 1; }
    const padSpan = (max - min) * 0.1;
    min -= padSpan; max += padSpan;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const xOf = (i, n) => padL + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
    const yOf = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;

    let g = '';
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = min + (max - min) * (t / ticks);
      const y = yOf(v);
      g += '<line class="grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '"/>';
      g += '<text class="axis" x="' + (padL - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' +
        (opts.fmt ? opts.fmt(v) : S.round(v, Math.abs(max) < 10 ? 1 : 0)) + '</text>';
    }
    if (min < 0 && max > 0) {
      g += '<line class="zeroline" x1="' + padL + '" y1="' + yOf(0).toFixed(1) + '" x2="' + (w - padR) + '" y2="' + yOf(0).toFixed(1) + '"/>';
    }
    let lines = '';
    series.forEach((s) => {
      const n = s.values.length;
      let d = '';
      for (let i = 0; i < n; i++) {
        d += (i ? 'L' : 'M') + xOf(i, n).toFixed(1) + ' ' + yOf(s.values[i]).toFixed(1) + ' ';
      }
      if (s.fill) {
        const area = d + 'L' + xOf(n - 1, n).toFixed(1) + ' ' + yOf(Math.max(min, 0)).toFixed(1) +
          ' L' + xOf(0, n).toFixed(1) + ' ' + yOf(Math.max(min, 0)).toFixed(1) + ' Z';
        lines += '<path class="area c-' + (s.color || 'gold') + '" d="' + area + '"/>';
      }
      lines += '<path class="line c-' + (s.color || 'gold') + '" d="' + d.trim() + '" fill="none"' +
        (s.dash ? ' stroke-dasharray="4 3"' : '') + '/>';
    });
    let legend = '';
    if (series.length > 1 || opts.legend) {
      legend = '<div class="chart-legend">' + series.map((s) =>
        '<span class="lg c-' + (s.color || 'gold') + '"><i></i>' + S.esc(s.label || '') + '</span>').join('') + '</div>';
    }
    let xl = '';
    if (opts.xLabels && opts.xLabels.length) {
      const n = series[0].values.length;
      opts.xLabels.forEach((lb) => {
        xl += '<text class="axis" x="' + xOf(lb.i, n).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle">' + S.esc(lb.t) + '</text>';
      });
    }
    // No preserveAspectRatio override: stretching the viewBox would distort
    // the axis type along with the plot.
    return '<div class="chart">' + legend +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" class="chart-svg">' +
      g + lines + xl + '</svg></div>';
  };

  S.barRow = function (label, value, max, color, valueText) {
    const p = S.clamp((value / (max || 100)) * 100, 0, 100);
    return '<div class="barrow"><span class="barrow-l">' + S.esc(label) + '</span>' +
      '<span class="barrow-t"><i class="bar-fill c-' + (color || 'gold') + '" style="width:' + p.toFixed(1) + '%"></i></span>' +
      '<span class="barrow-v">' + S.esc(valueText != null ? valueText : S.round(value, 1)) + '</span></div>';
  };

  // Horizontal diverging bar for -100..100 scales (relations, war score).
  S.divergeBar = function (value, opts) {
    opts = opts || {};
    const v = S.clamp(value, -100, 100);
    const half = Math.abs(v) / 2; // percent of full width
    const cls = v >= 0 ? (opts.invert ? 'bad' : 'good') : (opts.invert ? 'good' : 'bad');
    const left = v >= 0 ? 50 : 50 - half;
    return '<span class="dbar"><i class="dbar-mid"></i>' +
      '<i class="dbar-fill c-' + cls + '" style="left:' + left + '%;width:' + half + '%"></i></span>';
  };

  S.meter = function (value, opts) {
    opts = opts || {};
    const v = S.clamp(value, 0, 100);
    let cls = opts.color;
    if (!cls) {
      const good = opts.invert ? v < 35 : v > 65;
      const bad = opts.invert ? v > 65 : v < 35;
      cls = good ? 'good' : bad ? 'bad' : 'warn';
    }
    return '<span class="meter"><i class="c-' + cls + '" style="width:' + v.toFixed(1) + '%"></i></span>';
  };

  /* --------------------------------------------------------- misc utils -- */
  S.trendOf = function (arr, look) {
    if (!arr || arr.length < 2) return 0;
    const n = Math.min(look || 12, arr.length);
    return arr[arr.length - 1] - arr[arr.length - n];
  };
  S.arrow = function (delta, eps) {
    const e = eps == null ? 0.05 : eps;
    if (delta > e) return '<span class="tr up">▲</span>';
    if (delta < -e) return '<span class="tr dn">▼</span>';
    return '<span class="tr fl">—</span>';
  };
  S.rateWord = function (v, words) {
    // words: ascending list of 5 labels for 0-20,20-40,40-60,60-80,80-100
    return words[S.clamp(Math.floor(v / 20), 0, 4)];
  };
  S.titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  S.uid = function (prefix) {
    S._uidN = (S._uidN || 0) + 1;
    return (prefix || 'id') + '_' + S._uidN.toString(36);
  };
  S.deepClone = (o) => JSON.parse(JSON.stringify(o));

})(window.S);
