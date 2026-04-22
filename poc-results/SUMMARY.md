# Round E Re-Pivot PoC Summary
Target: linear.app  |  Date: 2026-04-23

---

## Angle 1: JS AST Scraping
**Status: ⚠️ Partial**

Bundles scraped: **58**
Bundles with motion pattern hits: **18**
Total data points: **62**

Pattern distribution (top hits):
- `framer-motion-exit-key` — in `chunks/21664-4e9afd8514a15bf6.js`
- `framer-motion-whileInView` — in `chunks/21664-4e9afd8514a15bf6.js`
- `framer-motion-whileHover` — in `chunks/21664-4e9afd8514a15bf6.js`
- `framer-motion-animate-key` — in `chunks/40874-8997d1de5007d10e.js`
- `framer-motion-initial-key` — in `chunks/40874-8997d1de5007d10e.js`
- `keyframes-object` (4 hits) — in `chunks/21664-4e9afd8514a15bf6.js`
- `transition-duration` — scattered across 16 bundles

Sample finding: chunk `40874` contains literal `animate:{opacity:...}` and `initial:{opacity:...}` props — confirms Framer Motion v10+ usage with object syntax.

**Blocker:** `ANTHROPIC_API_KEY` not set in execution environment → LLM decode step errored for all 5 candidates. Regex structural patterns still returned valid signal without the LLM step.

**Assessment:** Regex heuristics work and confirm Framer Motion usage. Two specific bundles (`21664`, `40874`) are the highest-value targets for deeper decode. LLM step is optional enrichment, not required for PoC. Partial because LLM decode failed, not because signal is absent.

---

## Angle 2: Differential Reduced-Motion Rendering
**Status: ✅ Work**

Elements compared: **2072**
Elements with property delta: **17**
Reduce mode respected: **yes**

Property breakdown:
| Property | Elements affected |
|----------|----------------:|
| opacity | 17 |
| transform | 9 |
| filter | 9 |
| visibility | 9 |
| transition | 9 |
| animation / animationName / animationDuration | 9 |
| transitionProperty / transitionDuration | 9 |
| clipPath / backdropFilter / willChange | 9 |

Key findings:
1. **17 `span` elements** (selector `span.sc-d5151d0-0`) — exist under normal motion but are absent (empty computed style) under reduced motion. These are the animated word/character spans in the hero headline — Linear conditionally renders them.
2. **`circle.grid-dot-*-upDown` elements** — `opacity: 0.3` (normal) vs `opacity: 1` (reduced). Dot-grid animation uses CSS `@keyframes upDown` targeting opacity; reduced motion disables it and resets to static full opacity.

**Interpretation:** The 17-element delta is a clean list of elements that Linear's own CSS has marked as animated — no false positives. The `span.sc-d5151d0-0` discovery directly maps to the hero headline character animation confirmed by Angle 3.

---

## Angle 3: rAF Interception
**Status: ✅ Work**

Total rAF frames captured: **162**
Frames with inline style mutations: **33**
Unique elements with style mutation: **10**
`Element.animate` (WAAPI) calls: **37**

Time window clusters:
| Phase | Frames with mutation |
|-------|--------------------:|
| Load phase (0–2500ms) | 0 |
| Scroll phase (2500ms+) | 33 |

**Element.animate calls (ground truth — highest confidence):**

37 WAAPI calls all targeting the **hero headline** (`h1.sc-d5151d0-0.bgDIHX > span > span`):
- `opacity` — duration: 1000ms, easing: `cubic-bezier(0.25, 0.1, 0.25, 1)`
- `filter` — duration: 1000ms, easing: `cubic-bezier(0.25, 0.1, 0.25, 1)`
- `transform` — duration: 1000ms, easing: `cubic-bezier(0.25, 0.1, 0.25, 1)`

This is the **staggered word reveal animation** on the hero headline: each word fades in with `opacity` + `filter` blur + `transform` slide, 1s, staggered.

**rAF-driven CSS custom property mutations (scroll-driven parallax):**

| Element | CSS var mutated | Pattern |
|---------|----------------|---------|
| `div.Frame_shine__Ei3zB.Frame_shineInner__wPfoO` | `--mask-x`, `--mask-y` | Mouse-tracking sparkle/spotlight effect (18 frames) |
| `div.Frame_shine__Ei3zB.Frame_shineScroll__lRFOP` | `--mask-y` | Scroll-driven shine (10 frames) |
| `div.SlackIssue_slackBox__GIILV` | `--bg-offset-y` | Parallax bg offset (12 frames) |
| `div.Plan_initiativesBox__hyqkS` | `--bg-offset-y` | Parallax bg offset (12 frames) |
| `div.Build_cmdkContainer__hLqDY` | `--bg-offset-y` | Parallax bg offset (12 frames) |
| `div.Monitor_pulse__Nw2jL` | `--bg-offset-y` | Parallax bg offset (12 frames) |
| `div > div.Frame_frame__xbIar > div` | `opacity` | Fade-in via rAF (0→0.43, 3 frames) |

The `--bg-offset-y` pattern is a rAF-driven parallax: 6 section cards each update their background offset on scroll — **not** a Framer Motion animation, a custom scroll listener driving CSS vars.

**Time cluster note:** 0 frames in load phase is expected — Framer Motion's stagger animates on mount but uses WAAPI (captured in Element.animate, not rAF), not inline style mutation.

---

## Recommendation

**Productionize Angle 3 + Angle 1 in conjunction (≥2 sources agreement).**

### Why Angle 3 is the strongest single angle

`Element.animate` interception captures **causal, not correlational** evidence:
- The exact WAAPI call arguments (keyframes array, duration, easing) are the developer's intent made executable.
- No cross-validation needed — if `Element.animate` fires with `{opacity: 0→1}` on a selector, that selector **has** a fade animation. Zero ambiguity.
- Captures Framer Motion, React Spring, and any library that delegates to WAAPI (v10+ Framer does).
- rAF style mutation captures rAF-loop animations (GSAP, custom scroll drivers, CSS var updates) that WAAPI misses.

**Gap:** Angle 3 misses CSS-only animations (pure `@keyframes` triggered by class toggles with no JS). Those are covered by Angle 2.

### Why add Angle 1 as conjunction

Angle 1 (JS AST) provides **developer intent** — the JSX props like `whileInView:`, `initial:`, `exit:` tell you the *semantic* animation type (scroll-triggered fade-in vs hover-scale vs exit), not just the CSS value change. This maps to Framer Motion emitter spec fields directly.

### Why Angle 2 is supplementary (not primary)

Angle 2's 17-element delta is clean but limited:
- Only captures elements where Linear implemented `prefers-reduced-motion` CSS — misses any animation without that media query.
- Can't reconstruct duration/easing/keyframes — only tells you *which* properties differ.
- Useful as a **filter/confirmation layer**, not as a discovery source.

### Proposed conjunction rule for E-Pivot-v2

```
verified = angle3_element_animate_calls            # WAAPI ground truth
         ∪ (angle1_framer_bundle_hit               # source confirms FM usage
            ∩ angle3_raf_css_var_mutation)          # runtime confirms animation
         ∪ angle2_delta_elements                    # CSS media query confirmer
```

Confidence tiers:
- **High (ship)**: `Element.animate` call on element — `opacity`/`transform`/`filter` keyframes + duration
- **Medium (review)**: rAF CSS custom property mutation + Angle 1 bundle hit for same component
- **Low (skip for now)**: Angle 2 delta only — property diff confirmed but no keyframe data

### Technical gotchas discovered

1. **Linear uses WAAPI directly** (not rAF inline-style mutation) for its Framer Motion word animations — `Element.animate` interception is the right hook.
2. **CSS custom properties** (`--mask-x`, `--bg-offset-y`) carry parallax state via rAF loop — these are distinct from CSS-property animations and need separate treatment in the emitter.
3. **Angle 2 `span` elements absent in reduced mode** = conditional render, not `opacity:0` — these spans are removed from DOM, not hidden. Emitter needs to reproduce them as present but unanimated in reduced-motion branches.
4. **LLM decode API key** must be in env for Angle 1 enrichment step. Without it, regex alone still returns 62 valid data points — LLM is additive, not required.
