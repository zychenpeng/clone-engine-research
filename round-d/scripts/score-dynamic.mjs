// Dynamic Fidelity scoring — pure static analysis of tsx source vs ground truth animations.
// Counts: framer-motion / motion usage, Tailwind hover/focus/active/group classes, CSS animation/transition.
// Compares to ground-truth 27 animations in animations-T0.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const GROUND_TRUTH = path.join(ROOT, 'target', 'animations-T0.json');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const EVAL_DIR = path.join(ROOT, 'evaluation');

// Patterns for animation detection
const PATTERNS = {
  // Library imports
  framer_motion: /from\s+['"](framer-motion|motion\/react)['"]/g,
  gsap: /from\s+['"]gsap['"]/g,
  lottie: /from\s+['"]lottie-react['"]/g,
  // Motion components
  motion_component: /<motion\.[a-z]+/gi,
  animate_presence: /<AnimatePresence/g,
  use_animate: /use(Animate|Spring|Motion|Transform|InView|Scroll)/g,
  // Tailwind animation classes
  hover_class: /\bhover:[\w-]+/g,
  focus_class: /\bfocus:[\w-]+/g,
  active_class: /\bactive:[\w-]+/g,
  group_class: /\bgroup(-hover|-focus)?:[\w-]+/g,
  transition_class: /\btransition(-[\w]+)?/g,
  animate_class: /\banimate-[\w-]+/g,
  duration_class: /\bduration-\d+/g,
  ease_class: /\bease-[\w-]+/g,
  // CSS-in-JS
  css_transition: /transition\s*:\s*[^;'"]+/gi,
  css_animation: /animation\s*:\s*[^;'"]+/gi,
  css_keyframes: /@keyframes\s+\w+/gi,
  // Scroll triggers
  intersection: /IntersectionObserver|useInView/g,
  scroll_effect: /useScroll|scrollYProgress|onScroll/g,
};

function analyzeFile(content) {
  const counts = {};
  for (const [key, rx] of Object.entries(PATTERNS)) {
    const matches = content.match(rx) || [];
    counts[key] = matches.length;
  }
  return counts;
}

function collectTsx(toolDir) {
  const out = [];
  const rootPage = path.join(toolDir, 'page.tsx');
  if (existsSync(rootPage)) {
    out.push(rootPage);
    return out;
  }
  // Next.js App Router (v0.dev)
  const appPage = path.join(toolDir, 'app', 'page.tsx');
  if (existsSync(appPage)) {
    out.push(appPage);
    const appLayout = path.join(toolDir, 'app', 'layout.tsx');
    if (existsSync(appLayout)) out.push(appLayout);
    return out;
  }
  const verifyDir = path.join(toolDir, 'verify');
  if (existsSync(verifyDir)) {
    for (const e of readdirSync(verifyDir)) {
      const best = path.join(verifyDir, e, 'best.tsx');
      if (existsSync(best)) out.push(best);
    }
    return out;
  }
  const walk = (d) => {
    const files = [];
    for (const e of readdirSync(d)) {
      const full = path.join(d, e);
      const st = statSync(full);
      if (st.isDirectory() && !['node_modules', '.next', 'ui'].includes(e)) files.push(...walk(full));
      else if (e.endsWith('.tsx') || e.endsWith('.jsx')) files.push(full);
    }
    return files;
  };
  return walk(toolDir);
}

async function scoreTool(toolId, toolDir, groundTruthCount, groundTruthTriggers) {
  const files = collectTsx(toolDir);
  if (files.length === 0) {
    console.log(`[score-dynamic] ⚠️ no tsx in ${toolId}`);
    return null;
  }
  const totals = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, 0]));
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    const c = analyzeFile(content);
    for (const k of Object.keys(totals)) totals[k] += c[k];
  }

  // Derived metrics
  const lib_animation_count = totals.framer_motion + totals.gsap + totals.lottie +
    totals.motion_component + totals.animate_presence + totals.use_animate;
  const interaction_state_count = totals.hover_class + totals.focus_class + totals.active_class + totals.group_class;
  const transition_count = totals.transition_class + totals.animate_class + totals.css_transition + totals.css_animation;
  const scroll_animation_count = totals.intersection + totals.scroll_effect;

  // Estimated captured animations = library_motion + CSS_keyframes + scroll_effect
  // (hover/focus classes are counted separately as interaction presence, not "animations" per se)
  const est_captured_animations = lib_animation_count + totals.css_keyframes + scroll_animation_count;

  // Animation count score: ratio vs ground truth (capped 0-100)
  const anim_count_score = Math.min(100, Math.round((est_captured_animations / groundTruthCount) * 100));

  // Interaction presence score: any hover/focus/active class at all?
  // Ground truth has hover-triggered animations so 1+ classes = partial credit
  const interaction_score = interaction_state_count === 0
    ? 0
    : Math.min(100, Math.round(Math.log10(interaction_state_count + 1) * 50)); // logarithmic: 1→15, 10→55, 100→100

  const composite_dynamic = Math.round(anim_count_score * 0.5 + interaction_score * 0.5);

  console.log(`[score-dynamic] ${toolId}: anim=${est_captured_animations}/${groundTruthCount} (${anim_count_score}) | interactions=${interaction_state_count} (${interaction_score}) | composite=${composite_dynamic}`);

  return {
    tool: toolId,
    file_count: files.length,
    raw_counts: totals,
    derived: {
      lib_animation_count,
      interaction_state_count,
      transition_count,
      scroll_animation_count,
      est_captured_animations,
    },
    vs_ground_truth: {
      ground_truth_total: groundTruthCount,
      captured: est_captured_animations,
      ratio: (est_captured_animations / groundTruthCount).toFixed(2),
    },
    sub_metrics: {
      animation_count_score: anim_count_score,
      interaction_presence_score: interaction_score,
    },
    composite_dynamic,
  };
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(EVAL_DIR)) await mkdir(EVAL_DIR, { recursive: true });

  const gt = JSON.parse(await readFile(GROUND_TRUTH, 'utf8'));
  const groundTruthCount = gt.summary?.total || gt.animations?.length || 27;
  const groundTruthTriggers = gt.summary?.by_trigger || {};
  console.log(`[score-dynamic] Ground truth: ${groundTruthCount} animations`);

  const toolDirs = readdirSync(OUTPUTS_DIR).filter((d) => /^\d\d-/.test(d));
  const results = [];
  for (const td of toolDirs) {
    const r = await scoreTool(td, path.join(OUTPUTS_DIR, td), groundTruthCount, groundTruthTriggers);
    if (r) results.push(r);
  }

  const out = {
    scored_at: new Date().toISOString(),
    ground_truth: { total: groundTruthCount, triggers: groundTruthTriggers },
    tool_count: results.length,
    tools: results,
  };
  await writeFile(path.join(EVAL_DIR, 'score-dynamic.json'), JSON.stringify(out, null, 2));

  console.log(`\n[score-dynamic] ✅ ${results.length} tools scored, elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[score-dynamic] Ranking by composite_dynamic:`);
  const ranked = [...results].sort((a, b) => b.composite_dynamic - a.composite_dynamic);
  for (const r of ranked) {
    console.log(`  ${String(r.composite_dynamic).padStart(3)} ${r.tool}  — est_animations=${r.derived.est_captured_animations}, interactions=${r.derived.interaction_state_count}`);
  }
}

main().catch((e) => {
  console.error('[score-dynamic] FATAL:', e);
  process.exit(1);
});
