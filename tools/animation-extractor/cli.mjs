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

Options:
  --out <dir>            Output directory (default: ./out/<hostname>)
  --skip-dom             Skip Layer 1 DOM probe (reuse animations-dom.json)
  --skip-vision          Skip Layer 2 Vision probe (reuse animations-vision.json)
  --skip-merge           Skip merge step (only probe)
  --headless             Launch browser headless (default: headed for stealth)
  --frames <n>           Number of scroll frames (default: 20)
  --timeout <ms>         Goto timeout in ms (default: 60000)
  --min-confidence <n>   Vision confidence floor (default: 0.5)
  --vision-model <id>    Override vision model (default: claude-sonnet-4-5-20250929)
  -h, --help             Show this help

Env:
  ANTHROPIC_API_KEY      Required for Layer 2 Vision step
`.trim();

function parseArgs(argv) {
  const opts = {
    url: null,
    out: null,
    skipDom: false,
    skipVision: false,
    skipMerge: false,
    headless: false,
    frames: null,
    timeout: null,
    minConfidence: null,
    visionModel: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--skip-dom') opts.skipDom = true;
    else if (a === '--skip-vision') opts.skipVision = true;
    else if (a === '--skip-merge') opts.skipMerge = true;
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

  console.log(`[cli] target=${opts.url}`);
  console.log(`[cli] out=${outDir}`);

  const t0 = Date.now();

  if (!opts.skipDom) {
    console.log('[cli] Stage 1/3: DOM probe');
    await runStage('extract-dom', path.join(HERE, 'extract-dom.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping DOM probe');
  }

  if (!opts.skipVision) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[cli] ANTHROPIC_API_KEY required for Vision stage (use --skip-vision to bypass)');
      process.exit(2);
    }
    console.log('[cli] Stage 2/3: Vision probe');
    await runStage('extract-vision', path.join(HERE, 'extract-vision.mjs'), baseEnv);
  } else {
    console.log('[cli] Skipping Vision probe');
  }

  if (!opts.skipMerge) {
    console.log('[cli] Stage 3/3: Merge');
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
