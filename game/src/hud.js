// hud.js — every DOM readout: bars, ammo, timer, killfeed, banner, buy menu,
// minimap, overlays. Reads state once a frame and touches the DOM only with
// what changed in spirit (text and widths); the minimap redraws on a 2D canvas
// at frame rate because it is small (180x122).
//
// The buy menu is the player's shop front for rounds.buyItem — the same rules
// the bots shop by. Killfeed and banner arrive as simulation events.

import { RULES, TEAM } from './state.js';
import { COLLIDERS, SITES } from './world.js';
import { WEAPONS, GRENADES, currentSpread } from './weapons.js';
import { buyItem, buyPrice, GRENADE_CAPS } from './rounds.js';
import { wasPressed } from './input.js';

const BUY_ORDER = ['raptor', 'mule', 'vk7', 'longbow', 'vest', 'frag', 'smoke', 'flash'];
const BUY_LABEL = {
  raptor: 'Raptor-9 SMG', mule: 'Mule 12G Shotgun', vk7: 'VK-7 Carbine', longbow: 'Longbow-7 DMR',
  vest: 'Kevlar Vest', frag: 'Frag Charge', smoke: 'Smoke Pot', flash: 'Flash Pellet',
};
const REASON_TEXT = {
  elimination: 'Enemy team eliminated',
  time: 'Time expired — the Yard holds',
  detonation: 'The Charge detonated',
  defuse: 'The Charge was defused',
};

const el = {};
let feedRows = [];
let hitmarkT = 0;
let hitmarkKill = false;
let buyOpen = true;
let lastPhase = '';

export function initHud(G) {
  for (const id of [
    'hud', 'scoreW', 'scoreJ', 'timer', 'roundLabel', 'objective', 'pipsW', 'pipsJ', 'minimap',
    'feed', 'crosshair', 'hitmarker', 'hitDir', 'banner', 'bannerTitle', 'bannerSub', 'channel',
    'channelLabel', 'channelFill', 'spectate', 'hpText', 'armorText', 'hpFill', 'armorFill',
    'money', 'weaponName', 'ammo', 'grenades', 'buyMenu', 'buyGrid', 'buyMoney',
    'damageVignette', 'flashOverlay', 'scope', 'menu', 'matchEnd', 'matchResult', 'matchScore',
  ]) {
    el[id] = document.getElementById(id);
  }
  // Build the buy grid once; updateHud refreshes prices and states.
  BUY_ORDER.forEach((itemId, i) => {
    const div = document.createElement('div');
    div.className = 'buyItem';
    div.dataset.item = itemId;
    div.innerHTML = `<span><span class="key">${i + 1}</span>${BUY_LABEL[itemId]}</span><span class="price">$${buyPrice(itemId)}</span>`;
    div.addEventListener('click', () => {
      const player = G.actors[0];
      buyItem(G, player, itemId);
    });
    el.buyGrid.appendChild(div);
  });
  buildPips(G);
}

function buildPips(G) {
  el.pipsW.innerHTML = '';
  el.pipsJ.innerHTML = '';
  for (const a of G.actors) {
    const pip = document.createElement('div');
    pip.className = 'pip' + (a.team === TEAM.JACKAL ? ' j' : '') + (a.isPlayer ? ' you' : '');
    pip.dataset.actor = a.id;
    (a.team === TEAM.WARDEN ? el.pipsW : el.pipsJ).appendChild(pip);
  }
}

export function showHud() {
  el.hud.classList.remove('hidden');
  el.menu.classList.add('hidden');
}

export function handleEvents(G, events) {
  const player = G.actors[0];
  for (const e of events) {
    if (e.kind === 'hit' && e.attacker === player) {
      hitmarkT = e.killed ? 0.3 : 0.14;
      hitmarkKill = !!e.killed;
    } else if (e.kind === 'kill') {
      addFeed(G, e);
    }
  }
}

function addFeed(G, e) {
  const cls = (team) => (team === TEAM.WARDEN ? 'w' : 'j');
  const row = document.createElement('div');
  row.className = 'feedRow';
  row.innerHTML =
    `<span class="${cls(e.attackerTeam)}">${e.attackerName}</span> ▸ ${e.weapon}` +
    `${e.headshot ? ' <span class="hs">HEADSHOT</span>' : ''} ▸ ` +
    `<span class="${cls(e.victimTeam)}">${e.victimName}</span>`;
  el.feed.prepend(row);
  feedRows.push({ row, until: G.time + 5.5 });
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateHud(G, dt) {
  const player = G.actors[0];

  // Feed expiry.
  for (let i = feedRows.length - 1; i >= 0; i--) {
    if (G.time > feedRows[i].until) {
      feedRows[i].row.remove();
      feedRows.splice(i, 1);
    }
  }
  hitmarkT = Math.max(0, hitmarkT - dt);
  el.hitmarker.style.opacity = hitmarkT > 0 ? 1 : 0;
  el.hitmarker.className = hitmarkKill && hitmarkT > 0 ? 'kill' : '';
  el.hitmarker.id = 'hitmarker';

  // Top bar.
  el.scoreW.textContent = G.score.W;
  el.scoreJ.textContent = G.score.J;
  el.roundLabel.textContent = `ROUND ${G.round} · FIRST TO ${RULES.winScore}`;
  let timerText = fmtTime(G.phaseT);
  let hot = false;
  if (G.phase === 'buy') timerText = `BUY ${fmtTime(G.phaseT)}`;
  if (G.phase === 'planted') {
    timerText = `⚠ ${fmtTime(G.phaseT)}`;
    hot = G.phaseT < 10;
  }
  if (G.phase === 'end' || G.phase === 'over') timerText = '—';
  el.timer.textContent = timerText;
  el.timer.className = hot ? 'hot' : '';
  el.timer.id = 'timer';

  // Objective line.
  let objective = '';
  if (G.phase === 'buy') objective = 'Buy phase — equip your Wardens';
  else if (G.phase === 'live') objective = G.charge.state === 'dropped' ? 'The Charge is down — hold the sites' : 'Defend the Foundry and the Silos';
  else if (G.phase === 'planted') objective = `The Charge is set at ${G.charge.site ? G.charge.site.name : ''} — defuse it!`;
  el.objective.textContent = objective;

  // Alive pips.
  for (const a of G.actors) {
    const pip = document.querySelector(`.pip[data-actor="${a.id}"]`);
    if (pip) pip.classList.toggle('dead', !a.alive);
  }

  // Banner during the end phase, and the match-end screen.
  if (G.phase === 'end' && G.lastRound) {
    const won = G.lastRound.winner === player.team;
    el.banner.classList.remove('hidden');
    el.bannerTitle.textContent = won ? 'ROUND WON' : 'ROUND LOST';
    el.bannerTitle.style.color = won ? '#57d7cd' : '#ff5340';
    el.bannerSub.textContent = `${REASON_TEXT[G.lastRound.reason] ?? ''} · Wardens ${G.score.W} — ${G.score.J} Jackals`;
  } else {
    el.banner.classList.add('hidden');
  }
  if (G.phase === 'over') {
    el.matchEnd.classList.remove('hidden');
    const won = G.winner === player.team;
    el.matchResult.textContent = won ? '🏆 THE YARD HOLDS — YOU WIN' : 'THE YARD FALLS — JACKALS WIN';
    el.matchScore.textContent = `Final score · Wardens ${G.score.W} — ${G.score.J} Jackals · Your kills: ${player.kills}`;
  } else {
    el.matchEnd.classList.add('hidden');
  }

  // Bottom left: health and armour.
  el.hpText.textContent = Math.max(0, Math.ceil(player.hp));
  el.armorText.textContent = player.armor > 0 ? `🛡 ${Math.ceil(player.armor)}` : '';
  el.hpFill.style.width = `${Math.max(0, player.hp)}%`;
  el.hpFill.className = player.hp <= 30 ? 'low' : '';
  el.hpFill.id = 'hpFill';
  el.armorFill.style.width = `${player.armor}%`;

  // Bottom right: money, weapon, ammo, grenades.
  el.money.textContent = `$${player.money}`;
  const w = player.weapon;
  el.weaponName.textContent = w ? w.def.name : '—';
  if (w && w.reloadT > 0) {
    el.ammo.textContent = 'RELOADING';
    el.ammo.className = 'reloading';
  } else if (w) {
    el.ammo.innerHTML = `${w.ammo} <span class="reserve">/ ${w.reserve}</span>`;
    el.ammo.className = '';
  }
  el.ammo.id = 'ammo';
  el.grenades.textContent =
    `[4] Frag ×${player.grenades.frag} · [5] Smoke ×${player.grenades.smoke} · [6] Flash ×${player.grenades.flash}` +
    (G.charge.carrier === player ? ' · ⚠ YOU CARRY THE CHARGE' : '');

  // Crosshair: gap follows the live spread; hidden when scoped, dead or buying.
  const scoped = w && w.id === 'longbow' && player.adsF > 0.72;
  el.scope.classList.toggle('hidden', !(scoped && player.alive));
  const showCross = player.alive && !scoped && G.phase !== 'buy';
  el.crosshair.style.display = showCross ? 'block' : 'none';
  if (showCross && w) {
    const gap = 5 + currentSpread(player) * 480;
    el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  // Channel bar: the player's own channel, or any defuse in progress.
  let channelFrac = -1;
  let channelLabel = '';
  if (player.channel && G.charge.state === 'planting') {
    channelFrac = G.charge.channel / RULES.plantTime;
    channelLabel = 'SETTING THE CHARGE…';
  } else if (G.defuse) {
    channelFrac = G.defuse.t / RULES.defuseTime;
    channelLabel = G.defuse.actor === player ? 'DEFUSING…' : `${G.defuse.actor.name} IS DEFUSING…`;
  } else if (player.channel && player.channel.kind === 'defuse' && G.defuse) {
    channelFrac = G.defuse.t / RULES.defuseTime;
    channelLabel = 'DEFUSING…';
  }
  el.channel.classList.toggle('hidden', channelFrac < 0);
  if (channelFrac >= 0) {
    el.channelLabel.textContent = channelLabel;
    el.channelFill.style.width = `${Math.min(100, channelFrac * 100)}%`;
  }

  // Damage vignette, hit direction, flash.
  const sinceHit = G.time - player.lastHitAt;
  let vig = 0;
  if (player.hp < 35 && player.alive) vig = 0.35 + (35 - player.hp) / 60;
  if (sinceHit < 0.4) vig = Math.max(vig, 0.55 * (1 - sinceHit / 0.4));
  el.damageVignette.style.opacity = player.alive ? vig : 0.4;
  if (sinceHit < 1.1 && player.alive) {
    const rel = (player.yaw - player.lastHitYaw) * (180 / Math.PI);
    el.hitDir.style.opacity = 1 - sinceHit / 1.1;
    el.hitDir.style.transform = `rotate(${rel}deg)`;
  } else {
    el.hitDir.style.opacity = 0;
  }
  el.flashOverlay.style.opacity = player.alive ? Math.min(0.96, player.flashT / 2.2) : 0;

  // Spectate label.
  if (!player.alive && (G.phase === 'live' || G.phase === 'planted')) {
    const mate = G.actors.find((a) => a.team === player.team && a.alive && !a.isPlayer);
    el.spectate.classList.remove('hidden');
    el.spectate.textContent = mate ? `Spectating ${mate.name}` : 'Your team is down';
  } else {
    el.spectate.classList.add('hidden');
  }

  updateBuyMenu(G);
  drawMinimap(G);
}

function updateBuyMenu(G) {
  const player = G.actors[0];
  if (G.phase !== lastPhase) {
    lastPhase = G.phase;
    if (G.phase === 'buy') buyOpen = true;
  }
  if (wasPressed('KeyB') && G.phase === 'buy') buyOpen = !buyOpen;
  const show = G.phase === 'buy' && buyOpen && player.alive;
  el.buyMenu.classList.toggle('hidden', !show);
  if (G.phase !== 'buy') return;
  el.buyMoney.textContent = `Credits: $${player.money} · Round ${G.round} starts in ${fmtTime(G.phaseT)}`;
  // Number keys buy.
  for (let i = 0; i < BUY_ORDER.length; i++) {
    if (wasPressed(`Digit${i + 1}`)) buyItem(G, player, BUY_ORDER[i]);
  }
  for (const div of el.buyGrid.children) {
    const itemId = div.dataset.item;
    const price = buyPrice(itemId);
    let owned = false;
    if (WEAPONS[itemId]) owned = player.weapons[WEAPONS[itemId].slot]?.id === itemId;
    else if (itemId === 'vest') owned = player.armor >= 100;
    else owned = player.grenades[itemId] >= GRENADE_CAPS[itemId];
    div.classList.toggle('owned', owned);
    div.classList.toggle('cant', !owned && player.money < price);
  }
}

// --- Minimap ------------------------------------------------------------------

function drawMinimap(G) {
  const cv = el.minimap;
  const g = cv.getContext('2d');
  const mx = (x) => ((x + 37) / 74) * cv.width;
  const mz = (z) => ((z + 25) / 50) * cv.height;
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = 'rgba(46,52,50,0.9)';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = 'rgba(255,255,255,0.13)';
  for (const c of COLLIDERS) {
    g.fillRect(mx(c.minX), mz(c.minZ), mx(c.maxX) - mx(c.minX), mz(c.maxZ) - mz(c.minZ));
  }
  for (const s of SITES) {
    g.strokeStyle = '#f0a840';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(mx(s.x), mz(s.z), (s.r / 74) * cv.width, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f0a840';
    g.font = 'bold 9px sans-serif';
    g.textAlign = 'center';
    g.fillText(s.id, mx(s.x), mz(s.z) + 3);
  }
  // The Charge.
  const c = G.charge;
  const cpos = c.carrier ? c.carrier.pos : c.pos;
  if (c.state !== 'carried' || c.carrier) {
    g.fillStyle = '#ffd34d';
    g.save();
    g.translate(mx(cpos.x), mz(cpos.z));
    g.rotate(Math.PI / 4);
    g.fillRect(-3, -3, 6, 6);
    g.restore();
  }
  // Fresh enemy gunfire gives away a rough position.
  for (const n of G.noises) {
    if (n.team === TEAM.WARDEN || G.time - n.t > 3) continue;
    g.fillStyle = 'rgba(255,83,64,0.5)';
    g.beginPath();
    g.arc(mx(n.x), mz(n.z), 5, 0, Math.PI * 2);
    g.fill();
  }
  // Actors: teammates always, enemies only when a Warden bot sees them.
  for (const a of G.actors) {
    if (!a.alive) continue;
    let show = a.team === TEAM.WARDEN;
    if (!show) {
      show = G.actors.some((w) => w.team === TEAM.WARDEN && w.bot && w.bot.visible === a);
    }
    if (!show) continue;
    g.fillStyle = a.isPlayer ? '#ffffff' : a.team === TEAM.WARDEN ? '#57d7cd' : '#ff5340';
    g.beginPath();
    g.arc(mx(a.pos.x), mz(a.pos.z), a.isPlayer ? 3.4 : 2.6, 0, Math.PI * 2);
    g.fill();
    if (a.isPlayer) {
      g.strokeStyle = '#fff';
      g.beginPath();
      g.moveTo(mx(a.pos.x), mz(a.pos.z));
      g.lineTo(mx(a.pos.x) - Math.sin(a.yaw) * 8, mz(a.pos.z) - Math.cos(a.yaw) * 8);
      g.stroke();
    }
  }
}
