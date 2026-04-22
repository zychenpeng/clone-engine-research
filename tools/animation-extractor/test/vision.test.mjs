import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonArray,
  filterByConfidence,
  VisionParseError,
} from '../extract-vision.mjs';

test('extractJsonArray: clean JSON array', () => {
  const r = extractJsonArray('[{"a": 1}, {"b": 2}]');
  assert.deepEqual(r, [{ a: 1 }, { b: 2 }]);
});

test('extractJsonArray: tolerates leading + trailing prose', () => {
  const text = 'Sure, here is the JSON:\n[{"a": 1}]\nThat\'s everything!';
  const r = extractJsonArray(text);
  assert.deepEqual(r, [{ a: 1 }]);
});

test('extractJsonArray: tolerates markdown fences', () => {
  const text = '```json\n[{"a": 1}]\n```';
  const r = extractJsonArray(text);
  assert.deepEqual(r, [{ a: 1 }]);
});

test('extractJsonArray: throws when no brackets', () => {
  assert.throws(() => extractJsonArray('sorry, I cannot do that'), VisionParseError);
});

test('extractJsonArray: throws on malformed JSON even with brackets', () => {
  assert.throws(() => extractJsonArray('[{"a": 1, }]'), VisionParseError);
});

test('filterByConfidence: default thresholds drop <0.5, flag 0.5-0.7, keep ≥0.7', () => {
  const entries = [
    { element: 'a', confidence: 0.3 },
    { element: 'b', confidence: 0.5 },
    { element: 'c', confidence: 0.65 },
    { element: 'd', confidence: 0.9 },
  ];
  const { kept, dropped } = filterByConfidence(entries);
  assert.equal(kept.length, 3);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].element, 'a');
  const keptMap = Object.fromEntries(kept.map((k) => [k.element, k]));
  assert.equal(keptMap.b.needs_review, true);
  assert.equal(keptMap.c.needs_review, true);
  assert.equal(keptMap.d.needs_review, undefined);
});

test('filterByConfidence: custom thresholds', () => {
  const entries = [
    { element: 'a', confidence: 0.6 },
    { element: 'b', confidence: 0.85 },
  ];
  const { kept, dropped } = filterByConfidence(entries, {
    minConfidence: 0.7,
    reviewConfidence: 0.9,
  });
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
  assert.equal(kept[0].element, 'b');
  assert.equal(kept[0].needs_review, true);
});

test('filterByConfidence: missing confidence treated as 0', () => {
  const entries = [{ element: 'no-conf' }];
  const { kept, dropped } = filterByConfidence(entries);
  assert.equal(kept.length, 0);
  assert.equal(dropped.length, 1);
});

test('filterByConfidence: does not mutate input entries', () => {
  const entries = [{ element: 'a', confidence: 0.6 }];
  const before = { ...entries[0] };
  filterByConfidence(entries);
  assert.deepEqual(entries[0], before);
});
