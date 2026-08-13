/* Animazing — core utilities (browser + node) */
(function (AZ) {
  'use strict';

  var _uidCounter = 0;

  function uid(prefix) {
    _uidCounter += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + _uidCounter.toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  /* Deterministic seeded RNG (mulberry32). */
  function makeRng(seed) {
    var s = (typeof seed === 'number' ? seed : hashString(String(seed || Math.random()))) >>> 0;
    function next() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (n) { return Math.floor(next() * n); },
      range: function (a, b) { return a + Math.floor(next() * (b - a + 1)); },
      chance: function (p) { return next() < p; },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
      },
      weighted: function (items, weightFn) {
        var total = 0, i;
        for (i = 0; i < items.length; i++) total += weightFn(items[i]);
        if (total <= 0) return items[0];
        var roll = next() * total;
        for (i = 0; i < items.length; i++) {
          roll -= weightFn(items[i]);
          if (roll <= 0) return items[i];
        }
        return items[items.length - 1];
      }
    };
  }

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function deepClone(obj) {
    if (obj === undefined || obj === null) return obj;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(obj); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(obj));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function sum(arr, fn) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += fn ? fn(arr[i]) : arr[i];
    return t;
  }

  function countBy(arr, fn) {
    var out = {};
    arr.forEach(function (x) { var k = fn(x); out[k] = (out[k] || 0) + 1; });
    return out;
  }

  function slug(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'entry';
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  AZ.util = {
    uid: uid,
    rng: makeRng,
    hashString: hashString,
    clamp: clamp,
    deepClone: deepClone,
    esc: esc,
    fmt: fmt,
    sum: sum,
    countBy: countBy,
    slug: slug,
    debounce: debounce
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));
