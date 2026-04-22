import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTimeWindow,
  crossValidate,
  extractKeywords,
  isMotionMutation,
  matchElement,
} from '../cross-validate.mjs';

// Synthetic scroll_timeline: scripted scroll starts at t=6000ms with 20 steps
// every ~500ms, ending at t=15000ms. Matches the shape extract-rrweb.mjs
// produces in live runs.
function makeScrollTimeline() {
  const arr = [];
  for (let i = 0; i < 20; i++) {
    arr.push({ t: 6000 + i * 500, scrollY: i * 500 });
  }
  return arr;
}

function motionMut(t, { path, tag = 'div', classes = [], props = ['opacity'] } = {}) {
  return {
    t,
    path,
    tag,
    classes,
    attribute: 'style',
    value: props.map((p) => `${p}: 1`).join('; '),
    style_props: props,
    motion_props: props.filter((p) =>
      ['opacity', 'transform', 'filter', 'clip-path', 'translate', 'scale', 'rotate'].includes(p)
    ),
  };
}

// -------------------- extractKeywords --------------------

test('extractKeywords: drops stop words and short tokens', () => {
  const kw = extractKeywords("Hero headline 'The product development system for teams'");
  assert.ok(kw.includes('hero'));
  assert.ok(kw.includes('headline'));
  assert.ok(kw.includes('product'));
  assert.ok(kw.includes('development'));
  assert.ok(kw.includes('system'));
  assert.ok(!kw.includes('the'));
  assert.ok(!kw.includes('for'));
});

test('extractKeywords: dedupes', () => {
  const kw = extractKeywords('Button button BUTTON');
  assert.deepEqual(kw, ['button']);
});

test('extractKeywords: empty / junk input safe', () => {
  assert.deepEqual(extractKeywords(''), []);
  assert.deepEqual(extractKeywords(null), []);
  assert.deepEqual(extractKeywords('a b c'), []); // all too short
});

// -------------------- matchElement --------------------

test('matchElement: matches when keyword appears in path', () => {
  const m = motionMut(100, { path: 'html > body > div.hero > h1', classes: ['title'] });
  assert.equal(matchElement(m, ['hero']), true);
  assert.equal(matchElement(m, ['footer']), false);
});

test('matchElement: matches via class list', () => {
  const m = motionMut(100, { path: 'html > body > div', classes: ['cta-button', 'primary'] });
  assert.equal(matchElement(m, ['button']), true);
});

test('matchElement: no keywords → no match', () => {
  const m = motionMut(100, { path: 'html > body > div.hero' });
  assert.equal(matchElement(m, []), false);
});

test('matchElement: with 2+ keywords, a single structural hit is not enough', () => {
  // Simulates the Linear false-positive: Vision says "Section 'Define the
  // product direction'" (6 kw) but only "section" appears in the path.
  const m = motionMut(100, {
    path: 'html > body > div > section.PageSection_root > div > div.SlackIssue_sendButton',
    classes: ['SlackIssue_sendButton'],
  });
  const keywords = ['section', 'define', 'product', 'direction', 'roadmap'];
  assert.equal(matchElement(m, keywords), false); // "section" alone ≠ 2 hits
});

test('matchElement: with 2+ keywords, two-hit overlap counts as match', () => {
  const m = motionMut(100, {
    path: 'html > body > div.hero > h1.headline',
    classes: ['headline'],
  });
  const keywords = ['hero', 'headline', 'fancy', 'product'];
  assert.equal(matchElement(m, keywords), true); // hero + headline
});

test('matchElement: single-keyword input falls back to any-match (not enough to enforce 2)', () => {
  const m = motionMut(100, { path: 'html > body > div.hero' });
  assert.equal(matchElement(m, ['hero']), true); // only one kw, fall back
  assert.equal(matchElement(m, ['footer']), false);
});

// -------------------- isMotionMutation --------------------

test('isMotionMutation: motion_props non-empty', () => {
  assert.equal(isMotionMutation({ motion_props: ['opacity'] }), true);
});
test('isMotionMutation: is_motion flag (source 13)', () => {
  assert.equal(isMotionMutation({ is_motion: true, property: 'opacity' }), true);
});
test('isMotionMutation: motion_props empty', () => {
  assert.equal(isMotionMutation({ motion_props: [] }), false);
  assert.equal(isMotionMutation({}), false);
});

// -------------------- computeTimeWindow --------------------

test('computeTimeWindow: frames_involved → timeline lookup ± window', () => {
  const timeline = makeScrollTimeline();
  const w = computeTimeWindow(
    { trigger: 'scroll-in', frames_involved: [3, 4] },
    timeline,
    500
  );
  // frame 3 → t=7500, frame 4 → t=8000. Window = [7000, 8500].
  assert.equal(w.lo, 7000);
  assert.equal(w.hi, 8500);
  assert.equal(w.source, 'frames_involved');
});

test('computeTimeWindow: on-load uses pre-scroll range', () => {
  const timeline = makeScrollTimeline();
  const w = computeTimeWindow({ trigger: 'on-load' }, timeline);
  assert.equal(w.lo, 0);
  assert.equal(w.hi, 6000); // scroll_timeline[0].t
  assert.equal(w.source, 'trigger:on-load');
});

test('computeTimeWindow: continuous covers entire recording', () => {
  const timeline = makeScrollTimeline();
  const w = computeTimeWindow({ trigger: 'continuous' }, timeline);
  assert.equal(w.lo, 0);
  assert.equal(w.hi, 20500); // scrollEnd=15500 + 5000 hover buffer
});

test('computeTimeWindow: hover/focus after scripted scroll', () => {
  const timeline = makeScrollTimeline();
  const w = computeTimeWindow({ trigger: 'hover' }, timeline);
  assert.equal(w.lo, 15500);
  assert.equal(w.hi, 25500);
});

test('computeTimeWindow: missing timeline → safe defaults', () => {
  const w = computeTimeWindow({ trigger: 'scroll-in', frames_involved: [2] }, []);
  assert.ok(Number.isFinite(w.lo));
  assert.ok(Number.isFinite(w.hi));
});

// -------------------- crossValidate: happy path --------------------

test('crossValidate: Vision candidate with matching rrweb motion in window → verified', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    {
      element: 'hero headline fade-in',
      motion_type: 'fade-up',
      trigger: 'scroll-in',
      frames_involved: [0, 1],
      confidence: 0.9,
    },
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    mutations: [
      motionMut(6200, { path: 'html > body > div.hero > h1.headline', props: ['opacity', 'transform'] }),
    ],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.verified, 1);
  assert.equal(result.stats.rejected, 0);
  assert.equal(result.verified[0].verified, true);
  assert.equal(result.verified[0].evidence.mutation_t, 6200);
  assert.deepEqual(result.verified[0].evidence.motion_props, ['opacity', 'transform']);
});

// -------------------- crossValidate: rejection reasons --------------------

test('crossValidate: no motion mutations at all → reject with no_motion_mutations_recorded', () => {
  const vision = [{ element: 'hero headline', trigger: 'scroll-in', frames_involved: [0] }];
  const mutationLog = { scroll_timeline: makeScrollTimeline(), mutations: [] };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.rejected, 1);
  assert.equal(result.verdicts[0].reason, 'no_motion_mutations_recorded');
});

test('crossValidate: motion exists but outside window → no_motion_in_time_window (Linear-style phantom)', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    {
      element: 'hero headline',
      motion_type: 'fade-up',
      trigger: 'scroll-in',
      frames_involved: [3, 4], // window ~[7000, 8500]
      confidence: 0.9,
    },
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    // Motion happened pre-scroll (on-load), not in Vision's claimed window
    mutations: [
      motionMut(1500, { path: 'html > body > div.hero > h1.headline', props: ['opacity'] }),
    ],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.rejected, 1);
  assert.equal(result.verdicts[0].reason, 'no_motion_in_time_window');
});

test('crossValidate: motion in window but wrong element → element_mismatch_in_window', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    {
      element: 'testimonial cards reveal',
      motion_type: 'fade-in',
      trigger: 'scroll-in',
      frames_involved: [5, 6],
      confidence: 0.8,
    },
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    // Motion on a different section in-window
    mutations: [
      motionMut(8500, { path: 'html > body > div.pricing > span', classes: ['pricing-badge'], props: ['opacity'] }),
    ],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.rejected, 1);
  assert.equal(result.verdicts[0].reason, 'element_mismatch_in_window');
});

test('crossValidate: Vision element with no usable keywords → no_keywords_in_vision_element', () => {
  const vision = [{ element: 'a b c', trigger: 'on-load' }]; // no words >3 chars
  const mutationLog = {
    scroll_timeline: makeScrollTimeline(),
    mutations: [motionMut(500, { path: 'html > body > div.hero', props: ['opacity'] })],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.rejected, 1);
  assert.equal(result.verdicts[0].reason, 'no_keywords_in_vision_element');
});

// -------------------- crossValidate: tiebreak + evidence --------------------

test('crossValidate: picks candidate with more motion_props over proximity', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    { element: 'hero headline glow banner', trigger: 'scroll-in', frames_involved: [0, 1] },
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    mutations: [
      motionMut(6100, { path: 'html > body > div.hero.headline', props: ['opacity'] }),
      motionMut(6400, { path: 'html > body > div.hero.glow.headline', props: ['opacity', 'transform', 'filter'] }),
    ],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.verified[0].evidence.mutation_t, 6400);
  assert.equal(result.verified[0].evidence.motion_props.length, 3);
});

test('crossValidate: empty vision array produces empty result', () => {
  const result = crossValidate([], { scroll_timeline: [], mutations: [] });
  assert.equal(result.stats.total_candidates, 0);
  assert.equal(result.stats.verified, 0);
});

test('crossValidate: by_reason histogram sums to rejection count', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    { element: 'hero thing', trigger: 'scroll-in', frames_involved: [3] },    // no motion in window
    { element: 'footer thing', trigger: 'scroll-in', frames_involved: [15] }, // no motion in window
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    mutations: [motionMut(1000, { path: 'html > body > div.hero', props: ['opacity'] })],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.rejected, 2);
  const sum = Object.values(result.stats.by_reason).reduce((a, b) => a + b, 0);
  assert.equal(sum, result.stats.rejected);
});

test('crossValidate: verification_rate is fraction', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    { element: 'hero headline banner', trigger: 'scroll-in', frames_involved: [0] },
    { element: 'footer copyright', trigger: 'scroll-in', frames_involved: [15] },
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    mutations: [
      motionMut(6100, { path: 'html > body > div.hero.headline', props: ['opacity'] }),
    ],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.verified, 1);
  assert.equal(result.stats.rejected, 1);
  assert.equal(result.stats.verification_rate, 0.5);
});

test('crossValidate: continuous trigger matches mutations across entire window', () => {
  const timeline = makeScrollTimeline();
  const vision = [
    { element: 'mesh gradient background', motion_type: 'shader-ambient', trigger: 'continuous' },
  ];
  const mutationLog = {
    scroll_timeline: timeline,
    mutations: [
      motionMut(10000, { path: 'html > body > canvas.mesh.gradient', classes: ['mesh', 'gradient'], props: ['transform'] }),
    ],
  };
  const result = crossValidate(vision, mutationLog);
  assert.equal(result.stats.verified, 1);
});
