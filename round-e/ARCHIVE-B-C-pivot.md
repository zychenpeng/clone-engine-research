# B+C Pivot Archive — rrweb-gated Vision (post-mortem)

**Attempt duration**: 2026-04-22 → 2026-04-23 (~1 day wall-clock)
**Commits**: `f2dc72e` → `2a544e7` (5 commits on main)
**Verdict**: Architecture insufficient. Files preserved as hallucination control group.
**Next**: Round E Re-Pivot to **Tier 1** (JS AST + Differential Render + rAF Intercept); new session takes over from main.

---

## 1. Origin

Phase E2 had shipped a 5-site Vision-based animation corpus (247 animations total) and passed it to Sean for the first human review. The review (REVIEW.md, 18-item Chinese spot-check form) came back **18/18 ❌ hallucinated**. Frame-diff analysis of the Round D raw frames confirmed every pixel change between consecutive scripted-scroll frames was explainable by the viewport moving past static content — no animation was required to explain the data.

Root cause established in `round-e/PIVOT.md` §1.3: Claude Sonnet 4.5 Vision systematically mislabels "content entering viewport via scroll" as "element fade-in animation" when given scripted-scroll frame sequences. This is methodology bias, not prompt bias — confidence filter at 0.85+ failed to catch it and neither did the newly added `direction` field in the prompt.

PIVOT.md enumerated 6 options (A–F). Sean picked **Option B + C hybrid**:

- **Option B**: Vision + DOM cross-validate — every Vision claim must have opacity/transform change evidence
- **Option C**: rrweb DOM mutation recorder — provides the objective evidence that Option B's rule needs

Expected outcome per PIVOT.md §4.1: hallucination rate < 10%. Timeline: 7 days → ~10-11 days with +3–4 day pivot cost. Budget impact: +$0.50, total $1.50 / $5.

---

## 2. Architecture design

```
[Layer 1] document.getAnimations()        unchanged — DOM API truth, no hallucination
                                          ↓
[Layer 2] rrweb DOM mutation recorder     NEW (E-Pivot.1)
                                          records style/attr/class mutations during
                                          the same scripted scroll + hover pass
                                          ↓
[Layer 3] Claude Vision                   demoted to candidate-only; verified=false
                                          by default; prompt + confidence filter unchanged
                                          ↓
[Layer 4] Cross-Validator                 NEW (E-Pivot.2) — promotes verified=true iff:
                                          (a) element path/class has ≥2 keyword overlap
                                              with Vision's prose
                                          (b) at least one matching mutation touched
                                              opacity / transform / filter / clip-path
                                              / translate / scale / rotate
                                          (c) mutation.t falls within ±500ms of the
                                              frame-mapped time window from Vision's
                                              frames_involved
```

Revised success metric in PIVOT.md §4.1:
- Linear Dynamic score 48 → **60-65** (down from the original 75 target)
- Honest trade-off: precision > recall ("寧願少但對，不要多但錯")

---

## 3. Phases executed

| Phase | Commit | Scope | Outcome |
|-------|--------|-------|---------|
| E-Pivot.1 | `410d4bb` | `extract-rrweb.mjs` + 21 unit tests + CLI integration | Live smoke on Linear: 1464 rrweb events, 302 processed mutations, **20 motion-prop mutations** — all clustered t=1422–5206ms (on-load phase). Scripted scroll began at t=6087ms; during scroll (6087–15729ms) only 1 motion mutation fired. Objectively confirmed Vision's scroll-in phantoms. |
| E-Pivot.2 | `c936c78` | `cross-validate.mjs` + 27 unit tests + merge default + matcher tightening (≥2 keyword overlap, post-smoke iteration in same commit) | Linear full 5-stage pipeline: **0/21 verified, 21 rejected** (16 × `no_motion_in_time_window` + 5 × `element_mismatch_in_window`). Matched Sean's 18/18 ❌ verdict. |
| E-Pivot.3 | `2a544e7` | Re-run 5 sites through the 5-stage pipeline + `analyze-pivot.mjs` + Chinese `REVIEW-pivot.md` | Corpus: 79 Vision candidates → **3 verified (3.8%)** all on Stripe, 76 rejected (55 × `element_mismatch` + 21 × `no_motion_in_window`). |

Skipped per Sean's 2026-04-23 verdict:
- **E-Pivot.4** (second human review) — Sean's final-verdict review delivered the result directly
- **Phase E3** (emitter) — never thawed from its frozen state

---

## 4. Final review verdict (2026-04-23)

Sean reviewed `round-e/ground-truth/REVIEW-pivot.md` (418 lines; 3 VERIFIED items + 25 REJECTED samples). The VERIFIED section failed first, so REJECTED false-negative adjudication was not exhaustively completed.

**Key finding — 3/3 Stripe VERIFIED entries are keyword-collision false positives:**

| Verdict in REVIEW-pivot.md | Actual (Sean) |
|---|---|
| V1: "usage meter bar chart animation in 'Enable any billing model' card" — matched rrweb mutation at t=4556ms, opacity+transform on section container | ❌ hallucination |
| V2: "particle circle animation in 'Monetize through agentic commerce' card" — matched same mutation as V1 | ❌ hallucination (same mutation re-used) |
| V3: "gradient background in 'Make your SaaS platform' section" — matched different mutation at t=8672ms on business-sizes-section | ❌ hallucination |

All three collide on the word "section" (and variants like "container") appearing in both Vision's prose and Stripe's CSS Modules class names. The ≥2-keyword-overlap tightening we shipped in E-Pivot.2 was not enough because structural vocabulary provides the second word too easily.

**Combined hallucination rate:**
- E2 raw Vision sample: 18/18 ❌ = 100%
- E-Pivot.3 post-cross-validation verified set: 3/3 ❌ = 100%

PIVOT.md §4.1 target ("< 10% hallucination") not met. Architecture fails.

---

## 5. Root cause — why rrweb cross-validator is insufficient

**rrweb provides correlational evidence, not causal evidence.**

- What rrweb tells you: "between timestamps t₁ and t₂, some element X mutated its opacity / transform / filter."
- What verification requires: "Vision's textual description V refers to the same element X as rrweb's report."
- rrweb alone cannot bridge that gap. External **element identity matching** is required.

Keyword overlap is the only tractable matching path between Vision's English prose and rrweb's selector strings, and it fails both ways:

- **Loose match** (≥1 shared word, what we shipped initially in E-Pivot.2 pre-tightening): "section" or "container" hit nearly every path → false positives dominate (observed: 2/21 verified with obviously wrong matches).
- **Strict match** (≥2 shared words, what we shipped finally): still permits structural-word collisions. Stripe's `section-container.section-root` has enough generic tokens to collide with any Vision element text that mentions "section".

Paths attempted beyond ≥2 keywords, all rejected as dead ends:

- **Full selector path match** — modern build tools (CSS Modules, CSS-in-JS, Next.js class-name hashing) produce opaque tokens like `Layout_container__BVtmP`. Vision prose cannot emit such tokens. All 5 sites would collapse to 0 verified, equivalent to dropping the Vision layer entirely.
- **Vision prose → semantic selector mapping** — requires DOM class names to be semantic, contradicted by the same build-tool hashing problem.
- **LLM semantic embedding matching** — expensive, and reintroduces the hallucination class we were trying to avoid.

**Conclusion**: using Vision as the primary truth source with any post-hoc gate is structurally doomed. The next attempt has to change the **source**, not the gate.

---

## 6. What's preserved (nothing deleted)

Sean's instruction: "所有 file 保留不刪 (outputs/animations/REVIEW*/PIVOT.md 全部不動). 所有 B+C 產物當 hallucination 對照組保存."

### Code (still tracked, still runnable via `npm run cli …`)

| Path | Role in B+C | Reuse potential for Re-Pivot |
|------|-------------|-------------------------------|
| `tools/animation-extractor/extract-rrweb.mjs` | Layer 2 rrweb recorder | rrweb infra (IIFE injection, Date.now alignment, motion-prop classifier) is reusable by Tier 1.c rAF Intercept for the non-DOM-mutation animations |
| `tools/animation-extractor/cross-validate.mjs` | Layer 4 rule engine | Pure helpers `extractKeywords`, `matchElement`, `computeTimeWindow` may be reused for Re-Pivot's conjunction rule across 3 tiers |
| `tools/animation-extractor/extract-dom.mjs` | Layer 1 | Unchanged need |
| `tools/animation-extractor/extract-vision.mjs` | Layer 3 | Becomes optional 4th tier at lowest weight |
| `tools/animation-extractor/schema.ts` | Canonical `AnimationSpec` | Unchanged need |
| `tools/animation-extractor/cli.mjs` | 5-stage orchestrator with `--skip-*` flags | Pattern carries over to Re-Pivot's N-stage pipeline |
| `tools/animation-extractor/test/*` | 80 unit tests, all green | None asserts Vision truth; carry over |

### Data (control-group corpus)

| Path | Purpose |
|------|---------|
| `round-e/ground-truth/{linear,stripe,raycast,vercel,apple}.com.json` | Phase E2 raw-Vision corpus (247 animations). **Hallucination baseline #1.** |
| `round-e/ground-truth/pivot/{site}.spec.json` × 5 | E-Pivot.3 post-gate specs. **Hallucination baseline #2** (post-rrweb-gate, still failed). |
| `round-e/ground-truth/pivot/{site}.audit.json` × 5 | Full cross-validation verdict trail per candidate. Primary data for §5 root cause analysis. |
| `round-e/ground-truth/summary.json` | Phase E2 aggregate stats |
| `round-e/ground-truth/summary-pivot.json` | E-Pivot.3 aggregate stats + E2 comparison |
| `round-e/ground-truth/REVIEW.md` | First-round human review form (Phase E2). Preserved with Sean's 18/18 ❌ markings. |
| `round-e/ground-truth/REVIEW-pivot.md` | Second-round review form. Now contains Sean's Final Verdict section (2026-04-23). |

When Re-Pivot Tier 1 lands and produces its own corpus, compare against these two baselines to prove: fewer animations, higher precision.

### Round-E-level narrative docs

| Path | Purpose |
|------|---------|
| `round-e/PLAN.md` | Original pre-pivot plan. Preserved for historical context. |
| `round-e/PIVOT.md` | B+C option selection + architecture + goals. Preserved. |
| `round-e/ARCHIVE-B-C-pivot.md` | **This file.** Post-mortem + forward pointers. |

---

## 7. Pointers forward (Re-Pivot Tier 1 — not started)

Sean's direction per REVIEW-pivot.md Final Verdict: three independent evidence sources with **conjunction gating** — an animation claim earns verified status iff ≥2 of the three tiers agree. Vision, if present, is a 4th low-weight tier.

| Tier | Technique | Catches | Anti-hallucination stance |
|------|-----------|---------|---------------------------|
| **1.a JS AST** | Static analysis of loaded JS bundles (`acorn` / `@babel/parser`) for `framer-motion` / `gsap` / `motion` / `lottie` / `@react-spring` API call sites + parameters | Declarative animation *intent* at source level | High — code is the ground truth |
| **1.b Differential Render** | High-FPS Playwright screenshot sequence, mask predicted scroll flow, return residual pixel changes | Real visual motion *not* attributable to scrolling | Medium — still visual but scroll-controlled |
| **1.c rAF Intercept** | Monkey-patch `requestAnimationFrame`, `Element.animate()`, CSSStyleDeclaration setters from a page init script; record caller stack + affected element | CSS keyframes, WAAPI, canvas, shader — actual runtime render events | High — runtime call trace is callable-addressed |

**Entry point for the new session:** `C:/Users/johns/projects/clone-engine-research/round-e/` — read in order:

1. `PIVOT.md` (why we pivoted off raw Vision)
2. `ARCHIVE-B-C-pivot.md` (this file — why B+C also failed)
3. `ground-truth/REVIEW-pivot.md` §"Sean Final Verdict" (the explicit direction)

Do **not** resume `tools/motion-emitter/` work. Do **not** resume any Vision-as-primary flow. Do **not** try to re-tune `cross-validate.mjs` keyword thresholds — the class of approach is exhausted.

---

## 8. Lessons for future pivots

1. **Sample adjudication before scaling.** Round D published "27 animations captured" without per-item human validation; Phase E2 then scaled to 247 before the 18/18 review exposed 100% hallucination. Always ship an ≤20-item human review form **in the same sprint as the methodology PoC**, not a round later.

2. **Correlational evidence ≠ causal evidence.** rrweb tells you something mutated; it doesn't tell you the subject of a linguistic description is that something. Whenever gating an LLM's output with an external signal, explicitly ask: "does my signal source identify the same entity the LLM is describing?" If the answer needs fuzzy matching across vocabularies, the gate will leak.

3. **Structural vocabulary pollutes matches at both ends.** Generic words ("section", "container", "item", "box", "root") appear in both LLM prose and CSS class names. Even ≥2-keyword thresholds produce collisions. Either strip them aggressively as stop-words or use non-text matching.

4. **Compiled class names are opaque on purpose.** CSS Modules / CSS-in-JS / Next.js's build-time class hashing means DOM selectors don't carry semantic content that can be aligned with English prose. Any approach relying on post-hoc reading of class names to infer "what this element is" is structurally brittle.

5. **Multi-source conjunction beats single-source strict gating.** When one signal source can be fooled, requiring 2+ independent sources to agree is often the only path to high precision without collapsing recall to zero. This is Re-Pivot Tier 1's bet.

6. **Budget the archive.** One day of B+C development consumed ~$1.23 of the $5 Round E budget. Archiving the attempt takes under an hour and produces regression material the next attempt can measure against. Don't skip the post-mortem even when the pivot fails cleanly.

---

*B+C pivot ends 2026-04-23. No code deleted. Re-Pivot Tier 1 is a new session's problem.*
