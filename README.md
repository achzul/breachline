![Live rank](https://make.fun/badge/threejs-fps-01/achzul/breachline/rank.svg)
![Live reward](https://make.fun/badge/threejs-fps-01/achzul/breachline/reward.svg)

# BREACHLINE

A round-based tactical FPS in the browser, built on three.js. You lead the
**Wardens** (you + 4 bots) against five **Jackal** bots on the Kestrel Yard —
a two-site depot map with a mid lane and north/south links. The Jackals carry
the **Charge**: if they plant it at the Foundry (A) or the Silos (B), your
team must retake and defuse before the 40-second fuse runs out. First team to
7 rounds wins the match.

Every round runs the full tactical loop: a 12-second buy phase with a shared
economy (kill, plant, win and loss-bonus income; weapons and armour persist
between rounds), a 100-second live phase, plant/defuse channels, and a
post-plant retake. Bots play both sides with waypoint navigation,
vision/noise perception with memory, role plans (site holds, a rotating
anchor, a carrier group with escorts, a mid watch and a lurk), burst-fire
combat with reaction time and aim error, and their own buy logic.

No build step, no runtime network calls: three.js is vendored, all art is
procedural, and every sound is synthesized with WebAudio.

## Run it

```sh
node serve.ts            # serves the game on http://localhost:8000
# or: node serve.ts --port 9000
```

Then open the printed URL and press **PLAY**. (Any static file server works
too — serve the repo root and open `/game/`.) Node 18+ is enough; there are
no dependencies to install.

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look (pointer lock) |
| Mouse 1 / Mouse 2 | Fire / aim down sights |
| R | Reload |
| Shift | Walk (quiet, accurate) |
| C or Ctrl | Crouch |
| Space | Jump |
| E (hold) | Plant the Charge (as carrier, on a site) / defuse |
| B | Toggle the buy menu during the buy phase |
| 1–8 | Buy the numbered item (buy phase) |
| 1 / 2, 4 / 5 / 6 | Weapon slots; frag / smoke / flash (live play) |

Weapons: P9 Wasp pistol, Raptor-9 SMG, Mule 12G shotgun, VK-7 carbine,
Longbow-7 DMR — hitscan with range falloff, headshot multipliers, armour
absorption, movement/recoil bloom and tracers. Grenades arc and bounce: frag
(splash), smoke (blocks sight lines for bots and players alike), flash
(blinds whoever looks at it).

## Design notes

- **Simulation** is a fixed 60 Hz step decoupled from rendering; the same
  step function drives the headless test harness, so verified behaviour is
  shipped behaviour.
- **Bots** perceive through a vision cone with line-of-sight raycasts
  (smoke blocks sight), hear gunfire, and remember last-seen positions for a
  few seconds. Wardens hold sites with a rotating third anchor; Jackals run a
  carrier group — the carrier stages through the site entry with its escorts,
  the escorts smoke the entry and then hold guard spots on the site while the
  carrier plants — plus a mid watch and a lurk that commit on first contact.
- **The map** is one shared source of truth: the collider list, the site
  definitions and the waypoint graph in `game/src/world.js` drive physics,
  rendering and bot navigation alike.
- **Determinism**: a seeded RNG (`?seed=N`) makes matches reproducible;
  `?autostart=1` skips the menu and `?shot=<name>` stages the screenshot
  scenes declared in `shots.json`.

## Layout

- `main.ts` — the competition entrypoint; copies `game/` and `screenshots/`
  to the output directory and writes `dossier.json`.
- `serve.ts` — zero-dependency static server for playing locally.
- `game/` — the game itself (`index.html`, `src/*.js`, vendored three.js).
- `vendor/makefun-threejs.ts` — the kit's dossier builder (byte-identical to
  the competition kit).
- `screenshots/`, `shots.json` — the staged captures and their recipes.
- `BUILD_NOTES.md` — design, architecture and verification record.

MIT licensed — see `LICENSE`.
