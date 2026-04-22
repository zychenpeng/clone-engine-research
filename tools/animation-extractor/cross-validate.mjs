// Cross-Validator — Round E Pivot Layer 4.
//
// Consumes:
//   - animations-vision.json   (Layer 3 candidates, unverified by default)
//   - mutation-log.json         (Layer 2' rrweb DOM/CSSOM evidence)
//
// Produces:
//   - animations-vision-verified.json  Shape-compatible with the raw Vision
//       output but ONLY contains entries that earned a `verified: true` flag
//       plus an `evidence` object pointing at the matched mutation. Merge
//       picks this up by default so the downstream spec never contains
//       phantom animations.
//   - cross-validation.json             Full audit log: every candidate with
//       verdict / reason / evidence or null. Preserved for Sean's review and
//       for regression tracking across Phase E-Pivot iterations.
//
// Rule (per PIVOT.md §3):
//   A Vision candidate earns `verified = true` iff there exists a rrweb
//   mutation M such that:
//     (a) M's path / tag / classes contains at least one keyword extracted
//         from the Vision entry's `element` description
//     (b) M is a motion mutation (style change on opacity / transform /
//         filter / clip-path / translate / scale / rotate, OR a source-13
//         StyleDeclaration on a motion property)
//     (c) M.t falls inside the time window for the Vision entry's trigger:
//           scroll-in / scroll-out → [scroll_timeline[min_frame].t - W,
//                                      scroll_timeline[max_frame].t + W]
//           on-load / on-mount     → [0, scroll_timeline[0].t]
//           continuous             → [0, recording_end]
//           hover / focus          → [scroll_timeline[-1].t, +10s]
//           default                → [0, recording_end]  (permissive)
//         where W = 500ms (configurable).
// Otherwise: rejected, reason populated so we can bucket failures.
//
// Pure `crossValidate(...)` is exported so unit tests can exercise every
// code path with synthetic inputs, without touching the filesystem.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'out');
const VISION_PATH = process.env.VISION_PATH || path.join(OUT_DIR, 'animations-vision.json');
const MUTATION_LOG_PATH = process.env.MUTATION_LOG_PATH || path.join(OUT_DIR, 'mutation-log.json');
const VERIFIED_PATH = process.env.VERIFIED_PATH || path.join(OUT_DIR, 'animations-vision-verified.json');
const REPORT_PATH = process.env.REPORT_PATH || path.join(OUT_DIR, 'cross-validation.json');
const TIME_WINDOW_MS = Number(process.env.TIME_WINDOW_MS || 500);

// --- Pure helpers ---------------------------------------------------------

// Common English stop-words + filler words we see in Vision's prose. Keeps
// keyword extraction focused on nouns / proper nouns that actually collide
// with DOM selectors or class names.
const STOP_WORDS = new Set([
  'with', 'from', 'that', 'this', 'over', 'into', 'their', 'there',
  'have', 'they', 'what', 'when', 'where', 'which', 'while', 'them',
  'your', 'yours', 'ours', 'been', 'being', 'more', 'most', 'much',
  'some', 'such', 'than', 'then', 'these', 'those',
]);

export function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  const raw = text
    .toLowerCase()
    .replace(/['"`]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return Array.from(new Set(raw));
}

// Require ≥2 distinct keyword hits by default. Smoke test on linear.app
// (2026-04-22) showed that a single structural word like "section" is
// enough to collide between unrelated Vision elements and DOM selectors —
// e.g. "Section 'Define the product direction'" would match any element
// nested inside <section> class chains. Two hits gates out that noise.
export function matchElement(mutation, keywords, { minMatches = 2 } = {}) {
  if (!keywords.length) return false;
  const haystack = `${mutation.path || ''} ${mutation.tag || ''} ${(mutation.classes || []).join(' ')}`.toLowerCase();
  if (keywords.length < minMatches) {
    // Nothing more we can do; fall back to single match when there aren't
    // enough keywords to enforce the threshold.
    return keywords.some((k) => haystack.includes(k));
  }
  let hits = 0;
  for (const k of keywords) {
    if (haystack.includes(k)) {
      hits++;
      if (hits >= minMatches) return true;
    }
  }
  return false;
}

export function isMotionMutation(mutation) {
  if (mutation.motion_props && mutation.motion_props.length) return true;
  if (mutation.is_motion) return true;
  return false;
}

export function computeTimeWindow(visionEntry, scrollTimeline, windowMs = TIME_WINDOW_MS) {
  const trigger = (visionEntry?.trigger || '').toLowerCase();
  const frames = Array.isArray(visionEntry?.frames_involved) ? visionEntry.frames_involved : [];
  const timeline = Array.isArray(scrollTimeline) ? scrollTimeline : [];
  const scrollStart = timeline[0]?.t ?? 3000;
  const scrollEnd = timeline.length ? timeline[timeline.length - 1].t : 15000;
  const recordingEnd = scrollEnd + 5000; // hover pass runs after scripted scroll

  // If we have scroll_timeline AND explicit frame references, prefer them.
  if (frames.length > 0 && timeline.length > 0) {
    const times = frames
      .map((f) => timeline[f]?.t)
      .filter((t) => Number.isFinite(t));
    if (times.length > 0) {
      return {
        lo: Math.min(...times) - windowMs,
        hi: Math.max(...times) + windowMs,
        source: 'frames_involved',
      };
    }
  }

  switch (trigger) {
    case 'on-load':
    case 'on-mount':
      return { lo: 0, hi: scrollStart, source: 'trigger:on-load' };
    case 'continuous':
      return { lo: 0, hi: recordingEnd, source: 'trigger:continuous' };
    case 'hover':
    case 'focus':
    case 'click':
      return { lo: scrollEnd, hi: scrollEnd + 10_000, source: 'trigger:interaction' };
    default:
      return { lo: 0, hi: recordingEnd, source: 'trigger:unknown' };
  }
}

function inWindow(t, { lo, hi }) {
  return t >= lo && t <= hi;
}

function scoreCandidate(mutation, window) {
  const center = (window.lo + window.hi) / 2;
  const distance = Math.abs(mutation.t - center);
  const motionCount = (mutation.motion_props?.length || (mutation.is_motion ? 1 : 0));
  return motionCount * 100_000 - distance; // motion count dominates; distance tiebreaks
}

export function crossValidate(visionAnimations, mutationLog, options = {}) {
  const timeWindowMs = Number.isFinite(options.timeWindowMs) ? options.timeWindowMs : TIME_WINDOW_MS;
  const mutations = Array.isArray(mutationLog?.mutations) ? mutationLog.mutations : [];
  const scrollTimeline = Array.isArray(mutationLog?.scroll_timeline) ? mutationLog.scroll_timeline : [];
  const motionMutations = mutations.filter(isMotionMutation);

  const verdicts = [];
  const verified = [];
  const rejected = [];

  for (let i = 0; i < (visionAnimations || []).length; i++) {
    const v = visionAnimations[i];
    const window = computeTimeWindow(v, scrollTimeline, timeWindowMs);
    const keywords = extractKeywords(v.element);

    const inWin = motionMutations.filter((m) => inWindow(m.t, window));
    const matches = inWin.filter((m) => matchElement(m, keywords));

    if (matches.length > 0) {
      const best = matches.reduce((a, b) => (scoreCandidate(b, window) > scoreCandidate(a, window) ? b : a));
      const center = (window.lo + window.hi) / 2;
      const verdict = {
        index: i,
        element: v.element,
        motion_type: v.motion_type,
        trigger: v.trigger,
        verdict: 'verified',
        reason: null,
        window,
        keyword_count: keywords.length,
        evidence: {
          mutation_t: best.t,
          mutation_path: best.path,
          mutation_tag: best.tag,
          motion_props: best.motion_props || (best.property ? [best.property] : []),
          distance_ms: Math.round(Math.abs(best.t - center)),
        },
      };
      verdicts.push(verdict);
      verified.push({ ...v, verified: true, evidence: verdict.evidence });
      continue;
    }

    // Disambiguate rejection reason to help Sean tune params later.
    let reason;
    if (motionMutations.length === 0) {
      reason = 'no_motion_mutations_recorded';
    } else if (keywords.length === 0) {
      reason = 'no_keywords_in_vision_element';
    } else if (inWin.length === 0) {
      reason = 'no_motion_in_time_window';
    } else {
      reason = 'element_mismatch_in_window';
    }

    const verdict = {
      index: i,
      element: v.element,
      motion_type: v.motion_type,
      trigger: v.trigger,
      verdict: 'rejected',
      reason,
      window,
      keyword_count: keywords.length,
      evidence: null,
    };
    verdicts.push(verdict);
    rejected.push({ ...v, verified: false, rejection_reason: reason });
  }

  const by_reason = {};
  for (const v of verdicts) {
    if (v.verdict === 'rejected') by_reason[v.reason] = (by_reason[v.reason] || 0) + 1;
  }

  return {
    verdicts,
    verified,
    rejected,
    stats: {
      total_candidates: verdicts.length,
      verified: verified.length,
      rejected: rejected.length,
      verification_rate: verdicts.length ? verified.length / verdicts.length : 0,
      motion_mutations_available: motionMutations.length,
      by_reason,
      time_window_ms: timeWindowMs,
    },
  };
}

// --- I/O wrapper ----------------------------------------------------------

async function main() {
  if (!existsSync(VISION_PATH)) {
    throw new Error(`Vision output not found: ${VISION_PATH}\n(run extract-vision.mjs first, or use --skip-cross-validate)`);
  }
  if (!existsSync(MUTATION_LOG_PATH)) {
    throw new Error(`Mutation log not found: ${MUTATION_LOG_PATH}\n(run extract-rrweb.mjs first, or use --skip-cross-validate)`);
  }

  const visionFile = JSON.parse(await readFile(VISION_PATH, 'utf8'));
  const mutationLog = JSON.parse(await readFile(MUTATION_LOG_PATH, 'utf8'));

  const result = crossValidate(visionFile.animations || [], mutationLog, {
    timeWindowMs: TIME_WINDOW_MS,
  });

  // Write verified-only vision file, preserving the rest of the outer shape
  // so merge.mjs can drop it in for animations-vision.json.
  const verifiedFile = {
    ...visionFile,
    total_animations: result.verified.length,
    animations: result.verified,
    cross_validated: true,
    cross_validation_stats: result.stats,
  };
  await writeFile(VERIFIED_PATH, JSON.stringify(verifiedFile, null, 2));

  // Write full audit report (every candidate + verdict).
  const report = {
    target: visionFile.target || mutationLog.target,
    validated_at: new Date().toISOString(),
    vision_path: path.basename(VISION_PATH),
    mutation_log_path: path.basename(MUTATION_LOG_PATH),
    time_window_ms: TIME_WINDOW_MS,
    stats: result.stats,
    verdicts: result.verdicts,
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  const pct = (result.stats.verification_rate * 100).toFixed(1);
  console.log(`[cross-validate] ${result.stats.verified}/${result.stats.total_candidates} verified (${pct}%), ${result.stats.rejected} rejected`);
  console.log(`[cross-validate] motion mutations available: ${result.stats.motion_mutations_available}`);
  if (result.stats.rejected > 0) {
    console.log('[cross-validate] rejection reasons:', result.stats.by_reason);
  }
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((e) => {
    console.error('[cross-validate] FATAL:', e.message);
    process.exit(1);
  });
}
