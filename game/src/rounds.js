// rounds.js — the match flow: phases, the plant/defuse channels, the economy
// and the buy menu's rules.
//
// Phase machine: buy (12 s, frozen, shop open) -> live (100 s) -> planted
// (40 s fuse) -> end (5 s banner) -> next round, until a team reaches 7.
// Wins come from elimination, the clock, detonation or a defuse. Money:
// kill +300 (in weapons.js), round win +1400, an escalating loss bonus, and
// the plant bonuses paid the moment the Charge is set. Survivors keep their
// kit between rounds; the dead come back with a pistol.

import { RULES, TEAM, emit } from './state.js';
import { SPAWNS, siteAt } from './world.js';
import { resetActor, aliveCount } from './actors.js';
import { planRound, botShop } from './bots.js';
import { WEAPONS, GRENADES, newWeapon } from './weapons.js';

const VEST_PRICE = 650;
export const GRENADE_CAPS = { frag: 2, smoke: 1, flash: 2 };

export function startMatch(G) {
  G.score = { W: 0, J: 0 };
  G.lossStreak = { W: 0, J: 0 };
  G.round = 0;
  G.winner = null;
  for (const a of G.actors) {
    a.money = RULES.startMoney;
    a.kills = 0;
    a.deaths = 0;
    a.alive = false; // nobody "survives" into round 1: full reset
  }
  startRound(G);
}

export function startRound(G) {
  G.round += 1;
  G.phase = 'buy';
  G.phaseT = RULES.buyTime;
  G.plantedEver = false;
  G.defuse = null;
  G.grenades.length = 0;
  G.smokes.length = 0;
  G.noises.length = 0;
  G.charge = { state: 'carried', carrier: null, planter: null, site: null, pos: { x: 0, y: 0, z: 0 }, channel: 0 };
  const wardens = G.actors.filter((a) => a.team === TEAM.WARDEN);
  const jackals = G.actors.filter((a) => a.team === TEAM.JACKAL);
  wardens.forEach((a, i) => resetActor(a, SPAWNS.W[i], a.alive));
  jackals.forEach((a, i) => resetActor(a, SPAWNS.J[i], a.alive));
  planRound(G);
  for (const a of G.actors) if (a.bot) botShop(G, a);
  emit(G, 'roundStart', { round: G.round });
}

export function buyItem(G, a, itemId) {
  if (G.phase !== 'buy' || !a.alive) return false;
  if (WEAPONS[itemId]) {
    const def = WEAPONS[itemId];
    if (a.money < def.price) return false;
    if (a.weapons[def.slot] && a.weapons[def.slot].id === itemId) return false;
    a.money -= def.price;
    a.weapons[def.slot] = newWeapon(itemId);
    a.weapon = a.weapons[def.slot];
    emit(G, 'buy', { actor: a });
    return true;
  }
  if (itemId === 'vest') {
    if (a.money < VEST_PRICE || a.armor >= 100) return false;
    a.money -= VEST_PRICE;
    a.armor = 100;
    emit(G, 'buy', { actor: a });
    return true;
  }
  if (GRENADES[itemId]) {
    if (a.money < GRENADES[itemId].price) return false;
    if (a.grenades[itemId] >= GRENADE_CAPS[itemId]) return false;
    a.money -= GRENADES[itemId].price;
    a.grenades[itemId] += 1;
    emit(G, 'buy', { actor: a });
    return true;
  }
  return false;
}

export function buyPrice(itemId) {
  if (WEAPONS[itemId]) return WEAPONS[itemId].price;
  if (itemId === 'vest') return VEST_PRICE;
  if (GRENADES[itemId]) return GRENADES[itemId].price;
  return 0;
}

function endRound(G, winner, reason) {
  const loser = winner === TEAM.WARDEN ? TEAM.JACKAL : TEAM.WARDEN;
  G.score[winner] += 1;
  G.lossStreak[winner] = 0;
  G.lossStreak[loser] += 1;
  const lossBonus = Math.min(
    RULES.lossBonusCap,
    RULES.lossBonusBase + RULES.lossBonusStep * (G.lossStreak[loser] - 1)
  );
  for (const a of G.actors) {
    const gain = a.team === winner ? RULES.winReward : lossBonus;
    a.money = Math.min(RULES.moneyCap, a.money + gain);
    a.channel = null;
  }
  G.lastRound = { winner, reason };
  G.defuse = null;
  G.phase = 'end';
  G.phaseT = RULES.endTime;
  if (G.score[winner] >= RULES.winScore) G.winner = winner;
  emit(G, 'roundEnd', { winner, reason });
}

function completePlant(G) {
  const c = G.charge;
  const planter = c.carrier;
  c.state = 'planted';
  c.planter = planter;
  c.pos = { x: planter.pos.x, y: planter.pos.y, z: planter.pos.z };
  c.carrier = null;
  c.channel = 0;
  planter.channel = null;
  G.plantedEver = true;
  G.phase = 'planted';
  G.phaseT = RULES.fuseTime;
  G.beepT = 0;
  for (const a of G.actors) {
    if (a.team === TEAM.JACKAL) a.money = Math.min(RULES.moneyCap, a.money + RULES.plantTeamBonus);
  }
  planter.money = Math.min(RULES.moneyCap, planter.money + RULES.planterBonus);
  emit(G, 'planted', { site: c.site });
}

function speedOf(a) {
  return Math.hypot(a.vel.x, a.vel.z);
}

// Plant and defuse channels, driven by each actor's wantChannel intent
// (set by player input or bot decisions) and cancelled by moving or dying.
function updateChannels(G, dt) {
  const c = G.charge;
  // Plant.
  if (G.phase === 'live' && c.carrier && c.carrier.alive) {
    const carrier = c.carrier;
    const site = siteAt(carrier.pos.x, carrier.pos.z);
    if (carrier.wantChannel === 'plant' && site && speedOf(carrier) < 0.9) {
      if (c.state !== 'planting') {
        c.state = 'planting';
        c.site = site;
        c.channel = 0;
        emit(G, 'plantStart', { site });
      }
      carrier.channel = { kind: 'plant' };
      c.channel += dt;
      if (c.channel >= RULES.plantTime) completePlant(G);
    } else if (c.state === 'planting') {
      c.state = 'carried';
      c.channel = 0;
      carrier.channel = null;
    }
  }
  // Defuse.
  if (G.phase === 'planted') {
    let defuser = null;
    for (const a of G.actors) {
      if (!a.alive || a.team !== TEAM.WARDEN || a.wantChannel !== 'defuse') continue;
      const d = Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z);
      if (d < 1.9 && speedOf(a) < 0.9) {
        defuser = a;
        break;
      }
    }
    if (defuser) {
      if (!G.defuse || G.defuse.actor !== defuser) G.defuse = { actor: defuser, t: 0 };
      defuser.channel = { kind: 'defuse' };
      G.defuse.t += dt;
      if (G.defuse.t >= RULES.defuseTime) {
        endRound(G, TEAM.WARDEN, 'defuse');
        return;
      }
    } else if (G.defuse) {
      G.defuse.actor.channel = null;
      G.defuse = null;
    }
  }
  // Pick up a dropped Charge by walking over it.
  if (c.state === 'dropped' && G.phase === 'live') {
    for (const a of G.actors) {
      if (!a.alive || a.team !== TEAM.JACKAL) continue;
      const d = Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z);
      if (d < 1.3) {
        c.state = 'carried';
        c.carrier = a;
        emit(G, 'chargePickup', { actor: a });
        break;
      }
    }
  }
}

export function updateRounds(G, dt) {
  // The carried-Charge prop follows whoever holds it.
  for (const a of G.actors) {
    a.hasCharge = G.charge.carrier === a && (G.charge.state === 'carried' || G.charge.state === 'planting');
  }
  if (G.phase === 'buy') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      G.phase = 'live';
      G.phaseT = RULES.roundTime;
      emit(G, 'live', {});
    }
    return;
  }
  if (G.phase === 'live') {
    updateChannels(G, dt);
    if (G.phase !== 'live') return; // a plant just flipped the phase
    G.phaseT -= dt;
    if (aliveCount(G, TEAM.JACKAL) === 0) endRound(G, TEAM.WARDEN, 'elimination');
    else if (aliveCount(G, TEAM.WARDEN) === 0) endRound(G, TEAM.JACKAL, 'elimination');
    else if (G.phaseT <= 0) endRound(G, TEAM.WARDEN, 'time');
    return;
  }
  if (G.phase === 'planted') {
    updateChannels(G, dt);
    if (G.phase !== 'planted') return; // defused
    G.phaseT -= dt;
    // The fuse beeps faster as it burns down.
    G.beepT = (G.beepT ?? 0) - dt;
    if (G.beepT <= 0) {
      G.beepT = G.phaseT > 20 ? 1.0 : G.phaseT > 8 ? 0.5 : 0.25;
      emit(G, 'beep', { urgent: G.phaseT <= 8 });
    }
    if (aliveCount(G, TEAM.WARDEN) === 0) endRound(G, TEAM.JACKAL, 'elimination');
    else if (G.phaseT <= 0) endRound(G, TEAM.JACKAL, 'detonation');
    return;
  }
  if (G.phase === 'end') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      if (G.winner) {
        G.phase = 'over';
        emit(G, 'matchEnd', { winner: G.winner });
      } else {
        startRound(G);
      }
    }
  }
}
