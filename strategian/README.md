# STRATEGIAN

A long-form government management simulation. You are the head of a state — which
state, and what kind of state, is up to you — and you rule on the matters that
land on your desk. Every ruling moves a simulation of the economy, society,
armed forces and international system, and every one of those systems feeds back
into the others.

It runs in a browser with no build step, no dependencies and no server.

## Playing it

Open `index.html` in any modern browser. That is the whole installation.

(If your browser is unusually strict about local files, serve the folder:
`python3 -m http.server 8000` and visit `http://localhost:8000`.)

## Setting up a game

Three choices before you start.

**The country** — eight starting positions, from a Continental Hegemon with a
reserve currency and a global alliance network down to a Post-Conflict State with
an active insurgency and a treasury that is mostly a rumour. In between: a
resurgent resource power under permanent sanctions, an industrial export republic
with world-class institutions and no army worth the name, a rising giant with a
billion people and no infrastructure, a petro-monarchy on a countdown clock, a
maritime entrepôt that survives by being indispensable, and a middle-income
republic whose creditors take your calls at inconvenient hours.

**The order** — liberal democracy, managed democracy, one-party state, military
junta, personalist autocracy, technocratic council, theocratic republic. This is
not flavour text. It determines where your legitimacy comes from, how fast policy
executes, how much repression the model will let you use before it starts
charging you for it, whether you face elections, and which ways you can lose. You
can change it later through constitutional reform — democratise, or seize
everything — at a considerable price.

**The details** — the country's name, your name, and what the currency is called.

## The departments

Eleven screens down the left rail. Everything on them is directly editable and
everything feeds the simulation.

| Screen | What you control there |
|---|---|
| **Situation Room** | The one-page view: headline indicators, internal risk board, active wars, threat assessment, factional standing, victory progress |
| **Treasury** | Departmental allocations as shares of GDP, income/corporate/consumption/wealth tax rates, anti-corruption enforcement, full revenue and spending breakdowns |
| **Economy** | The policy rate (or whether the central bank sets it at all), monetary emission, exchange-rate regime, capital controls, state ownership, regulation, labour protection, subsidies, price controls |
| **Trade & Currency** | Tariffs, non-tariff openness, foreign aid, diplomatic stance, the currency's name and symbol, and per-partner trade status from preferential to embargo |
| **Interior** | Policing, surveillance, civil liberties, press freedom, state messaging, immigration, traditionalism in law, devolution, natal policy — and the loyalty and influence of all eight factions |
| **Education & Culture** | Education, health, research, culture and welfare budgets; the split between basic schooling and universities; the cultural-affinity table for every foreign power |
| **Energy & Environment** | Energy and infrastructure budgets, the clean transition, strategic reserves, and your exposure to world commodity prices |
| **War Room** | Defence budget, doctrine, nuclear posture, conscription, readiness target, R&D share, veteran support; per-war posture and tempo; comparative force ratings for every nation |
| **Intelligence** | Service funding, the threat board, and the daily intelligence summary — whose accuracy scales with what you have spent on it |
| **Foreign Ministry** | Every foreign power, with relations, affinity, treaties and a menu of instruments: trade talks, defence pacts, arms control, energy contracts, aid packages, sanctions, ultimatums, war |
| **Records & Objectives** | Victory tracks with itemised requirements, the full decision record, the press archive, and save/export |

## Initiatives — the things you start

Every department screen opens with an **Initiatives** panel: forty-three
actions you take rather than answer. Mobilise the reserves or stand them down,
stage an exercise, deploy peacekeepers, test a warhead, sell arms, declare war.
Denounce a government by name, make a state visit, convene an international
conference, expel a mission, fly in relief. Sweep the ministries for
corruption, declare a state of emergency, or open the prisons in a general
amnesty. Stimulate, consolidate, buy back debt, found a sovereign wealth fund.

Some are one-off. Fifteen of them are **programmes**: multi-year projects that
cost a share of output every year until they finish and pay off at the end —
hospital construction, rural clinics, immunisation, literacy, universities,
foreign scholarships, arts and broadcasting, national infrastructure, grid
hardening, a high-speed rail spine, ports, mass housing, water and sanitation,
police reform, offensive cyber. You can see how far along each one is, and you
can cancel one, which wastes everything already spent.

Each action shows what it costs and why it is unavailable when it is. Anything
grave asks you to confirm.

## Decisions

Matters arrive on your desk with a source, a brief, advisers who disagree with
each other, and a deadline. Some are yes-or-no; most have three or four paths.
Each option shows its expected effects and, where relevant, the probability that
it goes wrong and what happens if it does. Those figures are the ministry's
*estimate*: what actually lands varies by up to a quarter either way, and the
error band narrows as your administrative capacity improves. Policy settings
and budget lines are exact — you pull those levers yourself.

The library is finite, so issues recur across playthroughs. What stops them
reading identically is that each arrival draws its own framing and its own
specifics — a named region, industry, firm, union or official — once, and the
brief, the advisers and the options all describe that same situation. The most
frequently-seen decisions have several genuinely different framings.

Ignoring a decision is itself a decision: when the deadline passes the most
passive available course is taken for you, and it costs you.

The clock stops itself when something urgent arrives and starts again by
itself once you have ruled on it — both halves can be turned off in the menu.
It stays stopped while anything urgent is still outstanding, and a pause you
made yourself is never undone for you.

Random events fire without warning: harvests fail, banks collapse, ministers
are found with property portfolios nobody declared, governments fall abroad.

## Aftermath

Catastrophes are meant to outlive their headline. A disaster, a pandemic, a
terrorist attack or a war leaves a **scar**: a named, dated wound with a death
toll that drags on growth, on the public mood and on the quality of whatever it
broke, and that heals over years at a rate set by how capable and solvent your
state is. You can see everything the country is still carrying on the Situation
Room and in the Records screen, with each ongoing effect itemised.

Scars are written about. The press returns to them unprompted, and prints an
anniversary piece every year while the damage is still material.

They also schedule what follows. A disaster puts a reconstruction bill on your
desk ten weeks later and an inquiry report over a year after that; a pandemic
sends you its reckoning eighteen months on; a costly war asks you what to do
about the dead. What you choose in those follow-ups shortens or lengthens the
scar, so the original catastrophe keeps mattering for as long as you let it.

Nothing catastrophic can happen while the last one is still being absorbed —
there is a seven-year floor between them, so a once-in-a-generation event is
one.

## Negotiation

When talks open you get a full negotiating table. Every issue sits on an axis
from entirely their way to entirely yours, and you build a package across all of
them.

The counterparty runs a real model. It computes a utility over the whole package
weighted by its own priorities, against a reservation level derived from actual
leverage — the battlefield position, the force ratio, its trade exposure to you,
your domestic stability, your reserve cover, whether it has grievances
outstanding. It holds hard red lines that no amount of sweetener will move, and
it concedes according to its negotiating character: a coercive power holds
everything until the last round, an institutionalist reciprocates your movement,
a strategic one trades the issues it cares least about for the ones it cares
most about.

The panel updates live as you move the sliders: your leverage and theirs, the
value of the current text to each side, their assessed minimum, their patience,
and the probability they accept. Six instruments are available beyond the text
itself — table intelligence, threaten escalation, offer a side payment, go
public, signal willingness to walk, make a goodwill gesture — and each has a
cost, and each can backfire if your leverage does not support it.

## The press

Headlines generate in real time from what actually happens. Seven outlets with
different politics report the same event differently, and which of them exist at
all depends on how free you have left the press. A state broadcaster reframes bad
news as foreign interference; an underground bulletin only appears once you have
given people a reason to read one.

## Winning and losing

**Victories** — military dominance, cultural dominance, world peace. Each has
itemised requirements, and each must be *held* for three continuous years. Nothing
is decided inside the first decade.

**Defeats** — apocalypse, military defeat, civil war, coup d'état, economic
collapse, removal from office at an election, deposition.

Games are meant to run for decades of game time across several sessions. It
autosaves every year; you can also save on demand, and export a save to a file
and import it back.

Every world is generated from a random seed, shown on the Records screen. Enter
it at setup to replay that exact world, or leave the field blank for a new one.

For calibration: across 80 games driven by a decision-maker choosing uniformly
at random, the median administration lasts about 10 years — 38% end in military
defeat, 34% in civil war, 10% at the ballot box, and 11% survive the full forty
years. A player who reads the briefs should do considerably better than that.

## Controls

`Space` pause · `1` normal · `2` fast · `I` open the next matter on your desk.
The theme toggle in the top bar switches between dark and light.

There are two running speeds. There used to be four; the fastest two expired
matters before they could be read, which made the clock the opponent.

## How the simulation is put together

```
js/util.js            seeded RNG, maths, formatting, SVG charts
js/data-world.js      archetypes, government forms, foreign powers, victory tracks
js/sim-economy.js     growth, inflation, fx, the budget, the financing constraint
js/sim-society.js     approval, unrest, legitimacy, factions, coups and civil war
js/sim-military.js    force ratings, doctrine, wars and escalation
js/sim-diplomacy.js   relations, treaties, and the behaviour of other governments
js/negotiation.js     the negotiating engine
js/news.js            the press
js/briefings.js       intelligence, military and treasury briefings
js/aftermath.js       scars, anniversaries and deferred consequences
js/actions.js         player initiatives and multi-year programmes
js/data-decisions.js  the decision library
js/data-events.js     random events
js/game.js            state, the clock, decisions, save/load, victory conditions
js/ui.js              every screen
```

A few things the model does that are worth knowing before you play:

- **Approval is relative.** People judge a government against what they are used
  to, and the reference point adapts over about three years. An improving poor
  country can be popular; a stagnating rich one cannot.
- **Repression works, and it is a loan.** Force suppresses visible unrest
  immediately while accumulating latent resentment that does not appear on any
  chart until control slips.
- **The central bank is the most stabilising institution in the model.** Taking
  direct control of it is available, effective in the short term, and permanently
  de-anchors inflation expectations.
- **Deficits are financed by someone or they are not.** Past the point where the
  market will fund you, the state cuts without asking you and prints the rest.
- **Catastrophes leave scars, and scars are capped.** Each one is a real
  standing weight on growth, mood and services, but their combined effect is
  bounded so a run of bad luck stays survivable and your own condition decides
  whether the country breaks.
- **Institutions move in years.** Education, health, infrastructure and
  administrative capacity are stocks. Benchmark funding buys a competent service;
  excellence costs considerably more, and a poor country cannot buy a rich
  country's outcomes at any share of a small GDP.

## Building the single-file version

`node build.js` writes two self-contained files into `dist/`:

- `strategian.html` — a complete page with everything inlined. Open it directly
  from disk, email it, drop it on any static host. No server required.
- `fragment.html` — the same content without the document shell, for hosts that
  supply their own `<head>` and `<body>`.

The build has no dependencies and no minifier: the output stays readable.
