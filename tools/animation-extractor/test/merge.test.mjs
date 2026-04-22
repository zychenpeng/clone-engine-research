import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpec } from '../merge.mjs';

function makeDom(animations = []) {
  return {
    target: 'https://example.com',
    captured_at: '2026-04-22T00:00:00Z',
    total_raw: animations.length,
    total_deduped: animations.length,
    frame_count: 20,
    warnings: [],
    animations,
  };
}

function makeVision(animations = [], extra = {}) {
  return {
    target: 'https://example.com',
    captured_at: '2026-04-22T00:00:00Z',
    model: 'claude-sonnet-4-5',
    frame_count: 20,
    cost_usd: 0.1,
    total_animations: animations.length,
    animations,
    ...extra,
  };
}

test('mergeSpec: pure DOM produces dom-only entries with inferred types', () => {
  const dom = makeDom([
    {
      targetSelector: 'div.pulse-dot',
      duration: 1750,
      easing: 'linear',
      iterations: null, // infinite
      keyframes: [],
      keyframeCount: 0,
    },
    {
      targetSelector: 'button.cta',
      duration: 300,
      easing: 'ease-out',
      iterations: 1,
      keyframes: [],
      keyframeCount: 0,
    },
  ]);
  const vision = makeVision([]);
  const spec = mergeSpec(dom, vision);

  assert.equal(spec.total, 2);
  assert.equal(spec.by_provenance.dom, 2);
  assert.equal(spec.by_provenance.vision, 0);
  assert.equal(spec.by_provenance.both, 0);

  const loop = spec.animations.find((a) => a.motion_type === 'loop');
  assert.ok(loop, 'expected a loop entry for iterations=null');
  assert.equal(loop.trigger, 'continuous');

  const oneShot = spec.animations.find((a) => a.motion_type === 'one-shot');
  assert.ok(oneShot, 'expected a one-shot entry for finite iterations');
  assert.equal(oneShot.trigger, 'unknown');
});

test('mergeSpec: pure Vision produces vision-only entries normalized to canonical MotionType', () => {
  const vision = makeVision([
    {
      element: 'hero headline',
      motion_type: 'fade',
      direction: 'up',
      trigger: 'scroll-in',
      approximate_duration_ms: 600,
      approximate_easing: 'ease-out',
      frames_involved: [0, 1, 2],
      confidence: 0.9,
    },
    {
      element: 'feature panel',
      motion_type: 'slide',
      direction: 'left',
      trigger: 'scroll-in',
      approximate_duration_ms: 800,
      approximate_easing: 'spring',
      frames_involved: [5, 6, 7],
      confidence: 0.8,
    },
  ]);
  const spec = mergeSpec(makeDom([]), vision);

  assert.equal(spec.total, 2);
  assert.equal(spec.by_provenance.vision, 2);

  const hero = spec.animations.find((a) => a.element === 'hero headline');
  assert.equal(hero.motion_type, 'fade-up');
  assert.equal(hero.trigger, 'scroll-in');
  assert.deepEqual(hero.provenance, ['vision']);

  const panel = spec.animations.find((a) => a.element === 'feature panel');
  assert.equal(panel.motion_type, 'slide-left');
  assert.equal(panel.easing, 'spring');
});

test('mergeSpec: fuzzy match merges DOM + Vision with both provenance and ≥0.9 confidence', () => {
  const dom = makeDom([
    {
      targetSelector: 'div.hero',
      duration: 650,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      iterations: 1,
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      keyframeCount: 2,
    },
  ]);
  const vision = makeVision([
    {
      element: 'hero headline',
      motion_type: 'fade',
      direction: 'up',
      trigger: 'scroll-in',
      approximate_duration_ms: 600, // within ±30% of 650
      approximate_easing: 'ease-out',
      frames_involved: [0, 1, 2],
      confidence: 0.7,
    },
  ]);
  const spec = mergeSpec(dom, vision);

  assert.equal(spec.total, 1);
  assert.equal(spec.by_provenance.both, 1);
  const entry = spec.animations[0];
  assert.deepEqual(entry.provenance, ['dom', 'vision']);
  assert.ok(entry.confidence >= 0.9, `expected confidence ≥0.9 after two-layer agreement, got ${entry.confidence}`);
  assert.equal(entry.motion_type, 'fade-up', 'Vision semantic should win on match');
  assert.equal(entry.trigger, 'scroll-in', 'Vision trigger should win on match');
  assert.equal(entry.duration_ms, 650, 'DOM duration should win on match when present');
  assert.equal(entry.easing, 'cubic-bezier', 'DOM easing should win when DOM has non-unknown value');
  assert.ok(Array.isArray(entry.keyframes), 'should carry DOM keyframes');
});

test('mergeSpec: Vision with scroll-out + fade normalizes to fade-out', () => {
  const vision = makeVision([
    {
      element: 'hero copy',
      motion_type: 'fade',
      direction: null,
      trigger: 'scroll-out',
      approximate_duration_ms: 400,
      approximate_easing: 'ease-in',
      confidence: 0.85,
    },
  ]);
  const spec = mergeSpec(makeDom([]), vision);
  assert.equal(spec.animations[0].motion_type, 'fade-out');
  assert.equal(spec.animations[0].trigger, 'scroll-out');
});

test('mergeSpec: low-confidence Vision entry flagged needs_review', () => {
  const vision = makeVision([
    {
      element: 'ambient blur',
      motion_type: 'shader-webgl',
      direction: null,
      trigger: 'continuous',
      approximate_duration_ms: 8000,
      approximate_easing: 'linear',
      confidence: 0.55,
    },
  ]);
  const spec = mergeSpec(makeDom([]), vision);
  assert.equal(spec.animations[0].needs_review, true);
  assert.equal(spec.animations[0].motion_type, 'shader-ambient');
});

test('mergeSpec: empty inputs produce empty spec with warning', () => {
  const spec = mergeSpec(makeDom([]), makeVision([]));
  assert.equal(spec.total, 0);
  assert.equal(spec.animations.length, 0);
  assert.ok(
    Array.isArray(spec.warnings) && spec.warnings.some((w) => /zero animations/i.test(w)),
    'expected zero-animations warning',
  );
});

test('mergeSpec: target_url + version propagated', () => {
  const dom = makeDom([]);
  dom.target = 'https://stripe.com';
  const spec = mergeSpec(dom, makeVision([]));
  assert.equal(spec.target_url, 'https://stripe.com');
  assert.equal(spec.version, '1.0');
});

test('mergeSpec: DOM duration used when Vision approx is missing', () => {
  // No Vision match, DOM-only entry
  const dom = makeDom([
    {
      targetSelector: 'div.x',
      duration: 1234,
      easing: 'ease-in',
      iterations: null,
      keyframes: [],
      keyframeCount: 0,
    },
  ]);
  const spec = mergeSpec(dom, makeVision([]));
  assert.equal(spec.animations[0].duration_ms, 1234);
  assert.equal(spec.animations[0].easing, 'ease-in');
});

test('mergeSpec: fuzzy match rejects when duration outside ±30%', () => {
  const dom = makeDom([
    {
      targetSelector: 'div.hero-x',
      duration: 2000,
      easing: 'linear',
      iterations: 1,
      keyframes: [],
      keyframeCount: 0,
    },
  ]);
  const vision = makeVision([
    {
      element: 'hero thing',
      motion_type: 'fade',
      direction: null,
      trigger: 'on-load',
      approximate_duration_ms: 600, // 70% off
      approximate_easing: 'ease-out',
      confidence: 0.8,
    },
  ]);
  const spec = mergeSpec(dom, vision);
  // Should NOT merge — DOM-only + Vision-only
  assert.equal(spec.total, 2);
  assert.equal(spec.by_provenance.both, 0);
  assert.equal(spec.by_provenance.dom, 1);
  assert.equal(spec.by_provenance.vision, 1);
});
