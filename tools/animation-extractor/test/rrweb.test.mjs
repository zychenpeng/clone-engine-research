import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNodeIdMap,
  extractMutations,
  normalizeStyleValue,
  parseStyleString,
} from '../extract-rrweb.mjs';

function makeSnapshot() {
  // Minimal shape matching rrweb's FullSnapshot (type=2).
  return {
    type: 2,
    timestamp: 1000,
    data: {
      node: {
        type: 0, // Document
        id: 1,
        childNodes: [
          {
            type: 2, // <html>
            id: 2,
            tagName: 'html',
            attributes: {},
            childNodes: [
              {
                type: 2, // <body class="page">
                id: 3,
                tagName: 'body',
                attributes: { class: 'page' },
                childNodes: [
                  {
                    type: 2, // <div id="top" class="hero glow">
                    id: 4,
                    tagName: 'div',
                    attributes: { class: 'hero glow extra third', id: 'top' },
                    childNodes: [
                      {
                        type: 2, // <h1 class="headline">
                        id: 5,
                        tagName: 'h1',
                        attributes: { class: 'headline' },
                        childNodes: [
                          { type: 3, id: 6, textContent: 'Hello' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

test('parseStyleString: basic + edge cases', () => {
  assert.deepEqual(parseStyleString('opacity: 1; transform: translateY(0)'), {
    opacity: '1',
    transform: 'translateY(0)',
  });
  assert.deepEqual(parseStyleString('color: rgb(0, 0, 0)'), { color: 'rgb(0, 0, 0)' });
  assert.deepEqual(parseStyleString(''), {});
  assert.deepEqual(parseStyleString(';;;'), {});
  assert.deepEqual(parseStyleString(null), {});
  assert.deepEqual(parseStyleString('opacity: 0.5;'), { opacity: '0.5' });
});

test('normalizeStyleValue: accepts string form', () => {
  const r = normalizeStyleValue('opacity: 0.5; transform: translateY(8px)');
  assert.deepEqual(r.props, { opacity: '0.5', transform: 'translateY(8px)' });
  assert.equal(r.serialized, 'opacity: 0.5; transform: translateY(8px)');
});

test('normalizeStyleValue: accepts rrweb v2 object form', () => {
  const r = normalizeStyleValue({ opacity: '0.5', transform: 'translateY(8px)' });
  assert.deepEqual(r.props, { opacity: '0.5', transform: 'translateY(8px)' });
  assert.equal(r.serialized, 'opacity: 0.5; transform: translateY(8px)');
});

test('normalizeStyleValue: strips null-valued properties (rrweb removal marker)', () => {
  const r = normalizeStyleValue({ opacity: '1', transform: null, color: 'red' });
  assert.deepEqual(r.props, { opacity: '1', color: 'red' });
});

test('normalizeStyleValue: handles null / undefined', () => {
  assert.deepEqual(normalizeStyleValue(null), { props: {}, serialized: '' });
  assert.deepEqual(normalizeStyleValue(undefined), { props: {}, serialized: '' });
});

test('buildNodeIdMap: builds full selector paths', () => {
  const map = buildNodeIdMap(makeSnapshot());
  assert.equal(map.get(2).path, 'html');
  assert.equal(map.get(3).path, 'html > body.page');
  assert.equal(map.get(4).path, 'html > body.page > div#top.hero.glow');
  assert.equal(map.get(5).path, 'html > body.page > div#top.hero.glow > h1.headline');
});

test('buildNodeIdMap: tag and classes preserved', () => {
  const map = buildNodeIdMap(makeSnapshot());
  assert.equal(map.get(4).tagName, 'div');
  assert.deepEqual(map.get(4).classes, ['hero', 'glow', 'extra', 'third']);
  assert.equal(map.get(4).domId, 'top');
  assert.deepEqual(map.get(5).classes, ['headline']);
});

test('buildNodeIdMap: skips non-element nodes but traverses into them', () => {
  const map = buildNodeIdMap(makeSnapshot());
  // text node should not appear in map
  assert.equal(map.has(6), false);
  // but its parent does
  assert.equal(map.has(5), true);
});

test('buildNodeIdMap: handles empty / malformed input', () => {
  assert.equal(buildNodeIdMap(null).size, 0);
  assert.equal(buildNodeIdMap({}).size, 0);
  assert.equal(buildNodeIdMap({ data: null }).size, 0);
});

test('extractMutations: classifies style attribute mutations with motion_props (string form)', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1500,
      data: {
        source: 0,
        attributes: [
          { id: 4, attributes: { style: 'opacity: 1; transform: translateY(0); color: red' } },
        ],
      },
    },
  ];
  const { mutations, stats } = extractMutations(events);
  assert.equal(mutations.length, 1);
  const m = mutations[0];
  assert.equal(m.t, 500);
  assert.equal(m.tag, 'div');
  assert.equal(m.path, 'html > body.page > div#top.hero.glow');
  assert.equal(m.attribute, 'style');
  assert.deepEqual(m.motion_props, ['opacity', 'transform']);
  assert.equal(stats.attribute_mutations, 1);
  assert.equal(stats.motion_property_mutations, 1);
});

test('extractMutations: classifies style mutations delivered as rrweb v2 object', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1500,
      data: {
        source: 0,
        attributes: [
          { id: 4, attributes: { style: { opacity: '1', transform: 'translateY(0)', color: 'red' } } },
        ],
      },
    },
  ];
  const { mutations, stats } = extractMutations(events);
  assert.equal(mutations.length, 1);
  const m = mutations[0];
  assert.deepEqual(m.motion_props, ['opacity', 'transform']);
  assert.deepEqual(m.style_props, ['opacity', 'transform', 'color']);
  assert.equal(m.value, 'opacity: 1; transform: translateY(0); color: red');
  assert.equal(stats.motion_property_mutations, 1);
});

test('extractMutations: custom-property-only style mutation is NOT counted as motion', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1500,
      data: {
        source: 0,
        attributes: [
          { id: 4, attributes: { style: { '--mask-x': '0.5%', '--mask-y': '24%' } } },
        ],
      },
    },
  ];
  const { mutations, stats } = extractMutations(events);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].motion_props, undefined);
  assert.equal(stats.motion_property_mutations, 0);
});

test('extractMutations: style without motion props leaves motion_props unset', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1100,
      data: {
        source: 0,
        attributes: [{ id: 5, attributes: { style: 'color: blue' } }],
      },
    },
  ];
  const { mutations, stats } = extractMutations(events);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].motion_props, undefined);
  assert.equal(stats.motion_property_mutations, 0);
});

test('extractMutations: class mutations recorded with classes array', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1200,
      data: {
        source: 0,
        attributes: [{ id: 5, attributes: { class: 'headline animate-fade-up visible' } }],
      },
    },
  ];
  const { mutations, stats } = extractMutations(events);
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].classes, ['headline', 'animate-fade-up', 'visible']);
  assert.equal(stats.classes_added_total, 3);
});

test('extractMutations: StyleDeclaration (source=13) flagged is_motion when on motion prop', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1300,
      data: {
        source: 13,
        id: 4,
        set: { property: 'opacity', value: '0.5', priority: '' },
      },
    },
    {
      type: 3,
      timestamp: 1400,
      data: {
        source: 13,
        id: 4,
        set: { property: 'color', value: 'red', priority: '' },
      },
    },
  ];
  const { mutations, stats } = extractMutations(events);
  assert.equal(mutations.length, 2);
  const opacityMutation = mutations.find((m) => m.property === 'opacity');
  assert.equal(opacityMutation.is_motion, true);
  assert.equal(opacityMutation.attribute, 'style-prop');
  const colorMutation = mutations.find((m) => m.property === 'color');
  assert.equal(colorMutation.is_motion, undefined);
  assert.equal(stats.style_declarations, 2);
  assert.equal(stats.motion_property_mutations, 1);
});

test('extractMutations: grows nodeMap when new elements are added mid-recording', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1500,
      data: {
        source: 0,
        adds: [
          {
            parentId: 4,
            nextId: null,
            node: {
              type: 2,
              id: 99,
              tagName: 'span',
              attributes: { class: 'ping' },
              childNodes: [],
            },
          },
        ],
      },
    },
    {
      type: 3,
      timestamp: 1600,
      data: {
        source: 0,
        attributes: [{ id: 99, attributes: { style: 'opacity: 0.3' } }],
      },
    },
  ];
  const { mutations } = extractMutations(events);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].tag, 'span');
  assert.equal(mutations[0].path, 'html > body.page > div#top.hero.glow > span.ping');
});

test('extractMutations: mutations sorted by timestamp ascending', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 2000,
      data: { source: 0, attributes: [{ id: 4, attributes: { style: 'opacity: 1' } }] },
    },
    {
      type: 3,
      timestamp: 1500,
      data: { source: 0, attributes: [{ id: 5, attributes: { class: 'a' } }] },
    },
  ];
  const { mutations } = extractMutations(events);
  assert.equal(mutations[0].t, 500);
  assert.equal(mutations[1].t, 1000);
});

test('extractMutations: unresolved node_id falls back to rrweb-id- path', () => {
  // Attribute mutation referencing an unknown ID (no FullSnapshot info, no add).
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1100,
      data: { source: 0, attributes: [{ id: 9999, attributes: { style: 'opacity: 0' } }] },
    },
  ];
  const { mutations } = extractMutations(events);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, '#rrweb-id-9999');
  assert.equal(mutations[0].tag, 'unknown');
});

test('extractMutations: unique_elements_mutated counts distinct node IDs', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1100,
      data: { source: 0, attributes: [{ id: 4, attributes: { style: 'opacity: 1' } }] },
    },
    {
      type: 3,
      timestamp: 1200,
      data: { source: 0, attributes: [{ id: 4, attributes: { style: 'opacity: 0.5' } }] },
    },
    {
      type: 3,
      timestamp: 1300,
      data: { source: 0, attributes: [{ id: 5, attributes: { class: 'a' } }] },
    },
  ];
  const { stats } = extractMutations(events);
  assert.equal(stats.unique_elements_mutated, 2);
});

test('extractMutations: respects explicit startTime offset', () => {
  const events = [
    makeSnapshot(),
    {
      type: 3,
      timestamp: 1500,
      data: { source: 0, attributes: [{ id: 4, attributes: { style: 'opacity: 1' } }] },
    },
  ];
  const { mutations } = extractMutations(events, { startTime: 1200 });
  assert.equal(mutations[0].t, 300);
});

test('extractMutations: empty events returns zero-safe result', () => {
  const { mutations, stats } = extractMutations([]);
  assert.equal(mutations.length, 0);
  assert.equal(stats.rrweb_events, 0);
  assert.equal(stats.full_snapshot, false);
});
