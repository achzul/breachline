// view.js — everything three.js shows: the renderer, the camera, viewmodels,
// the world Charge prop, and per-frame syncing of meshes from simulation state.
//
// The simulation never touches three.js objects except through here and
// actors.js. Camera: first person at the player's eye while alive (with the
// recoil offset and an ADS field-of-view pull), spectating a living teammate
// from their eye after death. One directional sun casts the shadows; a
// hemisphere light fills. The viewmodel is per-weapon boxes on the camera,
// with walk bob, a reload dip and hip/ADS poses.

import * as THREE from 'three';
import { buildScene } from './world.js';
import { buildActorMesh, syncActorMesh, attachChargeProp } from './actors.js';
import { eyePos } from './weapons.js';
import * as fx from './fx.js';

let renderer = null;
let scene = null;
let camera = null;
let chargeMesh = null;
let chargeLamp = null;
const viewmodels = {};
let currentVm = null;
const shakeV = { x: 0, y: 0, z: 0 };
let lastFov = 74;

const VM_SHAPES = {
  wasp: { body: [0.07, 0.13, 0.24], barrel: [0.045, 0.05, 0.1], color: 0x2c2f33 },
  raptor: { body: [0.08, 0.16, 0.44], barrel: [0.05, 0.06, 0.16], color: 0x33373c },
  mule: { body: [0.09, 0.15, 0.52], barrel: [0.07, 0.07, 0.2], color: 0x4a3a28 },
  vk7: { body: [0.08, 0.17, 0.56], barrel: [0.05, 0.06, 0.22], color: 0x2c2f33 },
  longbow: { body: [0.08, 0.16, 0.66], barrel: [0.045, 0.05, 0.3], color: 0x3a3f45, scope: true },
};

export function initView(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8bfd2);
  scene.fog = new THREE.Fog(0xb4c2c6, 45, 140);

  camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 320);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xcfe2f2, 0x8a7a5c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b0, 1.9);
  sun.position.set(30, 42, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  buildScene(scene);

  // The Charge as a world object (dropped or planted): dark case, amber lamp.
  chargeMesh = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.28, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 })
  );
  caseMesh.castShadow = true;
  chargeLamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.05, 0.04),
    new THREE.MeshBasicMaterial({ color: 0xffb020 })
  );
  chargeLamp.position.set(0, 0.1, 0.1);
  chargeMesh.add(caseMesh, chargeLamp);
  chargeMesh.visible = false;
  scene.add(chargeMesh);

  fx.init(scene, camera);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
  return { renderer, scene, camera };
}

export function buildActorMeshes(G) {
  for (const a of G.actors) {
    scene.add(buildActorMesh(a));
    attachChargeProp(a);
    if (a.isPlayer) a.mesh.visible = false;
  }
}

function viewmodelFor(id) {
  if (viewmodels[id]) return viewmodels[id];
  const shape = VM_SHAPES[id] ?? VM_SHAPES.vk7;
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: shape.color, roughness: 0.45, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(...shape.body), mat);
  body.position.z = -shape.body[2] / 2;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(...shape.barrel), dark);
  barrel.position.set(0, shape.body[1] * 0.22, -shape.body[2] - shape.barrel[2] / 2 + 0.02);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.15, 0.07), dark);
  grip.position.set(0, -shape.body[1] / 2 - 0.05, -0.05);
  grip.rotation.x = 0.3;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), dark);
  mag.position.set(0, -shape.body[1] / 2 - 0.05, -shape.body[2] * 0.55);
  mag.rotation.x = 0.12;
  g.add(body, barrel, grip, mag);
  if (shape.scope) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.17, 12), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, shape.body[1] / 2 + 0.055, -shape.body[2] * 0.5);
    g.add(scope);
  } else {
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.045, 0.02), dark);
    sight.position.set(0, shape.body[1] / 2 + 0.03, -shape.body[2] * 0.45);
    g.add(sight);
  }
  g.visible = false;
  camera.add(g);
  viewmodels[id] = g;
  return g;
}

export function syncView(G, dt) {
  const player = G.actors[0];
  for (const a of G.actors) syncActorMesh(a, dt);

  // World Charge prop: shown while dropped or planted, lamp blinking faster
  // as the fuse burns down.
  const c = G.charge;
  if (c.state === 'dropped' || c.state === 'planted') {
    chargeMesh.visible = true;
    chargeMesh.position.set(c.pos.x, c.pos.y + 0.16, c.pos.z);
    const rate = c.state === 'planted' ? (G.phaseT > 20 ? 2.4 : G.phaseT > 8 ? 5 : 10) : 2;
    chargeLamp.material.color.setHex(Math.sin(G.time * rate) > 0 ? 0xffb020 : 0x552f00);
  } else {
    chargeMesh.visible = false;
  }

  // Camera: the player's eye, or a living teammate's after death.
  let camActor = player;
  if (!player.alive) {
    camActor = G.actors.find((a) => a.team === player.team && a.alive && !a.isPlayer) ?? player;
  }
  const eye = eyePos(camActor);
  fx.shakeOffset(shakeV);
  camera.position.set(eye.x + shakeV.x, eye.y + shakeV.y, eye.z);
  camera.rotation.set(camActor.pitch + (camActor.recoil || 0), camActor.yaw, 0);

  // Field of view: ADS pulls it in by the weapon's zoom.
  let fov = 74;
  if (player.alive && player.weapon) {
    fov = 74 / (1 + (player.weapon.def.zoom - 1) * player.adsF);
  }
  if (Math.abs(fov - lastFov) > 0.05) {
    lastFov = fov;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // Viewmodel: swap on weapon change, pose by ADS, bob and reload dip.
  if (player.alive && player.weapon) {
    const vm = viewmodelFor(player.weapon.id);
    if (currentVm !== vm) {
      if (currentVm) currentVm.visible = false;
      currentVm = vm;
    }
    const scoped = player.weapon.id === 'longbow' && player.adsF > 0.72;
    vm.visible = !scoped;
    const ads = player.adsF;
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const bob = player.onGround && speed > 0.5 ? Math.sin(player.walkPhase * 2) * 0.012 : 0;
    const dip = player.weapon.reloadT > 0 ? Math.sin((player.weapon.reloadT / player.weapon.def.reload) * Math.PI) * 0.22 : 0;
    vm.position.set(
      0.27 + (0 - 0.27) * ads,
      -0.25 + (-0.168 + 0.25) * ads + bob,
      -0.45 - ads * 0.06
    );
    vm.rotation.set(-dip + bob * 2, 0, 0);
  } else if (currentVm) {
    currentVm.visible = false;
    currentVm = null;
  }

  renderer.render(scene, camera);
}
