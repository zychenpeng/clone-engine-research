// Tool 04 — Claude-null: screenshot only (no URL), Sonnet 4.5 fresh.
// Control arm that measures the value of URL access vs pure vision.

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const PROMPT_PATH = path.join(ROOT, 'prompts', 'claude-null.txt');
const SCREENSHOT = path.join(ROOT, 'target', 'screenshots', '1440.png');
const OUT_DIR = path.join(ROOT, 'outputs', '04-claude-null');
const MODEL = 'claude-sonnet-4-5-20250929';

async function main() {
  const t0 = Date.now();
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const prompt = await readFile(PROMPT_PATH, 'utf8');

  // Resize: Anthropic API caps image dimensions at 8000px. Linear fullpage often >10000 tall.
  const meta = await sharp(SCREENSHOT).metadata();
  const maxDim = 7800; // buffer under 8000
  let buf;
  if (meta.width > maxDim || meta.height > maxDim) {
    const scale = Math.min(maxDim / meta.width, maxDim / meta.height);
    const newW = Math.floor(meta.width * scale);
    const newH = Math.floor(meta.height * scale);
    console.log(`[claude-null] Resizing ${meta.width}x${meta.height} → ${newW}x${newH}`);
    buf = await sharp(SCREENSHOT).resize(newW, newH).png().toBuffer();
  } else {
    buf = await readFile(SCREENSHOT);
  }
  const b64 = buf.toString('base64');

  console.log(`[claude-null] Calling ${MODEL} with 1440.png (${(buf.length / 1024).toFixed(0)} KB)...`);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let code = text.trim();
  const fence = code.match(/^```(?:tsx|typescript|jsx)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) code = fence[1];

  await writeFile(path.join(OUT_DIR, 'page.tsx'), code);
  await writeFile(path.join(OUT_DIR, '_run-metadata.json'), JSON.stringify({
    tool: 'claude-null',
    model: MODEL,
    input: 'screenshot-only (no URL)',
    usage: response.usage,
    cost_usd: (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000,
    wall_clock_s: ((Date.now() - t0) / 1000).toFixed(1),
    captured_at: new Date().toISOString(),
  }, null, 2));

  console.log(`[claude-null] ✅ ${code.length} chars → page.tsx`);
  console.log(`[claude-null] usage: in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  console.log(`[claude-null] cost: $${((response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000).toFixed(3)}`);
  console.log(`[claude-null] ✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('[claude-null] FATAL:', e);
  process.exit(1);
});
