// state.js — the single match-state object and the rules constants.
//
// Every module reads and writes the one game object created here; nothing keeps a
// private copy of match facts. The simulation advances in fixed 1/60 steps from
// main.js, and rendering only reads state, so a match is a pure function of its
// seed and the player's inputs.

import { Rng } from './rng.js';

export const TICK = 1 / 60;

export const RULES = {
  winScore: 7, // first to 7 rounds takes the match
  buyTime: 12, // seconds, shop open, nobody moves
  roundTime: 100, // seconds of live play before the Wardens win on time
  fuseTime: 40, // seconds from plant to detonation
  endTime: 5, // banner between rounds
  plantTime: 2.8, // channel to set the Charge
  defuseTime: 5, // channel to disarm it
  startMoney: 800,
  moneyCap: 9000,
  killReward: 300,
  winReward: 1400,
  plantTeamBonus: 800, // every Jackal, once the Charge is set
  planterBonus: 300, // the planter alone, on top
  lossBonusBase: 1000, // first loss in a streak, +200 per further loss
  lossBonusStep: 200,
  lossBonusCap: 1800,
};

export const TEAM = { WARDEN: 'W', JACKAL: 'J' };

export function createGame(seed) {
  return {
    seed,
    rng: new Rng(seed),
    time: 0, // simulated seconds since match start
    phase: 'idle', // idle | buy | live | planted | end | over
    phaseT: 0, // seconds left in the current phase
    round: 0,
    score: { W: 0, J: 0 },
    lossStreak: { W: 0, J: 0 },
    actors: [], // every combatant, player first (actors.js fills this)
    charge: {
      state: 'carried', // carried | planting | dropped | planted
      carrier: null, // actor holding it, while carried/planting
      planter: null,
      site: null, // site object once planted (or targeted)
      pos: { x: 0, y: 0, z: 0 }, // world position when dropped/planted
      channel: 0, // plant channel progress, seconds
    },
    defuse: null, // { actor, t } while a Warden channels on the Charge
    grenades: [], // live thrown grenades
    smokes: [], // active smoke clouds { x, y, z, r, until }
    noises: [], // recent gunfire { x, z, team, t, radius }
    events: [], // one-frame facts for audio/fx/hud: { kind, ... }
    feed: [], // killfeed rows { text, t } newest first
    winner: null, // match winner team once phase is 'over'
    lastRound: null, // { winner, reason } for the banner
    plantedEver: false, // this round, for the plant bonuses
    frozen: false, // screenshot staging halts the simulation
    started: false,
  };
}

// Push a one-frame fact for the presentation layers (audio, fx, hud) to consume.
// The simulation never reads these back.
export function emit(G, kind, data) {
  G.events.push(Object.assign({ kind }, data));
}
