# Phase E2 Ground-Truth Review

Generated: 2026-04-22T09:38:04.651Z

> For each spot-check item below, mark ✅ (correct) / ⚠️ (partially) / ❌ (wrong) in this file and re-commit.

## Per-site Summary

| Site | Total | DOM | Vision | Both | Top MotionType | Avg Conf | Cost |
|------|------:|----:|-------:|-----:|:---------------|---------:|-----:|
| linear.app | 35 | 12 | 23 | 0 | fade-in (21) | 0.901 | $0.1312 |
| stripe.com | 111 | 95 | 12 | 4 | one-shot (95) | 0.968 | $0.1223 |
| raycast.com | 50 | 18 | 25 | 7 | fade-in (22) | 0.866 | $0.1407 |
| vercel.com | 25 | 5 | 16 | 4 | reveal-on-scroll (5) | 0.856 | $0.1273 |
| apple.com/mac | 26 | 18 | 5 | 3 | one-shot (17) | 0.968 | $0.1080 |

**Grand total**: 247 animations, 18 overlap, **$0.6296** vision cost

> Budget reminder: PLAN §13 allocates $5 for Round E. Phase E2 used 12.6%.

## ⚠️ 0-Overlap Anomaly on Linear

Linear is the **only** site with `by_provenance.both = 0`. The other 4 sites show 3–7 overlap entries each.
Root cause hypothesis: Linear's DOM animations are almost all `iterations=null` continuous loops at 1750–3200ms, while Vision captures scroll-triggered reveals at ~600ms. The ±30% duration window cannot bridge that gap.
**Action (Sean's note)**: revisit `merge.mjs` fuzzy match before Phase E3 — relax to keyword-only match when Vision's `trigger` is scroll-* (DOM rarely has scroll trigger semantics anyway).

---
## 🆕 Linear — 10 entries new in Round E vs Round D ground-truth

Round D captured 27 animations (12 DOM + 15 Vision). Round E Vision captures 23 entries; 13 overlap by text with Round D (Jaccard ≥ 0.15), **10 are candidate new**.
For each: was the animation really there in Round D too (we missed it), or is Round E Vision hallucinating?

### L1. `anim-21a33892`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 500ms / conf=0.80 · frames 1,2
  element: Heading 'A new species of product tool'

### L2. `anim-5fc3add8`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 700ms / conf=0.90 · frames 2,3
  element: Three isometric 3D figures (FIG 0.2, FIG 0.3, FIG 0.4)

### L3. `anim-70f2330c`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 600ms / conf=0.85 · frames 3,4
  element: Section 'Make product operations self-driving'

### L4. `anim-fc61e00f`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 600ms / conf=0.85 · frames 4,5
  element: Issue intake board with Todo and In Progress columns

### L5. `anim-2717ef9f`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 400ms / conf=0.75 · frames 5
  element: Navigation items '1.1 Linear Agent', '1.2 Triage', '1.3 Customer Requests', '1.4 Linear Asks'

### L6. `anim-e88a5517`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 600ms / conf=0.85 · frames 5,6
  element: Section 'Define the product direction'

### L7. `anim-f56e98dc`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 400ms / conf=0.75 · frames 9,10
  element: Navigation items '3.1 Issues', '3.2 Agents', '3.3 Linear MCP', '3.4 Git automations', '3.5 Cycles'

### L8. `anim-006f7f7f`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 600ms / conf=0.85 · frames 10
  element: Section 'Review PRs and agent output'

### L9. `anim-f0b3a605`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 600ms / conf=0.85 · frames 12
  element: Section 'Understand progress at scale'

### L10. `anim-62e18b52`  [ ] ✅ real [ ] ⚠️ partial [ ] ❌ hallucinated
**fade-in** / scroll-in / 600ms / conf=0.85 · frames 14,15
  element: Changelog section with four cards

---
## 🔬 Cross-site spot-check (2 per site)

### stripe.com
**stripe.com #1** (overlap)  [ ] ✅ [ ] ⚠️ [ ] ❌
**shader-ambient** / continuous / 11950.000000000002ms / conf=0.95 · frames 0,1,2,3,4…
  element: hero mesh gradient background <code>div.platform-graphic-browser-content > div.platform-graphic-browser-cards > div.</code>

**stripe.com #2** (vision-only)  [ ] ✅ [ ] ⚠️ [ ] ❌
**slide-left** / continuous / 10000ms / conf=0.90 · frames 0,1,2,3,4…
  element: Company logo carousel (amazon, nvidia, ford, coinbase, google, shopify, mindbody)

### raycast.com
**raycast.com #1** (overlap)  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-in** / on-load / 1000ms / conf=0.90 · frames 0
  element: Hero red diagonal stripes background <code>div#root > div.page_hero__Dwaih > div.page_heroText___VRvH.page_fadeInUp__yDeSr</code>

**raycast.com #2** (vision-only)  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-in** / on-load / 600ms / conf=0.90 · frames 0
  element: Main hero text 'Your shortcut to everything.'

### vercel.com
**vercel.com #1** (overlap)  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-out** / scroll-out / 300ms / conf=0.90 · frames 0,1
  element: Banner 'Vercel April 2026 security incident' + 'Read the bulletin' button <code>div.w-full.aspect-[802/402] > div.globe-module__QBqKTa__globe > div.globe-module</code>

**vercel.com #2** (vision-only)  [ ] ✅ [ ] ⚠️ [ ] ❌
**reveal-on-scroll** / scroll-in / 600ms / conf=0.90 · frames 11,12
  element: AI Gateway code editor section with syntax highlighting

### apple.com/mac
**apple.com/mac #1** (overlap)  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-in** / scroll-in / 700ms / conf=0.90 · frames 6,7
  element: Help me choose interactive section with colorful hello text and Mac illustrations <code>nav.ChapterNav_chapternav__F68Cm.ChapterNavSection_chapterNav__kIfth > div.Chapt</code>

**apple.com/mac #2** (vision-only)  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-up** / scroll-in / 800ms / conf=0.92 · frames 4,5
  element: Get to know Mac feature cards (Performance, AI, macOS)

---
## Phase E3 Prerequisites

Per Sean's Day-2 review note, before Phase E3 starts:

- [ ] Revisit `tools/animation-extractor/merge.mjs` fuzzy match — relax beyond ±30% duration when Vision trigger is `scroll-*` (DOM rarely knows scroll semantics)
- [ ] Consider a second match pass: selector-tag vs element-role overlap (e.g. `<h1>` selectors should match Vision entries labelled "headline")
- [ ] Add unit test for the relaxed rule before touching live specs
