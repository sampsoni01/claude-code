/* Animazing — persistence layer.
   - Profile + custom content live in localStorage (JSON, versioned keys).
   - Uploaded art (PNG/JPG/WebP) lives in IndexedDB as data URLs, preloaded
     into an in-memory cache at boot so rendering stays synchronous.
   - Everything degrades to in-memory stores when the browser APIs are
     missing (Node tests, exotic file:// setups) — the game still runs,
     it just won't persist.
   - Content packs (characters/cards/items/enemies + their images) can be
     exported to a single JSON file and re-imported anywhere. */
(function (AZ) {
  'use strict';

  var PROFILE_KEY = 'animazing.profile.v1';
  var CONTENT_KEY = 'animazing.content.v1';
  var DB_NAME = 'animazing-media';
  var DB_STORE = 'images';

  /* ---------------- localStorage with memory fallback ---------------- */

  var mem = {};
  function lsGet(key) {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch (e) { /* blocked */ }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }
  function lsSet(key, val) {
    try {
      if (typeof localStorage !== 'undefined') { localStorage.setItem(key, val); return true; }
    } catch (e) { /* full or blocked */ }
    mem[key] = val;
    return false;
  }
  function lsRemove(key) {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch (e) { /* ignore */ }
    delete mem[key];
  }

  function loadJSON(key, fallback) {
    var raw = lsGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function saveJSON(key, obj) { return lsSet(key, JSON.stringify(obj)); }

  /* ---------------- IndexedDB media store ---------------- */

  var idbAvailable = typeof indexedDB !== 'undefined';
  var memMedia = {};              // fallback store
  var mediaCache = {};            // id -> dataUrl, always the sync source of truth for rendering
  var dbPromise = null;

  function openDb() {
    if (!idbAvailable) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }

  function putImage(id, dataUrl) {
    mediaCache[id] = dataUrl;
    return openDb().then(function (db) {
      if (!db) { memMedia[id] = dataUrl; return; }
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put({ id: id, dataUrl: dataUrl });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { memMedia[id] = dataUrl; resolve(); };
      });
    });
  }

  function deleteImage(id) {
    delete mediaCache[id];
    delete memMedia[id];
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    });
  }

  function preloadMedia() {
    return openDb().then(function (db) {
      if (!db) {
        Object.keys(memMedia).forEach(function (k) { mediaCache[k] = memMedia[k]; });
        return mediaCache;
      }
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).getAll();
        req.onsuccess = function () {
          (req.result || []).forEach(function (row) { mediaCache[row.id] = row.dataUrl; });
          resolve(mediaCache);
        };
        req.onerror = function () { resolve(mediaCache); };
      });
    });
  }

  function getImage(id) { return mediaCache[id] || null; }

  /* Read an uploaded File, downscale to keep saves lean, return a data URL. */
  function fileToDataUrl(file, maxDim) {
    maxDim = maxDim || 640;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read file.')); };
      reader.onload = function () {
        var src = reader.result;
        if (typeof document === 'undefined') { resolve(src); return; }
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          if (scale >= 1 && String(src).length < 900000) { resolve(src); return; }
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = function () { resolve(src); };
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- profile ---------------- */

  function loadProfile() { return loadJSON(PROFILE_KEY, null); }
  function saveProfile(profile) { return saveJSON(PROFILE_KEY, profile); }
  function clearProfile() { lsRemove(PROFILE_KEY); }

  /* ---------------- custom content ---------------- */

  function emptyContent() { return { v: 1, characters: [], cards: [], items: [], enemies: [] }; }
  function loadCustomContent() {
    var c = loadJSON(CONTENT_KEY, null) || emptyContent();
    ['characters', 'cards', 'items', 'enemies'].forEach(function (k) { if (!Array.isArray(c[k])) c[k] = []; });
    return c;
  }
  function saveCustomContent(content) { return saveJSON(CONTENT_KEY, content); }
  function clearCustomContent() { lsRemove(CONTENT_KEY); }

  /* ---------------- content packs (export / import) ---------------- */

  function collectImageIds(content) {
    var ids = [];
    function grab(entity) { if (entity && entity.imageId) ids.push(entity.imageId); }
    ['characters', 'cards', 'items', 'enemies'].forEach(function (k) { (content[k] || []).forEach(grab); });
    return ids;
  }

  function buildContentPack(content, packMeta) {
    var pack = {
      format: 'animazing-pack',
      version: 1,
      name: (packMeta && packMeta.name) || 'Custom Pack',
      author: (packMeta && packMeta.author) || '',
      exportedAt: new Date().toISOString(),
      characters: AZ.util.deepClone(content.characters || []),
      cards: AZ.util.deepClone(content.cards || []),
      items: AZ.util.deepClone(content.items || []),
      enemies: AZ.util.deepClone(content.enemies || []),
      images: {}
    };
    collectImageIds(content).forEach(function (id) {
      var data = getImage(id);
      if (data) pack.images[id] = data;
    });
    return pack;
  }

  /* Merge a pack into local custom content (same-id entries are replaced).
     Returns {added: n, replaced: n, images: n, errors: [...]}. */
  function importContentPack(pack) {
    var result = { added: 0, replaced: 0, images: 0, errors: [] };
    if (!pack || pack.format !== 'animazing-pack') {
      result.errors.push('Not an Animazing content pack (missing format marker).');
      return Promise.resolve(result);
    }
    var content = loadCustomContent();
    var validators = {
      characters: AZ.schema.validateCharacter,
      cards: AZ.schema.validateCard,
      items: AZ.schema.validateItem,
      enemies: AZ.schema.validateEnemy
    };
    ['characters', 'cards', 'items', 'enemies'].forEach(function (kind) {
      (pack[kind] || []).forEach(function (entity) {
        if (!entity || !entity.id) { result.errors.push('Skipped a ' + kind.slice(0, -1) + ' with no id.'); return; }
        var errs = validators[kind](entity);
        if (errs.length) { result.errors.push((entity.name || entity.id) + ': ' + errs.join(' ')); return; }
        var list = content[kind];
        var idx = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === entity.id) { idx = i; break; }
        if (idx >= 0) { list[idx] = entity; result.replaced++; } else { list.push(entity); result.added++; }
      });
    });
    saveCustomContent(content);
    var imageWrites = Object.keys(pack.images || {}).map(function (id) {
      result.images++;
      return putImage(id, pack.images[id]);
    });
    return Promise.all(imageWrites).then(function () { return result; });
  }

  /* ---------------- full save export/import ---------------- */

  function buildFullSave() {
    return {
      format: 'animazing-save',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: loadProfile(),
      content: loadCustomContent(),
      images: (function () {
        var out = {};
        Object.keys(mediaCache).forEach(function (id) { out[id] = mediaCache[id]; });
        return out;
      })()
    };
  }

  function importFullSave(save) {
    if (!save || save.format !== 'animazing-save') return Promise.reject(new Error('Not an Animazing save file.'));
    if (save.profile) saveProfile(save.profile);
    if (save.content) saveCustomContent(save.content);
    var writes = Object.keys(save.images || {}).map(function (id) { return putImage(id, save.images[id]); });
    return Promise.all(writes);
  }

  /* ---------------- download helper (browser only) ---------------- */

  function downloadJSON(obj, filename) {
    if (typeof document === 'undefined') return;
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 250);
  }

  AZ.storage = {
    loadProfile: loadProfile,
    saveProfile: saveProfile,
    clearProfile: clearProfile,
    loadCustomContent: loadCustomContent,
    saveCustomContent: saveCustomContent,
    clearCustomContent: clearCustomContent,
    putImage: putImage,
    deleteImage: deleteImage,
    preloadMedia: preloadMedia,
    getImage: getImage,
    fileToDataUrl: fileToDataUrl,
    buildContentPack: buildContentPack,
    importContentPack: importContentPack,
    buildFullSave: buildFullSave,
    importFullSave: importFullSave,
    downloadJSON: downloadJSON
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));
