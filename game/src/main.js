// main.js — bootstrap and the game loop.
//
// The simulation runs on a fixed 60 Hz step, accumulated from rAF time and
// capped so a stalled tab cannot spiral; rendering reads state afterwards.
// Order inside a step: player, bots, movement integration for bots, weapon
// upkeep, grenades, then the round machine. Presentation (audio, fx, hud)
// drains the frame's event queue after the steps.
//
// Query parameters: ?seed=N picks the match seed; ?autostart=1 starts without
// the menu (tests); ?shot=<name> stages a deterministic scene for screenshots
// (see stageShot and shots.json). window.__game / __actors / __tick(n) are
// deliberate debug handles: the headless verification drives matches with them.

import { createGame, TICK } from './state.js';
import { COLLIDERS, SITES } from './world.js';
import { moveActor } from './physics.js';
import { createActors } from './actors.js';
import { makeBot, updateBot } from './bots.js';
import { updatePlayer } from './player.js';
import { startMatch, buyItem, updateRounds } from './rounds.js';
import { updateWeapon, updateGrenades, newWeapon } from './weapons.js';
import { initView, buildActorMeshes, syncView } from './view.js';
import { initHud, updateHud, handleEvents, showHud } from './hud.js';
import { initInput, lockPointer, input } from './input.js';
import { initAudio, playEvents } from './audio.js';
import * as fx from './fx.js';

const params = new URLSearchParams(location.search);
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const canvas = document.getElementById('game');

const G = createGame(seed);
createActors(G);
for (const a of G.actors) if (!a.isPlayer) makeBot(G, a);
const view = initView(canvas);
buildActorMeshes(G);
for (const a of G.actors) if (!a.isPlayer) a.mesh.visible = false;
initHud(G);
initInput(canvas);

const player = G.actors[0];
let started = false;

function start(userGesture) {
  if (started) return;
  started = true;
  G.started = true;
  initAudio();
  showHud();
  for (const a of G.actors) if (!a.isPlayer) a.mesh.visible = true;
  startMatch(G);
  if (userGesture) lockPointer(canvas);
}

document.getElementById('playBtn').addEventListener('click', () => start(true));
document.getElementById('againBtn').addEventListener('click', () => {
  document.getElementById('matchEnd').classList.add('hidden');
  G.winner = null;
  startMatch(G);
  lockPointer(canvas);
});
canvas.addEventListener('click', () => {
  if (started && G.phase !== 'over') {
    initAudio();
    lockPointer(canvas);
  }
});

function step() {
  G.time += TICK;
  updatePlayer(G, player, TICK);
  for (const a of G.actors) {
    if (a.isPlayer || !a.alive) continue;
    updateBot(G, a, TICK);
    a.crouchBlend += Math.max(-TICK * 8, Math.min(TICK * 8, (a.crouch ? 1 : 0) - a.crouchBlend));
    moveActor(COLLIDERS, a, TICK);
  }
  for (const a of G.actors) updateWeapon(G, a, TICK);
  updateGrenades(G, TICK);
  updateRounds(G, TICK);
}

let last = performance.now();
let acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!started) {
    // Menu backdrop: a slow orbit over the yard.
    const t = now / 1000;
    view.camera.position.set(Math.sin(t * 0.05) * 30, 19, Math.cos(t * 0.05) * 30);
    view.camera.lookAt(0, 0, -2);
    view.renderer.render(view.scene, view.camera);
    return;
  }
  if (!G.frozen) {
    acc += frameDt;
    let steps = 0;
    while (acc >= TICK && steps < 5) {
      step();
      acc -= TICK;
      steps++;
    }
    if (steps === 5) acc = 0;
  }
  const events = G.events.splice(0, G.events.length);
  playEvents(G, events);
  handleEvents(G, events);
  fx.update(frameDt);
  fx.syncSmokes(G);
  syncView(G, frameDt);
  updateHud(G, frameDt);
}
requestAnimationFrame(loop);

// --- Debug handles (used by the headless verification) -----------------------

window.__game = G;
window.__actors = G.actors;
window.__start = () => start(false);
window.__tick = (n) => {
  for (let i = 0; i < n; i++) step();
  G.events.length = 0;
};

// --- Screenshot staging --------------------------------------------------------
// Each scene is built from live game state, then frozen; the HUD in shot is
// the real HUD. stageShot resolves once two frames have rendered.

function place(a, x, z, yaw) {
  a.pos = { x, y: 0, z };
  a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = yaw;
  a.pitch = 0;
}

function stageShot(name) {
  start(false);
  const jackals = G.actors.filter((a) => a.team === 'J');
  const wardens = G.actors.filter((a) => a.team === 'W' && !a.isPlayer);
  if (name === 'buy') {
    player.money = 5000;
    buyItem(G, player, 'vk7');
    buyItem(G, player, 'vest');
  } else if (name === 'cover') {
    while (G.phase === 'buy') step();
    player.weapons.primary = newWeapon('vk7');
    player.weapon = player.weapons.primary;
    place(player, -25, 10.5, 0.12);
    place(jackals[0], -25, -1.5, Math.PI - 0.15);
    place(jackals[1], -20.5, -6.5, Math.PI + 0.5);
    jackals[0].weapons.primary = newWeapon('vk7');
    jackals[0].weapon = jackals[0].weapons.primary;
    jackals[1].weapons.primary = newWeapon('raptor');
    jackals[1].weapon = jackals[1].weapons.primary;
    input.mouseDown = true; // the player trades fire for the pose
    for (let i = 0; i < 26; i++) step();
    input.mouseDown = false;
    G.events.length = 0;
    // Fresh tracers and a muzzle flash, spawned after the last step so the
    // capture catches them mid-flight.
    const eye = { x: player.pos.x, y: player.pos.y + 1.5, z: player.pos.z };
    fx.muzzle(player, { x: eye.x + 0.2, y: eye.y - 0.12, z: eye.z - 0.5 });
    fx.tracer({ x: eye.x + 0.2, y: eye.y - 0.12, z: eye.z - 0.5 }, { x: -24.6, y: 1.35, z: -2.2 });
    fx.tracer({ x: -20.5, y: 1.45, z: -6 }, { x: -24.2, y: 1.1, z: 4 });
  } else if (name === 'planted') {
    while (G.phase === 'buy') step();
    const site = SITES[0];
    G.charge.state = 'planted';
    G.charge.site = site;
    G.charge.pos = { x: site.x + 0.6, y: 0, z: site.z + 0.4 };
    G.plantedEver = true;
    G.phase = 'planted';
    G.phaseT = 26;
    place(player, -18.5, -0.5, Math.PI / 2 + 0.35);
    const defuser = wardens[0];
    place(defuser, site.x + 1.7, site.z + 0.6, -Math.PI / 2);
    defuser.crouch = true;
    defuser.crouchBlend = 1;
    G.defuse = { actor: defuser, t: 2.3 };
    defuser.channel = { kind: 'defuse' };
    place(jackals[0], site.x - 4.5, site.z - 4.5, Math.PI * 0.75);
    place(jackals[1], site.x + 4, site.z + 3.5, -Math.PI * 0.8);
  } else if (name === 'banner') {
    G.score.W = 3;
    G.score.J = 2;
    G.phase = 'end';
    G.phaseT = 4.6;
    G.lastRound = { winner: 'W', reason: 'defuse' };
    place(player, -6, -14, Math.PI + 0.4);
  }
  G.frozen = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__shotReady = true;
  }));
}

if (params.has('shot')) {
  stageShot(params.get('shot'));
} else if (params.has('autostart')) {
  start(false);
}
