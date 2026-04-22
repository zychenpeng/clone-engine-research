// Merge Layer 1 (DOM getAnimations) + Layer 2 (Claude Vision)
// → canonical animation-spec.json per tools/animation-extractor/schema.ts.
//
// Round E upgrades (over Round D):
//   §7.4: type/trigger inheritance
//     - Vision wins on semantic fields (motion_type, trigger, role-ish element desc)
//     - DOM wins on timing fields (duration_ms, easing) when both present
//     - DOM-only entries inherit a best-effort motion_type (loop vs one-shot)
//       and trigger='unknown', which the emitter treats as continuous by default
//   - Emits canonical MotionType via normalizeMotionType()
//   - Stable content-addressed IDs via animationId()
//   - Output matches AnimationSpec (version-gated) so downstream consumers
//     can cheaply validate with schema.validateSpec().

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SPEC_VERSION,
  animationId,
  normalizeMotionType,
  normalizeTrigger,
  normalizeEasing,
  validateSpec,
} from './schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'out');
const DOM_PATH = process.env.DOM_PATH || path.join(OUT_DIR, 'animations-dom.json');
// Prefer the cross-validated Vision file when cross-validate.mjs has run;
// fall back to the raw Vision output so the pipeline is still usable in
// `--skip-cross-validate` or legacy modes.
const VERIFIED_VISION_PATH = path.join(OUT_DIR, 'animations-vision-verified.json');
const VISION_PATH = process.env.VISION_PATH
  || (existsSync(VERIFIED_VISION_PATH)
      ? VERIFIED_VISION_PATH
      : path.join(OUT_DIR, 'animations-vision.json'));
const SPEC_PATH = process.env.SPEC_PATH || path.join(OUT_DIR, 'animation-spec.json');
const DURATION_TOLERANCE = Number(process.env.DURATION_TOLERANCE || 0.3); // ±30%

function fuzzyMatch(domAnim, visionAnim) {
  const d1 = Number(domAnim.duration) || 0;
  const d2 = Number(visionAnim.approximate_duration_ms) || 0;
  if (d1 === 0 || d2 === 0) return false;
  const ratio = d1 / d2;
  const lo = 1 - DURATION_TOLERANCE;
  const hi = 1 + DURATION_TOLERANCE;
  if (ratio < lo || ratio > hi) return false;

  const visionWords = (visionAnim.element || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  const domSel = (domAnim.targetSelector || '').toLowerCase();
  return visionWords.some((w) => domSel.includes(w));
}

// DOM entries lack trigger semantics; assume 'continuous' for infinite loops,
// 'unknown' otherwise (emitter falls back to on-mount for unknown).
function inferDomTrigger(d) {
  if (d.iterations === null || d.iterations === 'Infinity' || d.iterations === Infinity) {
    return 'continuous';
  }
  return 'unknown';
}

function inferDomMotionType(d) {
  if (d.iterations === null || d.iterations === 'Infinity' || d.iterations === Infinity) {
    return 'loop';
  }
  return 'one-shot';
}

function pickDuration(domDuration, visionApprox) {
  const d = Number(domDuration);
  if (Number.isFinite(d) && d > 0) return d;
  const v = Number(visionApprox);
  return Number.isFinite(v) ? v : 0;
}

function pickEasing(domEasing, visionEasing) {
  // DOM reports exact easing from the Animation API; prefer it.
  const d = normalizeEasing(domEasing);
  if (d !== 'unknown') return d;
  return normalizeEasing(visionEasing);
}

function cleanElementLabel(d) {
  // Last segment of selector path, stripped of noise.
  const parts = (d.targetSelector || '').split(' > ');
  return parts[parts.length - 1] || 'unknown-element';
}

// Pure merge function — testable without any I/O.
// Accepts the JSON shapes produced by extract-dom.mjs / extract-vision.mjs
// and returns a canonical AnimationSpec. Does not validate; caller should.
export function mergeSpec(dom, vision) {
  const merged = [];
  const matchedDomIndices = new Set();

  for (const v of vision.animations) {
    let matchedIdx = -1;
    for (let i = 0; i < dom.animations.length; i++) {
      if (matchedDomIndices.has(i)) continue;
      if (fuzzyMatch(dom.animations[i], v)) {
        matchedIdx = i;
        break;
      }
    }

    const canonicalMotion = normalizeMotionType(v.motion_type, v.direction, v.trigger);
    const canonicalTrigger = normalizeTrigger(v.trigger);

    if (matchedIdx >= 0) {
      matchedDomIndices.add(matchedIdx);
      const d = dom.animations[matchedIdx];
      const duration_ms = pickDuration(d.duration, v.approximate_duration_ms);
      const easing = pickEasing(d.easing, v.approximate_easing);
      merged.push({
        id: animationId({
          element: v.element,
          motion_type: canonicalMotion,
          trigger: canonicalTrigger,
          duration_ms,
        }),
        provenance: ['dom', 'vision'],
        confidence: Math.max(0.9, Number(v.confidence) || 0.5), // two-layer agreement bumps to ≥0.9
        element: v.element,
        selector: d.targetSelector,
        motion_type: canonicalMotion,
        trigger: canonicalTrigger,
        duration_ms,
        easing,
        iterations: d.iterations ?? undefined,
        keyframes: Array.isArray(d.keyframes) && d.keyframes.length ? d.keyframes : undefined,
        frames_involved: Array.isArray(v.frames_involved) ? v.frames_involved : undefined,
        needs_review: v.needs_review || undefined,
      });
    } else {
      const duration_ms = Number(v.approximate_duration_ms) || 0;
      merged.push({
        id: animationId({
          element: v.element,
          motion_type: canonicalMotion,
          trigger: canonicalTrigger,
          duration_ms,
        }),
        provenance: ['vision'],
        confidence: Number(v.confidence) || 0.5,
        element: v.element,
        motion_type: canonicalMotion,
        trigger: canonicalTrigger,
        duration_ms,
        easing: normalizeEasing(v.approximate_easing),
        frames_involved: Array.isArray(v.frames_involved) ? v.frames_involved : undefined,
        needs_review: v.needs_review || (Number(v.confidence) || 0.5) < 0.7 || undefined,
      });
    }
  }

  // Pass 2: leftover DOM-only entries.
  for (let i = 0; i < dom.animations.length; i++) {
    if (matchedDomIndices.has(i)) continue;
    const d = dom.animations[i];
    const element = cleanElementLabel(d);
    const motion_type = inferDomMotionType(d);
    const trigger = inferDomTrigger(d);
    const duration_ms = Number(d.duration) || 0;
    merged.push({
      id: animationId({ element, motion_type, trigger, duration_ms }),
      provenance: ['dom'],
      confidence: 1.0,
      element,
      selector: d.targetSelector,
      motion_type,
      trigger,
      duration_ms,
      easing: normalizeEasing(d.easing),
      iterations: d.iterations ?? undefined,
      keyframes: Array.isArray(d.keyframes) && d.keyframes.length ? d.keyframes : undefined,
    });
  }

  const byProvenance = { dom: 0, vision: 0, both: 0 };
  const byTrigger = {};
  const byMotionType = {};
  for (const m of merged) {
    const prov = m.provenance.length === 2 ? 'both' : m.provenance[0];
    byProvenance[prov] = (byProvenance[prov] || 0) + 1;
    byTrigger[m.trigger] = (byTrigger[m.trigger] || 0) + 1;
    byMotionType[m.motion_type] = (byMotionType[m.motion_type] || 0) + 1;
  }

  const warnings = [];
  if (dom.warnings?.length) warnings.push(...dom.warnings.map((w) => `dom: ${w}`));
  if (merged.length === 0) warnings.push('merged spec contains zero animations');

  const spec = {
    version: SPEC_VERSION,
    target_url: dom.target,
    captured_at: new Date().toISOString(),
    total: merged.length,
    by_provenance: byProvenance,
    by_trigger: byTrigger,
    by_motion_type: byMotionType,
    layer_counts: {
      dom: dom.total_deduped ?? dom.animations.length,
      vision: vision.total_animations ?? vision.animations.length,
    },
    cost_usd: Number(vision.cost_usd) || undefined,
    warnings: warnings.length ? warnings : undefined,
    animations: merged,
  };

  return spec;
}

async function main() {
  if (!existsSync(DOM_PATH)) throw new Error(`DOM probe output not found: ${DOM_PATH}`);
  if (!existsSync(VISION_PATH)) throw new Error(`Vision probe output not found: ${VISION_PATH}`);

  const dom = JSON.parse(await readFile(DOM_PATH, 'utf8'));
  const vision = JSON.parse(await readFile(VISION_PATH, 'utf8'));

  console.log(`[merge] vision source: ${path.basename(VISION_PATH)}${vision.cross_validated ? ' (cross-validated)' : ' (raw)'}`);

  const spec = mergeSpec(dom, vision);
  validateSpec(spec);

  await writeFile(SPEC_PATH, JSON.stringify(spec, null, 2));
  console.log(`[merge] ${spec.total} animations → ${path.basename(SPEC_PATH)}`);
  console.log('[merge] provenance:', spec.by_provenance);
  console.log('[merge] triggers:', spec.by_trigger);
  console.log('[merge] motion types:', spec.by_motion_type);
  const reviewCount = spec.animations.filter((a) => a.needs_review).length;
  if (reviewCount) console.log(`[merge] ${reviewCount} entries flagged for review`);
  if (spec.warnings?.length) {
    console.warn(`[merge] Warnings:\n  - ${spec.warnings.join('\n  - ')}`);
  }
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((e) => {
    console.error('[merge] FATAL:', e);
    process.exit(1);
  });
}
