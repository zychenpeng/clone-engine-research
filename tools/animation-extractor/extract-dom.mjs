// Layer 1 — DOM animation probe via document.getAnimations().
// Scripted scroll + hover triggers; polls getAnimations() at each step; saves
// 20 frames alongside for Layer 2 (Vision).
//
// Round E upgrades (over Round D):
//   - Cloudflare / bot-wall detection with retry-once then clean abort
//   - Empty animation list is NOT fatal; writes {total: 0} spec with warning
//   - Configurable timeout / frame count / headless via env
//   - Structured error classes so callers (CLI, smoke tests) can branch
//   - Goto retry once on transient failures
//   - OUT_DIR configurable so one extractor can run across 5 target sites

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFile, mkdir } from 'node:fs/promises';
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

export class CloudflareBlockedError extends Error {
  constructor(url) {
    super(`Cloudflare / bot-wall blocked ${url}; manual Save Page As fallback required`);
    this.name = 'CloudflareBlockedError';
  }
}
export class NavigationError extends Error {
  constructor(url, cause) {
    super(`Failed to navigate to ${url}: ${cause?.message || cause}`);
    this.name = 'NavigationError';
    this.cause = cause;
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

async function gotoWithRetry(page, url, { timeoutMs, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
      return;
    } catch (e) {
      lastErr = e;
      // networkidle often flaky on dynamic sites — fall back to domcontentloaded
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
        return;
      } catch (e2) {
        lastErr = e2;
        if (attempt < retries) {
          console.warn(`[probe-dom] goto attempt ${attempt + 1} failed (${e2.message}); retrying...`);
          await page.waitForTimeout(2000);
          continue;
        }
      }
    }
  }
  throw new NavigationError(url, lastErr);
}

async function collectAnimations(page, label) {
  return await page.evaluate((lbl) => {
    const list = document.getAnimations({ subtree: true });
    return list.map((a, i) => {
      const effect = a.effect;
      const t = effect?.target;
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
      } catch {
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
  const warnings = [];
  await ensureDir(OUT_DIR);
  const framesDir = path.join(OUT_DIR, 'frames');
  await ensureDir(framesDir);

  const t0 = Date.now();
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    console.log(`[probe-dom] Loading ${TARGET} (timeout ${GOTO_TIMEOUT_MS}ms)...`);
    await gotoWithRetry(page, TARGET, { timeoutMs: GOTO_TIMEOUT_MS, retries: 1 });
    await page.waitForTimeout(2000);

    const cf = await detectCloudflareBlock(page);
    if (cf.blocked) {
      // Give stealth/solver a chance; poll for up to 15s.
      console.warn(`[probe-dom] Cloudflare detected (${cf.reason}); waiting 15s...`);
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        const again = await detectCloudflareBlock(page);
        if (!again.blocked) {
          console.log(`[probe-dom] Cloudflare cleared after ${i + 1}s`);
          break;
        }
        if (i === 14) throw new CloudflareBlockedError(TARGET);
      }
    }

    const collected = [];

    console.log('[probe-dom] Collect baseline (on-load)...');
    collected.push(...(await collectAnimations(page, 'on-load')));
    await page.waitForTimeout(500);

    console.log(`[probe-dom] Scripted scroll ${SCROLL_DURATION_MS / 1000}s, ${FRAME_COUNT} frames + polls`);
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
    if (scrollHeight <= 0) {
      warnings.push('scrollHeight <= 0; page may be empty or viewport-sized');
    }

    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = FRAME_COUNT === 1 ? 0 : i / (FRAME_COUNT - 1);
      const y = Math.max(0, Math.round(scrollHeight * t));
      await page.evaluate((ty) => window.scrollTo({ top: ty, behavior: 'instant' }), y);
      await page.waitForTimeout(SCROLL_DURATION_MS / FRAME_COUNT);
      const framePath = path.join(framesDir, `${String(i).padStart(2, '0')}.png`);
      try {
        await page.screenshot({ path: framePath, fullPage: false });
      } catch (e) {
        warnings.push(`frame ${i} screenshot failed: ${e.message}`);
      }
      const anims = await collectAnimations(page, `scroll-${i}`);
      collected.push(...anims);
    }
    console.log(`[probe-dom] Scroll pass done; ${collected.length} raw entries`);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(500);

    const ctas = await page.$$('a, button, [role="button"]');
    const hoverTargets = ctas.slice(0, MAX_HOVER_TARGETS);
    console.log(`[probe-dom] Hover pass on ${hoverTargets.length} CTAs`);
    for (let i = 0; i < hoverTargets.length; i++) {
      try {
        await hoverTargets[i].hover({ timeout: 2000 });
        await page.waitForTimeout(400);
        collected.push(...(await collectAnimations(page, `hover-${i}`)));
      } catch {
        // unhoverable (offscreen / detached) — ignore
      }
    }

    // Dedupe by (targetSelector, duration, easing, keyframeCount)
    const seen = new Map();
    for (const a of collected) {
      const key = `${a.targetSelector}|${a.duration}|${a.easing}|${a.keyframeCount}`;
      if (!seen.has(key)) seen.set(key, a);
    }
    const dedup = Array.from(seen.values());

    if (dedup.length === 0) {
      warnings.push('zero DOM animations found; site may have no WAAPI/CSS animations or stealth was detected');
    }

    const output = {
      target: TARGET,
      captured_at: new Date().toISOString(),
      total_raw: collected.length,
      total_deduped: dedup.length,
      frame_count: FRAME_COUNT,
      warnings,
      animations: dedup,
    };
    await writeFile(path.join(OUT_DIR, 'animations-dom.json'), JSON.stringify(output, null, 2));

    console.log(`[probe-dom] Dedupe: ${collected.length} -> ${dedup.length}`);
    console.log(`[probe-dom] Frames: ${FRAME_COUNT}`);
    if (warnings.length) console.warn(`[probe-dom] Warnings (${warnings.length}):\n  - ${warnings.join('\n  - ')}`);
    console.log(`[probe-dom] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Only run when invoked directly, not when imported.
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((e) => {
    if (e instanceof CloudflareBlockedError) {
      console.error(`[probe-dom] ${e.message}`);
      process.exit(2);
    }
    console.error('[probe-dom] FATAL:', e);
    process.exit(1);
  });
}
