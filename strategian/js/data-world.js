/* STRATEGIAN — static world data: archetypes, governments, foreign powers */
(function (S) {
  'use strict';

  /* =================================================== NATION ARCHETYPES ==
     Every number here is a starting condition, not a destiny. `gdp` is in
     billions of national units; `pop` in millions.                        */
  S.ARCHETYPES = [
    {
      id: 'hegemon',
      name: 'Continental Hegemon',
      sub: 'Superpower · Reserve currency',
      difficulty: 'Measured',
      desc: 'The largest economy on earth, a global alliance network, and a military with reach on every ocean. Everything you do moves world markets — including your mistakes.',
      pop: 336, gdp: 24800, urban: 83,
      military: { manpower: 1.35, equipment: 88, readiness: 76, doctrine: 'expeditionary', nuclear: 92, navy: 95, air: 94, land: 82 },
      economy: { growth: 2.1, inflation: 3.2, unemployment: 4.0, debtGdp: 121, rate: 4.5, reserveStatus: 95, productivity: 88 },
      society: { approval: 44, stability: 68, education: 79, health: 74, corruption: 26, freedom: 78, inequality: 47, culture: 92, infra: 72 },
      prestige: 92, intel: 88, tech: 90,
      tags: ['Reserve currency', 'Nuclear triad', 'Alliance hub', 'Deep capital markets'],
      currency: { name: 'Dollar', symbol: '$' },
      startWars: [], notes: 'Allies expect leadership. Rivals test the perimeter.'
    },
    {
      id: 'continental',
      name: 'Resurgent Continental Power',
      sub: 'Great power · Resource state',
      difficulty: 'Demanding',
      desc: 'Vast territory, nuclear parity, and an economy that leans hard on extraction. Feared abroad, brittle at home. Sanctions are a permanent feature of your weather.',
      pop: 148, gdp: 2300, urban: 75,
      military: { manpower: 1.15, equipment: 66, readiness: 68, doctrine: 'deterrence', nuclear: 95, navy: 58, air: 70, land: 84 },
      economy: { growth: 1.2, inflation: 7.5, unemployment: 5.2, debtGdp: 22, rate: 12, reserveStatus: 18, productivity: 52 },
      society: { approval: 58, stability: 60, education: 71, health: 58, corruption: 62, freedom: 26, inequality: 58, culture: 61, infra: 55 },
      prestige: 68, intel: 84, tech: 60,
      tags: ['Energy exporter', 'Nuclear parity', 'Under sanctions', 'Weak institutions'],
      currency: { name: 'Ruble', symbol: '₽' },
      startWars: [], notes: 'Commodity prices are your budget. Oligarchs are your parliament.'
    },
    {
      id: 'industrial',
      name: 'Industrial Republic',
      sub: 'Advanced economy · Export engine',
      difficulty: 'Measured',
      desc: 'Precision manufacturing, an enviable education system, and a constitution that constrains you at every turn. Prosperous, aging, and militarily modest.',
      pop: 84, gdp: 4400, urban: 78,
      military: { manpower: 0.19, equipment: 78, readiness: 52, doctrine: 'defensive', nuclear: 0, navy: 46, air: 58, land: 50 },
      economy: { growth: 1.4, inflation: 2.6, unemployment: 5.4, debtGdp: 66, rate: 3.0, reserveStatus: 55, productivity: 91 },
      society: { approval: 51, stability: 79, education: 88, health: 86, corruption: 14, freedom: 88, inequality: 31, culture: 74, infra: 84 },
      prestige: 74, intel: 58, tech: 87,
      tags: ['Export surplus', 'Aging population', 'Strong institutions', 'No nuclear arms'],
      currency: { name: 'Mark', symbol: '₥' },
      startWars: [], notes: 'Your security depends on other people\'s promises.'
    },
    {
      id: 'rising',
      name: 'Rising Giant',
      sub: 'Emerging power · Vast population',
      difficulty: 'Demanding',
      desc: 'A billion citizens, a young workforce, and infrastructure that cannot keep up. Growth is your only politics — and it is not evenly shared.',
      pop: 1240, gdp: 3900, urban: 39,
      military: { manpower: 1.45, equipment: 52, readiness: 60, doctrine: 'defensive', nuclear: 48, navy: 52, air: 55, land: 72 },
      economy: { growth: 6.2, inflation: 5.8, unemployment: 8.6, debtGdp: 84, rate: 6.5, reserveStatus: 22, productivity: 34 },
      society: { approval: 55, stability: 58, education: 52, health: 44, corruption: 66, freedom: 55, inequality: 64, culture: 70, infra: 38 },
      prestige: 58, intel: 62, tech: 55,
      tags: ['Demographic dividend', 'Infrastructure deficit', 'Regional rivalry', 'Informal economy'],
      currency: { name: 'Rupee', symbol: '₹' },
      startWars: [], notes: 'Every year of 6% growth buys you a decade of legitimacy.'
    },
    {
      id: 'petro',
      name: 'Petro-Monarchy',
      sub: 'Rentier state · Sovereign wealth',
      difficulty: 'Measured',
      desc: 'Enormous per-capita wealth pumped out of the ground, a citizenry paid to be content, and a countdown clock nobody wants to look at.',
      pop: 36, gdp: 940, urban: 87,
      military: { manpower: 0.26, equipment: 72, readiness: 44, doctrine: 'deterrence', nuclear: 0, navy: 40, air: 62, land: 44 },
      economy: { growth: 3.0, inflation: 2.4, unemployment: 9.5, debtGdp: 24, rate: 4.0, reserveStatus: 30, productivity: 58 },
      society: { approval: 62, stability: 66, education: 58, health: 68, corruption: 54, freedom: 22, inequality: 55, culture: 48, infra: 76 },
      prestige: 55, intel: 56, tech: 46,
      tags: ['Oil dependent', 'Sovereign wealth fund', 'Imported labour', 'Youth unemployment'],
      currency: { name: 'Dinar', symbol: 'د' },
      startWars: [], notes: 'Diversify before the wells or the world moves on.'
    },
    {
      id: 'entrepot',
      name: 'Maritime Entrepôt',
      sub: 'City-state · Financial hub',
      difficulty: 'Demanding',
      desc: 'Six million people, no hinterland, and the third-busiest port on earth. You survive by being indispensable to everyone and threatening to no one.',
      pop: 6.1, gdp: 480, urban: 100,
      military: { manpower: 0.07, equipment: 80, readiness: 74, doctrine: 'deterrence', nuclear: 0, navy: 38, air: 52, land: 30 },
      economy: { growth: 3.4, inflation: 2.8, unemployment: 2.6, debtGdp: 130, rate: 3.2, reserveStatus: 44, productivity: 94 },
      society: { approval: 66, stability: 84, education: 92, health: 88, corruption: 8, freedom: 52, inequality: 46, culture: 58, infra: 94 },
      prestige: 62, intel: 70, tech: 88,
      tags: ['Trade chokepoint', 'No resources', 'Financial centre', 'Existential exposure'],
      currency: { name: 'Crown', symbol: '⌾' },
      startWars: [], notes: 'A closed strait is a national emergency.'
    },
    {
      id: 'developing',
      name: 'Developing Republic',
      sub: 'Middle-income · Debt exposed',
      difficulty: 'Hard',
      desc: 'A young nation with real potential, real debt, and creditors who take your phone calls at inconvenient hours. Every foreign currency swing is felt in the markets.',
      pop: 62, gdp: 118, urban: 44,
      military: { manpower: 0.21, equipment: 32, readiness: 42, doctrine: 'asymmetric', nuclear: 0, navy: 18, air: 24, land: 40 },
      economy: { growth: 4.0, inflation: 14.0, unemployment: 13.5, debtGdp: 96, rate: 18, reserveStatus: 6, productivity: 24 },
      society: { approval: 40, stability: 44, education: 42, health: 38, corruption: 72, freedom: 48, inequality: 60, culture: 40, infra: 28 },
      prestige: 26, intel: 34, tech: 28,
      tags: ['IMF programme', 'Currency fragility', 'Brain drain', 'Commodity exporter'],
      currency: { name: 'Peso', symbol: '₱' },
      startWars: [], notes: 'The bond market votes more often than your citizens do.'
    },
    {
      id: 'postconflict',
      name: 'Post-Conflict State',
      sub: 'Fragile · Active insurgency',
      difficulty: 'Brutal',
      desc: 'The ceasefire held long enough for you to take office. Half the country is rubble, a third of it answers to someone else, and the treasury is a rumour.',
      pop: 29, gdp: 44, urban: 36,
      military: { manpower: 0.28, equipment: 22, readiness: 38, doctrine: 'asymmetric', nuclear: 0, navy: 8, air: 14, land: 34 },
      economy: { growth: 1.0, inflation: 26.0, unemployment: 27.0, debtGdp: 118, rate: 26, reserveStatus: 3, productivity: 14 },
      society: { approval: 34, stability: 24, education: 30, health: 26, corruption: 80, freedom: 34, inequality: 66, culture: 30, infra: 14 },
      prestige: 14, intel: 26, tech: 16,
      tags: ['Active insurgency', 'Aid dependent', 'Hyperinflation risk', 'Warlord factions'],
      currency: { name: 'Lira', symbol: '£' },
      startWars: ['insurgency'], notes: 'Survival is the first victory condition.'
    }
  ];

  /* ================================================== GOVERNMENT SYSTEMS ==
     `mods` are multipliers/offsets consumed directly by the simulation.   */
  S.GOVERNMENTS = [
    {
      id: 'liberal',
      name: 'Liberal Democracy',
      sub: 'Rule by consent',
      desc: 'Free elections every four years, a press that despises you, courts that overturn you. Legitimacy is cheap to lose and expensive to buy back.',
      mods: {
        freedom: +22, corruptionDrift: -0.012, approvalWeight: 1.5, unrestFromRepression: 1.6,
        policySpeed: 0.75, growthBonus: 0.25, coupRisk: 0.25, elections: 4,
        legitimacyFrom: 'approval', repressionCap: 35, cultureBonus: 8, intelPenalty: 0.85
      },
      traits: ['Elections every 4 years — lose and you leave office', 'Policy moves slowly; the legislature can water it down',
        'High legitimacy while approval holds', 'Repression is politically ruinous']
    },
    {
      id: 'managed',
      name: 'Managed Democracy',
      sub: 'Elections you expect to win',
      desc: 'The ballots are real; the choices are curated. You keep the forms of consent while removing most of its risks — at a slow cost to institutional trust.',
      mods: {
        freedom: +2, corruptionDrift: +0.010, approvalWeight: 1.0, unrestFromRepression: 1.0,
        policySpeed: 0.95, growthBonus: 0.0, coupRisk: 0.5, elections: 5,
        legitimacyFrom: 'mixed', repressionCap: 62, cultureBonus: 0, intelPenalty: 1.0
      },
      traits: ['Elections every 5 years, heavily weighted your way', 'Corruption creeps upward on its own',
        'Moderate repression tolerated', 'Legitimacy erodes if growth stalls']
    },
    {
      id: 'party',
      name: 'One-Party State',
      sub: 'Rule by the organisation',
      desc: 'The Party is the state, the state is the plan, and the plan must be met. Enormous mobilisation capacity, provided the cadres stay loyal.',
      mods: {
        freedom: -34, corruptionDrift: +0.014, approvalWeight: 0.55, unrestFromRepression: 0.7,
        policySpeed: 1.25, growthBonus: 0.15, coupRisk: 0.6, elections: 0,
        legitimacyFrom: 'performance', repressionCap: 88, cultureBonus: -4, intelPenalty: 1.2
      },
      traits: ['No elections — the Party is your electorate', 'Policies implement fast and at scale',
        'Legitimacy rests on delivery, not consent', 'Party loyalty is the vital statistic']
    },
    {
      id: 'junta',
      name: 'Military Junta',
      sub: 'Rule by the barracks',
      desc: 'You govern because the army agreed you should. Keep them paid, promoted and busy — the same men who installed you can uninstall you.',
      mods: {
        freedom: -40, corruptionDrift: +0.018, approvalWeight: 0.45, unrestFromRepression: 0.6,
        policySpeed: 1.35, growthBonus: -0.35, coupRisk: 1.9, elections: 0,
        legitimacyFrom: 'force', repressionCap: 92, cultureBonus: -10, intelPenalty: 1.15,
        militaryLoyaltyWeight: 2.2
      },
      traits: ['Decisions execute immediately', 'Military loyalty below 40 is a countdown',
        'Foreign investment is wary', 'Culture and soft power decay']
    },
    {
      id: 'personalist',
      name: 'Personalist Autocracy',
      sub: 'Rule by fear',
      desc: 'There is no institution between you and the citizen. You can do anything — and there is no one to blame, and nothing to catch you when the mood turns.',
      mods: {
        freedom: -46, corruptionDrift: +0.024, approvalWeight: 0.35, unrestFromRepression: 0.5,
        policySpeed: 1.5, growthBonus: -0.5, coupRisk: 1.4, elections: 0,
        legitimacyFrom: 'fear', repressionCap: 98, cultureBonus: -14, intelPenalty: 1.3,
        latentResentment: 1.9, collapseRisk: 1.7
      },
      traits: ['Total policy freedom, immediate execution', 'Fear suppresses unrest but stores resentment',
        'Collapse, when it comes, is sudden', 'Successors plot; intelligence is your lifeline']
    },
    {
      id: 'technocracy',
      name: 'Technocratic Council',
      sub: 'Rule by expertise',
      desc: 'Ministries staffed by specialists, decisions justified by modelling. Excellent policy, chronically thin legitimacy — nobody voted for the spreadsheet.',
      mods: {
        freedom: -8, corruptionDrift: -0.016, approvalWeight: 0.8, unrestFromRepression: 1.1,
        policySpeed: 1.2, growthBonus: 0.55, coupRisk: 0.8, elections: 0,
        legitimacyFrom: 'performance', repressionCap: 55, cultureBonus: -2, intelPenalty: 1.0,
        efficiency: 1.22
      },
      traits: ['Every budget unit goes further', 'Corruption falls over time', 'Legitimacy purely from results',
        'Populists gain whenever results dip']
    },
    {
      id: 'theocratic',
      name: 'Theocratic Republic',
      sub: 'Rule by doctrine',
      desc: 'Authority descends from a source no ballot can revoke. Extraordinary cohesion and mobilisation, purchased with a permanent tax on inquiry.',
      mods: {
        freedom: -30, corruptionDrift: +0.008, approvalWeight: 0.6, unrestFromRepression: 0.75,
        policySpeed: 1.1, growthBonus: -0.3, coupRisk: 0.7, elections: 0,
        legitimacyFrom: 'faith', repressionCap: 85, cultureBonus: +6, intelPenalty: 1.05,
        techPenalty: 0.78, cohesion: 1.35
      },
      traits: ['Very high national cohesion and identity', 'Research and universities underperform',
        'The clergy is a faction you cannot dissolve', 'Strong cultural export within your civilisation']
    }
  ];

  /* ======================================================= WORLD POWERS ==
     Personality drives both diplomatic drift and negotiation behaviour.  */
  S.WORLD_NATIONS = [
    { id: 'aurelia',   name: 'Aurelian Union',       adj: 'Aurelian',   color: 'steel', power: 88, ideology: 'liberal',     personality: 'institutionalist', region: 'West',       nuclear: true,  gdp: 19000, notes: 'A federation of wealthy democracies; slow to act, hard to move.' },
    { id: 'rus',       name: 'Novgar Federation',    adj: 'Novgari',    color: 'clay',  power: 74, ideology: 'authoritarian', personality: 'coercive',        region: 'North',      nuclear: true,  gdp: 2400,  notes: 'Energy leverage, aggressive intelligence services, long memory.' },
    { id: 'zhong',     name: 'Tianhe Republic',      adj: 'Tianhe',     color: 'gold',  power: 91, ideology: 'party',        personality: 'strategic',       region: 'East',       nuclear: true,  gdp: 21000, notes: 'The other pole. Patient, transactional, allergic to lectures.' },
    { id: 'bharat',    name: 'Sindhara',             adj: 'Sindharan',  color: 'sage',  power: 62, ideology: 'democratic',   personality: 'nonaligned',      region: 'South',      nuclear: true,  gdp: 4100,  notes: 'Refuses to choose sides and extracts a fee from both.' },
    { id: 'nihon',     name: 'Kaiyo Commonwealth',   adj: 'Kaiyo',      color: 'plum',  power: 58, ideology: 'liberal',      personality: 'cautious',        region: 'East',       nuclear: false, gdp: 4600,  notes: 'Technological, pacifist by constitution, quietly rearming.' },
    { id: 'brasil',    name: 'Amazonia Federation',  adj: 'Amazonian',  color: 'sage',  power: 44, ideology: 'democratic',   personality: 'transactional',   region: 'South',      nuclear: false, gdp: 2100,  notes: 'Agricultural superpower; domestic politics swing hard and often.' },
    { id: 'khalij',    name: 'Khalij Emirates',      adj: 'Khaliji',    color: 'gold',  power: 41, ideology: 'monarchy',     personality: 'transactional',   region: 'Gulf',       nuclear: false, gdp: 1100,  notes: 'Buys friends, hedges relentlessly, sets the oil price by mood.' },
    { id: 'anatol',    name: 'Anatolic Republic',    adj: 'Anatolic',   color: 'clay',  power: 46, ideology: 'managed',      personality: 'opportunist',     region: 'Crossroads', nuclear: false, gdp: 1000,  notes: 'Straddles two blocs and charges rent to both.' },
    { id: 'sahel',     name: 'Sahelian Union',       adj: 'Sahelian',   color: 'gold',  power: 27, ideology: 'mixed',        personality: 'nonaligned',      region: 'South',      nuclear: false, gdp: 620,   notes: 'Resource-rich, institution-poor, courted by everyone.' },
    { id: 'austral',   name: 'Austral Commonwealth', adj: 'Austral',    color: 'steel', power: 38, ideology: 'liberal',      personality: 'institutionalist', region: 'Pacific',    nuclear: false, gdp: 1700,  notes: 'Mineral exporter with an outsized diplomatic footprint.' },
    { id: 'andes',     name: 'Andean Pact',          adj: 'Andean',     color: 'sage',  power: 24, ideology: 'populist',     personality: 'volatile',        region: 'South',      nuclear: false, gdp: 480,   notes: 'Lithium, copper and a habit of nationalising things.' },
    { id: 'nordic',    name: 'Nordheim League',      adj: 'Nordheim',   color: 'teal',  power: 33, ideology: 'liberal',      personality: 'idealist',        region: 'North',      nuclear: false, gdp: 1500,  notes: 'Punches above its weight on norms, aid and mediation.' },
    { id: 'indo',      name: 'Nusantara Concord',    adj: 'Nusantaran', color: 'plum',  power: 36, ideology: 'managed',      personality: 'cautious',        region: 'Pacific',    nuclear: false, gdp: 1400,  notes: 'Straddles the world\'s busiest sea lanes.' },
    { id: 'levant',    name: 'Levantine States',     adj: 'Levantine',  color: 'clay',  power: 22, ideology: 'mixed',        personality: 'volatile',        region: 'Crossroads', nuclear: false, gdp: 340,   notes: 'Fault line. Every great power keeps a hand in.' }
  ];

  /* ============================================================ MINISTRIES */
  S.MINISTRIES = [
    { id: 'defense',   name: 'Defence',           icon: '⚔', desc: 'Force structure, procurement, readiness, deployments.' },
    { id: 'education', name: 'Education',         icon: '✎', desc: 'Schools, universities, vocational training, literacy.' },
    { id: 'health',    name: 'Health',            icon: '✚', desc: 'Hospitals, public health, pharmaceutical supply.' },
    { id: 'infra',     name: 'Infrastructure',    icon: '⌸', desc: 'Roads, rail, ports, grid, water, housing.' },
    { id: 'welfare',   name: 'Social Security',   icon: '⌂', desc: 'Pensions, unemployment insurance, family support.' },
    { id: 'research',  name: 'Science & R&D',     icon: '⌬', desc: 'Basic research, industrial policy, technology base.' },
    { id: 'intel',     name: 'Intelligence',      icon: '◉', desc: 'Foreign collection, counter-intelligence, covert action.' },
    { id: 'interior',  name: 'Interior & Police',  icon: '⚖', desc: 'Policing, courts, prisons, internal security.' },
    { id: 'culture',   name: 'Culture & Media',   icon: '❧', desc: 'Arts, broadcasting, heritage, national narrative.' },
    { id: 'energy',    name: 'Energy & Climate',  icon: '⚡', desc: 'Generation, transition, strategic reserves.' },
    { id: 'foreign',   name: 'Foreign Affairs',   icon: '⚑', desc: 'Embassies, foreign aid, treaty negotiation.' },
    { id: 'admin',     name: 'Administration',    icon: '❋', desc: 'The civil service that makes everything else work.' }
  ];

  /* ============================================================== FACTIONS */
  S.FACTIONS = [
    { id: 'military',  name: 'The General Staff',    desc: 'Senior officers. Care about budget, readiness, and not being asked to shoot citizens.' },
    { id: 'business',  name: 'Industry & Finance',   desc: 'Capital. Cares about taxes, regulation, stability and open markets.' },
    { id: 'labour',    name: 'Organised Labour',     desc: 'Unions and the wage-earning public. Care about employment, prices and welfare.' },
    { id: 'intelligentsia', short: 'Academia', name: 'Universities & Press', desc: 'Academics, journalists, the professional class. Care about freedom and funding.' },
    { id: 'clergy',    name: 'Traditional Authority', desc: 'Religious and communal leaders. Care about identity, family policy and continuity.' },
    { id: 'nationalists', short: 'Nationalists', name: 'Nationalist Bloc',  desc: 'Cares about sovereignty, borders, prestige and never backing down.' },
    { id: 'reformers', short: 'Reformers', name: 'Reform Movement',      desc: 'Young, urban, connected. Cares about corruption, rights and the future.' },
    { id: 'provinces', short: 'Provinces', name: 'Regional Governors',   desc: 'The periphery. Cares about transfers, autonomy and being remembered.' }
  ];

  /* ============================================================== OUTLETS */
  S.OUTLETS = [
    { id: 'state',     name: 'State Broadcasting',   bias: 'state',    color: 'gold'  },
    { id: 'record',    name: 'The National Record',  bias: 'centrist', color: 'steel' },
    { id: 'tribune',   name: 'The People\'s Tribune', bias: 'left',     color: 'clay'  },
    { id: 'ledger',    name: 'Financial Ledger',     bias: 'business', color: 'sage'  },
    { id: 'patriot',   name: 'The Patriot',          bias: 'right',    color: 'clay'  },
    { id: 'foreign',   name: 'Global Wire',          bias: 'foreign',  color: 'plum'  },
    { id: 'samizdat',  name: 'Underground Bulletin', bias: 'dissident', color: 'teal' }
  ];

  /* ====================================================== VICTORY TRACKS */
  S.VICTORY = [
    {
      id: 'military', name: 'Military Dominance', icon: '⚔',
      blurb: 'Hold unquestioned primacy of force: the strongest military on earth by a decisive margin, rivals defeated or subordinated, and a bloc that answers when you call.',
      req: 'Military index ≥ 88 · Lead the second power by ≥ 20 · 3 rivals defeated or subjugated · Prestige ≥ 75'
    },
    {
      id: 'culture', name: 'Cultural Dominance', icon: '❧',
      blurb: 'Win without firing: your language, media, institutions and model of society become the world\'s default setting.',
      req: 'Culture ≥ 88 · Soft power ≥ 82 · Prestige ≥ 80 · 9 nations with affinity ≥ 60 · Education ≥ 78'
    },
    {
      id: 'peace', name: 'World Peace', icon: '☮',
      blurb: 'Extinguish the fire: no wars anywhere, world tension near zero, and a treaty architecture that you built and that outlives you.',
      req: 'World tension ≤ 12 for 5 years · No wars anywhere · 10 treaties in force · Prestige ≥ 72'
    }
  ];

  S.DEFEATS = {
    apocalypse:  { name: 'Apocalypse',        blurb: 'Nuclear weapons were used at scale. Whatever survives will not be called a state.' },
    defeat:      { name: 'Military Defeat',   blurb: 'The armed forces broke, the capital fell, and terms were dictated to you.' },
    civilwar:    { name: 'Civil War',         blurb: 'The country divided into armed camps. Your writ ends at the edge of the compound.' },
    coup:        { name: 'Coup d\'État',      blurb: 'The men with guns decided the transition would not require your signature.' },
    collapse:    { name: 'Economic Collapse', blurb: 'The currency died, the state defaulted, and the machinery of government stopped paying its people.' },
    votedout:    { name: 'Removed from Office', blurb: 'The electorate exercised the option you left them. History will judge the rest.' },
    deposed:     { name: 'Deposed',           blurb: 'The legislature, the courts and the street agreed on one thing: not you.' }
  };

  /* ================================================= NAME GENERATOR BITS */
  S.NATION_NAME_PARTS = {
    hegemon:     ['Federated States', 'The Union', 'Columbia', 'Meridia', 'The Republic'],
    continental: ['Verkhova', 'Kravinia', 'Ostmark', 'Zarechya', 'Voskraya'],
    industrial:  ['Rhennland', 'Valdheim', 'Nordrhein Republic', 'Steinmark', 'Aldenberg'],
    rising:      ['Sundara', 'Mahastan', 'Ravindra', 'Jamshara', 'Ganesha Republic'],
    petro:       ['Al-Qadar', 'Emirate of Sahran', 'Bahr al-Nur', 'Zafara', 'Marjan'],
    entrepot:    ['Port Meridian', 'Selangore', 'Kalapan', 'New Anchorage', 'Straitholm'],
    developing:  ['Nueva Corona', 'San Ventura', 'Rio Verde', 'Costa Alta', 'Terranova'],
    postconflict:['Karesh', 'Duraz', 'Erbanistan', 'Valdara', 'Serrakhan']
  };
  S.LEADER_TITLES = {
    liberal: 'Prime Minister', managed: 'President', party: 'General Secretary',
    junta: 'Chairman of the Council', personalist: 'Supreme Leader',
    technocracy: 'Chief Executive', theocratic: 'Guardian'
  };

})(window.S);
