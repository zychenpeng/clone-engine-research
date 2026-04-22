// Merge Layer 1 (DOM getAnimations) + Layer 2 (Claude Vision) → animations-T0.json.
// Adds `provenance` tag to each entry. Simple fuzzy match (duration ±30%).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const DOM_PATH = path.join(ROOT, 'target', 'animations-dom.json');
const VISION_PATH = path.join(ROOT, 'target', 'animations-vision.json');
const OUT = path.join(ROOT, 'target', 'animations-T0.json');

function fuzzyMatch(domAnim, visionAnim) {
  // Match if duration within ±30% AND some keyword overlap between element descriptions
  const d1 = Number(domAnim.duration) || 0;
  const d2 = Number(visionAnim.approximate_duration_ms) || 0;
  if (d1 === 0 || d2 === 0) return false;
  const ratio = d1 / d2;
  if (ratio < 0.7 || ratio > 1.3) return false;

  // Weak keyword overlap: any word from Vision element appears in DOM selector
  const visionWords = (visionAnim.element || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const domSel = (domAnim.targetSelector || '').toLowerCase();
  const overlap = visionWords.some((w) => domSel.includes(w));
  return overlap;
}

async function main() {
  const dom = JSON.parse(await readFile(DOM_PATH, 'utf8'));
  const vision = JSON.parse(await readFile(VISION_PATH, 'utf8'));

  const merged = [];
  const matchedDomIndices = new Set();

  // Each Vision entry: try to match a DOM entry
  for (const v of vision.animations) {
    let matchedDomIdx = -1;
    for (let i = 0; i < dom.animations.length; i++) {
      if (matchedDomIndices.has(i)) continue;
      if (fuzzyMatch(dom.animations[i], v)) {
        matchedDomIdx = i;
        break;
      }
    }

    if (matchedDomIdx >= 0) {
      matchedDomIndices.add(matchedDomIdx);
      const d = dom.animations[matchedDomIdx];
      merged.push({
        provenance: ['dom', 'vision'],
        confidence: Math.max(0.9, v.confidence || 0.5), // bumped since two layers agree
        element: v.element,
        motion_type: v.motion_type,
        trigger: v.trigger,
        duration_ms: Number(d.duration) || v.approximate_duration_ms,
        easing: d.easing || v.approximate_easing,
        keyframes: d.keyframes,
        targetSelector: d.targetSelector,
        iterations: d.iterations,
      });
    } else {
      merged.push({
        provenance: ['vision'],
        confidence: v.confidence || 0.5,
        element: v.element,
        motion_type: v.motion_type,
        trigger: v.trigger,
        duration_ms: v.approximate_duration_ms,
        easing: v.approximate_easing,
        frames_involved: v.frames_involved,
        needs_review: (v.confidence || 0.5) < 0.7,
      });
    }
  }

  // Remaining DOM-only entries
  for (let i = 0; i < dom.animations.length; i++) {
    if (matchedDomIndices.has(i)) continue;
    const d = dom.animations[i];
    merged.push({
      provenance: ['dom'],
      confidence: 1.0, // DOM API output is precise
      element: d.targetSelector.split(' > ').pop(), // last segment is the immediate target
      motion_type: d.iterations === null || d.iterations === 'Infinity' ? 'loop' : 'one-shot',
      trigger: 'unknown', // DOM layer doesn't know trigger semantics
      duration_ms: Number(d.duration) || 0,
      easing: d.easing,
      keyframes: d.keyframes,
      targetSelector: d.targetSelector,
      iterations: d.iterations,
    });
  }

  // Counts
  const byProvenance = { 'dom-only': 0, 'vision-only': 0, both: 0 };
  const byTrigger = {};
  const byMotionType = {};
  const lowConf = [];
  for (const m of merged) {
    const prov = m.provenance.join('+');
    if (prov === 'dom') byProvenance['dom-only']++;
    else if (prov === 'vision') byProvenance['vision-only']++;
    else byProvenance['both']++;

    byTrigger[m.trigger] = (byTrigger[m.trigger] || 0) + 1;
    byMotionType[m.motion_type] = (byMotionType[m.motion_type] || 0) + 1;
    if (m.needs_review) lowConf.push(m.element);
  }

  const out = {
    target: dom.target,
    merged_at: new Date().toISOString(),
    summary: {
      total: merged.length,
      by_provenance: byProvenance,
      by_trigger: byTrigger,
      by_motion_type: byMotionType,
      needs_human_review: lowConf,
    },
    layer_counts: {
      dom: dom.total_deduped,
      vision: vision.total_animations,
    },
    animations: merged,
  };

  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`[merge] ✅ ${merged.length} animations merged → animations-T0.json`);
  console.log(`[merge] provenance:`, byProvenance);
  console.log(`[merge] triggers:`, byTrigger);
  console.log(`[merge] motion types:`, byMotionType);
  if (lowConf.length > 0) console.log(`[merge] ⚠️ ${lowConf.length} low-confidence entries: ${lowConf.join(', ')}`);
}

main().catch((e) => {
  console.error('[merge] FATAL:', e);
  process.exit(1);
});
