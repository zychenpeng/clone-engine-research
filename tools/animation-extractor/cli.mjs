#!/usr/bin/env node
// CLI entry: `npx animation-extract <url> [--out <dir>] [--skip-dom] [...]`
// Orchestrates extract-dom → extract-vision → merge by spawning tsx
// subprocesses. Keeps each stage's logging intact; propagates exit codes.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `
Usage: animation-extract <url> [options]

Stages (run sequentially, each writes to <out>/):
  1. extract-dom         → animations-dom.json           (Layer 1: document.getAnimations)
  2. extract-rrweb       → mutation-log.json             (Layer 2: rrweb DOM mutations)
  3. extract-vision      → animations-vision.json        (Layer 3: Claude Vision candidates)
  4. cross-validate      → animations-vision-verified.json + cross-validation.json
                                                         (Layer 4: rrweb-gated verification)
  5. merge               → animation-spec.json           (canonical merged spec)

Options:
  --out <dir>                Output directory (default: ./out/<hostname>)
  --skip-dom                 Skip Stage 1
  --skip-rrweb               Skip Stage 2
  --skip-vision              Skip Stage 3
  --skip-cross-validate      Skip Stage 4 (merge will fall back to raw Vision)
  --skip-merge               Skip Stage 5
  --headless                 Launch browser headless (default: headed for stealth)
  --frames <n>               Number of scroll frames (default: 20)
  --timeout <ms>             Goto timeout in ms (default: 60000)
  --min-confidence <n>       Vision confidence floor (default: 0.5)
  --vision-model <id>        Override vision model (default: claude-sonnet-4-5-20250929)
  --time-window-ms <n>       Cross-validator ±time-window, ms (default: 500)
  -h, --help                 Show this help

Env:
  ANTHROPIC_API_KEY          Required for Stage 3 (Vision)
`.trim();

function parseArgs(argv) {
  const opts = {
    url: null,
    out: null,
    skipDom: false,
    skipRrweb: false,
    skipVision: false,
    skipCrossValidate: false,
    skipMerge: false,
    headless: false,
    frames: null,
    timeout: null,
    minConfidence: null,
    visionModel: null,
    timeWindowMs: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--skip-dom') opts.skipDom = true;
    else if (a === '--skip-rrweb') opts.skipRrweb = true;
    else if (a === '--skip-vision') opts.skipVision = true;
    else if (a === '--skip-cross-validate') opts.skipCrossValidate = true;
    else if (a === '--skip-merge') opts.skipMerge = true;
    else if (a === '--time-window-ms') opts.timeWindowMs = argv[++i];
    else if (a === '--headless') opts.headless = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--frames') opts.frames = argv[++i];
    else if (a === '--timeout') opts.timeout = argv[++i];
    else if (a === '--min-confidence') opts.minConfidence = argv[++i];
    else if (a === '--vision-model') opts.visionModel = argv[++i];
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      console.error(USAGE);
      process.exit(2);
    } else positional.push(a);
  }
  if (positional.length !== 1) {
    console.error(USAGE);
    process.exit(2);
  }
  opts.url = positional[0];
  return opts;
}

function defaultOutDir(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return path.resolve(process.cwd(), 'out', host);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

function runStage(name, scriptPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}`));
    });
    child.on('error', (e) => reject(new Error(`${name} failed to start: ${e.message}`)));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = opts.out ? path.resolve(opts.out) : defaultOutDir(opts.url);

  const baseEnv = {
    TARGET_URL: opts.url,
    OUT_DIR: outDir,
  };
  if (opts.headless) baseEnv.HEADLESS = '1';
  if (opts.frames) baseEnv.FRAME_COUNT = opts.frames;
  if (opts.timeout) baseEnv.GOTO_TIMEOUT_MS = opts.timeout;
  if (opts.minConfidence) baseEnv.MIN_CONFIDENCE = opts.minConfidence;
  if (opts.visionModel) baseEnv.VISION_MODEL = opts.visionModel;
  if (opts.timeWindowMs) baseEnv.TIME_WINDOW_MS = opts.timeWindowMs;

  console.log(`[cli] target=${opts.url}`);
  console.log(`[cli] out=${outDir}`);

  const t0 = Date.now();

  if (!opts.skipDom) {
    console.log('[cli] Stage 1/5: DOM probe');
    await runStage('extract-dom', path.join(HERE, 'extract-dom.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping DOM probe');
  }

  if (!opts.skipRrweb) {
    console.log('[cli] Stage 2/5: rrweb mutation recorder');
    await runStage('extract-rrweb', path.join(HERE, 'extract-rrweb.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping rrweb');
  }

  if (!opts.skipVision) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[cli] ANTHROPIC_API_KEY required for Vision stage (use --skip-vision to bypass)');
      process.exit(2);
    }
    console.log('[cli] Stage 3/5: Vision probe');
    await runStage('extract-vision', path.join(HERE, 'extract-vision.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping Vision probe');
  }

  if (!opts.skipCrossValidate) {
    console.log('[cli] Stage 4/5: Cross-validate Vision against rrweb mutations');
    await runStage('cross-validate', path.join(HERE, 'cross-validate.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping cross-validate (merge will use raw Vision output)');
  }

  if (!opts.skipMerge) {
    console.log('[cli] Stage 5/5: Merge');
    await runStage('merge', path.join(HERE, 'merge.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping merge');
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[cli] Done in ${elapsed}s → ${path.join(outDir, 'animation-spec.json')}`);
}

main().catch((e) => {
  console.error('[cli] FATAL:', e.message);
  process.exit(1);
});
