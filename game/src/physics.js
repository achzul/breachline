// physics.js — movement and ray queries against the map's box colliders.
//
// The world is a flat yard plus axis-aligned boxes { minX, maxX, minZ, maxZ, top }
// (every box sits on the ground). Actors are circles of radius 0.35 on the XZ plane
// with a feet height; bullets are rays tested against the boxes, the ground plane,
// head spheres and body capsules. All plain math on { x, y, z } points, no three.js.

export const ACTOR_RADIUS = 0.35;
const STEP = 0.55; // tallest ledge an actor steps onto without jumping
const GRAVITY = 18;

// Highest standing surface at (x, z) for an actor whose feet are at feetY: the
// tallest box top that contains the point and is no more than a step above the
// feet, or the yard floor (0). Lets actors walk up low crates and fall off edges.
export function supportAt(colliders, x, z, feetY) {
  let best = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) {
      if (c.top <= feetY + STEP && c.top > best) best = c.top;
    }
  }
  return best;
}

// Move an actor one step: integrate velocity, keep it out of walls, land it.
// vel is the actor's desired velocity; this writes back pos, vel (zeroed on the
// axes it was stopped on) and onGround. Acceleration/friction live in the callers.
export function moveActor(colliders, a, dt) {
  a.pos.x += a.vel.x * dt;
  a.pos.z += a.vel.z * dt;
  // Horizontal push-out: any box too tall to step onto is a wall.
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.top <= a.pos.y + STEP) continue; // steppable, not a wall
    if (a.pos.y >= c.top) continue; // actor is above it entirely
    const nearX = Math.max(c.minX, Math.min(a.pos.x, c.maxX));
    const nearZ = Math.max(c.minZ, Math.min(a.pos.z, c.maxZ));
    const dx = a.pos.x - nearX;
    const dz = a.pos.z - nearZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= ACTOR_RADIUS * ACTOR_RADIUS) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      a.pos.x = nearX + (dx / d) * ACTOR_RADIUS;
      a.pos.z = nearZ + (dz / d) * ACTOR_RADIUS;
    } else {
      // Centre inside the box footprint: leave by the shallowest side.
      const left = a.pos.x - c.minX;
      const right = c.maxX - a.pos.x;
      const near = a.pos.z - c.minZ;
      const far = c.maxZ - a.pos.z;
      const m = Math.min(left, right, near, far);
      if (m === left) a.pos.x = c.minX - ACTOR_RADIUS;
      else if (m === right) a.pos.x = c.maxX + ACTOR_RADIUS;
      else if (m === near) a.pos.z = c.minZ - ACTOR_RADIUS;
      else a.pos.z = c.maxZ + ACTOR_RADIUS;
    }
  }
  // Gravity and landing.
  a.vel.y -= GRAVITY * dt;
  a.pos.y += a.vel.y * dt;
  const floor = supportAt(colliders, a.pos.x, a.pos.z, a.pos.y - a.vel.y * dt);
  if (a.pos.y <= floor) {
    a.pos.y = floor;
    a.vel.y = 0;
    a.onGround = true;
  } else {
    a.onGround = false;
  }
}

// Ray vs one box (slab test). Returns entry distance or Infinity.
function rayBox(c, o, d) {
  let tmin = 0;
  let tmax = Infinity;
  // X slab
  if (Math.abs(d.x) < 1e-9) {
    if (o.x < c.minX || o.x > c.maxX) return Infinity;
  } else {
    let t1 = (c.minX - o.x) / d.x;
    let t2 = (c.maxX - o.x) / d.x;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // Z slab
  if (Math.abs(d.z) < 1e-9) {
    if (o.z < c.minZ || o.z > c.maxZ) return Infinity;
  } else {
    let t1 = (c.minZ - o.z) / d.z;
    let t2 = (c.maxZ - o.z) / d.z;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // Y slab (box spans 0..top)
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < 0 || o.y > c.top) return Infinity;
  } else {
    let t1 = (0 - o.y) / d.y;
    let t2 = (c.top - o.y) / d.y;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest distance at which a ray meets the world (boxes or the ground plane),
// or Infinity. Direction need not be normalised if the caller reads t in the
// same units; all callers here pass unit directions.
export function rayWorld(colliders, o, d, maxT) {
  let best = maxT;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(colliders[i], o, d);
    if (t < best) best = t;
  }
  if (d.y < -1e-9) {
    const t = -o.y / d.y;
    if (t >= 0 && t < best) best = t;
  }
  return best === maxT ? Infinity : best;
}

// Does the straight segment a->b stay clear of boxes and smoke? Used for bot
// sight lines and for grenade damage shielding. Smoke spheres block sight.
export function sightBlocked(colliders, smokes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return false;
  const o = { x: ax, y: ay, z: az };
  const d = { x: dx / dist, y: dy / dist, z: dz / dist };
  if (rayWorld(colliders, o, d, dist - 0.05) !== Infinity) return true;
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    // Distance from the segment to the smoke centre.
    const px = s.x - ax;
    const py = s.y - ay;
    const pz = s.z - az;
    let t = (px * d.x + py * d.y + pz * d.z) / dist;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t - s.x;
    const cy = ay + dy * t - s.y;
    const cz = az + dz * t - s.z;
    if (cx * cx + cy * cy + cz * cz < s.r * s.r * 0.81) return true;
  }
  return false;
}

// Ray vs an actor's body: head sphere plus a capsule around the spine.
// Returns { t, zone } with zone 'head' | 'torso' | 'legs', or null.
// Heights scale with the actor's crouch blend (1 standing, 0 fully crouched).
export function rayActor(a, o, d, maxT) {
  const crouch = a.crouchBlend; // 0..1
  const baseY = a.pos.y;
  const headY = baseY + 1.62 - 0.42 * crouch;
  const spineTop = baseY + 1.38 - 0.38 * crouch;
  const spineBot = baseY + 0.28;
  let bestT = maxT;
  let zone = null;
  // Head sphere, radius 0.23.
  {
    const ox = o.x - a.pos.x;
    const oy = o.y - headY;
    const oz = o.z - a.pos.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - 0.23 * 0.23;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t < bestT) {
        bestT = t;
        zone = 'head';
      }
    }
  }
  // Body capsule: segment spineBot..spineTop on the actor's axis, radius 0.34.
  {
    const segY = spineTop - spineBot;
    // Closest points between the ray and the vertical segment.
    // Solve with the standard segment-segment distance, ray treated as a segment of length maxT.
    const rdx = d.x * maxT;
    const rdy = d.y * maxT;
    const rdz = d.z * maxT;
    const sx = 0;
    const sy = segY;
    const sz = 0;
    const ux = a.pos.x - o.x;
    const uy = baseY + spineBot - o.y;
    const uz = a.pos.z - o.z;
    const a1 = rdx * rdx + rdy * rdy + rdz * rdz;
    const b1 = rdx * sx + rdy * sy + rdz * sz;
    const c1 = sx * sx + sy * sy + sz * sz;
    const d1 = rdx * ux + rdy * uy + rdz * uz;
    const e1 = sx * ux + sy * uy + sz * uz;
    const denom = a1 * c1 - b1 * b1;
    let s = 0; // along the ray, 0..1 of maxT
    let t = 0; // along the spine, 0..1
    if (denom > 1e-9) {
      s = (b1 * e1 - c1 * d1) / denom;
      s = Math.max(0, Math.min(1, s));
    }
    t = c1 > 1e-9 ? (b1 * s + e1) / c1 : 0;
    t = Math.max(0, Math.min(1, t));
    s = a1 > 1e-9 ? Math.max(0, Math.min(1, (b1 * t - d1) / a1)) : 0;
    const px = o.x + rdx * s - a.pos.x;
    const py = o.y + rdy * s - (baseY + spineBot + sy * t);
    const pz = o.z + rdz * s - a.pos.z;
    const dist2 = px * px + py * py + pz * pz;
    if (dist2 <= 0.34 * 0.34) {
      const hitT = s * maxT - Math.sqrt(Math.max(0, 0.34 * 0.34 - dist2));
      if (hitT >= 0 && hitT < bestT) {
        bestT = hitT;
        const hitY = o.y + d.y * hitT;
        zone = hitY < baseY + 0.85 ? 'legs' : 'torso';
      }
    }
  }
  return zone === null ? null : { t: bestT, zone };
}
