# BREACHLINE — build notes (v2 rebuild)

## Why this directory exists

This is a fresh implementation of BREACHLINE for the make.fun bounty
`threejs-fps-01` ("Make the best three.js tactical FPS", $1,000). The design
carries over from the earlier BREACHLINE build, but every line of game code
in this tree was written new in this build session — the competition window
opened 2026-11-17 00:00 WIB and the recorded build session must sit inside
it. The only byte-identical files are the kit's own vendor files, verified
against the kit manifest (`kit.json`) by sha256:

- `vendor/makefun-threejs.ts` — f9622210… (= kit `files/makefun-threejs.ts`)
- `game/vendor/three/three.core.min.js` — 613e370f…
- `game/vendor/three/three.module.min.js` — ef510bae…
- `game/vendor/three/LICENSE` — 8b378ebe…

`.makefun/owner.json` carries the entrant's wallet for the repo-owner check.

## The game

Round-based tactical FPS, 5v5, on one map ("Kestrel Yard"): you + 4 Warden
bots defend the Foundry (A) and Silos (B) against 5 Jackal bots who carry
the Charge. Buy phase 12 s → live phase 100 s → plant (2.8 s channel) →
40 s fuse with a 5 s defuse channel. First to 7 rounds. Economy: start $800,
kill +$300, round win +$1,400, escalating loss bonus $1,000→$1,800, plant
team +$800 and planter +$300; weapons/armour persist across rounds.

Weapons (shared hitscan model — range falloff, headshot ×4, armour absorbs
55% body / 25% head, movement/recoil bloom, magazine + reserve, reload):
P9 Wasp pistol ($0), Raptor-9 SMG ($1,500), Mule 12G shotgun ($1,700,
8 pellets), VK-7 carbine ($2,700), Longbow-7 DMR ($3,400, semi). Kevlar vest
$650. Grenades (frag $300, smoke $300, flash $200) arc, bounce, and cook
their effects through the same physics as everything else: frag splash with
falloff, smoke volumes that block bot line-of-sight and fade over ~10 s,
flash that blinds by view angle and distance (bots included).

## Architecture

Fixed-step simulation at 60 Hz (`game/src/state.js` owns the match state;
one `step()` advances player → bots → weapons → grenades → round machine).
Rendering and HUD read state after the steps; presentation effects drain a
per-frame event queue, which is also what the audio synth consumes.

| File | Role |
| --- | --- |
| `world.js` | Kestrel Yard: 27 AABB colliders, 2 sites, spawns, 31-node waypoint graph with BFS paths; builds the three.js scene (canvas ground texture, site rings, skyline) |
| `physics.js` | AABB movement with step-up and support checks, `rayWorld`, `sightBlocked` (walls + smoke), `rayActor` (head sphere + body capsule) |
| `weapons.js` | Weapon table, shared fire model, grenade simulation |
| `actors.js` | Actor factory + procedural low-poly bodies (walk/crouch/death animation, Charge prop on the carrier) |
| `bots.js` | Perception (vision cone + LOS, noise, 6 s memory), role plans for both teams, burst combat, bot shopping |
| `rounds.js` | Phase machine, plant/defuse channels, buy validation |
| `player.js`, `input.js` | Pointer-lock controls, movement, channels via E |
| `view.js`, `fx.js` | Camera/viewmodels (ADS, reload dip), pooled tracers, hit puffs, smoke rendering, camera shake |
| `audio.js` | All-synthesized WebAudio: shots per weapon class, hits, footsteps, UI, plant/defuse beeps, detonation |
| `hud.js` | Scoreboard strip, timer, health/armour, ammo, buy menu, minimap, killfeed, banners, channel bar |
| `main.js` | Bootstrap, game loop, `?seed=` / `?autostart=1` / `?shot=` staging, debug handles (`__game`, `__tick`) |
| `rng.js` | mulberry32 seeded RNG |

No runtime network calls anywhere; three.js is vendored under
`game/vendor/three/`.

## Verification (headless, this session)

Harness: puppeteer-core driving chrome-headless-shell (SwiftShader WebGL)
against `serve.ts`, outside the entry tree. The game's `__tick(n)` debug
handle steps the real simulation, so soak tests exercise shipped code.

- **Load**: zero console errors and zero page errors; match reaches the buy
  phase.
- **Buy flow**: pressing 5 in the buy phase buys the Kevlar vest — armour
  100, money $800 → $150. (In headless runs the synthetic key press is
  occasionally eaten by focus handling; the harness then dispatches a
  `KeyboardEvent` through the game's own listener — same code path.)
- **Match soaks** (idle player, bots play both sides): seed 7 completes
  W 1 – J 7 (1,715 shots, 45 kills); seed 21 completes W 4 – J 7
  (2,859 shots, 71 kills, **3 plants**). Zero errors in both; every bot
  moves ≥ 6.6 m from spawn. Jackal dominance is expected with the player
  idle — the Wardens are effectively playing 4v5.
- **Plant isolation test**: with Warden bots removed and the carrier placed
  on its plan site, the channel accumulates 0.1 → 1.2 → 2.1 → **planted**,
  phase flips to `planted`.
- **Plant-rate diagnostic** (same soak method, 4 seeds): plants per match
  0–3; carriers reach their site in most rounds on most seeds. Elimination
  finishes are the other common outcome, as in the genre.
- **Screenshots**: the 4 staged scenes in `shots.json` captured at
  1280×800 JPEG, 44–64 KiB each (cap 256 KiB), zero page errors.
- **Hand-in**: `MAKEFUN_OUTPUT_DIR=<dir> node main.ts` run twice produces a
  byte-identical `dossier.json` (sha256 cbd87233…), 413,257 bytes
  (≈0.39 MiB, cap 1.5 MiB). Judge-visible source ≈131 KB (cap 160 KiB).

## Bugs found and fixed during verification

1. **Missing import** — `main.js` used `updateRounds` without importing it;
   threw on the first frame. Fixed; load test added.
2. **Buy keys raced the player controller** — `player.js` polled the same
   number keys for weapon slots and grenade throws (`Digit5` = smoke) that
   the buy menu polls for purchases, and `wasPressed` consumes: whichever
   ran first won, so number-key buys usually lost. Number-key shortcuts are
   now gated to non-buy phases; one key has exactly one consumer per phase.
3. **Carrier took a different lane than its escorts** — its BFS path from
   spawn was shortest for the site centre, not for the group's entry, so it
   walked alone and died en route. The carrier now stages through the site
   entry with the escorts, then follows through.
4. **Escorts stopped at the entry** — push bots held the entry node and left
   the carrier alone on the site. They now follow through and hold guard
   spots on the site while the plant goes down.
5. **Carrier abandoned plants for distant contacts** — any visible enemy
   pulled it into combat and reset the channel. A carrier mid-plant now
   commits: only a visible enemy inside 8 m breaks the plant.
6. **Recovered Charge was never planted** — a Jackal who picked up a dropped
   Charge kept its old role and plan. Pickup now promotes the bot to
   carrier with the site plan attached.
7. **Support bots arrived after the fight** — the lurk waited out a fixed
   timer and the mid bot rotated on the clock. Both now commit on first
   contact or the first Jackal death.
8. **Plant threat check too strict** (early iteration) — any 6 s-old memory
   within 10 m blocked planting forever. Tightened to visible < 12 m, or a
   ≤ 2 s-old memory < 7 m; escorts cover the rest.

Two test-harness lessons worth keeping: an idle player standing at spawn is
a legitimate target for bots routing past it (a Wasp headshot ended one
isolation run — the test now makes the player unkillable and freezes the
page's own loop before staging), and a teleported bot must have its path
cleared, or it faithfully retraces its stale route.

## Known limits

- Bot-versus-bot balance with an idle player skews Jackal (4v5); with a
  human playing, the Warden side gains its fifth gun and its brain.
- Plants happen in most simulated matches but not every one; elimination
  rounds are common when the defence collapses early — intended genre
  behaviour, tuned via the diagnostics above rather than forced.
