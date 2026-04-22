/**
 * Angle 2: Differential Reduced-Motion Rendering
 * Target: linear.app
 * Output: poc-results/angle2-differential.json
 *
 * Run A: prefers-reduced-motion: reduce
 * Run B: normal motion
 * Diff computed styles on all visible elements — delta = animation-controlled properties
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../../../poc-results');
mkdirSync(OUT_DIR, { recursive: true });

const MOTION_PROPS = [
  'opacity', 'transform', 'filter', 'visibility',
  'transition', 'animation', 'animationName', 'animationDuration',
  'transitionProperty', 'transitionDuration', 'transitionTimingFunction',
  'clipPath', 'backdropFilter', 'willChange'
];

const SCROLL_STEPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0];

async function collectStylesAtScrollPositions(page, label) {
  const allStyles = {};

  for (const fraction of SCROLL_STEPS) {
    await page.evaluate((f) => {
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.round(maxY * f), behavior: 'instant' });
    }, fraction);
    await page.waitForTimeout(800);

    const snapshot = await page.evaluate((props) => {
      const result = {};
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        // Only elements in or near viewport
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue;
        if (rect.width === 0 && rect.height === 0) continue;

        // Stable selector: tag + up to 2 meaningful classes
        const classes = Array.from(el.classList)
          .filter(c => !c.match(/^[a-z]{1,2}[0-9A-F]{5,}$/i)) // skip hashed classes
          .slice(0, 2).join('.');
        const selector = `${el.tagName.toLowerCase()}${classes ? '.' + classes : ''}`;
        const key = `${selector}|${Math.round(rect.left)}x${Math.round(rect.top)}`;

        const computed = window.getComputedStyle(el);
        const styles = {};
        for (const p of props) {
          styles[p] = computed[p] || '';
        }
        result[key] = styles;
      }
      return result;
    }, MOTION_PROPS);

    // Merge: take first seen value per key (initial state at each scroll position)
    for (const [key, styles] of Object.entries(snapshot)) {
      if (!allStyles[key]) allStyles[key] = {};
      for (const [prop, val] of Object.entries(styles)) {
        if (!allStyles[key][prop]) allStyles[key][prop] = val;
      }
    }
  }
  return allStyles;
}

async function runWithSettings(reducedMotion) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();

  console.log(`  Loading linear.app with reducedMotion=${reducedMotion}...`);
  await page.goto('https://linear.app', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const styles = await collectStylesAtScrollPositions(page, reducedMotion ? 'reduce' : 'normal');
  await browser.close();
  return styles;
}

async function run() {
  console.log('Run A: reduced motion...');
  const stylesReduced = await runWithSettings(true);

  console.log('Run B: normal motion...');
  const stylesNormal = await runWithSettings(false);

  // Diff: find elements + props where values differ between runs
  const diffs = [];
  const allKeys = new Set([...Object.keys(stylesNormal), ...Object.keys(stylesReduced)]);

  for (const key of allKeys) {
    const normal = stylesNormal[key] || {};
    const reduced = stylesReduced[key] || {};
    const affectedProps = [];

    for (const prop of MOTION_PROPS) {
      const nVal = normal[prop] || '';
      const rVal = reduced[prop] || '';
      if (nVal !== rVal) {
        affectedProps.push({ prop, normal_value: nVal, reduce_value: rVal });
      }
    }

    if (affectedProps.length > 0) {
      const [selectorPart] = key.split('|');
      diffs.push({
        selector: selectorPart,
        key,
        affected_properties: affectedProps.map(a => a.prop),
        details: affectedProps
      });
    }
  }

  // Aggregate by property
  const propCounts = {};
  for (const diff of diffs) {
    for (const prop of diff.affected_properties) {
      propCounts[prop] = (propCounts[prop] || 0) + 1;
    }
  }

  // Check if any CSS media query for prefers-reduced-motion exists
  // (This tells us whether Linear actually implements reduced-motion)
  const reducedMotionRespected = diffs.length > 0;

  const result = {
    target: 'linear.app',
    date: new Date().toISOString(),
    scroll_steps: SCROLL_STEPS.length,
    elements_compared: allKeys.size,
    elements_with_delta: diffs.length,
    reduce_mode_respected: reducedMotionRespected,
    property_delta_summary: propCounts,
    diffs: diffs.slice(0, 100) // cap output size
  };

  writeFileSync(join(OUT_DIR, 'angle2-differential.json'), JSON.stringify(result, null, 2));
  console.log(`\n=== Angle 2 Result ===`);
  console.log(`Elements compared: ${allKeys.size}`);
  console.log(`Elements with delta: ${diffs.length}`);
  console.log(`Reduce mode respected: ${reducedMotionRespected}`);
  console.log(`Property breakdown:`, propCounts);
  console.log(`Output: poc-results/angle2-differential.json`);
}

run().catch(e => { console.error(e); process.exit(1); });
