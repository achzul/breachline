// BREACHLINE hand-in program (make.fun threejs-fps-01, Node 22, standard library only).
//
// The playable game lives in game/ as plain static files. This program copies game/ and
// screenshots/ from beside itself into the output directory and writes dossier.json there
// with buildDossier from the vendored make.fun library, exactly as the competition's gate
// expects: the gate rebuilds the dossier with the same library and compares byte for byte,
// so the options below mirror the scorer's caps (dossier text 160 KiB, at most 4 screenshots
// of at most 256 KiB, game/ at most 993 entries and 48 MiB).
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The program is deterministic: two runs over the same repository write the same bytes.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });

const shotsDir = join(outDir, 'screenshots');
mkdirSync(shotsDir, { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), shotsDir, { recursive: true });
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
