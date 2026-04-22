// Layer 1 — DOM animation probe via document.getAnimations().
// Scripted scroll + hover to trigger animations, poll getAnimations() at each step.
// Also captures 20 frames during scroll for Layer 2 (Vision).

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

chromium.use(StealthPlugin());

const TARGET = process.env.TARGET_URL || 'https://linear.app';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'target');
const FRAMES = path.join(OUT, 'frames');
const FRAME_COUNT = 20;
const SCROLL_DURATION_MS = 10_000;

async function ensureDir(d) {
  if (!existsSync(d)) await mkdir(d, { recursive: true });
}

function normalizeAnim(a) {
  // Playwright serializes Animation objects partially; normalize into a diffable shape
  return {
    id: a.id || '',
    playState: a.playState,
    currentTime: a.currentTime,
    playbackRate: a.playbackRate,
    timelineType: a.timelineType || 'document',
    effect: a.effect
      ? {
          target: a.targetSelector || a.targetTag || 'unknown',
          duration: a.duration,
          easing: a.easing,
          iterations: a.iterations,
          keyframes: a.keyframes || [],
          pseudoElement: a.pseudoElement || null,
        }
      : null,
  };
}

async function collectAnimations(page, label) {
  return await page.evaluate((lbl) => {
    const list = document.getAnimations({ subtree: true });
    return list.map((a, i) => {
      const effect = a.effect;
      const t = effect?.target;
      // Build a short CSS-path for the target
      let targetSelector = 'unknown';
      if (t && t instanceof Element) {
        const parts = [];
        let el = t;
        while (el && parts.length < 4 && el !== document.body) {
          let s = el.tagName.toLowerCase();
          if (el.id) s += `#${el.id}`;
          else if (el.className && typeof el.className === 'string') {
            const cls = el.className.split(' ').filter(Boolean).slice(0, 2).join('.');
            if (cls) s += `.${cls}`;
          }
          parts.unshift(s);
          el = el.parentElement;
        }
        targetSelector = parts.join(' > ');
      }
      let keyframes = [];
      try {
        if (effect && typeof effect.getKeyframes === 'function') {
          keyframes = effect.getKeyframes().map((k) => {
            const simple = {};
            for (const key of Object.keys(k)) {
              if (['composite', 'computedOffset', 'easing', 'offset'].includes(key)) {
                simple[key] = k[key];
              } else if (typeof k[key] === 'string' || typeof k[key] === 'number') {
                simple[key] = k[key];
              }
            }
            return simple;
          });
        }
      } catch (e) {
        keyframes = [];
      }
      const timing = effect ? effect.getTiming() : {};
      return {
        label: lbl,
        index: i,
        id: a.id || `anim-${i}`,
        playState: a.playState,
        currentTime: a.currentTime,
        playbackRate: a.playbackRate,
        targetSelector,
        targetTag: t instanceof Element ? t.tagName.toLowerCase() : null,
        duration: timing.duration,
        easing: timing.easing,
        iterations: timing.iterations,
        keyframeCount: keyframes.length,
        keyframes,
        pseudoElement: effect?.pseudoElement || null,
      };
    });
  }, label);
}

async function main() {
  await ensureDir(OUT);
  await ensureDir(FRAMES);

  const t0 = Date.now();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  console.log(`[probe-animations] Loading ${TARGET}...`);
  try {
    await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60_000 });
  } catch {
    await page.waitForLoadState('domcontentloaded');
  }
  await page.waitForTimeout(2000);

  const collected = [];

  // Baseline (on-load animations)
  console.log(`[probe-animations] Collect baseline (on-load)...`);
  collected.push(...(await collectAnimations(page, 'on-load')));
  await page.waitForTimeout(500);

  // Scripted scroll with frame capture + animation polling
  console.log(`[probe-animations] Scripted scroll ${SCROLL_DURATION_MS / 1000}s, ${FRAME_COUNT} frames + ${FRAME_COUNT} poll steps`);
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);

  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / (FRAME_COUNT - 1);
    const y = Math.round(scrollHeight * t);
    await page.evaluate((ty) => window.scrollTo({ top: ty, behavior: 'instant' }), y);
    await page.waitForTimeout(SCROLL_DURATION_MS / FRAME_COUNT);
    const framePath = path.join(FRAMES, `${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: framePath, fullPage: false });
    const anims = await collectAnimations(page, `scroll-${i}`);
    collected.push(...anims);
  }
  console.log(`[probe-animations] Scroll pass done; ${collected.length} animation entries so far`);

  // Back to top before hover pass
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(500);

  // Hover pass — limit to first 10 CTAs to keep time bounded
  const ctas = await page.$$('a, button, [role="button"]');
  const hoverTargets = ctas.slice(0, 10);
  console.log(`[probe-animations] Hover pass on ${hoverTargets.length} CTAs`);
  for (let i = 0; i < hoverTargets.length; i++) {
    try {
      await hoverTargets[i].hover({ timeout: 2000 });
      await page.waitForTimeout(400);
      const anims = await collectAnimations(page, `hover-${i}`);
      collected.push(...anims);
    } catch (e) {
      // skip un-hoverable (offscreen / detached)
    }
  }

  // Dedupe by (targetSelector, duration, easing, keyframeCount)
  const seen = new Map();
  for (const a of collected) {
    const key = `${a.targetSelector}|${a.duration}|${a.easing}|${a.keyframeCount}`;
    if (!seen.has(key)) seen.set(key, a);
  }
  const dedup = Array.from(seen.values());

  await writeFile(path.join(OUT, 'animations-dom.json'), JSON.stringify({
    target: TARGET,
    captured_at: new Date().toISOString(),
    total_raw: collected.length,
    total_deduped: dedup.length,
    animations: dedup,
  }, null, 2));

  console.log(`[probe-animations] ✅ Dedupe: ${collected.length} → ${dedup.length} animations`);
  console.log(`[probe-animations] ✅ Frames saved: ${FRAME_COUNT}`);
  console.log(`[probe-animations] ✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error('[probe-animations] FATAL:', e);
  process.exit(1);
});
