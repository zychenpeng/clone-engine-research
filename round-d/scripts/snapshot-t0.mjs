// T0 Snapshot — freezes Linear.app for downstream tool consumption.
// Outputs: screenshots (5 breakpoints), DOM dump, HAR, SingleFile HTML.
// Animation probes run in a separate script (probe-animations.mjs).

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { spawn } from 'node:child_process';
import { writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

chromium.use(StealthPlugin());

const TARGET = process.env.TARGET_URL || 'https://linear.app';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const OUT = path.join(ROOT, 'target');
const SHOTS = path.join(OUT, 'screenshots');
const BREAKPOINTS = [320, 768, 1024, 1440, 1920];

async function ensureDir(d) {
  if (!existsSync(d)) await mkdir(d, { recursive: true });
}

function runSingleFile(url, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['single-file', url, outPath, '--browser-executable-path=""'], {
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`SingleFile exited ${code}`))));
    proc.on('error', reject);
  });
}

async function main() {
  await ensureDir(OUT);
  await ensureDir(SHOTS);

  console.log(`[snapshot-t0] Target: ${TARGET}`);
  console.log(`[snapshot-t0] Output: ${OUT}`);

  const t0 = Date.now();
  const browser = await chromium.launch({ headless: false }); // non-headless helps vs Cloudflare
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    recordHar: { path: path.join(OUT, 'snapshot-T0.har') },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60_000 });
  } catch (e) {
    console.warn(`[snapshot-t0] networkidle timeout; continuing with domcontentloaded`);
    await page.waitForLoadState('domcontentloaded');
  }
  await page.waitForTimeout(2000); // settle

  // Detect Cloudflare block
  const title = await page.title();
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/just a moment|cloudflare|verify you are human/i.test(title + bodyText)) {
    console.error('[snapshot-t0] ❌ Cloudflare challenge detected. Manual fallback needed (Save Page As).');
    await browser.close();
    process.exit(2);
  }
  console.log(`[snapshot-t0] Loaded: ${title}`);

  // Breakpoint screenshots
  for (const w of BREAKPOINTS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(800); // let responsive layout settle
    const p = path.join(SHOTS, `${w}.png`);
    await page.screenshot({ path: p, fullPage: true });
    console.log(`[snapshot-t0] screenshot ${w}w → ${path.basename(p)}`);
  }

  // Back to 1440 for canonical DOM dump
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // DOM + key computed styles (flat, not full-tree — we don't need tree-edit-distance in v3)
  const dom = await page.evaluate(() => {
    const collected = [];
    const selectors = ['h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'nav', 'main', 'section', 'header', 'footer', 'input'];
    const seen = new Set();
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel)).slice(0, 20);
      for (const el of els) {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const key = `${sel}:${el.textContent?.slice(0, 30)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push({
          tag: sel,
          text: el.textContent?.trim().slice(0, 80),
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          padding: cs.padding,
          margin: cs.margin,
          borderRadius: cs.borderRadius,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        });
      }
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    return {
      url: location.href,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      root: { backgroundColor: rootStyle.backgroundColor, color: rootStyle.color },
      body: {
        backgroundColor: bodyStyle.backgroundColor,
        color: bodyStyle.color,
        fontFamily: bodyStyle.fontFamily,
      },
      elements: collected,
      scrollHeight: document.body.scrollHeight,
    };
  });
  await writeFile(path.join(OUT, 'dom-T0.json'), JSON.stringify(dom, null, 2));
  console.log(`[snapshot-t0] DOM dumped: ${dom.elements.length} elements`);

  await context.close();
  await browser.close();

  // SingleFile (separate pass, doesn't need our stealth browser)
  const singleFileOut = path.join(OUT, 'snapshot-T0.html');
  try {
    console.log(`[snapshot-t0] Running SingleFile → ${path.basename(singleFileOut)}`);
    await runSingleFile(TARGET, singleFileOut);
  } catch (e) {
    console.warn(`[snapshot-t0] SingleFile failed: ${e.message}. Continuing without single-file HTML.`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[snapshot-t0] ✅ Done in ${elapsed}s`);
}

main().catch((e) => {
  console.error('[snapshot-t0] FATAL:', e);
  process.exit(1);
});
