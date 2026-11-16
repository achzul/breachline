// player.js — the human Warden: mouse look, movement, firing, interaction.
//
// Movement is velocity-based with ground acceleration and weak air control;
// top speed scales with the held weapon, shift-walk and crouch slow you (and
// quieten your spread), aiming down sights slows you further. The buy phase
// freezes the player. After death the camera spectates (view.js), and this
// module simply stops driving the body.

import { COLLIDERS, siteAt } from './world.js';
import { moveActor } from './physics.js';
import { tryFire, startReload, throwGrenade } from './weapons.js';
import { input, consumeLook, wasPressed } from './input.js';

const SENS = 0.0021;

export function updatePlayer(G, a, dt) {
  a.wantChannel = null;
  if (!a.alive) return;

  // Look. Recoil (a.recoil, added by weapons.js when firing) rides on top of
  // the aim pitch inside aimDir() and recovers here.
  const look = consumeLook();
  const scoped = a.weapon && a.weapon.id === 'longbow' && a.adsF > 0.7;
  const sens = SENS * (scoped ? 0.42 : 1 - a.adsF * 0.35);
  a.yaw -= look.dx * sens;
  a.pitch -= look.dy * sens;
  a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch));
  a.recoil = Math.max(0, a.recoil - dt * 0.085);

  if (G.phase === 'buy' || G.phase === 'end' || G.phase === 'idle' || G.phase === 'over') {
    a.vel.x = 0;
    a.vel.z = 0;
    input.mouseClicked = false;
    moveActor(COLLIDERS, a, dt);
    return;
  }

  // Aim down sights.
  const adsTarget = input.mouseRDown && a.weapon ? 1 : 0;
  a.adsF += Math.max(-dt * 7, Math.min(dt * 7, adsTarget - a.adsF));

  // Crouch and wish direction.
  a.crouch = input.keys.has('KeyC') || input.keys.has('ControlLeft');
  a.crouchBlend += Math.max(-dt * 8, Math.min(dt * 8, (a.crouch ? 1 : 0) - a.crouchBlend));
  const fwd = { x: -Math.sin(a.yaw), z: -Math.cos(a.yaw) };
  const right = { x: Math.cos(a.yaw), z: -Math.sin(a.yaw) };
  let wx = 0;
  let wz = 0;
  if (input.keys.has('KeyW')) { wx += fwd.x; wz += fwd.z; }
  if (input.keys.has('KeyS')) { wx -= fwd.x; wz -= fwd.z; }
  if (input.keys.has('KeyD')) { wx += right.x; wz += right.z; }
  if (input.keys.has('KeyA')) { wx -= right.x; wz -= right.z; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const walking = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  let speed = 5.2 * (a.weapon ? a.weapon.def.speed : 1);
  if (walking) speed *= 0.55;
  if (a.crouch) speed *= 0.36;
  speed *= 1 - a.adsF * 0.3;

  const blend = Math.min(1, dt * (a.onGround ? 11 : 1.4));
  a.vel.x += (wx * speed - a.vel.x) * blend;
  a.vel.z += (wz * speed - a.vel.z) * blend;
  if (wasPressed('Space') && a.onGround) a.vel.y = 5.4;
  moveActor(COLLIDERS, a, dt);

  // Weapon handling. The number keys belong to the buy menu during the buy
  // phase (hud.js polls them); the same keys are weapon/grenade shortcuts
  // only once the round is live — one key, one consumer per phase.
  if (wasPressed('KeyR')) startReload(G, a);
  if (G.phase !== 'buy') {
    if (wasPressed('Digit1') && a.weapons.primary) a.weapon = a.weapons.primary;
    if (wasPressed('Digit2')) a.weapon = a.weapons.pistol;
    if (wasPressed('Digit4')) throwGrenade(G, a, 'frag');
    if (wasPressed('Digit5')) throwGrenade(G, a, 'smoke');
    if (wasPressed('Digit6')) throwGrenade(G, a, 'flash');
  }
  if (a.weapon) {
    if (a.weapon.def.auto ? input.mouseDown : input.mouseClicked) tryFire(G, a);
  }
  input.mouseClicked = false;

  // Interact: plant when carrying at a site, defuse at a planted Charge.
  if (input.keys.has('KeyE')) {
    if (G.charge.carrier === a && siteAt(a.pos.x, a.pos.z)) {
      a.wantChannel = 'plant';
    } else if (G.phase === 'planted') {
      const d = Math.hypot(a.pos.x - G.charge.pos.x, a.pos.z - G.charge.pos.z);
      if (d < 1.9) a.wantChannel = 'defuse';
    }
  }
}
