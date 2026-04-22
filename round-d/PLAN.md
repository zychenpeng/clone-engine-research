# Round D: Baseline Comparison Experiment — Linear.app Clone

**Date**: 2026-04-22
**Owner**: Sean (@zychenpeng)
**Version**: v3 (post 4-agent multi-review)
**Status**: Plan approved — ready to execute
**Parent project**: `ai-website-cloner-template`

## Changelog

- **v3.2 (2026-04-22, pre-execution reality check)**: Discovered Camoufox is Python-only (no npm). Downgraded browser stack to `playwright-extra` + `puppeteer-extra-plugin-stealth` (Agent 3 said this gets detected in 2026, but for non-adversarial Linear it should hold; manual Save-Page-As fallback if not). Camoufox deferred to Round E when we have a real adversarial target. Parent repo already has `playwright`, `single-file-cli`, `sharp`, `pixelmatch`, `tsx` — only 3 new deps to install (`culori`, `ssim.js`, `odiff-bin`) + stealth packages.
- **v3.1 (2026-04-22)**: Re-added Vision layer to animation probe (user corrected: original insight was "AI can't read videos"; DOM-only API misses Canvas/WebGL/Lottie/Rive). Secondary Claude Vision layer on sampled video frames (~$0.30 extra, ~15 min extra).
- **v3 (2026-04-22, post-multi-review)**: Three independent agents audited v2 (strategy / redundancy / execution). Major changes:
  - **Tool count 10 → 5** (cut Bolt, 10Web, AnimSpec as redundant; cut `screenshot-to-code` in v2; cut `design-md-generator` as hue-redundant; Anima moved to optional Phase B)
  - **Camoufox** replaces `playwright-extra + stealth` (2026 new gold standard; old stack gets detected)
  - **SingleFile CLI + built-in Playwright HAR** replace custom MHTML script
  - **culori** replaces custom OKLCH delta-E
  - **ssim.js + sharp** replace custom image comparison
  - **Scoring scope trimmed to PRIMARY metrics only** (SSIM + OKLCH + animation count + format) — 10hr → 3-4hr
  - **Pre-committed decision tree** added (plan pre-decides action for each possible scorecard outcome)
  - **Kill criteria** added (per-tool $3 cap, Day 1 5hr cap, top-2 gap <20% = no Phase B)
  - **Round D → I roadmap** appended (connects this experiment to end-state vision)
  - **hue treated as semi-manual** (pre-answer script — see `prompts/hue-run.md`, 15-20 min wall-clock)
  - **Claude-naive/null concrete protocol** defined (Sonnet 4.5 not Opus; single page.tsx output; see `prompts/`)
- **v2 (2026-04-22)**: Post single-reviewer agent audit. Swapped screenshot-to-code for v0.dev; added hybrid animation probe; T0 snapshot; 7→3 dim scoring
- **v1 (2026-04-22)**: Initial plan

---

## Context

Sean is building an end-to-end website cloning pipeline. **North star**: *"Claude Code skill takes reference URL + brand brief, produces production-grade Next.js 16 + Tailwind v4 site on fresh Vercel deployment within 90 min — good enough that Source Code bills 2-week landing pages at 4-week quality."*

Round D is the **first** of ~6 rounds (D→I; see Roadmap at end). It establishes a quantified baseline: which existing tool is strongest at which dimension?

## Positioning

**Internal accelerator** for Source Code Intelligence (Sean + Kevin) + Mnemox internal tooling. **NOT outward SaaS**. Reasons: legal risk, low retention, integration > individual capability as moat.

## Goals

1. 3-dimension scorecard (Static / Dynamic / Practical) with **primary metrics only**
2. Identify capture-layer gaps — especially animations (the stated core concern)
3. Make a **pre-committed architectural decision** for Round E (see Decision Tree)
4. Establish a repeatable measurement framework for Round E onwards

## Success Criteria

Experiment succeeds if we can concretely answer:
- **Capture winner**: Which tool extracted the most?
- **Rebuild winner**: Which produced the most ship-able code?
- **Dynamic gap**: What % of animations did the best tool capture? (expected <50%)
- **Round E path**: Clear next-round architecture per the Decision Tree

---

## Target

**https://linear.app** (homepage, desktop 1440px primary)

Why: engineering reference point; Framer Motion-heavy (forces real animation capture); Cloudflare-protected (forces Camoufox validation); `hue` already has Linear as reference → cross-validation.

---

## T0 Snapshot Strategy

**Problem**: Live Linear.app introduces time-of-day / A-B test / Cloudflare variance. Tools that retry return inconsistent output.

**Solution**: Freeze Linear at T0, feed that snapshot to all open-source tools. SaaS tools fed live URL with timestamp recorded.

**Stack** (all off-the-shelf, no DIY):
- Browser: `playwright-extra` + `puppeteer-extra-plugin-stealth` (v3.2 downgrade — Camoufox is Python-only; stealth plugin is the pragmatic JS option for Round D's non-adversarial target; Camoufox via Python subprocess deferred to Round E)
- Single-file HTML + assets: [SingleFile CLI](https://github.com/gildas-lormeau/single-file-cli) — already in parent `package.json`
- HAR archive: `playwright.chromium.launchPersistentContext({ recordHar: ... })` (built-in, no dep)
- DOM + computed styles: Playwright `page.evaluate(() => serialize())` via custom 20-line script

**Output artifacts**:
- `target/snapshot-T0.html` (SingleFile output — full site inlined)
- `target/snapshot-T0.har`
- `target/dom-T0.json`
- `target/screenshots/{320,768,1024,1440,1920}.png`
- `target/recording-T0.mp4` (Playwright video; 30fps; 10s scripted scroll)
- `target/animations-T0.json` (see Probe below)

**Fallback if Camoufox fails**: Sean opens real Chrome manually → Save Page As "Webpage, Complete" → feed the file. Bulletproof manual path documented.

---

## Animation Probe (2-layer, v3.1)

Original v3 used only `document.getAnimations()`. That's DOM-level and misses Canvas/WebGL/Lottie/Rive/rAF-loops — exactly the "AI can't read video" gap Sean started with. v3.1 re-adds a Claude Vision secondary layer on sampled video frames.

### Layer 1 — DOM API (primary, precise)

`document.getAnimations()` via Playwright eval. Catches CSS animations + transitions + WAAPI + Framer Motion (when playing).

**Procedure** (in `scripts/probe-animations.mjs`):
1. Load target in Camoufox
2. `page.evaluate(() => document.getAnimations().map(...))` before any interaction → baseline
3. Scripted scroll 0% → 100% at 2s steps; after each step read animations and accumulate
4. For each `<button>`, `<a>`, `[role="button"]`: `page.hover()` → 500ms wait → read animations
5. For each `<input>`: `page.focus()` → read animations
6. Deduplicate by (target element path, property, keyframes)
7. Output → `target/animations-dom.json`

### Layer 2 — Claude Vision (secondary, visual coverage)

Sampled-frame vision analysis of the Playwright recording. Catches what DOM API misses: Canvas/WebGL shaders, Lottie/Rive, rAF transforms on non-Animation-tracked elements, parallax.

**Procedure** (in `scripts/probe-vision.mjs`):
1. Input: `target/recording-T0.mp4` (30fps × 10s scripted scroll = 300 frames)
2. Sample every 0.5s → **20 frames** saved to `target/frames/{00..19}.png`
3. Send frames in one Claude Sonnet 4.5 message with vision prompt (see below)
4. Parse response → structured animation inventory
5. Output → `target/animations-vision.json`

**Vision prompt** (pinned in `prompts/probe-vision.txt`, created in Step 1):
```
You are analyzing 20 frames from a 10-second screen recording of linear.app scrolling from top to bottom.

For each visual element that MOVES, CHANGES, or APPEARS across these frames, produce one entry in a JSON array with:
- element: brief description (e.g. "hero headline", "mesh gradient background", "feature card #2")
- motion_type: one of [fade, slide, scale, rotate, morph, parallax, shader/webgl, blur, color-shift, reveal, other]
- trigger: one of [on-load, scroll-in, scroll-out, hover, unknown]
- approximate_duration_ms: integer
- approximate_easing: one of [linear, ease-out, ease-in-out, spring, unknown]
- frames_involved: array of frame indices (0-19) where the animation is visible
- confidence: 0.0-1.0 (how sure you are this is a real animation, not a static element shown across frames)

Only output animations you're at least 0.5 confident about. Output strict JSON array, no commentary, no markdown fences.
```

### Layer merge

`scripts/merge-animations.mjs`:
- Read both JSON outputs
- For each Layer 2 entry, try to match to a Layer 1 entry by (element path similarity, trigger, duration ±30%)
- If matched → mark `provenance: ["dom", "vision"]`, `confidence: max`
- If Layer 2 only → mark `provenance: ["vision"]`, flag for review
- If Layer 1 only → mark `provenance: ["dom"]`
- Output → `target/animations-T0.json` (merged, deduplicated)

**Expected coverage (merged)**: CSS+WAAPI+Framer (100% via Layer 1), Canvas/WebGL/Lottie/rAF (estimated 70% via Layer 2, lower confidence), scroll-triggered-unfired (10% via Layer 2 hints from frames).

**Cost**: ~$0.30 (20 frames × Claude Sonnet 4.5 vision). Budget raised from $8 → $8.50.

**Limitation disclosed**: Vision layer can hallucinate — flagged by confidence score + `provenance`. Any Layer-2-only entry with confidence < 0.7 must be human-verified before scoring.

---

## Tool Lineup (5 tools, Phase A; 1 optional Phase B)

| # | Tool | Type | Input | Output | Automation |
|---|------|------|-------|--------|------------|
| **01** | `ai-website-cloner-template` v2 | Orchestrated LLM pipeline | URL | Next.js code | Full auto |
| **02** | `hue` skill | Claude interactive skill | URL | `design-model.yaml` + 4 preview HTMLs | **Semi-manual** (15-20 min, see `prompts/hue-run.md`) |
| **03** | **Claude-naive** | Pure LLM, URL+prompt | URL | Single `page.tsx` | Full auto (Sonnet 4.5 fresh session) |
| **04** | **Claude-null** | Pure LLM, screenshot-only control | 1440 screenshot | Single `page.tsx` | Full auto (Sonnet 4.5 fresh session) |
| **05** | **v0.dev** | SaaS LLM URL clone | URL | React/Next code | Sean: paste URL, 2 min |

### Optional Phase B
- **Anima Playground** — free tier, URL mode. Skip unless Phase A top-2 gap >20%.

### What Changed from v2 / Why

**Cut Bolt**: Prompt-descriptive not URL-cloner; ~zero new signal over v0.dev.
**Cut 10Web**: WordPress output already acknowledged as structurally losing Dim C.
**Cut AnimSpec**: 1 free analysis/device + video-to-spec not code; if we want animation semantic inventory, `document.getAnimations()` gives 80% at 0 cost.
**Cut design-md-generator**: High overlap with hue (both produce design-spec intermediates); hue is in-house and we need its specific output for Round E.

---

## Scoring Methodology — PRIMARY METRICS ONLY

Agent 2 found full scoring was **8-10 hours** (2 big debug pits: diff-dom normalization, `getAnimations()` returning empty). v3 cuts to **primary metrics only** — 3-4 hours. Sub-metrics (DOM tree-edit, pHash, scroll-trigger detail) deferred to Round E where they surface naturally.

### Dimension A — Static Fidelity (weight 1.0)

| Sub-metric | Method | Weight within A |
|------------|--------|-----------------|
| Visual similarity | **SSIM** via [`ssim.js`](https://www.npmjs.com/package/ssim.js) on 1440px rendering vs ground truth | 60% |
| Color accuracy | **OKLCH delta-E** via [`culori`](https://culorijs.org) `differenceCiede2000()` on extracted palette vs ground-truth palette | 40% |

**Skipped in v3** (deferred to Round E): pHash, typography per-element match, DOM tree-edit distance.

### Dimension B — Dynamic Fidelity (weight 1.5)

| Sub-metric | Method | Weight within B |
|------------|--------|-----------------|
| Animation count | `captured_animations / ground_truth_animations` (from `document.getAnimations()` probe) | 50% |
| Interaction presence | hover/focus states in output? (binary per CTA) | 50% |

**Skipped in v3**: duration delta, easing match, scroll-triggered detail.

### Dimension C — Practical Utility (weight 1.0)

| Sub-metric | Method | Weight within C |
|------------|--------|-----------------|
| Output format | React/Next=100, HTML=60, Spec-only=20, WP=40 | 50% |
| Ship-ability | Compiles? Renders without error? (binary scale) | 30% |
| Cost | Normalized against median of (time + API $) | 20% |

### Composite

```
overall = (static * 1.0 + dynamic * 1.5 + practical * 1.0) / 3.5
```

---

## Pre-Committed Decision Tree (new in v3)

Agent 1 critique: plan must pre-decide Round E architecture BEFORE scorecard results, so Sean doesn't drift post-hoc. Commit in writing here:

```
After Phase A scorecard:

IF cloner v2 wins BOTH Static AND Dynamic:
  → Round E = "Capture layer upgrade" on cloner v2
     (add Camoufox + getAnimations() probe + interaction state capture)
     Timeline: 3-4 days

ELIF v0.dev wins Practical AND Static ≥ 70:
  → Round E = "Two-stage pipeline"
     (v0.dev first-pass → cloner v2 refinement loop)
     Timeline: 2-3 days

ELIF hue wins Dynamic (unlikely but plausible):
  → Round E = "Design system first"
     (hue extract → DesignGraph → cloner v2 rebuild)
     Timeline: 4-5 days

ELIF all tools Dynamic < 50%:
  → Round E = "Dedicated animation extractor"
     (rrweb + getAnimations() + Playwright scripted replay → animation spec → code gen)
     Timeline: 5-7 days

ELIF top-2 gap on overall composite < 20%:
  → STOP.
     Pick whichever ships first. No Phase B. No Round E refinement needed.
     Roadmap jumps to Round F (code emitter on top of current best).
```

**Plan is only allowed to deviate from this tree if Sean explicitly overrides in writing.** Otherwise default is to follow.

---

## Kill Criteria (new in v3)

- **Per-tool API cap**: Single tool exceeds $3 API cost → stop that tool, score partial
- **Day 1 time cap**: Day 1 wall-clock exceeds 5 hours → checkpoint, don't drift to Day 2
- **Phase B gate**: If Phase A top-2 overall gap < 20% → **explicitly forbidden** to run Phase B (conclusion is already clear)
- **Experiment total cap**: Total API cost exceeds $8 → stop, write up partial scorecard

---

## Workspace Layout

```
experiments/round-d-linear/
├── PLAN.md                     # This document
├── README.md                   # Results summary (populated after Day 2)
├── .gitignore                  # Excludes heavy artifacts
├── prompts/
│   ├── claude-naive.txt        # Sonnet 4.5 URL-clone prompt
│   ├── claude-null.txt         # Sonnet 4.5 screenshot-only prompt
│   ├── hue-run.md              # Pre-answer script for hue 16 phases
│   └── probe-vision.txt        # Sonnet 4.5 vision prompt for animation extraction
├── target/
│   ├── snapshot-T0.html        # SingleFile output
│   ├── snapshot-T0.har
│   ├── dom-T0.json
│   ├── animations-T0.json
│   ├── recording-T0.mp4
│   └── screenshots/            # 320, 768, 1024, 1440, 1920
├── outputs/                    # Gitignored
│   ├── 01-cloner-v2/
│   ├── 02-hue/
│   ├── 03-claude-naive/
│   ├── 04-claude-null/
│   └── 05-v0dev/
├── evaluation/
│   ├── scorecard.md            # 3-dim × 5-tools
│   ├── gaps.md                 # Universal misses + disclosed biases
│   └── decision.md             # Which branch of Decision Tree fires
└── scripts/
    ├── snapshot-t0.mjs         # Camoufox + SingleFile + HAR + DOM dump + video (~80 lines)
    ├── probe-animations.mjs    # Layer 1 — document.getAnimations() + scripted interaction (~60 lines)
    ├── probe-vision.mjs        # Layer 2 — Claude Vision on 20 sampled video frames (~60 lines)
    ├── merge-animations.mjs    # Merge Layer 1 + Layer 2 → animations-T0.json (~40 lines)
    ├── score-static.mjs        # ssim.js + culori glue (~100 lines)
    ├── score-dynamic.mjs       # animation count + interaction state detection (~80 lines)
    ├── score-practical.mjs     # format + ship-ability + cost (~50 lines)
    └── compile-scorecard.mjs   # aggregate + weighted sum + markdown (~60 lines)
```

---

## Execution Steps

### Day 1 — Setup + Phase A + Primary Scoring (~5 hr target)

**Step 1: Setup (~30 min)**
1. Write `.gitignore` ✅
2. `npm install` in workspace: `camoufox-js`, `single-file-cli`, `@playwright/test`, `culori`, `ssim.js`, `sharp`, `odiff-bin`
3. `camoufox fetch` (download Firefox binary ~200MB)
4. Write `prompts/claude-naive.txt`, `prompts/claude-null.txt`, `prompts/hue-run.md` ✅ (done alongside PLAN.md v3)
5. Verify ANTHROPIC_API_KEY available

**Step 2: T0 Snapshot + 2-Layer Animation Probe (~35 min)**
1. Write `scripts/snapshot-t0.mjs` — Camoufox launch → SingleFile CLI → HAR record → DOM dump → video recording
2. Run against `https://linear.app`
3. Write `scripts/probe-animations.mjs` — `document.getAnimations()` + scripted interaction (Layer 1 DOM)
4. Run. Output → `target/animations-dom.json`
5. Write `scripts/probe-vision.mjs` — sample 20 frames from `recording-T0.mp4` → Claude Vision with `prompts/probe-vision.txt`
6. Run. Output → `target/animations-vision.json`
7. Write `scripts/merge-animations.mjs` → `target/animations-T0.json`
8. Manual spot-check: does merged output have ≥25 entries? Any Layer-2-only entries with conf < 0.7 → human review before scoring.

**Step 3: Phase A — 5 tools (~2.5 hr, serial)**
1. **Tool 01** cloner v2: `npx tsx tools/v2/pipeline.ts --url https://linear.app --out experiments/round-d-linear/outputs/01-cloner-v2/` — monitor cost; $3 kill switch
2. **Tool 02** hue: Open new Claude Code session, paste `prompts/hue-run.md` as script, walk through 16 phases (15-20 min), copy `~/.claude/skills/linear-design/*` → `outputs/02-hue/`
3. **Tool 03** Claude-naive: Fresh Claude session (Sonnet 4.5, no project context), paste `prompts/claude-naive.txt`, save response → `outputs/03-claude-naive/page.tsx` (10 min)
4. **Tool 04** Claude-null: Fresh Claude session (Sonnet 4.5), paste `prompts/claude-null.txt` + attach `target/screenshots/1440.png`, save response → `outputs/04-claude-null/page.tsx` (10 min)
5. **Tool 05** v0.dev: Sean opens v0.dev, pastes `https://linear.app`, exports → `outputs/05-v0dev/` (5 min)

**Step 4: Primary Scoring (~1.5 hr)**
1. Write + run `score-static.mjs` (SSIM + OKLCH) → per-tool static.json
2. Write + run `score-dynamic.mjs` (animation count + interaction presence) → per-tool dynamic.json
3. Write + run `score-practical.mjs` (format + ship-ability + cost) → per-tool practical.json
4. Write + run `compile-scorecard.mjs` → `evaluation/scorecard.md`

**Day 1 exit criteria**: `scorecard.md` exists with 3-dim × 5-tool table. **If exceeded 5 hr, stop here; Day 2 continues.**

### Day 2 — Decision Tree + Gap Analysis + Round E Plan (~2 hr)

**Step 5: Apply Decision Tree (~15 min)**
1. Read `scorecard.md`
2. Match results to pre-committed branches
3. Write `evaluation/decision.md` naming the selected branch + reasoning

**Step 6: Phase B ONLY IF Decision Tree says run it (~30-60 min)**
Anima only, conditional per Kill Criteria.

**Step 7: Gap Analysis (~30 min)**
Write `evaluation/gaps.md` — universal misses across all 5 tools, disclosed biases (ground-truth uses Playwright so cloner v2 has structural advantage).

**Step 8: Round E Plan (separate session, 24h later)**
Agent 1 correctly insisted: don't write Round E same-day. Sleep on scorecard, come back, write the Round E `PLAN.md` in new session.

---

## Risk Register (trimmed, v3)

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | playwright-extra+stealth blocked by Cloudflare | Medium (Agent 3 flagged as detected in 2026, but Linear likely has soft defenses) | Medium | Escalation: (a) try `rebrowser-patches` JS alternative; (b) manual Save Page As; (c) Python Camoufox subprocess (Round E) |
| R2 | `document.getAnimations()` returns empty | Medium | Medium | Trigger via scripted scroll/hover (already in probe) |
| R3 | hue pre-answer script mis-sequenced | Medium | Low | Test on dummy URL first (not Linear) |
| R4 | cloner v2 API cost >$3 | Medium | Medium | Per-tool $3 kill switch enforced in script |
| R5 | v0.dev changes output format week-to-week | Low | Low | Record timestamp + model version |
| R6 | Ground-truth bias (Playwright tools match Playwright ground truth) | Medium | Medium | Disclosed as limitation in `gaps.md` |
| R7 | Linear content changes mid-experiment | Low | Low | T0 snapshot prevents for open-source tools |
| R8 | Sonnet 4.5 rate limit during Claude-naive/null | Low | Low | Space runs by 2 min |
| R9 | Claude Vision hallucinates animations on Layer 2 | Medium | Low | Confidence threshold 0.7 + `provenance` tag; human review Layer-2-only entries |
| R10 | 20 frames insufficient for fast micro-interactions | Low | Low | Bump to 40 frames if probe returns <10 hover/tap animations |

---

## Deliverables

1. `target/` — Linear truth artifacts (reusable across rounds)
2. `outputs/*` — 5 tool outputs
3. `evaluation/scorecard.md` — 3-dim × 5-tool primary metrics
4. `evaluation/gaps.md` — Universal misses
5. `evaluation/decision.md` — Which Decision Tree branch fired
6. `README.md` — One-page summary with verdict

---

## Timeline

| Phase | Duration | Unattended? |
|-------|----------|-------------|
| Day 1 setup | 30 min | Yes |
| Day 1 snapshot + probe | 20 min | Yes |
| Day 1 Phase A (5 tools) | 2.5 hr | Mostly (hue 15-20 min manual; v0.dev 5 min manual) |
| Day 1 primary scoring | 1.5 hr | Yes |
| **Day 1 total** | **~4.5 hr** | ~80% unattended |
| Day 2 decision + gaps | 1 hr | Yes |
| Day 2 optional Phase B | 0-1 hr | Partial |
| **Day 2 total** | **~2 hr** | Mostly |
| Round E plan | Next session | Human |

**Budget**: $8.50 API total ($8 tools + $0.50 Vision probe), $3 per-tool kill.

---

## Round D → I Roadmap (from Agent 4 end-state audit)

| Round | Deliverable | Gates |
|-------|-------------|-------|
| **D (now)** | Baseline scorecard → Decision Tree fires → picks Round E path | Done when `decision.md` written |
| **E** | `DesignGraph` intermediate format (tokens + layout skeleton + motion map + asset manifest) | Any tool can emit/consume DesignGraph |
| **F** | Next.js 16 + Tailwind v4 emitter from DesignGraph (`/app` routes + shadcn + Framer Motion) | Linear clone hits ≥85% Round D scorecard |
| **G** ⭐ | Domain transfer (clone Raycast structure, reskin for fintech client brief) | **Usable on real Source Code client work** |
| **H** | Self-improvement loop (each client job diff → few-shot + failure taxonomy) | Tool improves without manual prompt engineering |
| **I** | Production hardening (Vercel deploy hook, visual regression, a11y gate, handoff docs) | Default Source Code landing-page workflow |

### Final Shape

- **Main engine**: Claude Code skill `~/.claude/skills/clone-site/` (pairs with superpowers)
- **Kevin's interface**: Internal Next.js dashboard on `sc-internal` Vercel project — paste URL + brief, watch preview URL materialize (triggers auto-claude worker under the hood)
- **Seed**: Private GitHub template (this `ai-website-cloner-template` repo)
- **No SaaS, no outward web app**

### Day-in-the-life (after Round G)

> Kevin: "client loves raycast.com, wants SaaS version, 2-week budget"
> Sean in client repo: `/clone-site raycast.com --brief ./client-brief.md`
> 3 min → `design-graph.json` + preview gallery
> Sean drops 2 unwanted sections + shifts brand teal → client purple
> `/clone-site continue` → 30 min scaffold → Vercel preview URL in terminal
> Side-by-side vs raycast.com, "hero parallax sluggish" → `/clone-site refine hero`
> 2-3 refine rounds → preview to Kevin → client edits copy (markdown) → ship

### Success KPIs (lagging)

- Landing-page project time **4 weeks → 10 days** (median across 5 jobs)
- Kevin closes **≥2 deals** because of same-day clone demo
- Client visual revisions **6 → ≤3 rounds**
- Generated components **≥60% unedited to prod**
- Sean's personal time on any landing page **≤6 hours**

---

## Open Questions

None critical. Defaults are safe. Ready to execute on confirmation.

---

## References

- [Camoufox](https://github.com/daijro/camoufox) — 2026 Cloudflare bypass standard
- [SingleFile CLI](https://github.com/gildas-lormeau/single-file-cli)
- [culori](https://culorijs.org) — OKLCH + delta-E
- [ssim.js](https://www.npmjs.com/package/ssim.js)
- [Design2Code](https://github.com/NoviScl/Design2Code) — methodology inspiration
- [rrweb](https://github.com/rrweb-io/rrweb) — deferred to Round E
