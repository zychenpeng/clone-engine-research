/**
 * Angle 3: requestAnimationFrame Interception
 * Target: linear.app
 * Output: poc-results/angle3-raf.json
 *
 * Monkey-patches rAF + Element.animate + CSSStyleDeclaration setters
 * Captures every inline style mutation driven by animation frame callbacks
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../../../poc-results');
mkdirSync(OUT_DIR, { recursive: true });

// Injected as init script — NO imports, all inline
const INTERCEPT_SCRIPT = `
(function() {
  window.__animationLog = [];
  window.__animateCallLog = [];
  window.__rafCount = 0;

  // --- CSS path helper (inline, no deps) ---
  function getCssPath(el) {
    if (!el || el === document.body) return 'body';
    const parts = [];
    let cur = el;
    for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
      let seg = cur.tagName ? cur.tagName.toLowerCase() : '';
      // Keep only non-hashed class tokens
      const classes = Array.from(cur.classList || [])
        .filter(c => !c.match(/^[a-z0-9]{1,2}[0-9A-F]{5,}$/i))
        .slice(0, 2);
      if (classes.length) seg += '.' + classes.join('.');
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // --- Snapshot style-mutated elements before/after each rAF ---
  const origRAF = window.requestAnimationFrame.bind(window);
  let frameCount = 0;
  window.requestAnimationFrame = function patchedRAF(cb) {
    return origRAF(function(t) {
      frameCount++;
      window.__rafCount = frameCount;

      // Only sample every 3rd frame to avoid perf collapse
      if (frameCount % 3 !== 0) { cb(t); return; }

      // Snapshot all elements with style attribute before callback
      const beforeMap = new Map();
      const styled = document.querySelectorAll('[style]');
      for (const el of styled) {
        beforeMap.set(el, el.getAttribute('style') || '');
      }

      cb(t);

      // Diff after callback
      const changed = [];
      // Check elements that had style before
      beforeMap.forEach(function(before, el) {
        const after = el.getAttribute('style') || '';
        if (after !== before) {
          changed.push({ path: getCssPath(el), before: before, after: after });
        }
      });
      // Check newly styled elements
      const styledAfter = document.querySelectorAll('[style]');
      for (const el of styledAfter) {
        if (!beforeMap.has(el)) {
          const after = el.getAttribute('style') || '';
          if (after) changed.push({ path: getCssPath(el), before: '', after: after });
        }
      }

      if (changed.length > 0) {
        window.__animationLog.push({ t: Math.round(t), changed: changed });
        // Cap log size to prevent memory blow-up
        if (window.__animationLog.length > 2000) {
          window.__animationLog = window.__animationLog.slice(-1500);
        }
      }
    });
  };

  // --- Also intercept Element.animate (WAAPI) ---
  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function(keyframes, options) {
    const path = getCssPath(this);
    window.__animateCallLog.push({
      t: performance.now(),
      path: path,
      keyframes: Array.isArray(keyframes)
        ? keyframes.slice(0, 3)
        : (keyframes ? Object.keys(keyframes).slice(0, 5) : []),
      duration: options && (typeof options === 'number' ? options : options.duration),
      easing: options && typeof options === 'object' ? options.easing : undefined
    });
    return origAnimate.call(this, keyframes, options);
  };

  console.log('[angle3] rAF + Element.animate intercepted');
})();
`;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // Inject BEFORE any page scripts load
  await context.addInitScript(INTERCEPT_SCRIPT);
  const page = await context.newPage();

  // Capture console logs from the page
  page.on('console', msg => {
    if (msg.text().includes('[angle3]')) console.log('  page:', msg.text());
  });

  console.log('Loading linear.app with rAF interception...');
  await page.goto('https://linear.app', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 2s wait for load animations
  console.log('  Waiting 2s for load animations...');
  await page.waitForTimeout(2000);

  // 8s scripted scroll
  console.log('  Scripted scroll for 8s...');
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const maxScroll = scrollHeight - viewportHeight;
  const SCROLL_DURATION_MS = 8000;
  const SCROLL_STEPS = 40;
  const stepDelay = Math.round(SCROLL_DURATION_MS / SCROLL_STEPS);

  for (let i = 0; i <= SCROLL_STEPS; i++) {
    const y = Math.round((i / SCROLL_STEPS) * maxScroll);
    await page.evaluate(scrollY => window.scrollTo({ top: scrollY, behavior: 'instant' }), y);
    await page.waitForTimeout(stepDelay);
    if (i % 10 === 0) {
      const progress = Math.round((i / SCROLL_STEPS) * 100);
      console.log(`  Scroll progress: ${progress}%`);
    }
  }

  // Collect logs
  console.log('  Collecting animation logs...');
  const [animationLog, animateCallLog, rafCount] = await page.evaluate(() => [
    window.__animationLog || [],
    window.__animateCallLog || [],
    window.__rafCount || 0
  ]);

  await browser.close();

  console.log(`Total rAF frames: ${rafCount}`);
  console.log(`rAF animation log entries: ${animationLog.length}`);
  console.log(`Element.animate calls: ${animateCallLog.length}`);

  // Analyze: unique elements, time clusters
  const elementMutations = {};
  for (const entry of animationLog) {
    for (const change of entry.changed) {
      if (!elementMutations[change.path]) {
        elementMutations[change.path] = { count: 0, firstT: entry.t, lastT: entry.t, samples: [] };
      }
      const em = elementMutations[change.path];
      em.count++;
      em.lastT = Math.max(em.lastT, entry.t);
      if (em.samples.length < 3) em.samples.push({ t: entry.t, before: change.before, after: change.after });
    }
  }

  // Time-window clusters: load phase (0-2500ms) vs scroll phase (2500ms+)
  const loadFrames = animationLog.filter(e => e.t < 2500).length;
  const scrollFrames = animationLog.filter(e => e.t >= 2500).length;

  const uniqueElements = Object.keys(elementMutations).length;

  // Top mutated elements
  const topElements = Object.entries(elementMutations)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([path, data]) => ({ path, mutation_count: data.count, first_t_ms: data.firstT, last_t_ms: data.lastT, samples: data.samples }));

  const result = {
    target: 'linear.app',
    date: new Date().toISOString(),
    total_raf_frames: rafCount,
    raf_log_entries: animationLog.length,
    element_animate_calls: animateCallLog.length,
    unique_elements_with_mutation: uniqueElements,
    time_clusters: {
      load_phase_0_2500ms: loadFrames,
      scroll_phase_2500ms_plus: scrollFrames
    },
    top_mutated_elements: topElements,
    element_animate_details: animateCallLog.slice(0, 30),
    raw_log_sample: animationLog.slice(0, 20)
  };

  writeFileSync(join(OUT_DIR, 'angle3-raf.json'), JSON.stringify(result, null, 2));
  console.log(`\n=== Angle 3 Result ===`);
  console.log(`Total rAF frames: ${rafCount}`);
  console.log(`Frames with style mutations: ${animationLog.length}`);
  console.log(`Unique elements mutated: ${uniqueElements}`);
  console.log(`Element.animate calls: ${animateCallLog.length}`);
  console.log(`Time clusters: load=${loadFrames}, scroll=${scrollFrames}`);
  console.log(`Output: poc-results/angle3-raf.json`);
}

run().catch(e => { console.error(e); process.exit(1); });
