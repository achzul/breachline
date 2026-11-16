// audio.js — every sound in the game is synthesised with WebAudio.
//
// No audio files exist. Gunshots are shaped noise bursts plus a falling
// square-wave body, each weapon with its own filter and decay; explosions are
// a lowpass noise sweep over a sine thump; the plant beeps, buy clicks, hit
// ticks and round stingers are small oscillator phrases. The context is
// created on the first user gesture (browser policy); event sounds from the
// simulation arrive through playEvents(), distance-attenuated from the player.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

function noise(dur, { type = 'lowpass', from = 1200, to = null, gain = 0.5, at = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, t0);
  if (to !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function tone(freq, dur, { type = 'sine', gain = 0.3, slideTo = null, at = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const SHOT_RECIPES = {
  wasp: { dur: 0.11, from: 2600, to: 500, gain: 0.5, body: 170 },
  raptor: { dur: 0.08, from: 2200, to: 420, gain: 0.42, body: 150 },
  mule: { dur: 0.3, from: 1300, to: 160, gain: 0.85, body: 95 },
  vk7: { dur: 0.12, from: 2400, to: 380, gain: 0.55, body: 140 },
  longbow: { dur: 0.24, from: 2800, to: 240, gain: 0.8, body: 105 },
};

function volFor(dist, mine) {
  if (mine) return 1;
  if (dist <= 3) return 0.9;
  return Math.max(0.04, 1 - dist / 58);
}

export function sfx(name, opts = {}) {
  if (!ctx) return;
  const v = volFor(opts.dist ?? 0, opts.mine);
  switch (name) {
    case 'shot': {
      const r = SHOT_RECIPES[opts.weapon] ?? SHOT_RECIPES.vk7;
      noise(r.dur, { from: r.from, to: r.to, gain: r.gain * v });
      tone(r.body, r.dur * 0.9, { type: 'square', gain: 0.16 * v, slideTo: r.body * 0.4 });
      break;
    }
    case 'dry': tone(1300, 0.04, { type: 'square', gain: 0.12 * v }); break;
    case 'reload':
      tone(900, 0.03, { type: 'square', gain: 0.1 * v });
      tone(700, 0.03, { type: 'square', gain: 0.1 * v, at: 0.55 });
      tone(1100, 0.04, { type: 'square', gain: 0.12 * v, at: (opts.dur ?? 2) - 0.15 });
      break;
    case 'hit': tone(1950, 0.05, { gain: 0.16 }); break;
    case 'kill':
      tone(660, 0.09, { type: 'triangle', gain: 0.22 });
      tone(990, 0.14, { type: 'triangle', gain: 0.22, at: 0.08 });
      break;
    case 'explosion':
      noise(0.8, { from: 900, to: 60, gain: 1.0 * v });
      tone(58, 0.7, { gain: 0.7 * v, slideTo: 30 });
      break;
    case 'throw': noise(0.09, { type: 'bandpass', from: 700, gain: 0.14 * v }); break;
    case 'smokePop': noise(0.35, { type: 'bandpass', from: 420, gain: 0.2 * v }); break;
    case 'flashPop':
      tone(2500, 0.16, { gain: 0.2 * v });
      noise(0.1, { type: 'highpass', from: 3000, gain: 0.2 * v });
      break;
    case 'beep': tone(opts.urgent ? 1420 : 920, 0.06, { type: 'square', gain: 0.12 }); break;
    case 'planted':
      tone(920, 0.07, { type: 'square', gain: 0.14 });
      tone(920, 0.07, { type: 'square', gain: 0.14, at: 0.12 });
      tone(1380, 0.16, { type: 'square', gain: 0.14, at: 0.24 });
      break;
    case 'pickup':
      tone(520, 0.05, { type: 'triangle', gain: 0.18 });
      tone(780, 0.07, { type: 'triangle', gain: 0.18, at: 0.05 });
      break;
    case 'buy':
      tone(840, 0.05, { type: 'triangle', gain: 0.16 });
      tone(1260, 0.08, { type: 'triangle', gain: 0.16, at: 0.05 });
      break;
    case 'roundWin':
      [523, 659, 784].forEach((f, i) => tone(f, 0.16, { type: 'triangle', gain: 0.2, at: i * 0.11 }));
      break;
    case 'roundLose':
      [392, 330, 262].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.2, at: i * 0.12 }));
      break;
    case 'matchWin':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.24, { type: 'triangle', gain: 0.22, at: i * 0.14 }));
      break;
    case 'matchLose':
      [440, 392, 330, 262].forEach((f, i) => tone(f, 0.26, { type: 'triangle', gain: 0.22, at: i * 0.15 }));
      break;
  }
}

// Translate one frame of simulation events into sounds, from the player's ears.
export function playEvents(G, events) {
  if (!ctx) return;
  const player = G.actors[0];
  const distTo = (x, z) => Math.hypot(x - player.pos.x, z - player.pos.z);
  for (const e of events) {
    switch (e.kind) {
      case 'shot':
        sfx('shot', { weapon: e.weapon.id, dist: distTo(e.x, e.z), mine: e.actor.isPlayer });
        break;
      case 'dry':
        if (e.actor.isPlayer) sfx('dry', { mine: true });
        break;
      case 'reload':
        if (e.actor.isPlayer) sfx('reload', { mine: true, dur: e.actor.weapon ? e.actor.weapon.def.reload : 2 });
        else if (distTo(e.actor.pos.x, e.actor.pos.z) < 13) sfx('reload', { dist: distTo(e.actor.pos.x, e.actor.pos.z) });
        break;
      case 'hit':
        if (e.attacker && e.attacker.isPlayer) {
          sfx('hit');
          if (e.killed) sfx('kill');
        }
        break;
      case 'explosion':
        sfx('explosion', { dist: distTo(e.x, e.z), mine: distTo(e.x, e.z) < 3 });
        break;
      case 'throw':
        if (e.actor.isPlayer) sfx('throw', { mine: true });
        break;
      case 'smokePop': sfx('smokePop', { dist: distTo(e.x, e.z) }); break;
      case 'flashPop': sfx('flashPop', { dist: distTo(e.x, e.z) }); break;
      case 'beep': sfx('beep', { urgent: e.urgent }); break;
      case 'planted': sfx('planted'); break;
      case 'chargePickup':
        if (e.actor.isPlayer) sfx('pickup', { mine: true });
        break;
      case 'buy':
        if (e.actor.isPlayer) sfx('buy', { mine: true });
        break;
      case 'roundEnd':
        sfx(e.winner === player.team ? 'roundWin' : 'roundLose');
        break;
      case 'matchEnd':
        sfx(e.winner === player.team ? 'matchWin' : 'matchLose');
        break;
    }
  }
}
