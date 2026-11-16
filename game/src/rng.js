// rng.js — one seeded random source for the whole simulation.
//
// Everything that can change a match outcome (team plans, bot loadouts, shot spread,
// grenade scatter) draws from this generator, so a seed reproduces a match exactly.
// mulberry32: tiny, fast, good enough distribution for game decisions. Visual-only
// randomness (particle jitter in fx.js) deliberately does not draw from here.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  // float in [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }
  // integer in [min, max]
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  // true with probability p
  chance(p) {
    return this.next() < p;
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  // symmetric jitter in [-amt, +amt]
  jitter(amt) {
    return (this.next() * 2 - 1) * amt;
  }
}
