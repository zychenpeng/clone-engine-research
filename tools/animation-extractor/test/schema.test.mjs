import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEC_VERSION,
  SpecValidationError,
  animationId,
  normalizeEasing,
  normalizeMotionType,
  normalizeTrigger,
  validateSpec,
} from '../schema.ts';

test('normalizeMotionType: fade variants', () => {
  assert.equal(normalizeMotionType('fade', 'up'), 'fade-up');
  assert.equal(normalizeMotionType('fade', null), 'fade-in');
  assert.equal(normalizeMotionType('fade', 'out'), 'fade-out');
  assert.equal(normalizeMotionType('fade', null, 'scroll-out'), 'fade-out');
});

test('normalizeMotionType: slide defaults up when direction unknown', () => {
  assert.equal(normalizeMotionType('slide', 'left'), 'slide-left');
  assert.equal(normalizeMotionType('slide', 'right'), 'slide-right');
  assert.equal(normalizeMotionType('slide', null), 'slide-up');
});

test('normalizeMotionType: scale defaults to scale-in', () => {
  assert.equal(normalizeMotionType('scale', null), 'scale-in');
  assert.equal(normalizeMotionType('scale', 'out'), 'scale-out');
});

test('normalizeMotionType: canonical passes through', () => {
  assert.equal(normalizeMotionType('fade-up'), 'fade-up');
  assert.equal(normalizeMotionType('hover-lift'), 'hover-lift');
  assert.equal(normalizeMotionType('shader-ambient'), 'shader-ambient');
});

test('normalizeMotionType: legacy + unknown', () => {
  assert.equal(normalizeMotionType('morph'), 'reveal-on-scroll');
  assert.equal(normalizeMotionType('shader-webgl'), 'shader-ambient');
  assert.equal(normalizeMotionType('blur'), 'other');
  assert.equal(normalizeMotionType('unrecognized'), 'other');
  assert.equal(normalizeMotionType(null), 'other');
  assert.equal(normalizeMotionType(''), 'other');
});

test('normalizeTrigger: valid vs unknown', () => {
  assert.equal(normalizeTrigger('scroll-in'), 'scroll-in');
  assert.equal(normalizeTrigger('HOVER'), 'hover');
  assert.equal(normalizeTrigger('bogus'), 'unknown');
  assert.equal(normalizeTrigger(null), 'unknown');
});

test('normalizeEasing: cubic-bezier detection + passthrough', () => {
  assert.equal(normalizeEasing('cubic-bezier(0.4, 0, 0.2, 1)'), 'cubic-bezier');
  assert.equal(normalizeEasing('ease-out'), 'ease-out');
  assert.equal(normalizeEasing('spring'), 'spring');
  assert.equal(normalizeEasing(''), 'unknown');
  assert.equal(normalizeEasing('none'), 'unknown');
  assert.equal(normalizeEasing('exotic'), 'unknown');
});

test('animationId: stable for same input', () => {
  const a = animationId({ element: 'hero', motion_type: 'fade-up', trigger: 'scroll-in', duration_ms: 600 });
  const b = animationId({ element: 'hero', motion_type: 'fade-up', trigger: 'scroll-in', duration_ms: 600 });
  assert.equal(a, b);
  assert.match(a, /^anim-[0-9a-f]{8}$/);
});

test('animationId: differs when any field differs', () => {
  const base = { element: 'hero', motion_type: 'fade-up', trigger: 'scroll-in', duration_ms: 600 };
  const a = animationId(base);
  assert.notEqual(a, animationId({ ...base, element: 'card' }));
  assert.notEqual(a, animationId({ ...base, motion_type: 'fade-in' }));
  assert.notEqual(a, animationId({ ...base, trigger: 'hover' }));
  assert.notEqual(a, animationId({ ...base, duration_ms: 700 }));
});

test('validateSpec: accepts well-formed spec', () => {
  const spec = {
    version: SPEC_VERSION,
    target_url: 'https://example.com',
    captured_at: '2026-04-22T00:00:00Z',
    total: 1,
    by_provenance: { dom: 0, vision: 1, both: 0 },
    by_trigger: { 'scroll-in': 1 },
    by_motion_type: { 'fade-up': 1 },
    layer_counts: { dom: 0, vision: 1 },
    animations: [
      {
        id: 'anim-00000000',
        provenance: ['vision'],
        confidence: 0.9,
        element: 'hero',
        motion_type: 'fade-up',
        trigger: 'scroll-in',
        duration_ms: 600,
        easing: 'ease-out',
      },
    ],
  };
  assert.doesNotThrow(() => validateSpec(spec));
});

test('validateSpec: rejects wrong version', () => {
  assert.throws(
    () => validateSpec({ version: '0.9', target_url: 'x', animations: [] }),
    SpecValidationError,
  );
});

test('validateSpec: rejects missing target_url', () => {
  assert.throws(
    () => validateSpec({ version: SPEC_VERSION, animations: [] }),
    SpecValidationError,
  );
});

test('validateSpec: rejects bad motion_type', () => {
  assert.throws(
    () => validateSpec({
      version: SPEC_VERSION,
      target_url: 'x',
      animations: [{ id: 'x', provenance: ['dom'], motion_type: 'bogus-type' }],
    }),
    SpecValidationError,
  );
});

test('validateSpec: rejects non-object', () => {
  assert.throws(() => validateSpec(null), SpecValidationError);
  assert.throws(() => validateSpec('string'), SpecValidationError);
});
