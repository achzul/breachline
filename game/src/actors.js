// actors.js — the ten combatants: their state, and the procedural bodies
// that render them.
//
// An actor is a plain object the simulation moves (pos is its feet); its mesh
// is a small group of boxes — legs, torso, head, helmet, gun — in team colours,
// animated from the actor's own state: legs swing with speed, the body drops
// with crouchBlend, a corpse tips over and stays until the round ends. The
// player's own mesh is hidden; the camera and viewmodel stand in for it.

import * as THREE from 'three';
import { TEAM } from './state.js';
import { newWeapon } from './weapons.js';

const WARDEN_NAMES = ['Vex', 'Ondine', 'Petra', 'Marshal'];
const JACKAL_NAMES = ['Hyena', 'Copper', 'Sable', 'Ruin', 'Fenn'];

let nextId = 0;

function makeActor(team, name, isPlayer) {
  return {
    id: nextId++,
    team,
    name,
    isPlayer,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    crouch: false,
    crouchBlend: 0,
    onGround: true,
    hp: 100,
    armor: 0,
    alive: true,
    money: 0,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    weapons: { pistol: newWeapon('wasp'), primary: null },
    weapon: null, // points at one of weapons.* — the held gun
    grenades: { frag: 0, smoke: 0, flash: 0 },
    adsF: 0, // 0 hip .. 1 fully aimed
    flashT: 0,
    nadeCd: 0,
    recoil: 0, // player camera kick, recovered by player.js
    channel: null, // { kind: 'plant' | 'defuse' } while channelling
    triggerHeld: false,
    bot: null,
    mesh: null,
    deathT: 0,
    walkPhase: 0,
    lastHitFrom: -1,
    lastHitAt: -99,
    lastHitYaw: 0,
  };
}

export function createActors(G) {
  nextId = 0;
  const actors = [];
  const player = makeActor(TEAM.WARDEN, 'Rook (you)', true);
  actors.push(player);
  for (const n of WARDEN_NAMES) actors.push(makeActor(TEAM.WARDEN, n, false));
  for (const n of JACKAL_NAMES) actors.push(makeActor(TEAM.JACKAL, n, false));
  for (const a of actors) a.weapon = a.weapons.pistol;
  G.actors = actors;
  return actors;
}

// Place an actor at a spawn for a new round. Survivors keep their kit; the
// dead come back with a pistol, no armour and no grenades (rounds.js decides).
export function resetActor(a, spawn, keepLoadout) {
  a.pos = { x: spawn.x, y: 0, z: spawn.z };
  a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = spawn.yaw;
  a.pitch = 0;
  a.crouch = false;
  a.crouchBlend = 0;
  a.hp = 100;
  a.alive = true;
  a.channel = null;
  a.flashT = 0;
  a.nadeCd = 0;
  a.recoil = 0;
  a.deathT = 0;
  a.triggerHeld = false;
  if (!keepLoadout) {
    a.weapons.primary = null;
    a.weapons.pistol = newWeapon('wasp');
    a.armor = 0;
    a.grenades = { frag: 0, smoke: 0, flash: 0 };
  } else {
    // Top the held magazines back up between rounds; reserves stay spent.
    for (const key of ['pistol', 'primary']) {
      const w = a.weapons[key];
      if (w) {
        w.reloadT = 0;
        w.bloom = 0;
        w.nextShot = 0;
      }
    }
  }
  a.weapon = a.weapons.primary ?? a.weapons.pistol;
  if (a.bot) a.bot.reset = true;
}

export function aliveCount(G, team) {
  let n = 0;
  for (const a of G.actors) if (a.team === team && a.alive) n++;
  return n;
}

// --- Meshes -----------------------------------------------------------------

const MATS = {};
function mats() {
  if (MATS.warden) return MATS;
  const std = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  MATS.warden = std(0x2e6f6a);
  MATS.jackal = std(0xb07a2e);
  MATS.pants = std(0x3a3f45);
  MATS.skin = std(0xc9a189);
  MATS.dark = std(0x24262a);
  MATS.vestW = std(0x1d4a47);
  MATS.vestJ = std(0x7a521f);
  return MATS;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildActorMesh(a) {
  const M = mats();
  const teamMat = a.team === TEAM.WARDEN ? M.warden : M.jackal;
  const vestMat = a.team === TEAM.WARDEN ? M.vestW : M.vestJ;
  const g = new THREE.Group();

  const upper = new THREE.Group(); // everything above the hips; drops when crouched
  const legGeoL = new THREE.BoxGeometry(0.17, 0.8, 0.21);
  legGeoL.translate(0, -0.4, 0);
  const legL = new THREE.Mesh(legGeoL, M.pants);
  legL.position.set(-0.12, 0.8, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeoL.clone(), M.pants);
  legR.position.set(0.12, 0.8, 0);
  legR.castShadow = true;
  g.add(legL, legR);

  upper.add(box(0.47, 0.62, 0.27, teamMat, 0, 1.1, 0)); // torso
  upper.add(box(0.5, 0.4, 0.31, vestMat, 0, 1.12, 0)); // vest
  upper.add(box(0.24, 0.26, 0.26, M.skin, 0, 1.6, 0)); // head
  upper.add(box(0.29, 0.11, 0.31, teamMat, 0, 1.76, 0)); // helmet
  upper.add(box(0.09, 0.09, 0.55, M.dark, 0.3, 1.34, -0.2)); // right arm to gun
  upper.add(box(0.09, 0.09, 0.4, teamMat, -0.3, 1.3, -0.1)); // left arm
  const gun = box(0.07, 0.15, 0.66, M.dark, 0.3, 1.36, -0.42);
  upper.add(gun);
  g.add(upper);

  g.userData = { legL, legR, upper, gun };
  a.mesh = g;
  return g;
}

// Pose a mesh from its actor for this frame. Render-side only.
export function syncActorMesh(a, dt) {
  const g = a.mesh;
  if (!g) return;
  g.position.set(a.pos.x, a.pos.y, a.pos.z);
  const u = g.userData;
  if (!a.alive) {
    a.deathT = Math.min(1, a.deathT + dt * 2.6);
    const fall = a.deathT * a.deathT * 1.5;
    g.rotation.set(fall, a.yaw, 0);
    return;
  }
  g.rotation.set(0, a.yaw, 0);
  const speed = Math.hypot(a.vel.x, a.vel.z);
  if (speed > 0.4 && a.onGround) a.walkPhase += dt * speed * 1.85;
  const swing = Math.sin(a.walkPhase) * Math.min(0.65, speed * 0.14);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.upper.position.y = -0.4 * a.crouchBlend;
  u.upper.rotation.x = a.pitch * 0.35; // lean into the aim a little
  // The carried Charge rides on the carrier's back.
  const chargeBox = u.chargeBox;
  if (chargeBox) chargeBox.visible = !!a.hasCharge;
}

export function attachChargeProp(a) {
  // A small dark box with an amber light, worn on the back while carrying.
  const M = mats();
  const prop = new THREE.Group();
  const body = box(0.34, 0.24, 0.12, M.dark, 0, 0, 0);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.05, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffb020 })
  );
  lamp.position.set(0, 0.06, 0.07);
  prop.add(body, lamp);
  prop.position.set(0, 1.25, 0.24);
  prop.visible = false;
  a.mesh.userData.upper.add(prop);
  a.mesh.userData.chargeBox = prop;
}
