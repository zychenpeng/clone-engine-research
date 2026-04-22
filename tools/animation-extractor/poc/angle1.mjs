/**
 * Angle 1: JS Source AST Scraping (regex structural patterns + optional LLM decode)
 * Target: linear.app
 * Output: poc-results/angle1-js-ast.json
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../../../poc-results');
mkdirSync(OUT_DIR, { recursive: true });

// Framer Motion structural patterns in minified bundles
// motion.div → o.div or (0,n.motion).div or t.motion.div etc.
const PATTERNS = [
  // Framer Motion v10+ object spread with animate/initial/exit
  { name: 'framer-motion-animate-key',   re: /\banimate\s*:\s*\{[^}]{1,300}\}/ },
  { name: 'framer-motion-initial-key',   re: /\binitial\s*:\s*\{[^}]{1,300}\}/ },
  { name: 'framer-motion-exit-key',      re: /\bexit\s*:\s*\{[^}]{1,300}\}/ },
  { name: 'framer-motion-whileInView',   re: /whileInView\s*:/ },
  { name: 'framer-motion-whileHover',    re: /whileHover\s*:/ },
  { name: 'framer-motion-useScroll',     re: /useScroll\s*\(/ },
  { name: 'framer-motion-useTransform',  re: /useTransform\s*\(/ },
  { name: 'framer-motion-useSpring',     re: /useSpring\s*\(/ },
  { name: 'framer-motion-useAnimate',    re: /useAnimate\s*\(/ },
  { name: 'framer-motion-motion-import', re: /['"](framer-motion|motion)['"]/ },
  // motion.* JSX calls — minified as single-letter.div etc., match structural shape
  { name: 'motion-component-call',       re: /\.motion\.[a-z]+\b/ },
  { name: 'motion-create-call',          re: /motion\s*\(\s*['"][a-z]+['"]\s*\)/ },
  // GSAP
  { name: 'gsap-to',                     re: /gsap\.to\s*\(/ },
  { name: 'gsap-from',                   re: /gsap\.from\s*\(/ },
  { name: 'gsap-fromTo',                 re: /gsap\.fromTo\s*\(/ },
  { name: 'gsap-timeline',               re: /gsap\.timeline\s*\(/ },
  { name: 'gsap-import',                 re: /['"]gsap['"]/ },
  // CSS transition / keyframe hints in JS
  { name: 'transition-duration',         re: /transition\s*:\s*['""][^'"]{3,80}['"]/ },
  { name: 'keyframes-object',            re: /keyframes\s*:\s*\[/ },
  // Lottie
  { name: 'lottie-import',               re: /['"]lottie[-\w]*['"]/ },
  { name: 'lottie-loadAnimation',        re: /loadAnimation\s*\(/ },
  // React Spring
  { name: 'react-spring-import',         re: /['"]@react-spring\/[^'"]+['"]/ },
  { name: 'react-spring-useSpring',      re: /useSpring\s*\(\{/ },
  // CSS animation property assignments
  { name: 'animation-inline-style',      re: /animation\s*:\s*['"][^'"]{5,100}['"]/ },
];

const MAX_BUNDLE_SIZE = 2 * 1024 * 1024; // 2 MB cap per bundle
const MAX_LLM_CHUNKS = 5; // max chunks to send to Claude
const CHUNK_SIZE = 4000;  // chars per LLM chunk
let apiCost = 0;

async function llmDecodeChunk(client, chunk, sourceFile) {
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `This is a minified JavaScript chunk from ${sourceFile}. Identify any Framer Motion motion components and their props (animate, initial, exit, whileInView, transition, etc.). List each occurrence as: component_name | prop_name | prop_value. If none found, say NONE.\n\n${chunk}`
    }]
  });
  // Rough cost estimate: ~$3/M input + $15/M output (sonnet)
  const inputTok = resp.usage.input_tokens;
  const outputTok = resp.usage.output_tokens;
  apiCost += (inputTok / 1e6) * 3 + (outputTok / 1e6) * 15;
  return resp.content[0].text;
}

async function run() {
  const client = new Anthropic();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  });

  const page = await context.newPage();
  const bundles = [];

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!(ct.includes('javascript') || url.match(/\.(js|mjs)(\?|$)/))) return;
    if (url.includes('gtag') || url.includes('analytics') || url.includes('intercom')) return;
    try {
      const body = await response.body();
      if (body.length > MAX_BUNDLE_SIZE) return;
      bundles.push({ url, text: body.toString('utf8') });
    } catch (_) { /* streamed responses may throw */ }
  });

  console.log('Navigating to linear.app...');
  await page.goto('https://linear.app', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  await browser.close();

  console.log(`Scraped ${bundles.length} JS bundles`);

  const findings = [];
  const llmCandidates = []; // bundles with hits, for optional LLM decode

  for (const { url, text } of bundles) {
    const bundleHits = [];
    for (const { name, re } of PATTERNS) {
      const matches = [];
      let m;
      const reGlobal = new RegExp(re.source, 'g');
      while ((m = reGlobal.exec(text)) !== null) {
        // Grab 120 chars of context around the match
        const start = Math.max(0, m.index - 30);
        const end = Math.min(text.length, m.index + m[0].length + 90);
        matches.push({
          offset: m.index,
          snippet: text.slice(start, end).replace(/\n/g, '↵')
        });
        if (matches.length >= 5) break; // cap per pattern per bundle
      }
      if (matches.length > 0) {
        bundleHits.push({ pattern: name, count: matches.length, samples: matches.slice(0, 3) });
      }
    }

    if (bundleHits.length > 0) {
      const entry = {
        source_file: url.split('?')[0].split('/').slice(-2).join('/'),
        source_url: url,
        pattern_hits: bundleHits,
        total_patterns_matched: bundleHits.length,
        bundle_size_kb: Math.round(text.length / 1024),
        llm_decoded: null
      };
      findings.push(entry);

      // Queue for LLM if has strong framer hits
      const strongHits = bundleHits.filter(h =>
        h.pattern.startsWith('framer') || h.pattern.startsWith('motion')
      );
      if (strongHits.length > 0 && llmCandidates.length < MAX_LLM_CHUNKS) {
        llmCandidates.push({ entry, text });
      }
    }
  }

  // LLM decode on top candidates (cost-capped)
  console.log(`LLM decode: ${llmCandidates.length} candidates (budget: $1)`);
  for (const { entry, text } of llmCandidates) {
    if (apiCost >= 1.0) {
      console.log(`  API budget $1 reached, stopping LLM decode`);
      break;
    }
    // Find the most interesting chunk (around first framer hit)
    const firstHit = entry.pattern_hits.find(h => h.pattern.startsWith('framer') || h.pattern.startsWith('motion'));
    if (!firstHit || !firstHit.samples[0]) continue;
    const offset = firstHit.samples[0].offset;
    const chunk = text.slice(
      Math.max(0, offset - 200),
      Math.min(text.length, offset + CHUNK_SIZE)
    );
    try {
      console.log(`  Sending chunk from ${entry.source_file} to Claude...`);
      const decoded = await llmDecodeChunk(client, chunk, entry.source_file);
      entry.llm_decoded = decoded;
      console.log(`  Cost so far: $${apiCost.toFixed(4)}`);
    } catch (e) {
      entry.llm_decoded = `ERROR: ${e.message}`;
    }
  }

  // Flatten to data points
  const dataPoints = [];
  for (const f of findings) {
    for (const hit of f.pattern_hits) {
      for (const sample of hit.samples) {
        dataPoints.push({
          source_file: f.source_file,
          location: `offset:${sample.offset}`,
          inferred_component: hit.pattern,
          props: sample.snippet
        });
      }
    }
  }

  const result = {
    target: 'linear.app',
    date: new Date().toISOString(),
    bundles_scraped: bundles.length,
    bundles_with_hits: findings.length,
    total_data_points: dataPoints.length,
    api_cost_usd: parseFloat(apiCost.toFixed(4)),
    findings_by_bundle: findings,
    data_points: dataPoints
  };

  writeFileSync(join(OUT_DIR, 'angle1-js-ast.json'), JSON.stringify(result, null, 2));
  console.log(`\n=== Angle 1 Result ===`);
  console.log(`Bundles scraped: ${bundles.length}`);
  console.log(`Bundles with hits: ${findings.length}`);
  console.log(`Total data points: ${dataPoints.length}`);
  console.log(`API cost: $${apiCost.toFixed(4)}`);
  console.log(`Output: poc-results/angle1-js-ast.json`);
}

run().catch(e => { console.error(e); process.exit(1); });
