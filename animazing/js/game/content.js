/* Animazing — content registry.
   Merges three layers, later layers overriding earlier ones by id:
     1. the built-in starter pack (sample content),
     2. file-based packs registered in packs/ (AZ.PACKS),
     3. the player's own Studio creations (localStorage).
   Everything downstream (collection, summons, battles, Studio) reads
   content exclusively through this module. */
(function (AZ) {
  'use strict';

  var custom = { characters: [], cards: [], items: [], enemies: [] };
  var KINDS = ['characters', 'cards', 'items', 'enemies'];

  function init() {
    custom = AZ.storage.loadCustomContent();
  }

  function layers() {
    var packs = (AZ.PACKS || []).filter(function (p) { return p && typeof p === 'object'; });
    return [AZ.STARTER].concat(packs).concat([custom]);
  }

  function mergedList(kind) {
    var map = {}, order = [];
    layers().forEach(function (layer) {
      (layer[kind] || []).forEach(function (entity) {
        if (!entity || !entity.id) return;
        if (!(entity.id in map)) order.push(entity.id);
        map[entity.id] = entity;
      });
    });
    return order.map(function (id) { return map[id]; });
  }

  function characters(opts) {
    opts = opts || {};
    var list = mergedList('characters');
    if (opts.includeSamples === false) list = list.filter(function (c) { return !c.sample; });
    return list;
  }
  function cards() { return mergedList('cards'); }
  function items() { return mergedList('items'); }
  function enemies() { return mergedList('enemies'); }
  function events() {
    var out = [];
    layers().forEach(function (layer) { (layer.events || []).forEach(function (e) { out.push(e); }); });
    return out;
  }

  function byId(kind, id) {
    var list = mergedList(kind);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function getCharacter(id) { return byId('characters', id); }
  function getCard(id) { return byId('cards', id); }
  function getItem(id) { return byId('items', id); }
  function getEnemy(id) { return byId('enemies', id); }

  /* Cards playable by a given hero: their own plus universal ('*') cards. */
  function cardsForOwner(charId) {
    return cards().filter(function (c) { return c.owner === charId || c.owner === '*'; });
  }

  function isCustom(kind, id) {
    return (custom[kind] || []).some(function (e) { return e.id === id; });
  }

  /* Upsert a Studio creation. Returns [] on success or validation errors. */
  function saveCustom(kind, entity) {
    var validators = {
      characters: AZ.schema.validateCharacter,
      cards: AZ.schema.validateCard,
      items: AZ.schema.validateItem,
      enemies: AZ.schema.validateEnemy
    };
    var errs = validators[kind](entity);
    if (errs.length) return errs;
    var list = custom[kind];
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === entity.id) { idx = i; break; }
    if (idx >= 0) list[idx] = entity; else list.push(entity);
    AZ.storage.saveCustomContent(custom);
    return [];
  }

  function deleteCustom(kind, id) {
    var list = custom[kind];
    var before = list.length;
    custom[kind] = list.filter(function (e) { return e.id !== id; });
    if (custom[kind].length !== before) AZ.storage.saveCustomContent(custom);
    return before !== custom[kind].length;
  }

  function customContent() { return custom; }

  function counts() {
    return {
      characters: mergedList('characters').length,
      cards: mergedList('cards').length,
      items: mergedList('items').length,
      enemies: mergedList('enemies').length,
      custom: KINDS.reduce(function (n, k) { return n + custom[k].length; }, 0)
    };
  }

  AZ.content = {
    init: init,
    characters: characters,
    cards: cards,
    items: items,
    enemies: enemies,
    events: events,
    getCharacter: getCharacter,
    getCard: getCard,
    getItem: getItem,
    getEnemy: getEnemy,
    cardsForOwner: cardsForOwner,
    isCustom: isCustom,
    saveCustom: saveCustom,
    deleteCustom: deleteCustom,
    customContent: customContent,
    counts: counts
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));
