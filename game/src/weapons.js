// weapons.js — the five guns, the shared firing and damage model, and grenades.
//
// Player and bots fire through the same tryFire(), so the rules are identical for
// everyone: hitscan rays against head sphere and body capsule, zone multipliers
// (head x4, torso x1, legs x0.75), distance falloff, armour halving health damage,
// and spread that grows with movement, airtime and sustained fire (bloom) and
// shrinks when crouched or aiming down sights. Stopping to aim pays.

import { emit, RULES } from './state.js';
import { COLLIDERS } from './world.js';
import { rayWorld, rayActor, sightBlocked } from './physics.js';
import * as fx from './fx.js';

export const WEAPONS = {
  wasp: {
    name: 'P9 Wasp', slot: 'pistol', price: 0, dmg: 34, rpm: 380, auto: false,
    mag: 12, reserve: 96, reload: 1.5, pellets: 1,
    spreadHip: 0.016, spreadAds: 0.006, spreadMove: 0.055, bloomShot: 0.010, bloomMax: 0.05,
    fallStart: 18, fallEnd: 46, minFrac: 0.5, speed: 1.0, zoom: 1.15, kick: 0.011, noise: 22,
  },
  raptor: {
    name: 'Raptor-9', slot: 'primary', price: 1500, dmg: 26, rpm: 780, auto: true,
    mag: 30, reserve: 120, reload: 2.0, pellets: 1,
    spreadHip: 0.022, spreadAds: 0.011, spreadMove: 0.06, bloomShot: 0.008, bloomMax: 0.055,
    fallStart: 12, fallEnd: 34, minFrac: 0.45, speed: 0.98, zoom: 1.2, kick: 0.007, noise: 26,
  },
  mule: {
    name: 'Mule 12G', slot: 'primary', price: 1700, dmg: 13, rpm: 68, auto: false,
    mag: 6, reserve: 30, reload: 2.8, pellets: 8,
    spreadHip: 0.055, spreadAds: 0.045, spreadMove: 0.03, bloomShot: 0.02, bloomMax: 0.06,
    fallStart: 6, fallEnd: 19, minFrac: 0.3, speed: 0.95, zoom: 1.1, kick: 0.05, noise: 30,
  },
  vk7: {
    name: 'VK-7 Carbine', slot: 'primary', price: 2700, dmg: 33, rpm: 660, auto: true,
    mag: 30, reserve: 120, reload: 2.1, pellets: 1,
    spreadHip: 0.017, spreadAds: 0.004, spreadMove: 0.06, bloomShot: 0.007, bloomMax: 0.05,
    fallStart: 24, fallEnd: 62, minFrac: 0.6, speed: 0.93, zoom: 1.35, kick: 0.009, noise: 30,
  },
  longbow: {
    name: 'Longbow-7', slot: 'primary', price: 3400, dmg: 72, rpm: 150, auto: false,
    mag: 10, reserve: 40, reload: 2.4, pellets: 1,
    spreadHip: 0.03, spreadAds: 0.0006, spreadMove: 0.09, bloomShot: 0.02, bloomMax: 0.05,
    fallStart: 30, fallEnd: 95, minFrac: 0.8, speed: 0.9, zoom: 2.6, kick: 0.035, noise: 34,
  },
};

export const GRENADES = {
  frag: { name: 'Frag Charge', price: 300 },
  smoke: { name: 'Smoke Pot', price: 300 },
  flash: { name: 'Flash Pellet', price: 200 },
};

export function newWeapon(id) {
  const def = WEAPONS[id];
  return { id, def, ammo: def.mag, reserve: def.reserve, reloadT: 0, nextShot: 0, bloom: 0 };
}

export function eyePos(a) {
  return { x: a.pos.x, y: a.pos.y + 1.58 - 0.4 * a.crouchBlend, z: a.pos.z };
}

// Unit aim direction from an actor's yaw/pitch (three.js convention: yaw 0 faces -Z).
// The player's recoil offset rides on the pitch and recovers in player.js.
export function aimDir(a) {
  const pitch = a.pitch + (a.recoil || 0);
  const cp = Math.cos(pitch);
  return { x: -Math.sin(a.yaw) * cp, y: Math.sin(pitch), z: -Math.cos(a.yaw) * cp };
}

// Current spread in radians for an actor's held weapon.
export function currentSpread(a) {
  const w = a.weapon;
  if (!w) return 0;
  const def = w.def;
  const base = def.spreadHip + (def.spreadAds - def.spreadHip) * a.adsF;
  const speed = Math.hypot(a.vel.x, a.vel.z);
  const move = (speed / 5.2) * def.spreadMove * (a.crouchBlend > 0.5 ? 0.45 : 1);
  const air = a.onGround ? 0 : 0.05;
  return base + move + air + w.bloom;
}

function falloff(def, dist) {
  if (dist <= def.fallStart) return 1;
  if (dist >= def.fallEnd) return def.minFrac;
  const t = (dist - def.fallStart) / (def.fallEnd - def.fallStart);
  return 1 + (def.minFrac - 1) * t;
}

const ZONE_MULT = { head: 4, torso: 1, legs: 0.75 };

// Apply damage with armour rules, death, rewards and the charge drop.
// Returns true when the victim died.
export function applyDamage(G, victim, attacker, baseDmg, zone) {
  if (!victim.alive || baseDmg <= 0) return false;
  let dmg = baseDmg * (ZONE_MULT[zone] ?? 1);
  if (victim.armor > 0) {
    victim.armor = Math.max(0, victim.armor - dmg * 0.5);
    dmg *= 0.5;
  }
  victim.hp -= dmg;
  victim.lastHitFrom = attacker ? attacker.id : -1;
  victim.lastHitAt = G.time;
  victim.lastHitYaw = attacker ? Math.atan2(-(attacker.pos.x - victim.pos.x), -(attacker.pos.z - victim.pos.z)) : 0;
  const killed = victim.hp <= 0;
  emit(G, 'hit', { attacker, victim, zone, dmg, killed });
  if (!killed) return false;
  victim.hp = 0;
  victim.alive = false;
  victim.deaths += 1;
  victim.channel = null;
  if (attacker && attacker !== victim) {
    attacker.kills += 1;
    if (attacker.team !== victim.team) {
      attacker.money = Math.min(RULES.moneyCap, attacker.money + RULES.killReward);
    }
  }
  if (G.defuse && G.defuse.actor === victim) G.defuse = null;
  if (G.charge.carrier === victim) {
    G.charge.state = 'dropped';
    G.charge.carrier = null;
    G.charge.pos = { x: victim.pos.x, y: victim.pos.y, z: victim.pos.z };
    emit(G, 'chargeDropped', { x: victim.pos.x, z: victim.pos.z });
  }
  emit(G, 'kill', {
    attackerName: attacker ? attacker.name : 'the yard',
    victimName: victim.name,
    weapon: attacker && attacker.weapon ? attacker.weapon.def.name : '',
    headshot: zone === 'head',
    attackerTeam: attacker ? attacker.team : null,
    victimTeam: victim.team,
  });
  return true;
}

export function startReload(G, a) {
  const w = a.weapon;
  if (!w || w.reloadT > 0 || w.ammo >= w.def.mag || w.reserve <= 0) return;
  w.reloadT = w.def.reload;
  emit(G, 'reload', { actor: a });
}

// Fire the held weapon once (all pellets). Shared by the player and the bots.
export function tryFire(G, a) {
  const w = a.weapon;
  if (!w || !a.alive || a.channel || w.reloadT > 0) return false;
  if (G.phase !== 'live' && G.phase !== 'planted') return false;
  if (G.time < w.nextShot) return false;
  if (w.ammo <= 0) {
    emit(G, 'dry', { actor: a });
    w.nextShot = G.time + 0.3;
    startReload(G, a);
    return false;
  }
  const def = w.def;
  w.nextShot = G.time + 60 / def.rpm;
  w.ammo -= 1;
  w.bloom = Math.min(def.bloomMax, w.bloom + def.bloomShot);
  a.shotsFired += 1;
  G.noises.push({ x: a.pos.x, z: a.pos.z, team: a.team, t: G.time, radius: def.noise });
  if (G.noises.length > 24) G.noises.shift();

  const eye = eyePos(a);
  const dir = aimDir(a);
  // Orthonormal basis around the aim direction, for the spread cone.
  const up = Math.abs(dir.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const ux = dir.y * up.z - dir.z * up.y;
  const uy = dir.z * up.x - dir.x * up.z;
  const uz = dir.x * up.y - dir.y * up.x;
  const vx = uy * dir.z - uz * dir.y;
  const vy = uz * dir.x - ux * dir.z;
  const vz = ux * dir.y - uy * dir.x;
  const spread = currentSpread(a);
  const muzzle = {
    x: eye.x + dir.x * 0.55 - dir.z * 0.16,
    y: eye.y - 0.14 + dir.y * 0.55,
    z: eye.z + dir.z * 0.55 + dir.x * 0.16,
  };
  fx.muzzle(a, muzzle);
  emit(G, 'shot', { actor: a, weapon: def, x: eye.x, z: eye.z });

  for (let p = 0; p < def.pellets; p++) {
    const ang = spread * Math.sqrt(G.rng.next());
    const th = G.rng.next() * Math.PI * 2;
    const ca = Math.cos(th) * ang;
    const sa = Math.sin(th) * ang;
    let dx = dir.x + ux * ca + vx * sa;
    let dy = dir.y + uy * ca + vy * sa;
    let dz = dir.z + uz * ca + vz * sa;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;
    const d = { x: dx, y: dy, z: dz };
    const worldT = rayWorld(COLLIDERS, eye, d, 220);
    let bestT = worldT;
    let bestActor = null;
    let bestZone = null;
    for (const other of G.actors) {
      if (other === a || !other.alive) continue;
      const hit = rayActor(other, eye, d, Math.min(bestT, 220));
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestActor = other;
        bestZone = hit.zone;
      }
    }
    const end = { x: eye.x + dx * bestT, y: eye.y + dy * bestT, z: eye.z + dz * bestT };
    if (bestT < 220) fx.tracer(muzzle, end);
    if (bestActor) {
      applyDamage(G, bestActor, a, def.dmg * falloff(def, bestT), bestZone);
    } else if (bestT < 220) {
      fx.impact(end);
    }
  }
  if (a.isPlayer) a.recoil += def.kick;
  if (w.ammo === 0) startReload(G, a);
  return true;
}

// Per-tick weapon upkeep: reloads, bloom recovery, flash decay, grenade cooldown.
export function updateWeapon(G, a, dt) {
  const w = a.weapon;
  if (w) {
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        const take = Math.min(w.def.mag - w.ammo, w.reserve);
        w.ammo += take;
        w.reserve -= take;
        w.reloadT = 0;
      }
    }
    w.bloom = Math.max(0, w.bloom - dt * 0.075);
  }
  a.flashT = Math.max(0, a.flashT - dt);
  a.nadeCd = Math.max(0, a.nadeCd - dt);
}

// --- Grenades ---------------------------------------------------------------

export function throwGrenade(G, a, kind) {
  if (!a.alive || a.channel || a.nadeCd > 0 || a.grenades[kind] <= 0) return false;
  if (G.phase !== 'live' && G.phase !== 'planted') return false;
  a.grenades[kind] -= 1;
  a.nadeCd = 0.5;
  const eye = eyePos(a);
  const dir = aimDir(a);
  G.grenades.push({
    kind,
    thrower: a,
    x: eye.x + dir.x * 0.4,
    y: eye.y + 0.05,
    z: eye.z + dir.z * 0.4,
    vx: dir.x * 15 + a.vel.x * 0.4,
    vy: dir.y * 15 + 3.2,
    vz: dir.z * 15 + a.vel.z * 0.4,
    fuse: kind === 'frag' ? 1.6 : 1.35,
  });
  emit(G, 'throw', { actor: a, kind });
  return true;
}

function detonate(G, n) {
  const pos = { x: n.x, y: n.y, z: n.z };
  if (n.kind === 'frag') {
    fx.explosion(pos);
    emit(G, 'explosion', { x: n.x, z: n.z });
    for (const a of G.actors) {
      if (!a.alive) continue;
      const chest = { x: a.pos.x, y: a.pos.y + 1.0, z: a.pos.z };
      const dist = Math.hypot(chest.x - pos.x, chest.y - pos.y, chest.z - pos.z);
      if (dist >= 6.5) continue;
      let dmg = 10 + 92 * (1 - dist / 6.5);
      if (sightBlocked(COLLIDERS, [], pos.x, pos.y, pos.z, chest.x, chest.y, chest.z)) dmg *= 0.22;
      applyDamage(G, a, n.thrower, dmg, 'torso');
    }
  } else if (n.kind === 'smoke') {
    G.smokes.push({ x: n.x, y: n.y + 1.05, z: n.z, r: 3.1, until: G.time + 13 });
    emit(G, 'smokePop', { x: n.x, z: n.z });
  } else if (n.kind === 'flash') {
    fx.flashPop(pos);
    emit(G, 'flashPop', { x: n.x, z: n.z });
    for (const a of G.actors) {
      if (!a.alive) continue;
      const eye = eyePos(a);
      const dx = pos.x - eye.x;
      const dy = pos.y - eye.y;
      const dz = pos.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 24) continue;
      const dir = aimDir(a);
      const facing = (dir.x * dx + dir.y * dy + dir.z * dz) / dist; // 1 = staring at it
      if (facing < 0.15) continue;
      if (sightBlocked(COLLIDERS, [], eye.x, eye.y, eye.z, pos.x, pos.y, pos.z)) continue;
      const strength = (0.35 + 0.65 * facing) * (1 - dist / 26);
      a.flashT = Math.max(a.flashT, 0.5 + 2.8 * strength);
    }
  }
}

export function updateGrenades(G, dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const n = G.grenades[i];
    n.fuse -= dt;
    n.vy -= 15 * dt;
    const px = n.x;
    const py = n.y;
    const pz = n.z;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    n.z += n.vz * dt;
    if (n.y < 0.12) {
      n.y = 0.12;
      n.vy = Math.abs(n.vy) > 1.2 ? -n.vy * 0.42 : 0;
      n.vx *= 0.68;
      n.vz *= 0.68;
    }
    for (const c of COLLIDERS) {
      if (n.x > c.minX - 0.1 && n.x < c.maxX + 0.1 && n.z > c.minZ - 0.1 && n.z < c.maxZ + 0.1 && n.y < c.top) {
        if (py >= c.top) {
          n.y = c.top + 0.12;
          n.vy = Math.abs(n.vy) > 1.2 ? -n.vy * 0.42 : 0;
          n.vx *= 0.68;
          n.vz *= 0.68;
        } else if (px <= c.minX - 0.1 || px >= c.maxX + 0.1) {
          n.x = px <= c.minX - 0.1 ? c.minX - 0.11 : c.maxX + 0.11;
          n.vx = -n.vx * 0.45;
        } else if (pz <= c.minZ - 0.1 || pz >= c.maxZ + 0.1) {
          n.z = pz <= c.minZ - 0.1 ? c.minZ - 0.11 : c.maxZ + 0.11;
          n.vz = -n.vz * 0.45;
        }
      }
    }
    if (n.fuse <= 0) {
      detonate(G, n);
      G.grenades.splice(i, 1);
    }
  }
  // Expire smoke clouds.
  for (let i = G.smokes.length - 1; i >= 0; i--) {
    if (G.time > G.smokes[i].until) G.smokes.splice(i, 1);
  }
}
