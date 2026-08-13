/* Animazing — starter content pack.
   Original sample heroes/cards/items/enemies that make the game playable out
   of the box and demonstrate every system (combo tags, item synergies,
   battlefield passives, chaos effects). All of it is flagged sample:true so
   it can be hidden once you author your own roster in the Studio.

   Also home to the procedural portrait generator used whenever an entity has
   no uploaded PNG. */
(function (AZ) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Procedural portraits (SVG data URIs)                                */
  /* ------------------------------------------------------------------ */

  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.round(AZ.util.clamp(((n >> 16) & 255) * f, 0, 255));
    var g = Math.round(AZ.util.clamp(((n >> 8) & 255) * f, 0, 255));
    var b = Math.round(AZ.util.clamp((n & 255) * f, 0, 255));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function portraitSvg(entity) {
    var el = AZ.schema.ELEMENTS[entity.element] || AZ.schema.ELEMENTS.steel;
    var seed = AZ.util.hashString(String(entity.portraitSeed || entity.name || entity.id || 'x'));
    var rng = AZ.util.rng(seed);
    var base = el.color;
    var glyph = entity.glyph || el.glyph;
    var initial = (entity.name || '?').trim().charAt(0).toUpperCase();
    var rot = Math.floor(rng.next() * 360);
    var rings = '';
    for (var i = 0; i < 3; i++) {
      var rr = 34 + i * 14 + Math.floor(rng.next() * 6);
      rings += '<circle cx="60" cy="66" r="' + rr + '" fill="none" stroke="rgba(244,224,160,' +
        (0.28 - i * 0.07).toFixed(2) + ')" stroke-width="' + (i === 0 ? 1.4 : 0.8) +
        '" stroke-dasharray="' + (2 + i * 5) + ' ' + (3 + i * 4) + '" transform="rotate(' + (rot + i * 40) + ' 60 66)"/>';
    }
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 132">' +
      '<defs>' +
      '<radialGradient id="bg" cx="50%" cy="36%" r="80%">' +
      '<stop offset="0%" stop-color="' + shade(base, 1.25) + '"/>' +
      '<stop offset="55%" stop-color="' + shade(base, 0.62) + '"/>' +
      '<stop offset="100%" stop-color="#170a0d"/>' +
      '</radialGradient>' +
      '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#f8ecc2"/><stop offset="45%" stop-color="#d9b64a"/>' +
      '<stop offset="100%" stop-color="#8a6a1e"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<rect width="120" height="132" fill="url(#bg)"/>' +
      rings +
      '<text x="60" y="88" font-size="64" text-anchor="middle" font-family="serif" fill="rgba(20,8,10,0.55)">' + glyph + '</text>' +
      '<text x="58" y="86" font-size="64" text-anchor="middle" font-family="serif" fill="url(#gold)">' + glyph + '</text>' +
      '<text x="106" y="124" font-size="20" text-anchor="end" font-family="serif" font-style="italic" fill="rgba(248,236,194,0.8)">' + initial + '</text>' +
      '<rect x="1" y="1" width="118" height="130" fill="none" stroke="rgba(217,182,74,0.55)" stroke-width="2"/>' +
      '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  /* Resolve the display art for any entity: uploaded image first, then SVG. */
  function artFor(entity) {
    if (entity && entity.imageId) {
      var data = AZ.storage.getImage(entity.imageId);
      if (data) return data;
    }
    return portraitSvg(entity || {});
  }

  AZ.art = { portraitSvg: portraitSvg, artFor: artFor, shade: shade };

  /* ------------------------------------------------------------------ */
  /* Heroes                                                              */
  /* ------------------------------------------------------------------ */

  var characters = [
    {
      id: 'ch-kira', sample: true, name: 'Kira Emberblade', title: 'The Cinder Duelist',
      rarity: 'SSR', element: 'flame', role: 'striker',
      stats: { hp: 42, energy: 3, draw: 5, speed: 7 },
      lore: 'A wandering swordswoman whose blade remembers every fire it has ever touched. She fights smiling, because ash is just a beginning.',
      innate: {
        name: 'Ember Heart', icon: '🔥', tags: ['fire'],
        duration: -1,
        hooks: [{ on: 'modifyDamage', tags: ['fire'], add: 1 }],
        desc: 'Kira’s Fire cards deal +1 damage.'
      }
    },
    {
      id: 'ch-yuki', sample: true, name: 'Yuki Frostveil', title: 'Bastion of the North',
      rarity: 'SR', element: 'frost', role: 'guardian',
      stats: { hp: 50, energy: 3, draw: 5, speed: 4 },
      lore: 'Heir to a mountain shrine buried in eternal snow. Her calm is a wall; her patience, a glacier.',
      innate: {
        name: 'Winter Poise', icon: '❄️', tags: ['frost'],
        duration: -1,
        hooks: [{ on: 'turnStart', effects: [{ op: 'block', amount: 2, target: 'self' }] }],
        desc: 'Yuki gains 2 Block at the start of her turn.'
      }
    },
    {
      id: 'ch-hana', sample: true, name: 'Hana Petalsong', title: 'Voice of the Garden',
      rarity: 'SR', element: 'radiant', role: 'support',
      stats: { hp: 38, energy: 3, draw: 5, speed: 6 },
      lore: 'An idol-shrine maiden whose songs make flowers bloom out of season. Her encore has brought people back from the edge of dusk.',
      innate: {
        name: 'Morning Chorus', icon: '🌸', tags: ['bloom'],
        duration: -1,
        hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'regen', stacks: 1, target: 'all-friends' }] }],
        desc: 'The whole team starts battle with 1 Regen.'
      }
    },
    {
      id: 'ch-taro', sample: true, name: 'Taro Ironheart', title: 'The Unmoved',
      rarity: 'N', element: 'steel', role: 'guardian',
      stats: { hp: 55, energy: 3, draw: 5, speed: 3 },
      lore: 'A former festival strongman who decided the best place to stand is between danger and everyone else.',
      innate: {
        name: 'Stubborn Oath', icon: '🛡️', tags: ['steel'],
        duration: -1,
        hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'thorns', stacks: 1, target: 'self' }] }],
        desc: 'Taro starts battle with 1 Thorns.'
      }
    },
    {
      id: 'ch-shizuka', sample: true, name: 'Shizuka Nightbloom', title: 'Witch of the Late Hour',
      rarity: 'SSR', element: 'shadow', role: 'mystic',
      stats: { hp: 36, energy: 3, draw: 5, speed: 8 },
      lore: 'She keeps a moon in a jar and secrets in her sleeves. Nothing she says is a lie; nothing she says is safe.',
      innate: {
        name: 'First Whisper', icon: '🌙', tags: ['venom'],
        duration: -1,
        hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'poison', stacks: 2, target: 'random-foe' }] }],
        desc: 'A random foe starts battle with 2 Poison.'
      }
    },
    {
      id: 'ch-renji', sample: true, name: 'Renji Voltarc', title: 'Lightning-in-Debt',
      rarity: 'R', element: 'storm', role: 'trickster',
      stats: { hp: 40, energy: 3, draw: 5, speed: 9 },
      lore: 'A courier who once outran a storm and has been paying it back, one spark at a time, ever since.',
      innate: null
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Ability cards. owner '*' = universal basics usable by everyone.     */
  /* ------------------------------------------------------------------ */

  var cards = [
    /* Universal basics */
    { id: 'ab-strike', sample: true, owner: '*', name: 'Strike', rarity: 'N', type: 'attack', cost: 1, tags: ['basic'], flavor: 'Simple. Honest. Pointy.', effects: [{ op: 'damage', amount: 6, target: 'foe' }] },
    { id: 'ab-guard', sample: true, owner: '*', name: 'Guard', rarity: 'N', type: 'guard', cost: 1, tags: ['basic'], flavor: 'The oldest technique: do not get hit.', effects: [{ op: 'block', amount: 6, target: 'self' }] },

    /* Kira — flame striker, combo tags + fire passives */
    { id: 'ab-kira-flame-slash', sample: true, owner: 'ch-kira', name: 'Flame Slash', rarity: 'R', type: 'attack', cost: 1, tags: ['fire', 'blade'],
      flavor: 'The first cut lights the wick.', effects: [{ op: 'damage', amount: 8, target: 'foe' }] },
    { id: 'ab-kira-twin-embers', sample: true, owner: 'ch-kira', name: 'Twin Embers', rarity: 'SR', type: 'attack', cost: 1, tags: ['fire'],
      flavor: 'Two sparks, one intention.', effects: [{ op: 'damage', amount: 4, times: 2, target: 'foe' }] },
    { id: 'ab-kira-flash-step', sample: true, owner: 'ch-kira', name: 'Flash Step', rarity: 'R', type: 'skill', cost: 0, tags: ['blade'],
      flavor: 'Blink and she is already past you.', effects: [{ op: 'draw', amount: 2 }] },
    { id: 'ab-kira-cinder-guard', sample: true, owner: 'ch-kira', name: 'Cinder Guard', rarity: 'R', type: 'guard', cost: 1, tags: ['fire'],
      flavor: 'Even her defense is warm to the touch.',
      effects: [
        { op: 'block', amount: 7, target: 'self' },
        { op: 'block', amount: 4, target: 'self', if: { tagThisRound: 'blade' } }
      ] },
    { id: 'ab-kira-ember-veil', sample: true, owner: 'ch-kira', name: 'Ember Veil', rarity: 'SR', type: 'passive', cost: 2, tags: ['fire'],
      flavor: 'The air itself takes her side.',
      effects: [{ op: 'passive', passive: { name: 'Ember Veil', icon: '🔥', duration: 2, tags: ['fire'], hooks: [{ on: 'modifyDamage', tags: ['fire'], add: 3 }] } }] },
    { id: 'ab-kira-inferno-wave', sample: true, owner: 'ch-kira', name: 'Inferno Wave', rarity: 'SR', type: 'attack', cost: 2, tags: ['fire'],
      flavor: 'A horizon, briefly, made of gold.',
      effects: [
        { op: 'damage', amount: 9, target: 'all-foes' },
        { op: 'status', status: 'burn', stacks: 2, target: 'all-foes', if: { passiveActive: 'fire' } }
      ] },
    { id: 'ab-kira-rising-phoenix', sample: true, owner: 'ch-kira', name: 'Rising Phoenix', rarity: 'SSR', type: 'attack', cost: 3, tags: ['fire', 'blade'], exhaust: true,
      flavor: 'What burns twice, burns brighter.',
      effects: [
        { op: 'damage', amount: 18, target: 'foe' },
        { op: 'damage', amount: 10, target: 'foe', if: { tagThisRound: 'fire', minCount: 3 } }
      ] },

    /* Yuki — frost guardian, block synergies + aegis passive */
    { id: 'ab-yuki-glacier-wall', sample: true, owner: 'ch-yuki', name: 'Glacier Wall', rarity: 'R', type: 'guard', cost: 1, tags: ['frost'],
      flavor: 'Winter, on request.', effects: [{ op: 'block', amount: 9, target: 'self' }] },
    { id: 'ab-yuki-frozen-riposte', sample: true, owner: 'ch-yuki', name: 'Frozen Riposte', rarity: 'SR', type: 'guard', cost: 1, tags: ['frost'],
      flavor: 'Touch the shrine gate and lose the hand.',
      effects: [
        { op: 'block', amount: 6, target: 'self' },
        { op: 'status', status: 'thorns', stacks: 3, target: 'self' }
      ] },
    { id: 'ab-yuki-taunting-chill', sample: true, owner: 'ch-yuki', name: 'Taunting Chill', rarity: 'R', type: 'guard', cost: 1, tags: ['frost'],
      flavor: 'Her silence is louder than your war cry.',
      effects: [
        { op: 'status', status: 'taunt', stacks: 1, target: 'self' },
        { op: 'block', amount: 5, target: 'self' },
        { op: 'status', status: 'weak', stacks: 1, target: 'foe' }
      ] },
    { id: 'ab-yuki-shatter', sample: true, owner: 'ch-yuki', name: 'Shatter', rarity: 'SR', type: 'attack', cost: 2, tags: ['frost'],
      flavor: 'Everything brittle breaks beautifully.',
      effects: [
        { op: 'damage', amount: 12, target: 'foe' },
        { op: 'damage', amount: 6, target: 'foe', if: { selfHasBlock: true } }
      ] },
    { id: 'ab-yuki-snow-mend', sample: true, owner: 'ch-yuki', name: 'Snow Mend', rarity: 'R', type: 'skill', cost: 1, tags: ['frost'],
      flavor: 'Cold hands, warm intent.', effects: [{ op: 'heal', amount: 6, target: 'friend-target' }] },
    { id: 'ab-yuki-permafrost-aegis', sample: true, owner: 'ch-yuki', name: 'Permafrost Aegis', rarity: 'SSR', type: 'passive', cost: 2, tags: ['frost'],
      flavor: 'Some winters refuse to end. Be one of them.',
      effects: [{ op: 'passive', passive: { name: 'Permafrost Aegis', icon: '❄️', duration: 2, tags: ['frost'], hooks: [{ on: 'roundStart', effects: [{ op: 'status', status: 'aegis', stacks: 1, target: 'all-friends' }] }] } }] },

    /* Hana — radiant support, heals/buffs/revive */
    { id: 'ab-hana-petal-mend', sample: true, owner: 'ch-hana', name: 'Petal Mend', rarity: 'R', type: 'skill', cost: 1, tags: ['bloom'],
      flavor: 'A chorus of small mercies.', effects: [{ op: 'heal', amount: 7, target: 'friend-target' }] },
    { id: 'ab-hana-blossom-ward', sample: true, owner: 'ch-hana', name: 'Blossom Ward', rarity: 'R', type: 'guard', cost: 1, tags: ['bloom'],
      flavor: 'Petals, arranged like armor.', effects: [{ op: 'block', amount: 4, target: 'all-friends' }] },
    { id: 'ab-hana-radiant-chorus', sample: true, owner: 'ch-hana', name: 'Radiant Chorus', rarity: 'SR', type: 'skill', cost: 2, tags: ['bloom', 'light'],
      flavor: 'The song rises; so does everyone.',
      effects: [{ op: 'status', status: 'strength', stacks: 1, target: 'all-friends' }] },
    { id: 'ab-hana-dazzling-bloom', sample: true, owner: 'ch-hana', name: 'Dazzling Bloom', rarity: 'R', type: 'attack', cost: 1, tags: ['light'],
      flavor: 'Beauty, weaponized politely.',
      effects: [
        { op: 'damage', amount: 6, target: 'foe' },
        { op: 'status', status: 'weak', stacks: 1, target: 'foe' }
      ] },
    { id: 'ab-hana-encore', sample: true, owner: 'ch-hana', name: 'Encore', rarity: 'SR', type: 'skill', cost: 0, tags: ['bloom'],
      flavor: 'One more song. There is always one more song.',
      effects: [{ op: 'draw', amount: 2 }, { op: 'heal', amount: 3, target: 'self' }] },
    { id: 'ab-hana-garden-of-dawn', sample: true, owner: 'ch-hana', name: 'Garden of Dawn', rarity: 'SSR', type: 'passive', cost: 3, tags: ['bloom'],
      flavor: 'Where she sings, nothing stays wilted.',
      effects: [{ op: 'passive', passive: { name: 'Garden of Dawn', icon: '🌸', duration: 3, tags: ['bloom'], hooks: [{ on: 'roundStart', effects: [{ op: 'heal', amount: 4, target: 'all-friends' }] }] } }] },
    { id: 'ab-hana-second-bloom', sample: true, owner: 'ch-hana', name: 'Second Bloom', rarity: 'SSR', type: 'skill', cost: 2, tags: ['bloom'], exhaust: true,
      flavor: 'Spring answers when she calls it by name.',
      effects: [{ op: 'revive', amount: 40, target: 'downed-friend' }] },

    /* Taro — steel guardian, taunt/thorns/block-scaling */
    { id: 'ab-taro-iron-bash', sample: true, owner: 'ch-taro', name: 'Iron Bash', rarity: 'N', type: 'attack', cost: 1, tags: ['steel'],
      flavor: 'Subtlety is for people with smaller arms.', effects: [{ op: 'damage', amount: 7, target: 'foe' }] },
    { id: 'ab-taro-bulwark', sample: true, owner: 'ch-taro', name: 'Bulwark', rarity: 'N', type: 'guard', cost: 1, tags: ['steel'],
      flavor: 'A wall that apologizes afterward.', effects: [{ op: 'block', amount: 8, target: 'self' }] },
    { id: 'ab-taro-provoke', sample: true, owner: 'ch-taro', name: 'Provoke', rarity: 'N', type: 'guard', cost: 0, tags: ['steel'],
      flavor: '“Hey. Over here. Yes, you.”',
      effects: [
        { op: 'status', status: 'taunt', stacks: 1, target: 'self' },
        { op: 'block', amount: 3, target: 'self' }
      ] },
    { id: 'ab-taro-shield-slam', sample: true, owner: 'ch-taro', name: 'Shield Slam', rarity: 'R', type: 'attack', cost: 1, tags: ['steel'],
      flavor: 'The best sword he owns is a door.',
      effects: [{ op: 'damage', amount: { base: 0, perSelfBlock: { mult: 1 } }, target: 'foe' }] },
    { id: 'ab-taro-unbreakable', sample: true, owner: 'ch-taro', name: 'Unbreakable', rarity: 'SR', type: 'guard', cost: 2, tags: ['steel'], exhaust: true,
      flavor: 'He has never once moved out of the way.',
      effects: [
        { op: 'block', amount: 15, target: 'self' },
        { op: 'status', status: 'fortify', stacks: 1, target: 'self' }
      ] },
    { id: 'ab-taro-rally-cry', sample: true, owner: 'ch-taro', name: 'Rally Cry', rarity: 'R', type: 'skill', cost: 1, tags: ['steel'],
      flavor: 'Loud enough to count as armor.',
      effects: [{ op: 'block', amount: 3, target: 'all-friends' }, { op: 'status', status: 'strength', stacks: 1, target: 'self' }] },

    /* Shizuka — shadow mystic, poison scaling + chaos */
    { id: 'ab-shizuka-venom-needle', sample: true, owner: 'ch-shizuka', name: 'Venom Needle', rarity: 'R', type: 'attack', cost: 0, tags: ['shadow', 'venom'],
      flavor: 'A pinprick with a long memory.',
      effects: [{ op: 'damage', amount: 3, target: 'foe' }, { op: 'status', status: 'poison', stacks: 2, target: 'foe' }] },
    { id: 'ab-shizuka-creeping-dusk', sample: true, owner: 'ch-shizuka', name: 'Creeping Dusk', rarity: 'SR', type: 'skill', cost: 2, tags: ['shadow', 'venom'],
      flavor: 'Evening arrives early, and only for you.',
      effects: [{ op: 'status', status: 'poison', stacks: 3, target: 'all-foes' }] },
    { id: 'ab-shizuka-hex-of-frailty', sample: true, owner: 'ch-shizuka', name: 'Hex of Frailty', rarity: 'R', type: 'skill', cost: 1, tags: ['shadow'],
      flavor: 'She writes your weakness in the air.',
      effects: [{ op: 'status', status: 'vulnerable', stacks: 2, target: 'foe' }, { op: 'status', status: 'weak', stacks: 1, target: 'foe' }] },
    { id: 'ab-shizuka-shadow-veil', sample: true, owner: 'ch-shizuka', name: 'Shadow Veil', rarity: 'R', type: 'guard', cost: 1, tags: ['shadow'],
      flavor: 'Try hitting the place she just was.',
      effects: [{ op: 'block', amount: 5, target: 'self' }, { op: 'status', status: 'evade', stacks: 1, target: 'self' }] },
    { id: 'ab-shizuka-nightmare-bloom', sample: true, owner: 'ch-shizuka', name: 'Nightmare Bloom', rarity: 'SSR', type: 'attack', cost: 2, tags: ['shadow', 'venom'],
      flavor: 'The garden she keeps is not for visiting.',
      effects: [{ op: 'damage', amount: { base: 4, perStatusTarget: { status: 'poison', mult: 2 } }, target: 'foe' }] },
    { id: 'ab-shizuka-chaos-moth', sample: true, owner: 'ch-shizuka', name: 'Chaos Moth', rarity: 'SR', type: 'skill', cost: 1, tags: ['shadow', 'chaos'],
      flavor: 'She opens the jar. She does not look inside first.',
      effects: [{ op: 'random', choices: [
        [{ op: 'damage', amount: 12, target: 'random-foe' }],
        [{ op: 'status', status: 'poison', stacks: 4, target: 'random-foe' }],
        [{ op: 'status', status: 'weak', stacks: 2, target: 'all-foes' }],
        [{ op: 'draw', amount: 2 }, { op: 'energy', amount: 1 }]
      ] }] },
    { id: 'ab-shizuka-midnight-parliament', sample: true, owner: 'ch-shizuka', name: 'Midnight Parliament', rarity: 'SSR', type: 'passive', cost: 2, tags: ['shadow', 'chaos'],
      flavor: 'The moths vote. The verdict is always “yes”.',
      effects: [{ op: 'passive', passive: { name: 'Midnight Parliament', icon: '🌙', duration: 3, tags: ['chaos', 'shadow'], hooks: [{ on: 'roundStart', effects: [{ op: 'random', choices: [
        [{ op: 'status', status: 'poison', stacks: 2, target: 'random-foe' }],
        [{ op: 'status', status: 'vulnerable', stacks: 1, target: 'random-foe' }],
        [{ op: 'status', status: 'evade', stacks: 1, target: 'random-friend' }]
      ] }] }] } }] },

    /* Renji — storm trickster, multi-hit, energy, storm-count scaling */
    { id: 'ab-renji-static-jab', sample: true, owner: 'ch-renji', name: 'Static Jab', rarity: 'N', type: 'attack', cost: 0, tags: ['storm'],
      flavor: 'Barely a punch. Mostly a spark.', effects: [{ op: 'damage', amount: 4, target: 'foe' }] },
    { id: 'ab-renji-chain-arc', sample: true, owner: 'ch-renji', name: 'Chain Arc', rarity: 'R', type: 'attack', cost: 1, tags: ['storm'],
      flavor: 'Lightning never checks the address twice.',
      effects: [{ op: 'damage', amount: 5, times: 2, target: 'random-foe' }] },
    { id: 'ab-renji-insulate', sample: true, owner: 'ch-renji', name: 'Insulate', rarity: 'N', type: 'guard', cost: 1, tags: ['storm'],
      flavor: 'Rubber soles. Professional secret.', effects: [{ op: 'block', amount: 6, target: 'self' }] },
    { id: 'ab-renji-overclock', sample: true, owner: 'ch-renji', name: 'Overclock', rarity: 'SR', type: 'skill', cost: 1, tags: ['storm'],
      flavor: 'He borrows tomorrow’s speed. Interest applies.',
      effects: [
        { op: 'energy', amount: 2 },
        { op: 'draw', amount: 2 },
        { op: 'damage', amount: 3, target: 'self', isAttack: false }
      ] },
    { id: 'ab-renji-storm-circuit', sample: true, owner: 'ch-renji', name: 'Storm Circuit', rarity: 'SR', type: 'passive', cost: 2, tags: ['storm'],
      flavor: 'The whole team, briefly, conducts.',
      effects: [{ op: 'passive', passive: { name: 'Storm Circuit', icon: '⚡', duration: 2, tags: ['storm'], hooks: [{ on: 'cardPlayed', tagFilter: 'storm', effects: [{ op: 'damage', amount: 3, target: 'random-foe' }] }] } }] },
    { id: 'ab-renji-thunder-finale', sample: true, owner: 'ch-renji', name: 'Thunder Finale', rarity: 'SSR', type: 'attack', cost: 3, tags: ['storm'], exhaust: true,
      flavor: 'The storm settles its account in full.',
      effects: [{ op: 'damage', amount: { base: 8, perRoundTag: { tag: 'storm', mult: 4 } }, target: 'foe' }] }
  ];

  /* ------------------------------------------------------------------ */
  /* Items (equipment relics; 2 slots per hero)                          */
  /* ------------------------------------------------------------------ */

  var items = [
    { id: 'it-ember-charm', sample: true, name: 'Ember Charm', rarity: 'R', slot: 'charm', tags: ['fire'],
      flavor: 'A coal that never quite goes out.',
      hooks: [{ on: 'modifyDamage', tags: ['fire'], add: 2 }] },
    { id: 'it-jade-talisman', sample: true, name: 'Jade Talisman', rarity: 'R', slot: 'charm', tags: ['bloom'],
      flavor: 'Cool to the touch, kind to the wearer.',
      hooks: [{ on: 'turnStart', effects: [{ op: 'heal', amount: 2, target: 'self' }] }] },
    { id: 'it-spiked-bracer', sample: true, name: 'Spiked Bracer', rarity: 'N', slot: 'armor', tags: ['steel'],
      flavor: 'Handshakes are no longer recommended.',
      hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'thorns', stacks: 2, target: 'self' }] }] },
    { id: 'it-iron-plate', sample: true, name: 'Iron Plate', rarity: 'N', slot: 'armor', tags: ['steel'],
      flavor: 'Heavy. Reassuring. Slightly dented.',
      statMods: { hp: 8 } },
    { id: 'it-crimson-banner', sample: true, name: 'Crimson Banner', rarity: 'SR', slot: 'weapon', tags: ['war'],
      flavor: 'Whoever carries it stops asking whether to advance.',
      hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'strength', stacks: 1, target: 'all-friends' }] }] },
    { id: 'it-frost-sigil', sample: true, name: 'Frost Sigil', rarity: 'R', slot: 'charm', tags: ['frost'],
      flavor: 'It hums when snow is coming. It always hums.',
      hooks: [{ on: 'turnStart', effects: [{ op: 'block', amount: 2, target: 'self' }] }] },
    { id: 'it-phantom-anklet', sample: true, name: 'Phantom Anklet', rarity: 'SR', slot: 'charm', tags: ['shadow'],
      flavor: 'Your shadow arrives a half-step late.',
      hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'evade', stacks: 1, target: 'self' }] }] },
    { id: 'it-lucky-koban', sample: true, name: 'Lucky Koban', rarity: 'SR', slot: 'charm', tags: ['fortune'],
      flavor: 'A gold coin that keeps coming back with friends.',
      goldBonus: 0.25 },
    { id: 'it-storm-capacitor', sample: true, name: 'Storm Capacitor', rarity: 'SSR', slot: 'weapon', tags: ['storm'],
      flavor: 'Charge now, apologize later.',
      hooks: [{ on: 'modifyDamage', tags: ['storm'], add: 2 }],
      statMods: { draw: 1 } },
    { id: 'it-warrior-sash', sample: true, name: 'Warrior’s Sash', rarity: 'R', slot: 'weapon', tags: ['war'],
      flavor: 'Tied once, never loosened.',
      statMods: { hp: 4 },
      hooks: [{ on: 'battleStart', effects: [{ op: 'status', status: 'strength', stacks: 1, target: 'self' }] }] }
  ];

  /* ------------------------------------------------------------------ */
  /* Enemies. Their effect targets are side-relative: 'foe' = your team. */
  /* ------------------------------------------------------------------ */

  var enemies = [
    {
      id: 'en-gloomdrop', sample: true, name: 'Gloomdrop Slime', element: 'shadow', glyph: '泥',
      stats: { hp: 22, speed: 3 },
      moves: [
        { name: 'Splatter', weight: 3, intent: 'attack', effects: [{ op: 'damage', amount: 6, target: 'foe' }] },
        { name: 'Gel Guard', weight: 2, intent: 'defend', effects: [{ op: 'block', amount: 6, target: 'self' }] },
        { name: 'Corrosive Spit', weight: 2, intent: 'debuff', effects: [{ op: 'damage', amount: 3, target: 'foe' }, { op: 'status', status: 'weak', stacks: 1, target: 'foe' }] }
      ]
    },
    {
      id: 'en-oni-brute', sample: true, name: 'Oni Brute', element: 'flame', glyph: '鬼',
      stats: { hp: 45, speed: 4 },
      moves: [
        { name: 'Crush', weight: 3, intent: 'attack', effects: [{ op: 'damage', amount: 12, target: 'foe' }] },
        { name: 'War Cry', weight: 1, intent: 'buff', effects: [{ op: 'status', status: 'strength', stacks: 2, target: 'self' }] },
        { name: 'Sweeping Club', weight: 2, intent: 'attack', effects: [{ op: 'damage', amount: 5, target: 'all-foes' }] }
      ]
    },
    {
      id: 'en-cursed-miko', sample: true, name: 'Cursed Miko', element: 'shadow', glyph: '呪',
      stats: { hp: 30, speed: 6 },
      moves: [
        { name: 'Spirit Bolt', weight: 3, intent: 'attack', effects: [{ op: 'damage', amount: 8, target: 'foe' }] },
        { name: 'Withering Hex', weight: 2, intent: 'debuff', effects: [{ op: 'status', status: 'vulnerable', stacks: 2, target: 'foe' }] },
        { name: 'Dark Prayer', weight: 2, intent: 'buff', effects: [{ op: 'heal', amount: 6, target: 'all-friends' }] }
      ]
    },
    {
      id: 'en-kitsune', sample: true, name: 'Kitsune Illusionist', element: 'storm', glyph: '狐',
      stats: { hp: 34, speed: 8 },
      moves: [
        { name: 'Foxfire', weight: 3, intent: 'attack', effects: [{ op: 'damage', amount: 4, times: 2, target: 'foe' }, { op: 'status', status: 'burn', stacks: 1, target: 'foe' }] },
        { name: 'Nine-Tail Trick', weight: 2, intent: 'chaos', effects: [{ op: 'random', choices: [
          [{ op: 'damage', amount: 10, target: 'random-foe' }],
          [{ op: 'status', status: 'evade', stacks: 1, target: 'self' }, { op: 'block', amount: 6, target: 'self' }],
          [{ op: 'status', status: 'stun', stacks: 1, target: 'random-foe' }]
        ] }] },
        { name: 'Mirror Veil', weight: 1, intent: 'defend', effects: [{ op: 'status', status: 'evade', stacks: 1, target: 'self' }] }
      ]
    },
    {
      id: 'en-ashen-ronin', sample: true, name: 'Ashen Ronin', element: 'flame', glyph: '浪', elite: true,
      stats: { hp: 70, speed: 7 },
      moves: [
        { name: 'Twin Cut', weight: 3, intent: 'attack', effects: [{ op: 'damage', amount: 8, times: 2, target: 'foe' }] },
        { name: 'Ash Cloud', weight: 2, intent: 'debuff', effects: [{ op: 'status', status: 'weak', stacks: 2, target: 'all-foes' }] },
        { name: 'Immolate', weight: 2, intent: 'chaos', effects: [{ op: 'status', status: 'burn', stacks: 3, target: 'all-foes' }, { op: 'status', status: 'strength', stacks: 1, target: 'self' }] }
      ]
    },
    {
      id: 'en-jade-golem', sample: true, name: 'Jade Golem', element: 'steel', glyph: '岩', elite: true,
      stats: { hp: 90, speed: 2 },
      moves: [
        { name: 'Verdant Bulwark', weight: 2, intent: 'defend', effects: [{ op: 'block', amount: 12, target: 'self' }, { op: 'status', status: 'thorns', stacks: 2, target: 'self' }] },
        { name: 'Seismic Slam', weight: 3, intent: 'attack', effects: [{ op: 'damage', amount: 14, target: 'foe' }] },
        { name: 'Petrifying Gaze', weight: 1, intent: 'debuff', effects: [{ op: 'status', status: 'stun', stacks: 1, target: 'foe' }] }
      ]
    },
    {
      id: 'en-ashen-shogun', sample: true, name: 'The Ashen Shogun', element: 'flame', glyph: '将', boss: true, sequence: true,
      stats: { hp: 170, speed: 5 },
      innate: {
        name: 'Court of Cinders', icon: '👹', tags: ['fire'],
        duration: -1,
        hooks: [{ on: 'roundStart', effects: [{ op: 'block', amount: 4, target: 'self' }] }],
        desc: 'The Shogun gains 4 Block each round.'
      },
      moves: [
        { name: 'War Drums', intent: 'buff', effects: [{ op: 'status', status: 'strength', stacks: 2, target: 'self' }, { op: 'block', amount: 8, target: 'self' }] },
        { name: 'Crescent Execution', intent: 'attack', effects: [{ op: 'damage', amount: 20, target: 'foe' }] },
        { name: 'Ash Storm', intent: 'chaos', effects: [{ op: 'damage', amount: 6, target: 'all-foes' }, { op: 'status', status: 'burn', stacks: 2, target: 'all-foes' }] },
        { name: 'Iron Stance', intent: 'defend', effects: [{ op: 'block', amount: 18, target: 'self' }, { op: 'status', status: 'thorns', stacks: 3, target: 'self' }] }
      ]
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Wandering events for the run map                                    */
  /* ------------------------------------------------------------------ */

  var events = [
    {
      id: 'ev-hot-spring', name: 'Hidden Hot Spring', glyph: '♨',
      desc: 'Steam curls through the bamboo. The water smells faintly of plum blossoms and very strongly of a nap.',
      choices: [
        { label: 'Soak (heal team 30%)', result: { healPct: 30 } },
        { label: 'Sell the location (gain 60 gold)', result: { gold: 60 } }
      ]
    },
    {
      id: 'ev-merchant', name: 'The Umbrella Merchant', glyph: '傘',
      desc: 'A fox-masked peddler bows. “Everything is for sale, traveler. Especially the things I have not finished stealing.”',
      choices: [
        { label: 'Buy a relic (80 gold)', result: { costGold: 80, item: true } },
        { label: 'Trade stories (gain 15 crystals)', result: { crystals: 15 } },
        { label: 'Walk away', result: {} }
      ]
    },
    {
      id: 'ev-cursed-chest', name: 'Lacquered Chest', glyph: '匣',
      desc: 'A beautiful chest, sealed with crimson cord. Something inside is either treasure or extremely annoyed.',
      choices: [
        { label: 'Open it (relic + a lingering curse)', result: { item: true, curse: {
          name: 'Chest’s Grudge', icon: '👻', side: 'ally', duration: -1, tags: ['curse'],
          hooks: [{ on: 'roundStart', effects: [{ op: 'damage', amount: 2, target: 'random-friend', isAttack: false }] }],
          desc: 'A random hero takes 2 damage each round.' } } },
        { label: 'Leave it sealed', result: {} }
      ]
    },
    {
      id: 'ev-comet-shrine', name: 'Comet Shrine', glyph: '☄',
      desc: 'A tiny shrine to a falling star. The offering box rattles although nothing moves.',
      choices: [
        { label: 'Pray (random blessing for this run)', result: { boon: {
          name: 'Comet Blessing', icon: '☄️', side: 'ally', duration: -1, tags: ['chaos'],
          hooks: [{ on: 'roundStart', effects: [{ op: 'random', choices: [
            [{ op: 'block', amount: 4, target: 'random-friend' }],
            [{ op: 'damage', amount: 4, target: 'random-foe' }],
            [{ op: 'status', status: 'regen', stacks: 1, target: 'random-friend' }]
          ] }] }],
          desc: 'Each round, a random small blessing strikes the field.' } } },
        { label: 'Pocket the offerings (40 gold, feel bad)', result: { gold: 40 } }
      ]
    },
    {
      id: 'ev-stone-general', name: 'The Stone General', glyph: '像',
      desc: 'A mossy statue of a forgotten general. Its palm is open, as if expecting tribute — or offering something.',
      choices: [
        { label: 'Offer blood (team -10% HP, gain 25 crystals)', result: { hpCostPct: 10, crystals: 25 } },
        { label: 'Salute and pass', result: { gold: 15 } }
      ]
    },
    {
      id: 'ev-tanuki', name: 'A Tanuki’s Wager', glyph: '狸',
      desc: 'A tanuki in a tiny kimono shuffles three acorn shells. You are fairly sure all three are empty.',
      choices: [
        { label: 'Play (50/50: double or nothing, 50 gold)', result: { gamble: { stake: 50, win: 100 } } },
        { label: 'Applaud and leave', result: {} }
      ]
    }
  ];

  AZ.STARTER = {
    packId: 'starter',
    name: 'Animazing Starter Cast',
    characters: characters,
    cards: cards,
    items: items,
    enemies: enemies,
    events: events
  };
})(typeof window !== 'undefined' ? (window.AZ = window.AZ || {}) : (globalThis.AZ = globalThis.AZ || {}));
