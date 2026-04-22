// Layer 2 — Claude Vision on 20 sampled frames.
// Sends all frames in one message + prompts/vision.txt, parses JSON array.
//
// Round E upgrades (over Round D):
//   - JSON parse retry: if the model slips into prose, re-ask with a stricter
//     system instruction up to MAX_PARSE_RETRIES times.
//   - API error retry: exponential backoff on 429 / 5xx up to MAX_API_RETRIES.
//   - Confidence filtering: drop entries < MIN_CONFIDENCE (default 0.5);
//     mark 0.5-0.7 as needs_review.
//   - OUT_DIR configurable so multiple sites share one extractor.

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TARGET = process.env.TARGET_URL || 'https://linear.app';
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'out');
const FRAMES_DIR = process.env.FRAMES_DIR || path.join(OUT_DIR, 'frames');
const PROMPT_PATH = process.env.PROMPT_PATH || path.join(HERE, 'prompts', 'vision.txt');
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = Number(process.env.VISION_MAX_TOKENS || 8000);
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 0.5);
const REVIEW_CONFIDENCE = Number(process.env.REVIEW_CONFIDENCE || 0.7);
const MAX_API_RETRIES = Number(process.env.MAX_API_RETRIES || 3);
const MAX_PARSE_RETRIES = Number(process.env.MAX_PARSE_RETRIES || 2);

export class VisionApiError extends Error {
  constructor(msg, cause) {
    super(msg);
    this.name = 'VisionApiError';
    this.cause = cause;
  }
}
export class VisionParseError extends Error {
  constructor(msg, raw) {
    super(msg);
    this.name = 'VisionParseError';
    this.raw = raw;
  }
}

export function extractJsonArray(text) {
  // Prefer the outermost `[...]` block; tolerate leading/trailing prose or
  // a ```json fence around the array.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) {
    throw new VisionParseError('no JSON array brackets found', text);
  }
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    throw new VisionParseError(`JSON.parse failed: ${e.message}`, text);
  }
}

// Split raw Vision entries into kept / dropped / needs-review based on
// confidence thresholds. Pure function, safe to import from tests.
export function filterByConfidence(entries, { minConfidence = 0.5, reviewConfidence = 0.7 } = {}) {
  const kept = [];
  const dropped = [];
  for (const a of entries) {
    const conf = typeof a.confidence === 'number' ? a.confidence : 0;
    if (conf < minConfidence) {
      dropped.push({ element: a.element, confidence: conf });
      continue;
    }
    const copy = { ...a };
    if (conf < reviewConfidence) copy.needs_review = true;
    kept.push(copy);
  }
  return { kept, dropped };
}

function isTransientApiError(err) {
  const status = err?.status ?? err?.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  // Network errors surface without a status
  if (!status && /ECONN|ETIMEDOUT|socket|network|fetch failed/i.test(String(err?.message || err))) return true;
  return false;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callVisionWithRetry(client, messages, systemPrompt) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      return await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_API_RETRIES && isTransientApiError(e)) {
        const backoff = 1000 * Math.pow(2, attempt);
        console.warn(`[probe-vision] API error (attempt ${attempt + 1}): ${e.message}; retrying in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      throw new VisionApiError(`vision API call failed: ${e.message}`, e);
    }
  }
  throw new VisionApiError(`vision API exhausted retries: ${lastErr?.message}`, lastErr);
}

function buildImageBlocks(frameFiles, framesDir) {
  const blocks = [];
  for (const f of frameFiles) {
    const buf = readFileSync(path.join(framesDir, f));
    const b64 = buf.toString('base64');
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    });
    blocks.push({ type: 'text', text: `[Frame ${f.replace('.png', '')}]` });
  }
  return blocks;
}

async function main() {
  const t0 = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  const prompt = await readFile(PROMPT_PATH, 'utf8');

  const frameFiles = readdirSync(FRAMES_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (frameFiles.length < 10) {
    throw new Error(`Only ${frameFiles.length} frames found in ${FRAMES_DIR}; expected ~20. Run extract-dom.mjs first.`);
  }
  console.log(`[probe-vision] Loading ${frameFiles.length} frames`);

  const imageBlocks = buildImageBlocks(frameFiles, FRAMES_DIR);

  let animations = null;
  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  let userContent = [...imageBlocks, { type: 'text', text: prompt }];
  let systemPrompt = 'You are a precise animation analyst. You ALWAYS output a strict JSON array and nothing else.';

  for (let parseAttempt = 0; parseAttempt <= MAX_PARSE_RETRIES; parseAttempt++) {
    console.log(`[probe-vision] Calling ${MODEL} (parse attempt ${parseAttempt + 1})`);
    const response = await callVisionWithRetry(client, [{ role: 'user', content: userContent }], systemPrompt);

    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const u = response.usage;
    inputTokens += u.input_tokens;
    outputTokens += u.output_tokens;
    const cost = (u.input_tokens * 3 + u.output_tokens * 15) / 1_000_000;
    totalCost += cost;
    console.log(`[probe-vision] Usage: in=${u.input_tokens} out=${u.output_tokens} cost=$${cost.toFixed(4)}`);

    try {
      animations = extractJsonArray(text);
      break;
    } catch (e) {
      if (parseAttempt < MAX_PARSE_RETRIES) {
        console.warn(`[probe-vision] Parse failed: ${e.message}; re-prompting`);
        // Re-prompt: keep images, tell it the previous output was invalid.
        userContent = [
          ...imageBlocks,
          { type: 'text', text: prompt },
          { type: 'text', text: `Your previous reply was not valid JSON (${e.message}). Output ONLY the JSON array now, no prose, no markdown fence.` },
        ];
        continue;
      }
      console.error('[probe-vision] Parse failed, raw head:');
      console.error(text.slice(0, 500));
      throw e;
    }
  }

  if (!Array.isArray(animations)) {
    throw new VisionParseError('extracted value is not an array', String(animations));
  }

  const { kept, dropped } = filterByConfidence(animations, {
    minConfidence: MIN_CONFIDENCE,
    reviewConfidence: REVIEW_CONFIDENCE,
  });
  if (dropped.length) {
    console.log(`[probe-vision] Dropped ${dropped.length} low-confidence entries (< ${MIN_CONFIDENCE})`);
  }
  const reviewCount = kept.filter((a) => a.needs_review).length;
  if (reviewCount) {
    console.log(`[probe-vision] Flagged ${reviewCount} entries for review (${MIN_CONFIDENCE}-${REVIEW_CONFIDENCE})`);
  }

  const out = {
    target: TARGET,
    captured_at: new Date().toISOString(),
    model: MODEL,
    frame_count: frameFiles.length,
    cost_usd: totalCost,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    filters: { min_confidence: MIN_CONFIDENCE, review_confidence: REVIEW_CONFIDENCE },
    dropped_count: dropped.length,
    needs_review_count: reviewCount,
    total_animations: kept.length,
    animations: kept,
  };
  await writeFile(path.join(OUT_DIR, 'animations-vision.json'), JSON.stringify(out, null, 2));

  console.log(`[probe-vision] ${kept.length} animations captured`);
  console.log(`[probe-vision] Total cost: $${totalCost.toFixed(4)}`);
  console.log(`[probe-vision] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((e) => {
    console.error('[probe-vision] FATAL:', e);
    process.exit(1);
  });
}
