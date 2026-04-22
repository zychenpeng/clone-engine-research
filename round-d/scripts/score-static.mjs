// Static Fidelity scoring — LLM-as-judge via Claude Vision.
// For each tool, compare (tsx source + optional rendered screenshot) against ground truth 1440.png.
// Returns 0-100 scores on: visual, color, typography, layout.
// Why LLM-judge: rendering tsx → screenshot requires next dev (RAM killer).
// LLM sees source + target and reasons holistically. Business-standard approach in 2026.

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import sharp from 'sharp';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const GROUND_TRUTH_PNG = path.join(ROOT, 'target', 'screenshots', '1440.png');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const EVAL_DIR = path.join(ROOT, 'evaluation');
const MODEL = 'claude-sonnet-4-5-20250929';

const JUDGE_PROMPT = `You are a senior frontend engineer evaluating how accurately a generated clone matches a target website.

I will give you:
1. TARGET screenshot of the original website (linear.app homepage, 1440px)
2. GENERATED CODE (one or more .tsx files) that attempts to clone it

Score the generated code's static fidelity on these 4 dimensions (0-100 each):

1. **visual_similarity** — If we rendered this code, how close would the overall layout/composition look to the target? (composition, hierarchy, spatial rhythm)
2. **color_accuracy** — Do the CSS colors (hex/oklch/rgb/Tailwind classes) match the target's palette? Consider dark theme, violet accents, exact backgrounds.
3. **typography_accuracy** — Do font families, sizes, weights match? Linear uses a custom geometric sans (not common Google Font).
4. **layout_structure** — Is the DOM/JSX tree structure reasonable? Right number of sections, nav, hero, feature grids, footer?

Also provide:
- **notes**: 1-2 sentence summary of strengths and weaknesses
- **confidence**: 0.0-1.0 (how confident in this score — lower if code is very short or unparseable)

Output STRICT JSON only. No commentary, no markdown fences. Schema:
{
  "visual_similarity": 0-100,
  "color_accuracy": 0-100,
  "typography_accuracy": 0-100,
  "layout_structure": 0-100,
  "notes": "...",
  "confidence": 0.0-1.0
}`;

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object found in response');
  return JSON.parse(m[0]);
}

function collectTsxSources(toolDir) {
  // Return concatenated tsx content from a tool's output dir.
  // Priorities: page.tsx at root → app/page.tsx (Next.js App Router) → cloner v2 verify/*/best.tsx → walk.
  const sources = [];
  // Pattern 1: page.tsx at root (claude-naive, claude-null)
  const rootPage = path.join(toolDir, 'page.tsx');
  if (existsSync(rootPage)) {
    sources.push({ file: 'page.tsx', path: rootPage });
    return sources;
  }
  // Pattern 2: Next.js App Router — app/page.tsx (v0.dev full project)
  const appPage = path.join(toolDir, 'app', 'page.tsx');
  if (existsSync(appPage)) {
    sources.push({ file: 'app/page.tsx', path: appPage });
    const appLayout = path.join(toolDir, 'app', 'layout.tsx');
    if (existsSync(appLayout)) sources.push({ file: 'app/layout.tsx', path: appLayout });
    // Skip components/ui/* (shadcn boilerplate, not clone-specific)
    return sources;
  }
  // Pattern 3: cloner v2 — verify/*/best.tsx
  const verifyDir = path.join(toolDir, 'verify');
  if (existsSync(verifyDir)) {
    const entries = readdirSync(verifyDir);
    for (const e of entries) {
      const best = path.join(verifyDir, e, 'best.tsx');
      if (existsSync(best)) sources.push({ file: `${e}/best.tsx`, path: best });
    }
    return sources;
  }
  // Pattern 4: scan for any .tsx (skip shadcn ui + node_modules)
  const walk = (dir) => {
    const out = [];
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      const st = statSync(full);
      if (st.isDirectory() && !['node_modules', '.next', 'ui'].includes(e)) out.push(...walk(full));
      else if (e.endsWith('.tsx') || e.endsWith('.jsx')) out.push({ file: path.relative(toolDir, full), path: full });
    }
    return out;
  };
  return walk(toolDir);
}

async function buildCodePayload(sources) {
  let text = '';
  let totalChars = 0;
  const MAX = 80_000; // safety cap
  for (const s of sources) {
    const content = await readFile(s.path, 'utf8');
    const block = `\n\n--- FILE: ${s.file} ---\n${content}`;
    if (totalChars + block.length > MAX) {
      text += `\n\n[truncated ${sources.length - sources.indexOf(s)} more files due to token budget]`;
      break;
    }
    text += block;
    totalChars += block.length;
  }
  return text.trim();
}

async function scoreTool(client, toolId, toolDir, targetB64) {
  console.log(`[score-static] scoring ${toolId}...`);
  const sources = collectTsxSources(toolDir);
  if (sources.length === 0) {
    console.log(`[score-static] ⚠️ no tsx files in ${toolId}, skipping`);
    return null;
  }
  const codePayload = await buildCodePayload(sources);

  const t0 = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: targetB64 } },
          { type: 'text', text: `TARGET: linear.app homepage (1440px desktop, full page, above).\n\nGENERATED CODE from tool "${toolId}" (${sources.length} file${sources.length > 1 ? 's' : ''}):\n\n${codePayload}\n\n${JUDGE_PROMPT}` },
        ],
      },
    ],
  });

  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let scores;
  try {
    scores = extractJson(text);
  } catch (e) {
    console.error(`[score-static] JSON parse failed for ${toolId}:`, text.slice(0, 300));
    return { error: e.message, raw: text.slice(0, 500) };
  }

  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);
  const cost = (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000;
  const composite = Math.round(
    scores.visual_similarity * 0.4 +
    scores.color_accuracy * 0.2 +
    scores.typography_accuracy * 0.2 +
    scores.layout_structure * 0.2
  );

  console.log(`[score-static] ${toolId}: visual=${scores.visual_similarity} color=${scores.color_accuracy} typo=${scores.typography_accuracy} layout=${scores.layout_structure} | composite=${composite}`);
  console.log(`[score-static]   notes: ${scores.notes}`);
  console.log(`[score-static]   cost $${cost.toFixed(3)}, ${wallSec}s, ${sources.length} files, ${codePayload.length} chars`);

  return {
    tool: toolId,
    file_count: sources.length,
    code_chars: codePayload.length,
    sub_metrics: {
      visual_similarity: scores.visual_similarity,
      color_accuracy: scores.color_accuracy,
      typography_accuracy: scores.typography_accuracy,
      layout_structure: scores.layout_structure,
    },
    composite_static: composite,
    notes: scores.notes,
    judge_confidence: scores.confidence,
    judge_model: MODEL,
    judge_usage: response.usage,
    judge_cost_usd: cost,
    judge_wall_s: parseFloat(wallSec),
  };
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(EVAL_DIR)) await mkdir(EVAL_DIR, { recursive: true });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  // Resize ground truth to max 7800px
  const meta = await sharp(GROUND_TRUTH_PNG).metadata();
  const maxDim = 7800;
  let targetBuf;
  if (meta.width > maxDim || meta.height > maxDim) {
    const scale = Math.min(maxDim / meta.width, maxDim / meta.height);
    targetBuf = await sharp(GROUND_TRUTH_PNG).resize(Math.floor(meta.width * scale), Math.floor(meta.height * scale)).png().toBuffer();
  } else {
    targetBuf = await readFile(GROUND_TRUTH_PNG);
  }
  const targetB64 = targetBuf.toString('base64');
  console.log(`[score-static] ground truth loaded (${(targetBuf.length / 1024).toFixed(0)} KB)`);

  // Scan tools
  const toolDirs = readdirSync(OUTPUTS_DIR).filter((d) => /^\d\d-/.test(d));
  const results = [];
  let totalCost = 0;
  for (const td of toolDirs) {
    const full = path.join(OUTPUTS_DIR, td);
    const r = await scoreTool(client, td, full, targetB64);
    if (r) {
      results.push(r);
      if (r.judge_cost_usd) totalCost += r.judge_cost_usd;
    }
  }

  const out = {
    scored_at: new Date().toISOString(),
    target: 'linear.app/homepage 1440px',
    tool_count: results.length,
    total_judge_cost_usd: totalCost,
    tools: results,
  };
  await writeFile(path.join(EVAL_DIR, 'score-static.json'), JSON.stringify(out, null, 2));
  console.log(`\n[score-static] ✅ ${results.length} tools scored, total judge cost $${totalCost.toFixed(3)}, elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[score-static] Ranking by composite_static:`);
  const ranked = [...results].sort((a, b) => (b.composite_static || 0) - (a.composite_static || 0));
  for (const r of ranked) {
    console.log(`  ${String(r.composite_static).padStart(3)} ${r.tool}  — ${r.notes?.slice(0, 80) || ''}`);
  }
}

main().catch((e) => {
  console.error('[score-static] FATAL:', e);
  process.exit(1);
});
