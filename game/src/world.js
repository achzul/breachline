// world.js — Kestrel Yard: the map as data, plus the scene built from it.
//
// One source of truth: the collider list below drives physics, bullet raycasts,
// bot sight lines and the rendered geometry alike, so what you see is exactly
// what blocks you. The yard is 72 x 48 m: two plant sites (the Foundry west,
// the Silos east), three lanes (west, mid, east) and two cross links (north,
// south). Wardens spawn north and defend; Jackals spawn south and attack.

import * as THREE from 'three';
import { rayWorld, supportAt } from './physics.js';

function box(minX, maxX, minZ, maxZ, top, kind) {
  return { minX, maxX, minZ, maxZ, top, kind };
}

export const COLLIDERS = [
  // Perimeter walls.
  box(-37, 37, -25.2, -24, 3.4, 'wall'),
  box(-37, 37, 24, 25.2, 3.4, 'wall'),
  box(-37.2, -36, -25.2, 25.2, 3.4, 'wall'),
  box(36, 37.2, -25.2, 25.2, 3.4, 'wall'),
  // West lane and Foundry (site A) cover.
  box(-29, -21, -13, -10, 2.4, 'containerA'),
  box(-27, -24.6, 1, 3.4, 1.0, 'crate'),
  box(-22, -20, -6, -4, 0.5, 'crate'),
  box(-19.5, -18.5, -16, -4, 2.6, 'wall'),
  box(-31, -27.5, -8, -4.5, 2.8, 'tank'),
  box(-24, -21.5, -9.5, -7, 0.5, 'crate'),
  // East lane and Silos (site B) cover, mirrored.
  box(21, 29, -13, -10, 2.4, 'containerB'),
  box(24.6, 27, 1, 3.4, 1.0, 'crate'),
  box(20, 22, -6, -4, 0.5, 'crate'),
  box(18.5, 19.5, -16, -4, 2.6, 'wall'),
  box(27.5, 31, -8, -4.5, 2.8, 'tank'),
  box(21.5, 24, -9.5, -7, 0.5, 'crate'),
  // Mid: the depot block splits it into two lanes; a two-step platform watches it.
  box(-4, 4, -2, 4, 2.4, 'depot'),
  box(-3, 3, -14, -11, 0.5, 'crate'),
  box(-3, 0, -14, -11, 1.0, 'crate'),
  box(-9, -6.5, 9, 11.5, 1.0, 'crate'),
  box(6.5, 9, 9, 11.5, 1.0, 'crate'),
  // North and south links.
  box(-14, -11.5, -18, -15.5, 1.0, 'crate'),
  box(11.5, 14, -18, -15.5, 1.0, 'crate'),
  box(-16, -9, 12, 14.5, 2.4, 'containerA'),
  box(9, 16, 12, 14.5, 2.4, 'containerB'),
  // Spawn-yard cover.
  box(-8, -5.5, -16.5, -14, 1.0, 'crate'),
  box(5.5, 8, -16.5, -14, 1.0, 'crate'),
  box(-8, -5.5, 14, 16.5, 1.0, 'crate'),
  box(5.5, 8, 14, 16.5, 1.0, 'crate'),
];

export const SITES = [
  { id: 'A', name: 'the Foundry', x: -25, z: -4, r: 5.5 },
  { id: 'B', name: 'the Silos', x: 25, z: -4, r: 5.5 },
];

export function siteAt(x, z) {
  for (const s of SITES) {
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return s;
  }
  return null;
}

export const SPAWNS = {
  W: [-6, -3, 0, 3, 6].map((x) => ({ x, z: -19.5, yaw: Math.PI })),
  J: [-6, -3, 0, 3, 6].map((x) => ({ x, z: 19.5, yaw: 0 })),
};

// Waypoint graph: nodes in open ground, edges wherever a straight walk at
// chest height is not blocked by a tall collider (low cover never blocks an
// edge; the collision push-out handles the walking itself).
export const NODES = [
  { x: 0, z: -19.5 }, // 0 Warden spawn
  { x: -13, z: -17 }, // 1
  { x: 13, z: -17 }, // 2
  { x: -24, z: -17 }, // 3 north link west
  { x: 24, z: -17 }, // 4 north link east
  { x: -25, z: -12 }, // 5
  { x: -25, z: -4 }, // 6 Foundry centre
  { x: -25, z: 4 }, // 7
  { x: 25, z: -12 }, // 8
  { x: 25, z: -4 }, // 9 Silos centre
  { x: 25, z: 4 }, // 10
  { x: 0, z: -8 }, // 11 mid north
  { x: -9, z: -6 }, // 12 mid west upper
  { x: 9, z: -6 }, // 13 mid east upper
  { x: 0, z: 8 }, // 14 mid south
  { x: -8, z: 0 }, // 15 depot west lane
  { x: 8, z: 0 }, // 16 depot east lane
  { x: -13, z: 10 }, // 17 south link west
  { x: 13, z: 10 }, // 18 south link east
  { x: 0, z: 19.5 }, // 19 Jackal spawn
  { x: -13, z: 16 }, // 20
  { x: 13, z: 16 }, // 21
  { x: -20, z: -1 }, // 22 Foundry entry
  { x: 20, z: -1 }, // 23 Silos entry
  { x: 0, z: -12.5 }, // 24 platform
  { x: -12, z: 6 }, // 25 mid south-west
  { x: 12, z: 6 }, // 26 mid south-east
  { x: -31, z: -1 }, // 27 Foundry deep
  { x: 31, z: -1 }, // 28 Silos deep
  { x: -25, z: 12 }, // 29 west lane south
  { x: 25, z: 12 }, // 30 east lane south
];

function buildGraph() {
  const adj = NODES.map(() => []);
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const a = NODES[i];
      const b = NODES[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 26) continue;
      const o = { x: a.x, y: 1.2, z: a.z };
      const d = { x: dx / dist, y: 0, z: dz / dist };
      if (rayWorld(COLLIDERS, o, d, dist - 0.05) === Infinity) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  return adj;
}
export const GRAPH = buildGraph();

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i].x - x;
    const dz = NODES[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first path of node indices from `from` to `to` (inclusive), or null.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Array(NODES.length).fill(-1);
  prev[from] = from;
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nb of GRAPH[cur]) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let c = to;
        while (c !== from) {
          c = prev[c];
          path.push(c);
        }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return null;
}

export function groundY(x, z) {
  return supportAt(COLLIDERS, x, z, 0);
}

// ---------------------------------------------------------------------------
// Scene building. Palette: warm sand and concrete, teal for the Wardens' side
// of the yard, amber for the Jackals'. One directional sun with shadows, a
// canvas-painted ground (asphalt, lane lines, site rings and letters), boxes
// for every collider, and a flat skyline so the horizon is not empty.
// ---------------------------------------------------------------------------

const PALETTE = {
  wall: 0x8d8578,
  crate: 0x9a7648,
  containerA: 0x2e6f6a,
  containerB: 0xb07a2e,
  depot: 0x6b6f75,
  tank: 0x7a4a3a,
};

function groundTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 683;
  const g = cv.getContext('2d');
  const sx = (x) => ((x + 37) / 74) * cv.width;
  const sz = (z) => ((z + 25) / 50) * cv.height;
  g.fillStyle = '#57534c';
  g.fillRect(0, 0, cv.width, cv.height);
  // Asphalt speckle.
  for (let i = 0; i < 9000; i++) {
    const v = 70 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    g.fillRect(Math.random() * cv.width, Math.random() * cv.height, 2, 2);
  }
  // Lane dashes down the three lanes.
  g.strokeStyle = 'rgba(230,220,190,0.5)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  for (const x of [-25, 0, 25]) {
    g.beginPath();
    g.moveTo(sx(x), sz(-22));
    g.lineTo(sx(x), sz(22));
    g.stroke();
  }
  g.setLineDash([]);
  // Site rings and letters.
  for (const s of SITES) {
    g.strokeStyle = '#e8a33d';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(sx(s.x), sz(s.z), (s.r / 74) * cv.width, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(232,163,61,0.85)';
    g.font = 'bold 64px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.id, sx(s.x), sz(s.z) + 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildScene(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(74, 50),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const mats = {};
  for (const kind of Object.keys(PALETTE)) {
    mats[kind] = new THREE.MeshStandardMaterial({ color: PALETTE[kind], roughness: 0.85 });
  }
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3c3a36, roughness: 0.9 });
  for (const c of COLLIDERS) {
    const w = c.maxX - c.minX;
    const d = c.maxZ - c.minZ;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, c.top, d), mats[c.kind]);
    mesh.position.set((c.minX + c.maxX) / 2, c.top / 2, (c.minZ + c.maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (c.top >= 1) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.1, d + 0.12), trimMat);
      trim.position.set(mesh.position.x, c.top - 0.05, mesh.position.z);
      trim.castShadow = true;
      scene.add(trim);
    }
  }

  // Site rings standing proud of the paint, so the plant zone reads in 3D.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.55 });
  for (const s of SITES) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.18, s.r, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
  }

  // Distant skyline silhouettes beyond the walls.
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x4a4640 });
  const skyline = [
    [-30, -38, 14, 16], [-8, -40, 18, 22], [16, -38, 12, 13], [34, -40, 16, 19],
    [-34, 38, 16, 12], [-4, 40, 20, 17], [28, 38, 14, 21],
  ];
  for (const [x, z, w, h] of skyline) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), skyMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }
}
