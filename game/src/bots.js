// bots.js — bot brains: perception, round plans, pathfinding, combat, shopping.
//
// Each bot thinks ten times a second (staggered by id) and moves every tick.
// Perception is honest: a view cone and a sight line (smoke blocks it), hearing
// from the shared gunfire-noise log, and a six-second memory of last seen
// positions. Plans are team-level and made at round start: the Jackals pick a
// site, push it in a group with a lurk through the other lane; the Wardens hold
// set positions, then rotate to retake once the Charge is planted. Combat uses
// the same fire() path as the player, with reaction delays, burst discipline,
// aim error and a friendly-fire line check.

import { TEAM, RULES } from './state.js';
import { COLLIDERS, NODES, SITES, nearestNode, findPath, siteAt } from './world.js';
import { sightBlocked } from './physics.js';
import { WEAPONS, tryFire, startReload, throwGrenade, eyePos } from './weapons.js';
import { buyItem } from './rounds.js';

const FOV_COS = Math.cos(1.0); // ~115 degree cone
const MEMORY = 6;

export function makeBot(G, a) {
  const bot = {
    role: 'hold',
    skill: G.rng.range(0.85, 1.2),
    react: G.rng.range(0.27, 0.46),
    thinkT: (a.id % 6) * 0.016,
    path: [],
    pathI: 0,
    goalNode: -1,
    holdPos: null,
    watchYaw: 0,
    visible: null,
    firstSeenT: -99,
    lastSeen: null,
    lastSeenT: -99,
    burstLeft: 0,
    burstPauseT: 0,
    aimErr: 0.03,
    strafeDir: 1,
    strafeT: 0,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    nadeT: 0,
    smokedEntry: false,
    planSite: null,
    waitUntil: 0,
    crouchHold: false,
  };
  a.bot = bot;
  return bot;
}

function yawTo(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

function setPath(G, a, nodeIdx) {
  const bot = a.bot;
  const from = nearestNode(a.pos.x, a.pos.z);
  const path = findPath(from, nodeIdx);
  bot.path = path ?? [nodeIdx];
  bot.pathI = 0;
  bot.goalNode = nodeIdx;
}

function setPathToPos(G, a, x, z) {
  setPath(G, a, nearestNode(x, z));
  a.bot.finalPos = { x, z };
}

// --- Round plans --------------------------------------------------------------

const HOLDS = [
  { x: -20.5, z: -8.5, watch: [-25, -15] }, // Foundry main
  { x: 20.5, z: -8.5, watch: [25, -15] }, // Silos main
  { x: -29.5, z: 1.5, watch: [-25, 9] }, // Foundry deep
  { x: 29.5, z: 1.5, watch: [25, 9] }, // Silos deep
  { x: 0, z: -12.5, watch: [0, 8] }, // platform over mid
];

export function planRound(G) {
  const wardens = G.actors.filter((a) => a.team === TEAM.WARDEN && !a.isPlayer);
  const jackals = G.actors.filter((a) => a.team === TEAM.JACKAL);
  const site = G.rng.chance(0.5) ? SITES[0] : SITES[1];
  const other = site === SITES[0] ? SITES[1] : SITES[0];

  // Wardens: rotate the hold table by round so positions are not identical
  // every round; the platform bot is always the last one.
  const rot = (G.round - 1) % HOLDS.length;
  wardens.forEach((a, i) => {
    const bot = a.bot;
    const hold = HOLDS[(i + rot) % HOLDS.length];
    bot.role = 'hold';
    bot.holdPos = { x: hold.x, z: hold.z };
    bot.watchYaw = yawTo(hold.x, hold.z, hold.watch[0], hold.watch[1]);
    bot.planSite = null;
    bot.finalPos = null;
    setPathToPos(G, a, hold.x, hold.z);
  });

  // Jackals: a carrier, two pushing with it, one mid, one lurk.
  const carrier = jackals[G.rng.int(0, jackals.length - 1)];
  G.charge.carrier = carrier;
  G.charge.state = 'carried';
  const entryNode = site.id === 'A' ? 22 : 23;
  const siteNode = site.id === 'A' ? 6 : 9;
  const lurkNodes = other.id === 'A' ? [22] : [23];
  let pushCount = 0;
  jackals.forEach((a, i) => {
    const bot = a.bot;
    bot.planSite = site;
    bot.smokedEntry = false;
    bot.finalPos = null;
    bot.stage = 0;
    bot.entryNode = entryNode;
    bot.siteNode = siteNode;
    if (a === carrier) {
      bot.role = 'carrier';
      setPath(G, a, entryNode); // travel with the escorts, then follow through
    } else if (i === jackals.length - 1) {
      bot.role = 'lurk';
      setPath(G, a, lurkNodes[0]);
      bot.waitUntil = G.time + G.rng.range(16, 26);
    } else if (pushCount === 2) {
      bot.role = 'mid';
      setPath(G, a, 14);
    } else {
      bot.role = 'push';
      pushCount++;
      setPath(G, a, entryNode);
    }
  });
}

// --- Shopping -----------------------------------------------------------------

const PRIMARY_PREFS = ['vk7', 'raptor', 'mule', 'longbow'];

export function botShop(G, a) {
  const bot = a.bot;
  const m = a.money;
  const broke = m < 2400 && G.lossStreak[a.team] >= 2;
  if (!broke) {
    if (!a.weapons.primary) {
      // Buy the best affordable primary, preferring this bot's taste.
      const prefs = PRIMARY_PREFS.slice(bot.id % 4).concat(PRIMARY_PREFS.slice(0, bot.id % 4));
      for (const id of prefs) {
        const price = WEAPONS[id].price;
        if (m - price >= 650 && buyItem(G, a, id)) break; // keep vest money
        if (id === 'raptor' && m >= price && buyItem(G, a, id)) break;
      }
    }
    if (a.armor < 60) buyItem(G, a, 'vest');
    if (a.money >= 700 && a.grenades.frag === 0) buyItem(G, a, 'frag');
    if ((bot.role === 'push' || bot.role === 'carrier' || bot.role === 'lurk') && a.grenades.smoke === 0) buyItem(G, a, 'smoke');
    if ((bot.role === 'push' || bot.role === 'lurk') && a.grenades.flash === 0 && a.money >= 500) buyItem(G, a, 'flash');
  } else {
    if (m > 1600 && a.armor < 60) buyItem(G, a, 'vest');
    if (m >= 900 && a.grenades.flash === 0) buyItem(G, a, 'flash');
  }
}

// --- Perception ---------------------------------------------------------------

function perceive(G, a) {
  const bot = a.bot;
  const eye = eyePos(a);
  let best = null;
  let bestD = Infinity;
  for (const e of G.actors) {
    if (e.team === a.team || !e.alive) continue;
    const dx = e.pos.x - a.pos.x;
    const dz = e.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 70) continue;
    let seen = dist < 3.2;
    if (!seen) {
      const fx = -Math.sin(a.yaw);
      const fz = -Math.cos(a.yaw);
      const dot = (dx * fx + dz * fz) / (dist || 1);
      if (dot < FOV_COS) continue;
      seen = !sightBlocked(COLLIDERS, G.smokes, eye.x, eye.y, eye.z, e.pos.x, e.pos.y + 1.25, e.pos.z);
    }
    if (seen && dist < bestD) {
      bestD = dist;
      best = e;
    }
  }
  if (best) {
    if (bot.visible !== best) {
      bot.firstSeenT = G.time;
      bot.aimErr = 0.028 * bot.skill;
    }
    bot.visible = best;
    bot.lastSeen = { x: best.pos.x, z: best.pos.z };
    bot.lastSeenT = G.time;
  } else {
    bot.visible = null;
    // Hearing: fresh enemy gunfire inside its radius refreshes memory.
    for (let i = G.noises.length - 1; i >= 0; i--) {
      const n = G.noises[i];
      if (n.team === a.team || G.time - n.t > 1.4) continue;
      const d = Math.hypot(n.x - a.pos.x, n.z - a.pos.z);
      if (d < n.radius) {
        bot.lastSeen = { x: n.x, z: n.z };
        bot.lastSeenT = G.time;
        break;
      }
    }
  }
}

// --- Movement -----------------------------------------------------------------

function steer(G, a, tx, tz, dt, speedMul) {
  const bot = a.bot;
  const dx = tx - a.pos.x;
  const dz = tz - a.pos.z;
  const dist = Math.hypot(dx, dz);
  const def = a.weapon ? a.weapon.def : WEAPONS.wasp;
  const maxSpeed = 5.2 * def.speed * speedMul;
  let dvx = 0;
  let dvz = 0;
  if (dist > 0.05) {
    dvx = (dx / dist) * Math.min(maxSpeed, dist * 2.2);
    dvz = (dz / dist) * Math.min(maxSpeed, dist * 2.2);
  }
  const blend = Math.min(1, dt * 9);
  a.vel.x += (dvx - a.vel.x) * blend;
  a.vel.z += (dvz - a.vel.z) * blend;
  // Face the walk direction unless a caller already set the aim this tick.
  if (dist > 0.4 && !bot.aiming) {
    turnToward(a, Math.atan2(-dx, -dz), dt, 9);
  }
  // Stuck recovery: commanded to move but going nowhere -> hop and re-path.
  const moved = Math.hypot(a.pos.x - bot.lastX, a.pos.z - bot.lastZ);
  if (dist > 1.5 && moved < 0.02) {
    bot.stuckT += dt;
    if (bot.stuckT > 0.7) {
      bot.stuckT = 0;
      if (a.onGround) a.vel.y = 5.2;
      if (bot.goalNode >= 0) setPath(G, a, bot.goalNode);
    }
  } else {
    bot.stuckT = Math.max(0, bot.stuckT - dt);
  }
  bot.lastX = a.pos.x;
  bot.lastZ = a.pos.z;
  return dist;
}

function turnToward(a, targetYaw, dt, rate) {
  let diff = targetYaw - a.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  a.yaw += step;
  return Math.abs(diff) < 0.02;
}

// Follow the node path; returns true on arrival at the final goal.
function followPath(G, a, dt, speedMul) {
  const bot = a.bot;
  if (bot.pathI >= bot.path.length) {
    if (bot.finalPos) {
      return steer(G, a, bot.finalPos.x, bot.finalPos.z, dt, speedMul) < 0.6;
    }
    return true;
  }
  const node = NODES[bot.path[bot.pathI]];
  const d = steer(G, a, node.x, node.z, dt, speedMul);
  if (d < 1.15) bot.pathI++;
  return false;
}

function stopActor(a, dt) {
  a.vel.x *= Math.max(0, 1 - dt * 10);
  a.vel.z *= Math.max(0, 1 - dt * 10);
}

// --- Combat -------------------------------------------------------------------

function friendlyInLine(G, a, dirX, dirZ, maxDist) {
  for (const t of G.actors) {
    if (t === a || t.team !== a.team || !t.alive) continue;
    const rx = t.pos.x - a.pos.x;
    const rz = t.pos.z - a.pos.z;
    const along = rx * dirX + rz * dirZ;
    if (along < 0.5 || along > maxDist) continue;
    const lat = Math.abs(rx * dirZ - rz * dirX);
    if (lat < 0.85) return true;
  }
  return false;
}

function combat(G, a, dt) {
  const bot = a.bot;
  const e = bot.visible;
  if (!e) return false;
  bot.aiming = true;
  const dist = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
  // Aim at the chest, leading a moving target a little.
  const lead = Math.min(0.22, dist / 160);
  const tx = e.pos.x + e.vel.x * lead;
  const tz = e.pos.z + e.vel.z * lead;
  const ty = e.pos.y + 1.28 - 0.35 * e.crouchBlend;
  const eye = eyePos(a);
  const desiredYaw = Math.atan2(-(tx - eye.x), -(tz - eye.z));
  const desiredPitch = Math.atan2(ty - eye.y, Math.hypot(tx - eye.x, tz - eye.z));
  turnToward(a, desiredYaw, dt, 7.5);
  let pdiff = desiredPitch - a.pitch;
  a.pitch += Math.max(-5 * dt, Math.min(5 * dt, pdiff));
  bot.aimErr = Math.max(0.009 * bot.skill, bot.aimErr - dt * 0.02);
  a.adsF = Math.min(1, a.adsF + dt * 3);

  // Movement while fighting: close in when far, strafe when near, stop to burst.
  const firing = bot.burstLeft > 0;
  if (dist > 24) {
    steer(G, a, tx, tz, dt, 0.92);
  } else if (dist < 6) {
    steer(G, a, a.pos.x - (tx - a.pos.x) * 0.2 + bot.strafeDir, a.pos.z - (tz - a.pos.z) * 0.2, dt, 0.7);
  } else if (!firing) {
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeT = G.rng.range(0.6, 1.3);
      bot.strafeDir = G.rng.chance(0.5) ? 1 : -1;
    }
    const px = -Math.cos(a.yaw) * bot.strafeDir;
    const pz = Math.sin(a.yaw) * bot.strafeDir;
    steer(G, a, a.pos.x + px * 3, a.pos.z + pz * 3, dt, 0.55);
  } else {
    stopActor(a, dt);
  }

  // Fire control.
  if (bot.burstPauseT > 0) {
    bot.burstPauseT -= dt;
    return true;
  }
  if (G.time - bot.firstSeenT < bot.react) return true;
  const dirX = -Math.sin(a.yaw);
  const dirZ = -Math.cos(a.yaw);
  if (friendlyInLine(G, a, dirX, dirZ, dist)) return true;
  if (bot.burstLeft <= 0) bot.burstLeft = G.rng.int(3, 6);
  const saveYaw = a.yaw;
  const savePitch = a.pitch;
  a.yaw += G.rng.jitter(bot.aimErr);
  a.pitch += G.rng.jitter(bot.aimErr * 0.7);
  const shot = tryFire(G, a);
  a.yaw = saveYaw;
  a.pitch = savePitch;
  if (shot) {
    bot.burstLeft--;
    if (bot.burstLeft <= 0) bot.burstPauseT = G.rng.range(0.24, 0.42);
  } else if (a.weapon && a.weapon.ammo === 0) {
    startReload(G, a);
    bot.burstPauseT = 0.3;
  }
  // Occasional frag at a mid-range visible enemy.
  if (a.grenades.frag > 0 && dist > 9 && dist < 24 && G.time > bot.nadeT && G.rng.chance(0.012)) {
    bot.nadeT = G.time + 7;
    a.pitch += 0.16;
    throwGrenade(G, a, 'frag');
    a.pitch -= 0.16;
  }
  return true;
}

// --- Main update ----------------------------------------------------------------

export function updateBot(G, a, dt) {
  const bot = a.bot;
  if (!a.alive) return;
  bot.aiming = false;
  a.wantChannel = null;

  bot.thinkT -= dt;
  if (bot.thinkT <= 0) {
    bot.thinkT = 0.1;
    perceive(G, a);
  }
  if (G.phase === 'buy' || G.phase === 'end' || G.phase === 'idle') {
    stopActor(a, dt);
    return;
  }

  const memoryFresh = bot.lastSeen && G.time - bot.lastSeenT < MEMORY;

  // A carrier mid-plant commits to the channel: combat does not pull it off
  // unless a visible enemy is close enough to matter (inside 8 m).
  if (G.charge.state === 'planting' && G.charge.carrier === a) {
    const closeThreat = bot.visible &&
      Math.hypot(bot.visible.pos.x - a.pos.x, bot.visible.pos.z - a.pos.z) < 8;
    if (!closeThreat) {
      stopActor(a, dt);
      a.wantChannel = 'plant';
      a.crouch = false;
      return;
    }
  }

  const inCombat = combat(G, a, dt);
  if (!inCombat) a.adsF = Math.max(0, a.adsF - dt * 3);

  // Reload in quiet moments.
  if (!bot.visible && a.weapon && a.weapon.ammo === 0) startReload(G, a);
  if (!bot.visible && a.weapon && a.weapon.reloadT === 0 && a.weapon.ammo < a.weapon.def.mag * 0.35 && !memoryFresh) {
    startReload(G, a);
  }

  const plantedSite = G.phase === 'planted' ? G.charge.site : null;

  if (!inCombat) {
    if (a.team === TEAM.WARDEN) updateWarden(G, a, dt, plantedSite, memoryFresh);
    else updateJackal(G, a, dt, plantedSite, memoryFresh);
  }
  a.crouch = !!bot.crouchHold;
  bot.crouchHold = false;
}

function updateWarden(G, a, dt, plantedSite, memoryFresh) {
  const bot = a.bot;
  if (plantedSite) {
    // Retake: path to the site, then find the Charge and channel on it.
    const dx = G.charge.pos.x - a.pos.x;
    const dz = G.charge.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.6) {
      stopActor(a, dt);
      turnToward(a, Math.atan2(-dx, -dz), dt, 8);
      a.wantChannel = 'defuse';
      return;
    }
    if (bot.goalNode !== nearestNode(G.charge.pos.x, G.charge.pos.z) || bot.pathI >= bot.path.length) {
      setPathToPos(G, a, G.charge.pos.x, G.charge.pos.z);
    }
    followPath(G, a, dt, 1);
    return;
  }
  if (G.charge.state === 'planted') return; // phase flips next tick
  // Hold the assigned position; face the watch direction, or the last contact.
  const arrived = followPath(G, a, dt, 1);
  if (arrived) {
    stopActor(a, dt);
    bot.crouchHold = true;
    let yaw = bot.watchYaw + Math.sin(G.time * 0.35 + a.id * 1.7) * 0.35;
    if (memoryFresh && bot.lastSeen) yaw = yawTo(a.pos.x, a.pos.z, bot.lastSeen.x, bot.lastSeen.z);
    turnToward(a, yaw, dt, 4);
    bot.crouchHold = !(memoryFresh && bot.visible);
  } else if (memoryFresh && bot.lastSeen && G.rng.chance(0.004)) {
    // A close, fresh contact pulls one holder off position to check it.
    setPathToPos(G, a, bot.lastSeen.x, bot.lastSeen.z);
  }
}

function updateJackal(G, a, dt, plantedSite, memoryFresh) {
  const bot = a.bot;
  const site = bot.planSite;

  // Whoever picks the Charge up becomes the carrier, with the plan that
  // goes with it (the original carrier may be dead).
  if (G.charge.carrier === a && bot.role !== 'carrier' && G.charge.state === 'carried') {
    bot.role = 'carrier';
    bot.stage = 1;
    setPath(G, a, bot.siteNode);
  }

  if (plantedSite) {
    // Post-plant: settle near the Charge and watch the approaches.
    const guard = guardSpot(a, plantedSite);
    const d = steer(G, a, guard.x, guard.z, dt, 1);
    if (d < 0.8) {
      stopActor(a, dt);
      bot.crouchHold = true;
      const yaw = memoryFresh && bot.lastSeen
        ? yawTo(a.pos.x, a.pos.z, bot.lastSeen.x, bot.lastSeen.z)
        : yawTo(a.pos.x, a.pos.z, plantedSite.x + (a.pos.x > plantedSite.x ? 14 : -14), a.pos.z);
      turnToward(a, yaw, dt, 4);
    }
    return;
  }

  if (G.charge.state === 'dropped' && bot.role !== 'lurk') {
    // Someone close goes back for the Charge.
    const dCharge = Math.hypot(G.charge.pos.x - a.pos.x, G.charge.pos.z - a.pos.z);
    const mine = jackalNearestToCharge(G) === a;
    if (mine && dCharge > 1.2) {
      setPathToPos(G, a, G.charge.pos.x, G.charge.pos.z);
      followPath(G, a, dt, 1);
      return;
    }
    if (mine) {
      stopActor(a, dt);
      return; // rounds.js picks it up this tick
    }
  }

  switch (bot.role) {
    case 'carrier': {
      if (bot.stage === 0) {
        // Stage 0: move with the escort group to the site entry.
        const arrived = followPath(G, a, dt, 1);
        if (arrived) {
          bot.stage = 1;
          setPath(G, a, bot.siteNode);
        }
        break;
      }
      const arrived = followPath(G, a, dt, 1);
      const atSite = siteAt(a.pos.x, a.pos.z) === site;
      if (arrived || atSite) {
        stopActor(a, dt);
        // Plant unless an enemy is visibly close, or a very fresh contact
        // is within a few metres — escorts cover the rest.
        let threat = false;
        if (bot.visible) {
          const d = Math.hypot(bot.visible.pos.x - a.pos.x, bot.visible.pos.z - a.pos.z);
          threat = d < 12;
        } else if (bot.lastSeen && G.time - bot.lastSeenT < 2) {
          threat = Math.hypot(bot.lastSeen.x - a.pos.x, bot.lastSeen.z - a.pos.z) < 7;
        }
        if (atSite && !threat) a.wantChannel = 'plant';
        else if (bot.lastSeen) turnToward(a, yawTo(a.pos.x, a.pos.z, bot.lastSeen.x, bot.lastSeen.z), dt, 5);
      }
      break;
    }
    case 'push': {
      if (bot.stage === 0) {
        // Stage 0: to the site entry. Smoke it on arrival, then follow through.
        const arrived = followPath(G, a, dt, 1);
        if (arrived) {
          bot.stage = 1;
          if (!bot.smokedEntry && a.grenades.smoke > 0) {
            bot.smokedEntry = true;
            a.yaw = yawTo(a.pos.x, a.pos.z, site.x, site.z);
            a.pitch = 0.1;
            throwGrenade(G, a, 'smoke');
            a.pitch = 0;
          }
          setPath(G, a, bot.siteNode);
        }
      } else if (bot.stage === 1) {
        // Stage 1: into the site with the carrier.
        const arrived = followPath(G, a, dt, 1);
        if (arrived) bot.stage = 2;
      } else {
        // Stage 2: hold a guard spot on the site, watching outward.
        const guard = guardSpot(a, site);
        const d = steer(G, a, guard.x, guard.z, dt, 1);
        if (d < 0.9) {
          stopActor(a, dt);
          const yaw = memoryFresh && bot.lastSeen
            ? yawTo(a.pos.x, a.pos.z, bot.lastSeen.x, bot.lastSeen.z)
            : yawTo(a.pos.x, a.pos.z, a.pos.x + (a.pos.x - site.x), a.pos.z + (a.pos.z - site.z));
          turnToward(a, yaw, dt, 4);
        }
      }
      break;
    }
    case 'mid': {
      const arrived = followPath(G, a, dt, 0.95);
      if (arrived) {
        // Rotate to the plant site late, or as soon as the attack commits
        // (first contact, or a Jackal down).
        if (G.phaseT < 45 || attackCommitted(G)) {
          setPath(G, a, site.id === 'A' ? 6 : 9);
          bot.role = 'push';
          bot.stage = 1;
        } else {
          stopActor(a, dt);
          bot.crouchHold = true;
          turnToward(a, yawTo(a.pos.x, a.pos.z, site.x, site.z), dt, 3);
        }
      }
      break;
    }
    case 'lurk': {
      if (G.time < bot.waitUntil && G.phase === 'live' && !attackCommitted(G)) {
        const arrived = followPath(G, a, dt, 0.8);
        if (arrived) {
          stopActor(a, dt);
          bot.crouchHold = true;
          turnToward(a, bot.watchYaw || yawTo(a.pos.x, a.pos.z, site.x, site.z), dt, 3);
        }
      } else {
        // Late lurk: come through the north link into the plant site.
        if (bot.role === 'lurk') {
          bot.role = 'push';
          if (a.grenades.flash > 0) {
            a.yaw = yawTo(a.pos.x, a.pos.z, site.x, site.z);
            throwGrenade(G, a, 'flash');
          }
          setPath(G, a, site.id === 'A' ? 6 : 9);
        }
        followPath(G, a, dt, 1);
      }
      break;
    }
    default:
      followPath(G, a, dt, 1);
  }
}

// Has the attack committed? First visual contact by any Jackal, or a Jackal
// death, pulls the lurk and the mid bot into the plant site.
function attackCommitted(G) {
  for (const a of G.actors) {
    if (a.team !== TEAM.JACKAL) continue;
    if (!a.alive) return true;
    if (a.bot && a.bot.visible) return true;
  }
  return false;
}

function guardSpot(a, site) {
  // Four rough guard posts around a planted site, picked by actor id.
  const spots = [
    { x: site.x - 4, z: site.z - 4 },
    { x: site.x + 4, z: site.z + 3 },
    { x: site.x - 3, z: site.z + 5 },
    { x: site.x + 5, z: site.z - 3 },
    { x: site.x, z: site.z + 6 },
  ];
  return spots[a.id % spots.length];
}

function jackalNearestToCharge(G) {
  let best = null;
  let bestD = Infinity;
  for (const a of G.actors) {
    if (a.team !== TEAM.JACKAL || !a.alive) continue;
    const d = Math.hypot(G.charge.pos.x - a.pos.x, G.charge.pos.z - a.pos.z);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}
