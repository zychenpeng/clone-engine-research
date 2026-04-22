// Compile final scorecard.md from score-static.json + score-dynamic.json + score-practical.json.
// Weights: Static 1.0 | Dynamic 1.5 | Practical 1.0 → overall = (S + 1.5*D + P) / 3.5

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const EVAL = path.join(ROOT, 'evaluation');

async function readJson(p) {
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8'));
}

async function main() {
  const s = await readJson(path.join(EVAL, 'score-static.json'));
  const d = await readJson(path.join(EVAL, 'score-dynamic.json'));
  const p = await readJson(path.join(EVAL, 'score-practical.json'));

  if (!d || !p) {
    console.error('[compile] missing dynamic or practical scores; run those first');
    process.exit(1);
  }

  // Build per-tool row
  const toolIds = new Set();
  [...(s?.tools || []), ...d.tools, ...p.tools].forEach((t) => toolIds.add(t.tool));
  const rows = [];
  for (const tid of toolIds) {
    const sT = s?.tools?.find((t) => t.tool === tid);
    const dT = d.tools.find((t) => t.tool === tid);
    const pT = p.tools.find((t) => t.tool === tid);
    const staticScore = sT?.composite_static ?? null;
    const dynamicScore = dT?.composite_dynamic ?? null;
    const practicalScore = pT?.composite_practical ?? null;
    let overall = null;
    if (staticScore !== null && dynamicScore !== null && practicalScore !== null) {
      overall = Math.round((staticScore * 1.0 + dynamicScore * 1.5 + practicalScore * 1.0) / 3.5);
    }
    rows.push({
      tool: tid,
      static: staticScore,
      dynamic: dynamicScore,
      practical: practicalScore,
      overall,
      static_detail: sT?.sub_metrics,
      static_notes: sT?.notes,
      dynamic_detail: dT?.derived,
      practical_detail: { format: pT?.format, loc: pT?.total_loc, cost: pT?.cost_usd },
    });
  }

  // Sort by overall (nulls last)
  rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  // Markdown scorecard
  const lines = [];
  lines.push(`# Round D Scorecard — Linear.app Clone`);
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Target:** https://linear.app (homepage, 1440px)`);
  lines.push(`**Ground truth:** ${d.ground_truth.total} merged animations (DOM + Vision)`);
  lines.push('');
  lines.push(`## Overall Ranking (weighted: Static×1.0 + Dynamic×1.5 + Practical×1.0)`);
  lines.push('');
  lines.push(`| Rank | Tool | Static | Dynamic | Practical | **Overall** |`);
  lines.push(`|------|------|--------|---------|-----------|-------------|`);
  rows.forEach((r, i) => {
    const fmt = (v) => v === null ? '—' : String(v);
    lines.push(`| ${i + 1} | \`${r.tool}\` | ${fmt(r.static)} | ${fmt(r.dynamic)} | ${fmt(r.practical)} | **${fmt(r.overall)}** |`);
  });
  lines.push('');

  // Static breakdown
  if (s) {
    lines.push(`## Static Fidelity (LLM-as-judge, Claude Sonnet 4.5 Vision)`);
    lines.push('');
    lines.push(`| Tool | Visual | Color | Typography | Layout | Composite | Notes |`);
    lines.push(`|------|--------|-------|------------|--------|-----------|-------|`);
    for (const r of rows) {
      const sd = r.static_detail;
      if (!sd) { lines.push(`| \`${r.tool}\` | — | — | — | — | — | not scored |`); continue; }
      lines.push(`| \`${r.tool}\` | ${sd.visual_similarity} | ${sd.color_accuracy} | ${sd.typography_accuracy} | ${sd.layout_structure} | **${r.static}** | ${(r.static_notes || '').slice(0, 100)} |`);
    }
    lines.push('');
  }

  // Dynamic breakdown
  lines.push(`## Dynamic Fidelity (static code analysis vs ${d.ground_truth.total} ground-truth animations)`);
  lines.push('');
  lines.push(`| Tool | Animations captured | vs Truth | Interactions | Composite |`);
  lines.push(`|------|---------------------|----------|--------------|-----------|`);
  for (const r of rows) {
    const dd = r.dynamic_detail;
    if (!dd) { lines.push(`| \`${r.tool}\` | — | — | — | — |`); continue; }
    lines.push(`| \`${r.tool}\` | ${dd.est_captured_animations} | ${Math.round((dd.est_captured_animations / d.ground_truth.total) * 100)}% | ${dd.interaction_state_count} | **${r.dynamic}** |`);
  }
  lines.push('');

  // Practical breakdown
  lines.push(`## Practical Utility`);
  lines.push('');
  lines.push(`| Tool | Format | LOC | Cost | Composite |`);
  lines.push(`|------|--------|-----|------|-----------|`);
  for (const r of rows) {
    const pd = r.practical_detail;
    if (!pd) { lines.push(`| \`${r.tool}\` | — | — | — | — |`); continue; }
    lines.push(`| \`${r.tool}\` | ${pd.format} | ${pd.loc} | ${pd.cost ? '$' + pd.cost.toFixed(3) : 'n/a'} | **${r.practical}** |`);
  }
  lines.push('');

  // Insights
  lines.push(`## Key Insights`);
  lines.push('');
  const topOverall = rows.find((r) => r.overall !== null);
  if (topOverall) lines.push(`- **Overall winner**: \`${topOverall.tool}\` (${topOverall.overall})`);
  const topStatic = s ? [...rows].sort((a, b) => (b.static || 0) - (a.static || 0))[0] : null;
  if (topStatic) lines.push(`- **Static winner**: \`${topStatic.tool}\` (${topStatic.static})`);
  const topDyn = [...rows].sort((a, b) => (b.dynamic || 0) - (a.dynamic || 0))[0];
  lines.push(`- **Dynamic winner**: \`${topDyn.tool}\` (${topDyn.dynamic})`);
  const topPrac = [...rows].sort((a, b) => (b.practical || 0) - (a.practical || 0))[0];
  lines.push(`- **Practical winner**: \`${topPrac.tool}\` (${topPrac.practical})`);
  const maxDynPct = Math.max(...rows.map((r) => r.dynamic_detail ? (r.dynamic_detail.est_captured_animations / d.ground_truth.total) : 0));
  lines.push(`- **Best animation coverage**: ${Math.round(maxDynPct * 100)}% of ${d.ground_truth.total} ground-truth animations`);
  if (maxDynPct < 0.5) lines.push(`- ⚠️ **ALL tools under 50% animation coverage** — this is the stated core gap, confirmed quantitatively`);
  lines.push('');
  lines.push(`See \`score-static.json\`, \`score-dynamic.json\`, \`score-practical.json\` for raw data.`);

  const outPath = path.join(EVAL, 'scorecard.md');
  await writeFile(outPath, lines.join('\n'));
  console.log(`[compile] ✅ ${outPath}`);
  console.log(`[compile] Ranking:`);
  for (const r of rows) console.log(`  ${String(r.overall ?? '—').padStart(3)} ${r.tool} (S${r.static ?? '?'}/D${r.dynamic ?? '?'}/P${r.practical ?? '?'})`);
}

main().catch((e) => { console.error('[compile]', e); process.exit(1); });
