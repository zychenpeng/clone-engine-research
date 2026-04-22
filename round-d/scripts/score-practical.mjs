// Practical Utility scoring — output format, ship-ability, cost.
// Pure static analysis. No RAM-heavy tsc/build invocation (skip compile check for Round D).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const EVAL_DIR = path.join(ROOT, 'evaluation');

function detectFormat(toolDir) {
  const hasPageTsx = existsSync(path.join(toolDir, 'page.tsx'));
  const hasAppPageTsx = existsSync(path.join(toolDir, 'app', 'page.tsx'));
  const hasPackageJson = existsSync(path.join(toolDir, 'package.json'));
  const hasLayoutTsx = existsSync(path.join(toolDir, 'app', 'layout.tsx'));
  const hasVerify = existsSync(path.join(toolDir, 'verify'));
  const hasSections = existsSync(path.join(toolDir, 'sections'));
  const hasManifest = existsSync(path.join(toolDir, 'manifest.json'));
  const hasAssets = existsSync(path.join(toolDir, 'assets'));

  // Scan any html / md / wp files
  let allFiles = [];
  const walk = (d) => {
    try {
      for (const e of readdirSync(d)) {
        const full = path.join(d, e);
        const st = statSync(full);
        if (st.isDirectory() && !['node_modules', '.next', 'frames'].includes(e)) walk(full);
        else allFiles.push(full.toLowerCase());
      }
    } catch {}
  };
  walk(toolDir);

  const hasTsx = allFiles.some((f) => f.endsWith('.tsx') || f.endsWith('.jsx'));
  const hasHtml = allFiles.some((f) => f.endsWith('.html'));
  const hasMd = allFiles.some((f) => f.endsWith('.md'));

  if (hasTsx && (hasVerify || hasSections || hasManifest)) return 'react-multi-section';
  if (hasTsx && hasAppPageTsx && hasPackageJson && hasLayoutTsx) return 'react-full-project';
  if (hasTsx && hasPageTsx) return 'react-single-page';
  if (hasTsx) return 'react-other';
  if (hasHtml) return 'html';
  if (hasMd) return 'spec-only';
  return 'unknown';
}

const FORMAT_SCORE = {
  'react-full-project': 100, // Full Next.js app — page.tsx + layout + package.json (v0.dev)
  'react-multi-section': 95, // Cloner v2 style — sections + manifest + assets
  'react-single-page': 90,   // Single page.tsx (naive/null)
  'react-other': 75,
  'html': 60,
  'spec-only': 20,
  'unknown': 0,
};

function assessShipability(sources) {
  // Heuristics (avoid running tsc to save RAM):
  // - Has default export?
  // - Imports look well-formed?
  // - No obvious syntax red flags?
  let score = 100;
  const issues = [];
  for (const s of sources) {
    if (!/export\s+default\s/.test(s.content)) {
      score -= 10;
      issues.push(`${s.file}: no default export`);
    }
    if (/TODO|FIXME|\.\.\.|placeholder/i.test(s.content)) {
      score -= 5;
      issues.push(`${s.file}: has TODO/placeholder`);
    }
    // Tailwind config check for arbitrary values that won't compile without setup
    const arbitraryValuePresent = /\[\d+px\]|\[#[0-9a-f]+\]/i.test(s.content);
    // Actually arbitrary values do compile. Skip penalty.
    // Count suspicious unresolved imports (bare non-standard package refs)
    const imports = s.content.match(/from\s+['"]([^'"]+)['"]/g) || [];
    for (const imp of imports) {
      const pkg = imp.match(/['"]([^'"]+)['"]/)[1];
      if (pkg.startsWith('.') || pkg.startsWith('/')) continue; // relative
      if (['react', 'next', 'next/link', 'next/image', 'next/font', 'next/navigation',
           'react-dom', 'framer-motion', 'motion/react', 'lucide-react',
           '@anthropic-ai/sdk', '@/lib/utils', 'clsx', 'class-variance-authority',
           'tailwind-merge', '@base-ui/react'].some((ok) => pkg === ok || pkg.startsWith(ok))) continue;
      if (pkg.startsWith('@/')) continue; // project alias
      // Unknown bare import — minor penalty
      // Skip penalty for now (too many legit cases)
    }
  }
  return { score: Math.max(0, score), issues };
}

function collectSources(toolDir) {
  const out = [];
  const rootPage = path.join(toolDir, 'page.tsx');
  if (existsSync(rootPage)) {
    out.push({ file: 'page.tsx', path: rootPage });
    return out;
  }
  // Next.js App Router (v0.dev)
  const appPage = path.join(toolDir, 'app', 'page.tsx');
  if (existsSync(appPage)) {
    out.push({ file: 'app/page.tsx', path: appPage });
    const appLayout = path.join(toolDir, 'app', 'layout.tsx');
    if (existsSync(appLayout)) out.push({ file: 'app/layout.tsx', path: appLayout });
    return out;
  }
  const verifyDir = path.join(toolDir, 'verify');
  if (existsSync(verifyDir)) {
    for (const e of readdirSync(verifyDir)) {
      const best = path.join(verifyDir, e, 'best.tsx');
      if (existsSync(best)) out.push({ file: `${e}/best.tsx`, path: best });
    }
    return out;
  }
  return [];
}

async function readMetadata(toolDir) {
  const metaPath = path.join(toolDir, '_run-metadata.json');
  if (!existsSync(metaPath)) return null;
  try { return JSON.parse(await readFile(metaPath, 'utf8')); } catch { return null; }
}

async function scoreTool(toolId, toolDir) {
  const format = detectFormat(toolDir);
  const formatScore = FORMAT_SCORE[format] ?? 0;

  const sources = collectSources(toolDir);
  const sourceContents = await Promise.all(sources.map(async (s) => ({ ...s, content: await readFile(s.path, 'utf8') })));
  const ship = sources.length > 0 ? assessShipability(sourceContents) : { score: 0, issues: ['no tsx source found'] };

  const meta = await readMetadata(toolDir);
  const cost = meta?.cost_usd || null;
  const wallSec = meta?.wall_clock_s ? parseFloat(meta.wall_clock_s) : null;

  const composite_practical = Math.round(formatScore * 0.5 + ship.score * 0.3 + (cost !== null ? 20 : 10));
  // cost sub-score: if known, 20; if unknown, 10 (incomplete metadata)

  return {
    tool: toolId,
    format,
    sub_metrics: {
      format_score: formatScore,
      ship_ability_score: ship.score,
      has_cost_metadata: cost !== null,
    },
    ship_issues: ship.issues.slice(0, 5),
    file_count: sources.length,
    total_loc: sourceContents.reduce((acc, s) => acc + s.content.split('\n').length, 0),
    cost_usd: cost,
    wall_clock_s: wallSec,
    composite_practical,
  };
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(EVAL_DIR)) await mkdir(EVAL_DIR, { recursive: true });

  const toolDirs = readdirSync(OUTPUTS_DIR).filter((d) => /^\d\d-/.test(d));
  const results = [];
  for (const td of toolDirs) {
    const r = await scoreTool(td, path.join(OUTPUTS_DIR, td));
    results.push(r);
  }

  const out = {
    scored_at: new Date().toISOString(),
    tool_count: results.length,
    tools: results,
  };
  await writeFile(path.join(EVAL_DIR, 'score-practical.json'), JSON.stringify(out, null, 2));

  console.log(`[score-practical] ✅ ${results.length} tools scored, elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[score-practical] Ranking:`);
  const ranked = [...results].sort((a, b) => b.composite_practical - a.composite_practical);
  for (const r of ranked) {
    console.log(`  ${String(r.composite_practical).padStart(3)} ${r.tool}  — format=${r.format}, loc=${r.total_loc}, ship=${r.sub_metrics.ship_ability_score}`);
  }
}

main().catch((e) => {
  console.error('[score-practical] FATAL:', e);
  process.exit(1);
});
