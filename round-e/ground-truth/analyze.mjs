// Phase E2 analyzer — reads the 5 ground-truth specs + Round D animations-T0
// and produces summary.json (machine) + REVIEW.md (human spot-check queue).
//
// Outputs:
//   summary.json  — per-site counts, provenance, motion-type histogram, cost
//   REVIEW.md     — 16 sampled entries for Sean to spot-check:
//     8 Linear Round E entries that did NOT exist in Round D ground truth
//     2 per site × 4 non-Linear sites (biased to overlap + high-confidence)
//
// Usage: node round-e/ground-truth/analyze.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const ROUND_D_T0 = path.join(REPO_ROOT, 'round-d', 'target', 'animations-T0.json');

const SITES = [
  { file: 'linear.app.json',  label: 'linear.app',  roundD: 27 },
  { file: 'stripe.com.json',  label: 'stripe.com',  roundD: null },
  { file: 'raycast.com.json', label: 'raycast.com', roundD: null },
  { file: 'vercel.com.json',  label: 'vercel.com',  roundD: null },
  { file: 'apple.com.json',   label: 'apple.com/mac', roundD: null },
];

function loadJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function topN(obj, n = 5) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function wordsOf(s) {
  return new Set(
    (s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)
  );
}

// Jaccard similarity on noun-ish word sets (words > 3 chars).
function jaccard(a, b) {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return inter / union;
}

function bestRoundDMatch(element, roundDElements) {
  let best = { sim: 0, text: null };
  for (const rd of roundDElements) {
    const s = jaccard(element, rd);
    if (s > best.sim) best = { sim: s, text: rd };
  }
  return best;
}

function linearDelta(roundE, roundD) {
  // Only compare Round E Vision entries (DOM layer produces identical output
  // both runs by design). Call an entry "new" when best Jaccard similarity
  // to any Round D entry < 0.3 — i.e. at most 1 shared noun out of ~4-6 total.
  const roundDElements = roundD.animations.map((a) => a.element || '').filter(Boolean);
  // Threshold calibrated by manual inspection of the 23 Round E × 27 Round D
  // pairs: 0.15 separates "describes same UI element with different phrasing"
  // from "unrelated element". See REVIEW.md spot-check for validation.
  const MATCH_THRESHOLD = 0.15;

  const rows = [];
  for (const e of roundE.animations) {
    if (!e.provenance.includes('vision')) continue;
    const match = bestRoundDMatch(e.element, roundDElements);
    rows.push({
      entry: e,
      bestMatch: match,
      isNew: match.sim < MATCH_THRESHOLD,
    });
  }
  return rows;
}

// Pick 2 entries per non-Linear site: prefer 1 overlap ('both' provenance)
// and 1 high-confidence vision-only. Falls back when overlap absent.
function sampleSite(spec) {
  const overlap = spec.animations.filter((a) => a.provenance.length === 2);
  const visionOnly = spec.animations
    .filter((a) => a.provenance.length === 1 && a.provenance[0] === 'vision')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const domOnly = spec.animations
    .filter((a) => a.provenance.length === 1 && a.provenance[0] === 'dom');

  const picks = [];
  if (overlap.length) picks.push({ tag: 'overlap', entry: overlap[0] });
  if (visionOnly.length) picks.push({ tag: 'vision-only', entry: visionOnly[0] });
  // fall back to DOM if we still need 2
  while (picks.length < 2 && domOnly.length) {
    picks.push({ tag: 'dom-only', entry: domOnly.shift() });
  }
  return picks.slice(0, 2);
}

function fmtEntry(e) {
  const sel = e.selector ? ` <code>${e.selector.slice(0, 80)}</code>` : '';
  const dir = e.frames_involved ? ` · frames ${e.frames_involved.slice(0, 5).join(',')}${e.frames_involved.length > 5 ? '…' : ''}` : '';
  return `**${e.motion_type}** / ${e.trigger} / ${e.duration_ms}ms / conf=${e.confidence.toFixed(2)}${dir}\n  element: ${e.element}${sel}`;
}

function main() {
  // Per-site summaries
  const specs = SITES.map((s) => {
    const spec = loadJSON(path.join(HERE, s.file));
    return { ...s, spec };
  });

  const summary = {
    generated_at: new Date().toISOString(),
    sites: specs.map(({ label, spec, roundD }) => ({
      site: label,
      total: spec.total,
      by_provenance: spec.by_provenance,
      by_motion_type_top5: Object.fromEntries(topN(spec.by_motion_type, 5)),
      by_trigger: spec.by_trigger,
      needs_review: spec.animations.filter((a) => a.needs_review).length,
      avg_confidence: Number(
        (spec.animations.reduce((s, a) => s + (a.confidence || 0), 0) / spec.animations.length).toFixed(3)
      ),
      cost_usd: spec.cost_usd || 0,
      round_d_baseline: roundD,
    })),
    totals: {
      animations: specs.reduce((s, x) => s + x.spec.total, 0),
      overlap_entries: specs.reduce((s, x) => s + (x.spec.by_provenance?.both || 0), 0),
      cost_usd: Number(specs.reduce((s, x) => s + (x.spec.cost_usd || 0), 0).toFixed(4)),
    },
  };

  // Linear delta vs Round D
  const linearRE = specs.find((s) => s.label === 'linear.app').spec;
  const roundD = loadJSON(ROUND_D_T0);
  const linearRows = linearDelta(linearRE, roundD);
  const newOnLinear = linearRows.filter((r) => r.isNew).map((r) => r.entry);
  const carriedOver = linearRows.filter((r) => !r.isNew);

  // Cross-site spot-check samples
  const samples = {};
  for (const { label, spec } of specs) {
    if (label === 'linear.app') continue;
    samples[label] = sampleSite(spec);
  }

  writeFileSync(path.join(HERE, 'summary.json'), JSON.stringify(summary, null, 2));

  // Build REVIEW.md
  const lines = [];
  const nLinear = 0; // filled in below after we compute newOnLinear
  const nSamples = 0;
  lines.push('# Phase E2 Ground-Truth Review\n');
  lines.push(`Generated: ${summary.generated_at}\n`);
  lines.push('> For each spot-check item below, mark ✅ (correct) / ⚠️ (partially) / ❌ (wrong) in this file and re-commit.\n');
  lines.push('## Per-site Summary\n');
  lines.push('| Site | Total | DOM | Vision | Both | Top MotionType | Avg Conf | Cost |');
  lines.push('|------|------:|----:|-------:|-----:|:---------------|---------:|-----:|');
  for (const s of summary.sites) {
    const top1 = Object.entries(s.by_motion_type_top5)[0];
    const topLabel = top1 ? `${top1[0]} (${top1[1]})` : '—';
    lines.push(
      `| ${s.site} | ${s.total} | ${s.by_provenance.dom} | ${s.by_provenance.vision} | ${s.by_provenance.both} | ${topLabel} | ${s.avg_confidence} | $${s.cost_usd.toFixed(4)} |`
    );
  }
  lines.push(`\n**Grand total**: ${summary.totals.animations} animations, ${summary.totals.overlap_entries} overlap, **$${summary.totals.cost_usd}** vision cost\n`);
  lines.push('> Budget reminder: PLAN §13 allocates $5 for Round E. Phase E2 used ' + (summary.totals.cost_usd / 5 * 100).toFixed(1) + '%.\n');

  lines.push('## ⚠️ 0-Overlap Anomaly on Linear\n');
  lines.push('Linear is the **only** site with `by_provenance.both = 0`. The other 4 sites show 3–7 overlap entries each.');
  lines.push('Root cause hypothesis: Linear\'s DOM animations are almost all `iterations=null` continuous loops at 1750–3200ms, while Vision captures scroll-triggered reveals at ~600ms. The ±30% duration window cannot bridge that gap.');
  lines.push('**Action (Sean\'s note)**: revisit `merge.mjs` fuzzy match before Phase E3 — relax to keyword-only match when Vision\'s `trigger` is scroll-* (DOM rarely has scroll trigger semantics anyway).\n');

  lines.push(`---\n## 🆕 Linear — ${newOnLinear.length} entries new in Round E vs Round D ground-truth\n`);
  lines.push(`Round D captured 27 animations (12 DOM + 15 Vision). Round E Vision captures ${linearRows.length} entries; ${carriedOver.length} overlap by text with Round D (Jaccard ≥ 0.15), **${newOnLinear.length} are candidate new**.`);
  lines.push('For each: was the animation really there in Round D too (we missed it), or is Round E Vision hallucinating?\n');
  newOnLinear.forEach((e, i) => {
    lines.push(`### L${i + 1}. \`${e.id}\`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated`);
    lines.push(fmtEntry(e));
    lines.push('');
  });

  lines.push('---\n## 🔬 Cross-site spot-check (2 per site)\n');
  for (const [site, picks] of Object.entries(samples)) {
    lines.push(`### ${site}`);
    picks.forEach((p, i) => {
      lines.push(`**${site} #${i + 1}** (${p.tag})  [ ] ✅ [ ] ⚠️ [ ] ❌`);
      lines.push(fmtEntry(p.entry));
      lines.push('');
    });
  }

  lines.push('---\n## Phase E3 Prerequisites\n');
  lines.push('Per Sean\'s Day-2 review note, before Phase E3 starts:\n');
  lines.push('- [ ] Revisit `tools/animation-extractor/merge.mjs` fuzzy match — relax beyond ±30% duration when Vision trigger is `scroll-*` (DOM rarely knows scroll semantics)');
  lines.push('- [ ] Consider a second match pass: selector-tag vs element-role overlap (e.g. `<h1>` selectors should match Vision entries labelled "headline")');
  lines.push('- [ ] Add unit test for the relaxed rule before touching live specs\n');

  writeFileSync(path.join(HERE, 'REVIEW.md'), lines.join('\n'));

  console.log(`[analyze] Wrote summary.json (${summary.totals.animations} animations, $${summary.totals.cost_usd})`);
  console.log(`[analyze] Wrote REVIEW.md with ${newOnLinear.length} Linear deltas + ${Object.values(samples).flat().length} cross-site samples`);
}

main();
