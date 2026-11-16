// fx.js — transient visuals: tracers, muzzle flashes, impact puffs, explosions,
// smoke clouds and camera shake.
//
// Everything is pooled and reused; nothing is allocated per frame. The simulation
// calls in as events happen (weapons.js), main.js calls update() once a frame and
// syncSmokes() so the smoke you see is exactly the smoke that blocks sight lines
// in state. init() receives the scene and camera from view.js, which keeps this
// module free of import cycles.

import * as THREE from 'three';

let scene = null;
let camera = null;
let shakeAmp = 0;

const tracers = [];
const puffs = [];
const flashes = [];
let blastLight = null;
let blastBall = null;
let smokeGroups = new Map();
let blobTexture = null;
let puffTexture = null;

function makeTextures() {
  const blob = document.createElement('canvas');
  blob.width = blob.height = 128;
  const b = blob.getContext('2d');
  const grad = b.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  b.fillStyle = grad;
  b.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(blob);

  const puff = document.createElement('canvas');
  puff.width = puff.height = 64;
  const p = puff.getContext('2d');
  const g2 = p.createRadialGradient(32, 32, 2, 32, 32, 30);
  g2.addColorStop(0, 'rgba(255,255,255,0.9)');
  g2.addColorStop(1, 'rgba(255,255,255,0)');
  p.fillStyle = g2;
  p.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(puff);
}

export function init(scn, cam) {
  scene = scn;
  camera = cam;
  makeTextures();

  const tracerMat = new THREE.LineBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (let i = 0; i < 48; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  for (let i = 0; i < 44; i++) {
    const mat = new THREE.SpriteMaterial({ map: puffTexture, color: 0xcfc4ae, transparent: true, opacity: 0, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.visible = false;
    scene.add(spr);
    puffs.push({ spr, life: 0, maxLife: 0.35, vx: 0, vy: 0, vz: 0, grow: 1 });
  }
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.SpriteMaterial({ map: puffTexture, color: 0xffc266, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const spr = new THREE.Sprite(mat);
    spr.visible = false;
    scene.add(spr);
    flashes.push({ spr, life: 0 });
  }
  blastLight = new THREE.PointLight(0xffa040, 0, 26, 1.6);
  scene.add(blastLight);
  blastBall = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0 })
  );
  blastBall.visible = false;
  scene.add(blastBall);
}

export function muzzle(actor, pos) {
  if (!scene) return;
  for (const f of flashes) {
    if (f.life > 0) continue;
    f.life = 0.05;
    f.spr.visible = true;
    f.spr.position.set(pos.x, pos.y, pos.z);
    const s = 0.34 + Math.random() * 0.2;
    f.spr.scale.set(s, s, 1);
    f.spr.material.opacity = 0.95;
    break;
  }
  if (blastLight && actor.isPlayer) {
    blastLight.position.set(pos.x, pos.y, pos.z);
    blastLight.intensity = 6;
    blastLight.color.setHex(0xffc266);
  }
}

export function tracer(from, to) {
  if (!scene) return;
  for (const t of tracers) {
    if (t.life > 0) continue;
    t.life = 0.055;
    t.line.visible = true;
    const attr = t.line.geometry.getAttribute('position');
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    return;
  }
}

function puff(pos, count, color, speed, size, life) {
  if (!scene) return;
  let made = 0;
  for (const p of puffs) {
    if (p.life > 0) continue;
    p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
    p.spr.visible = true;
    p.spr.position.set(pos.x, pos.y, pos.z);
    p.spr.material.color.setHex(color);
    p.spr.material.opacity = 0.75;
    p.vx = (Math.random() - 0.5) * speed;
    p.vy = Math.random() * speed * 0.7 + 0.4;
    p.vz = (Math.random() - 0.5) * speed;
    p.grow = size;
    p.spr.scale.set(size * 0.4, size * 0.4, 1);
    if (++made >= count) break;
  }
}

export function impact(pos) {
  puff(pos, 2, 0xd8cdb4, 1.6, 0.5, 0.3);
}

export function explosion(pos) {
  if (!scene) return;
  blastBall.visible = true;
  blastBall.position.set(pos.x, pos.y + 0.3, pos.z);
  blastBall.scale.set(0.6, 0.6, 0.6);
  blastBall.material.opacity = 0.85;
  blastBall.userData.life = 0.28;
  blastLight.position.set(pos.x, pos.y + 0.6, pos.z);
  blastLight.color.setHex(0xff9040);
  blastLight.intensity = 60;
  puff(pos, 12, 0x8a7a5f, 5, 1.6, 0.7);
  puff(pos, 5, 0xffa050, 3, 1.1, 0.4);
  if (camera) {
    const d = camera.position.distanceTo(blastBall.position);
    shakeAmp = Math.min(0.5, shakeAmp + Math.max(0, (16 - d) / 16) * 0.4);
  }
}

export function flashPop(pos) {
  if (!scene) return;
  blastLight.position.set(pos.x, pos.y, pos.z);
  blastLight.color.setHex(0xdfe8ff);
  blastLight.intensity = 26;
  puff(pos, 3, 0xeaf2ff, 1.2, 0.8, 0.25);
}

// Keep the rendered smoke in step with the simulation's smoke list.
export function syncSmokes(G) {
  if (!scene) return;
  const seen = new Set();
  for (const s of G.smokes) {
    seen.add(s);
    if (smokeGroups.has(s)) continue;
    const group = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({ map: blobTexture, color: 0xb9bcbe, transparent: true, opacity: 0, depthWrite: false });
      const spr = new THREE.Sprite(mat);
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * s.r * 0.55;
      spr.position.set(Math.cos(ang) * rad, (Math.random() - 0.3) * 1.1, Math.sin(ang) * rad);
      const sc = s.r * (0.9 + Math.random() * 0.7);
      spr.scale.set(sc, sc, 1);
      group.add(spr);
    }
    group.position.set(s.x, s.y, s.z);
    scene.add(group);
    smokeGroups.set(s, group);
  }
  for (const [s, group] of smokeGroups) {
    const remain = s.until - G.time;
    const age = 13 - remain;
    const target = remain < 2 ? Math.max(0, remain / 2) * 0.5 : Math.min(0.5, age * 0.8);
    for (const spr of group.children) spr.material.opacity = target;
    if (!seen.has(s)) {
      scene.remove(group);
      smokeGroups.delete(s);
    }
  }
}

// A decaying shake offset for the camera; view.js adds it each frame.
export function shakeOffset(out) {
  out.x = (Math.random() - 0.5) * shakeAmp * 0.14;
  out.y = (Math.random() - 0.5) * shakeAmp * 0.14;
  out.z = 0;
  return out;
}

export function update(dt) {
  if (!scene) return;
  shakeAmp = Math.max(0, shakeAmp - dt * 1.4);
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) t.line.visible = false;
  }
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.spr.visible = false;
      continue;
    }
    p.spr.position.x += p.vx * dt;
    p.spr.position.y += p.vy * dt;
    p.spr.position.z += p.vz * dt;
    const k = p.life / p.maxLife;
    p.spr.material.opacity = 0.75 * k;
    const s = p.grow * (1.4 - k * 0.8);
    p.spr.scale.set(s, s, 1);
  }
  for (const f of flashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) f.spr.visible = false;
  }
  if (blastLight) blastLight.intensity = Math.max(0, blastLight.intensity - dt * 260);
  if (blastBall && blastBall.visible) {
    blastBall.userData.life -= dt;
    if (blastBall.userData.life <= 0) {
      blastBall.visible = false;
    } else {
      const s = blastBall.scale.x + dt * 16;
      blastBall.scale.set(s, s, s);
      blastBall.material.opacity = Math.max(0, blastBall.userData.life * 2.6);
    }
  }
}
