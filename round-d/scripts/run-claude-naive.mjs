// Tool 03 — Claude-naive: URL + prompt, Sonnet 4.5 fresh (via SDK, no project context).

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const PROMPT_PATH = path.join(ROOT, 'prompts', 'claude-naive.txt');
const OUT_DIR = path.join(ROOT, 'outputs', '03-claude-naive');
const MODEL = 'claude-sonnet-4-5-20250929';

async function main() {
  const t0 = Date.now();
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const prompt = await readFile(PROMPT_PATH, 'utf8');

  console.log(`[claude-naive] Calling ${MODEL}...`);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  // Strip markdown fences if present
  let code = text.trim();
  const fence = code.match(/^```(?:tsx|typescript|jsx)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) code = fence[1];

  await writeFile(path.join(OUT_DIR, 'page.tsx'), code);
  await writeFile(path.join(OUT_DIR, '_run-metadata.json'), JSON.stringify({
    tool: 'claude-naive',
    model: MODEL,
    usage: response.usage,
    cost_usd: (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000,
    wall_clock_s: ((Date.now() - t0) / 1000).toFixed(1),
    captured_at: new Date().toISOString(),
  }, null, 2));

  console.log(`[claude-naive] ✅ ${code.length} chars → page.tsx`);
  console.log(`[claude-naive] usage: in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
  console.log(`[claude-naive] cost: $${((response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000).toFixed(3)}`);
  console.log(`[claude-naive] ✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('[claude-naive] FATAL:', e);
  process.exit(1);
});
