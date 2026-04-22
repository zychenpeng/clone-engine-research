// Layer 2' — rrweb DOM mutation recorder.
// Injects rrweb's record bundle, records all DOM/CSSOM mutations during a
// scripted scroll + hover session with timing parity to extract-dom.mjs,
// and writes a flat `mutation-log.json` keyed on element path.
//
// Added for Round E Pivot (E-Pivot.1). Companion to extract-dom.mjs (DOM
// Layer 1) and extract-vision.mjs (Layer 3, candidate-only). Consumed by the
// cross-validator (E-Pivot.2) which demands mutation evidence before
// promoting any Vision candidate to verified.
//
// What we capture:
//   - rrweb FullSnapshot (type=2) → element ID → selector/tag/class map
//   - IncrementalSnapshot Mutation (type=3, source=0) → attribute changes
//     especially `style` / `class` / `data-*`, plus add/remove events
//   - IncrementalSnapshot StyleDeclaration (type=3, source=13) → inline
//     `element.style.<prop> = value` setters (framer-motion uses these)
//   - Scroll timeline: per-step scrollY at known timestamps, so the
//     cross-validator can align Vision's scroll-in claims to scroll offset
//     rather than wall-clock.

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

chromium.use(StealthPlugin());

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TARGET = process.env.TARGET_URL || 'https://linear.app';
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, 'out');
const FRAME_COUNT = Number(process.env.FRAME_COUNT || 20);
const SCROLL_DURATION_MS = Number(process.env.SCROLL_DURATION_MS || 10_000);
const GOTO_TIMEOUT_MS = Number(process.env.GOTO_TIMEOUT_MS || 60_000);
const HEADLESS = process.env.HEADLESS === '1';
const MAX_HOVER_TARGETS = Number(process.env.MAX_HOVER_TARGETS || 10);
const RRWEB_BUNDLE_PATH = process.env.RRWEB_BUNDLE_PATH
  || path.join(HERE, 'node_modules', 'rrweb', 'dist', 'rrweb.min.js');

export class CloudflareBlockedError extends Error {
  constructor(url) {
    super(`Cloudflare / bot-wall blocked ${url}; manual fallback required`);
    this.name = 'CloudflareBlockedError';
  }
}

async function ensureDir(d) {
  if (!existsSync(d)) await mkdir(d, { recursive: true });
}

async function detectCloudflareBlock(page) {
  const title = (await page.title().catch(() => '')) || '';
  if (/just a moment|checking your browser|attention required/i.test(title)) {
    return { blocked: true, reason: `title: ${title}` };
  }
  const hit = await page.evaluate(() => {
    const sel = [
      '#challenge-running',
      '.cf-browser-verification',
      'iframe[src*="challenges.cloudflare.com"]',
      '[data-translate="checking_browser"]',
    ];
    for (const s of sel) if (document.querySelector(s)) return s;
    return null;
  }).catch(() => null);
  if (hit) return { blocked: true, reason: `selector: ${hit}` };
  return { blocked: false };
}

// --- Post-processing: pure functions, exported for unit tests. ------------

// Walk an rrweb FullSnapshot tree and build a Map<nodeId, {tagName, classes,
// domId, path}>. `path` is a chain of `tag[#id][.classA.classB]` segments.
export function buildNodeIdMap(fullSnapshot) {
  const map = new Map();
  function segment(tag, attrs) {
    let s = (tag || 'unknown').toLowerCase();
    if (attrs?.id) s += `#${attrs.id}`;
    if (typeof attrs?.class === 'string' && attrs.class.trim()) {
      const classes = attrs.class.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) s += `.${classes}`;
    }
    return s;
  }
  function visit(node, parentPath) {
    if (!node || typeof node.id !== 'number') return;
    let pathHere = parentPath;
    if (node.type === 2 /* Element */) {
      const tagName = (node.tagName || 'unknown').toLowerCase();
      const attrs = node.attributes || {};
      const seg = segment(tagName, attrs);
      const newPath = parentPath ? `${parentPath} > ${seg}` : seg;
      const classes = typeof attrs.class === 'string'
        ? attrs.class.trim().split(/\s+/).filter(Boolean)
        : [];
      map.set(node.id, {
        tagName,
        classes,
        domId: attrs.id || null,
        path: newPath,
      });
      pathHere = newPath;
    }
    for (const child of node.childNodes || []) visit(child, pathHere);
  }
  visit(fullSnapshot?.data?.node, '');
  return map;
}

export function parseStyleString(s) {
  const out = {};
  if (!s || typeof s !== 'string') return out;
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

const MOTION_PROPS = new Set([
  'opacity', 'transform', 'filter', 'clip-path',
  'translate', 'scale', 'rotate',
  '-webkit-transform', '-webkit-filter', '-webkit-clip-path',
]);

// rrweb v2 can serialize the `style` attribute as either a string OR an
// object keyed by CSS property (e.g. `{opacity: "1", transform: "..."}`);
// null-valued keys mean "this property was removed".
export function normalizeStyleValue(val) {
  if (val == null) return { props: {}, serialized: '' };
  if (typeof val === 'object') {
    const props = {};
    const parts = [];
    for (const [k, v] of Object.entries(val)) {
      if (v === null || v === undefined) continue;
      const sv = String(v);
      props[k] = sv;
      parts.push(`${k}: ${sv}`);
    }
    return { props, serialized: parts.join('; ') };
  }
  return { props: parseStyleString(String(val)), serialized: String(val) };
}

function classifyClass(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

// Convert raw rrweb events → flat, easily queryable mutation log.
// Returns { mutations, stats }. `mutations` is sorted by t ascending.
export function extractMutations(events, { startTime } = {}) {
  const fullSnapshot = events.find((e) => e.type === 2);
  const nodeMap = fullSnapshot ? buildNodeIdMap(fullSnapshot) : new Map();
  const t0 = Number.isFinite(startTime)
    ? startTime
    : (fullSnapshot?.timestamp ?? events[0]?.timestamp ?? 0);

  // Walk added nodes (source 0 adds) and grow nodeMap on the fly so that
  // later mutations on freshly-added nodes still resolve to a selector.
  function ingestAdd(parentId, node) {
    if (!node || typeof node.id !== 'number') return;
    if (node.type === 2) {
      const parent = nodeMap.get(parentId);
      const attrs = node.attributes || {};
      let seg = (node.tagName || 'unknown').toLowerCase();
      if (attrs.id) seg += `#${attrs.id}`;
      if (typeof attrs.class === 'string' && attrs.class.trim()) {
        seg += `.${attrs.class.trim().split(/\s+/).slice(0, 2).join('.')}`;
      }
      nodeMap.set(node.id, {
        tagName: (node.tagName || 'unknown').toLowerCase(),
        classes: typeof attrs.class === 'string' ? attrs.class.trim().split(/\s+/).filter(Boolean) : [],
        domId: attrs.id || null,
        path: parent ? `${parent.path} > ${seg}` : seg,
      });
    }
    for (const child of node.childNodes || []) ingestAdd(node.id, child);
  }

  const mutations = [];
  const stats = {
    rrweb_events: events.length,
    full_snapshot: Boolean(fullSnapshot),
    attribute_mutations: 0,
    style_declarations: 0,
    motion_property_mutations: 0,
    classes_added_total: 0,
    unique_elements_mutated: 0,
  };
  const mutatedIds = new Set();

  for (const ev of events) {
    if (ev.type !== 3) continue; // IncrementalSnapshot only
    const t = Math.round(ev.timestamp - t0);
    const d = ev.data || {};

    if (Array.isArray(d.adds)) {
      for (const add of d.adds) ingestAdd(add.parentId, add.node);
    }

    // Source 0: attribute mutation (style as string or object, class, etc.)
    if (d.source === 0 && Array.isArray(d.attributes)) {
      for (const am of d.attributes) {
        const node = nodeMap.get(am.id);
        mutatedIds.add(am.id);
        for (const [attr, val] of Object.entries(am.attributes || {})) {
          if (val === null) continue; // attribute removal
          stats.attribute_mutations++;
          const entry = {
            t,
            node_id: am.id,
            tag: node?.tagName || 'unknown',
            path: node?.path || `#rrweb-id-${am.id}`,
            attribute: attr,
          };
          if (attr === 'style') {
            const { props, serialized } = normalizeStyleValue(val);
            entry.value = serialized;
            entry.style_props = Object.keys(props);
            const motion = entry.style_props.filter((p) => MOTION_PROPS.has(p));
            if (motion.length) {
              entry.motion_props = motion;
              stats.motion_property_mutations++;
            }
          } else if (attr === 'class') {
            entry.value = typeof val === 'string' ? val : '';
            const classes = classifyClass(entry.value);
            entry.classes = classes;
            stats.classes_added_total += classes.length;
            if (node) node.classes = classes;
          } else {
            entry.value = typeof val === 'string' ? val : String(val);
          }
          mutations.push(entry);
        }
      }
    }

    // Source 13: StyleDeclaration — element.style.<prop> = val set/remove
    if (d.source === 13) {
      stats.style_declarations++;
      const node = nodeMap.get(d.id);
      mutatedIds.add(d.id);
      if (d.set && typeof d.set.property === 'string') {
        const prop = d.set.property;
        const entry = {
          t,
          node_id: d.id,
          tag: node?.tagName || 'unknown',
          path: node?.path || `#rrweb-id-${d.id}`,
          attribute: 'style-prop',
          property: prop,
          value: d.set.value ?? '',
          priority: d.set.priority ?? '',
        };
        if (MOTION_PROPS.has(prop)) {
          entry.is_motion = true;
          stats.motion_property_mutations++;
        }
        mutations.push(entry);
      }
      if (Array.isArray(d.remove)) {
        for (const r of d.remove) {
          mutations.push({
            t,
            node_id: d.id,
            tag: node?.tagName || 'unknown',
            path: node?.path || `#rrweb-id-${d.id}`,
            attribute: 'style-prop-remove',
            property: r.property,
          });
        }
      }
    }
  }

  stats.unique_elements_mutated = mutatedIds.size;
  mutations.sort((a, b) => a.t - b.t);
  return { mutations, stats, nodeMap };
}

// --- Browser automation (main flow). --------------------------------------

async function main() {
  const warnings = [];
  await ensureDir(OUT_DIR);

  const rrwebBundleRaw = await readFile(RRWEB_BUNDLE_PATH, 'utf8');
  // rrweb.min.js starts with `var rrweb=...`. Playwright's addInitScript wraps
  // the content in a function, so that `var` never reaches the window global.
  // Wrap in an IIFE and promote explicitly.
  const rrwebBundle = `
(function(){
  ${rrwebBundleRaw}
  if (typeof rrweb !== 'undefined') window.rrweb = rrweb;
})();
`;
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  // Inject rrweb bundle + bootstrap BEFORE any page script runs so we catch
  // mutations from the very first render tick.
  await page.addInitScript({ content: rrwebBundle });
  await page.addInitScript(() => {
    window.__rrwebEvents = [];
    // Use Date.now() so the same clock as rrweb's own event.timestamp; lets
    // the cross-validator correlate scroll_timeline.t to mutation.t directly.
    window.__rrwebStartTime = 0;
    window.__scrollTimeline = [];
    (function boot() {
      if (typeof window.rrweb === 'undefined' || typeof window.rrweb.record !== 'function') {
        return setTimeout(boot, 10);
      }
      window.__rrwebStartTime = Date.now();
      window.__rrwebStopFn = window.rrweb.record({
        emit(ev) { window.__rrwebEvents.push(ev); },
        recordCanvas: false,
        sampling: { mouseInteraction: false, scroll: 'last', input: 'last' },
      });
    })();
  });

  const t0 = Date.now();
  try {
    console.log(`[rrweb] Loading ${TARGET} (timeout ${GOTO_TIMEOUT_MS}ms)...`);
    try {
      await page.goto(TARGET, { waitUntil: 'networkidle', timeout: GOTO_TIMEOUT_MS });
    } catch {
      await page.waitForLoadState('domcontentloaded', { timeout: GOTO_TIMEOUT_MS });
    }
    await page.waitForTimeout(2000);

    const cf = await detectCloudflareBlock(page);
    if (cf.blocked) {
      console.warn(`[rrweb] Cloudflare detected (${cf.reason}); waiting 15s...`);
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        const again = await detectCloudflareBlock(page);
        if (!again.blocked) break;
        if (i === 14) throw new CloudflareBlockedError(TARGET);
      }
    }

    // Confirm rrweb actually booted inside the page.
    const rrwebReady = await page.evaluate(
      () => typeof window.__rrwebStopFn === 'function'
    );
    if (!rrwebReady) {
      throw new Error('rrweb.record() did not boot in page context; check bundle injection');
    }

    console.log(`[rrweb] Scripted scroll ${SCROLL_DURATION_MS / 1000}s, ${FRAME_COUNT} steps`);
    const scrollHeight = await page.evaluate(
      () => document.body.scrollHeight - window.innerHeight
    );
    if (scrollHeight <= 0) warnings.push('scrollHeight <= 0; page may be empty');

    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = FRAME_COUNT === 1 ? 0 : i / (FRAME_COUNT - 1);
      const y = Math.max(0, Math.round(scrollHeight * t));
      await page.evaluate(
        (ty) => {
          window.scrollTo({ top: ty, behavior: 'instant' });
          window.__scrollTimeline.push({
            t: Date.now() - window.__rrwebStartTime,
            scrollY: window.scrollY,
          });
        },
        y
      );
      await page.waitForTimeout(SCROLL_DURATION_MS / FRAME_COUNT);
    }
    console.log('[rrweb] Scroll pass done');

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(500);

    const ctas = await page.$$('a, button, [role="button"]');
    const hoverTargets = ctas.slice(0, MAX_HOVER_TARGETS);
    console.log(`[rrweb] Hover pass on ${hoverTargets.length} CTAs`);
    for (const t of hoverTargets) {
      try {
        await t.hover({ timeout: 2000 });
        await page.waitForTimeout(400);
      } catch {}
    }

    // Stop recording + drain buffers.
    const payload = await page.evaluate(() => {
      try { window.__rrwebStopFn?.(); } catch {}
      return {
        events: window.__rrwebEvents || [],
        scrollTimeline: window.__scrollTimeline || [],
        startTime: window.__rrwebStartTime || 0,
      };
    });
    console.log(`[rrweb] Captured ${payload.events.length} rrweb events, ${payload.scrollTimeline.length} scroll points`);

    if (payload.events.length === 0) {
      warnings.push('zero rrweb events captured; bundle may not have booted or page is truly static');
    }

    // Persist the raw event stream (gitignored via out/) so we can iterate
    // post-processing without replaying the page.
    await writeFile(
      path.join(OUT_DIR, 'rrweb-raw.json'),
      JSON.stringify({
        target: TARGET,
        captured_at: new Date().toISOString(),
        start_time: payload.startTime,
        event_count: payload.events.length,
        events: payload.events,
      })
    );

    const { mutations, stats } = extractMutations(payload.events, { startTime: payload.startTime });

    const log = {
      target: TARGET,
      captured_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      scroll_timeline: payload.scrollTimeline,
      mutations,
      stats,
      warnings,
    };
    await writeFile(
      path.join(OUT_DIR, 'mutation-log.json'),
      JSON.stringify(log, null, 2)
    );

    console.log(`[rrweb] ${mutations.length} processed mutations → mutation-log.json`);
    console.log('[rrweb] stats:', stats);
    if (warnings.length) {
      console.warn(`[rrweb] Warnings:\n  - ${warnings.join('\n  - ')}`);
    }
    console.log(`[rrweb] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((e) => {
    if (e instanceof CloudflareBlockedError) {
      console.error(`[rrweb] ${e.message}`);
      process.exit(2);
    }
    console.error('[rrweb] FATAL:', e);
    process.exit(1);
  });
}
