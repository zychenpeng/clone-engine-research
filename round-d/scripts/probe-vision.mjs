// Layer 2 — Claude Vision on 20 sampled frames.
// Sends all 20 frames in one message with the probe-vision.txt prompt.

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const FRAMES = path.join(ROOT, 'target', 'frames');
const OUT = path.join(ROOT, 'target', 'animations-vision.json');
const PROMPT_PATH = path.join(ROOT, 'prompts', 'probe-vision.txt');

const MODEL = 'claude-sonnet-4-5-20250929'; // Sonnet 4.5

function extractJson(text) {
  // Strip any leading/trailing commentary
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('No JSON array found in response');
  return JSON.parse(m[0]);
}

async function main() {
  const t0 = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  const prompt = await readFile(PROMPT_PATH, 'utf8');

  const frameFiles = readdirSync(FRAMES)
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (frameFiles.length < 10) {
    throw new Error(`Only ${frameFiles.length} frames found in ${FRAMES}; expected ~20. Run probe-animations.mjs first.`);
  }
  console.log(`[probe-vision] Loading ${frameFiles.length} frames from ${FRAMES}`);

  const imageBlocks = [];
  for (const f of frameFiles) {
    const buf = await readFile(path.join(FRAMES, f));
    const b64 = buf.toString('base64');
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    });
    // Text label so Claude knows which frame index this is
    imageBlocks.push({ type: 'text', text: `[Frame ${f.replace('.png', '')}]` });
  }

  console.log(`[probe-vision] Calling ${MODEL}, total ${imageBlocks.length / 2} frames`);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [...imageBlocks, { type: 'text', text: prompt }],
      },
    ],
  });

  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const usage = response.usage;
  console.log(`[probe-vision] Response usage: input=${usage.input_tokens} output=${usage.output_tokens}`);
  // Rough cost estimate for Sonnet 4.5: $3/M input, $15/M output
  const estCost = (usage.input_tokens * 3 + usage.output_tokens * 15) / 1_000_000;
  console.log(`[probe-vision] Est cost: $${estCost.toFixed(3)}`);

  let animations;
  try {
    animations = extractJson(text);
  } catch (e) {
    console.error('[probe-vision] JSON parse failed. Raw response:');
    console.error(text.slice(0, 500));
    throw e;
  }

  await writeFile(OUT, JSON.stringify({
    target: process.env.TARGET_URL || 'https://linear.app',
    captured_at: new Date().toISOString(),
    model: MODEL,
    frame_count: frameFiles.length,
    cost_usd: estCost,
    total_animations: animations.length,
    animations,
  }, null, 2));

  console.log(`[probe-vision] ✅ ${animations.length} animations captured → ${path.basename(OUT)}`);
  console.log(`[probe-vision] ✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('[probe-vision] FATAL:', e);
  process.exit(1);
});
