# Round D — AI Website Clone Tools Baseline (Linear.app)

> **One-page summary.** Full report: [REPORT.md](./REPORT.md) · Raw scorecard: [evaluation/scorecard.md](./evaluation/scorecard.md)

## TL;DR

4 個 SOTA AI 網站克隆工具對 Linear.app 量化對比。**全員 0/27 動畫捕捉**，證實「AI 不會讀動畫」是產業系統性盲點。Top 2 工具（Cloner v2 自家 / v0.dev 商業）差 1 分，技術互補。

| Rank | Tool | Static | Dynamic | Practical | **Overall** |
|:---:|:---|:---:|:---:|:---:|:---:|
| 🥇 | **Cloner v2** | 74 | **48** | 82 | **65** |
| 🥈 | v0.dev | **76** | 39 | 89 | **64** |
| 🥉 | Claude-naive | 72 | 37 | 94 | **63** |
| 4 | Claude-null | 47 | 38 | 95 | **57** |

## Key Findings

1. 🚨 **0/27 animations** captured — all 4 tools, 0 motion library imports, 0 CSS `@keyframes`
2. 🔑 **URL access value = +24 static** (naive 72 vs null 47; typography +20, visual +30)
3. 🤝 **Cloner v2 + v0.dev 技術互補** (color/dynamic vs layout/scaffold)
4. ✅ **2-layer animation probe 成功擷取 27 animations** (DOM 12 + Vision 15, 0 overlap) — Round E PoC

## Decision Tree Fires → Round E

**Branch ④**: all Dynamic < 50% → **Dedicated Animation Extractor** (5-7 days)

- Productionize 2-layer probe (DOM `getAnimations()` + Claude Vision)
- Build Framer Motion emitter (spec → motion.tsx)
- Integrate into cloner v2 capture layer
- Multi-site validation (Stripe, Raycast, Vercel, Apple)

## What's Here

```
experiments/round-d-linear/
├── README.md                   ← You are here
├── REPORT.md                   ← Full research report ⭐
├── PLAN.md                     ← Experiment plan (v1 → v3.2)
├── assets/                     ← Curated images for report (8 png)
├── target/                     ← Ground truth
│   ├── animations-T0.json      ← 27 merged animations
│   ├── snapshot-T0.har, dom-T0.json
│   ├── screenshots/ (5 breakpoints)
│   └── frames/ (20 scroll frames)
├── outputs/                    ← Per-tool outputs
│   ├── 01-cloner-v2/           (11 section.tsx, 1798 LOC)
│   ├── 03-claude-naive/        (410 LOC)
│   ├── 04-claude-null/         (475 LOC)
│   └── 05-v0dev/               (full Next.js project, 973 main LOC)
├── evaluation/
│   ├── scorecard.md            ← Final scoring
│   └── score-*.json            ← Per-dimension raw
├── prompts/                    ← All pinned LLM prompts
└── scripts/                    ← All runnable scripts
```

## Budget

- **API cost**: $1.02 / $8.50 budget (12%)
- **Wall-clock**: ~25 min pure execution (Day 1)

## Next

- [ ] **Round E**: Dedicated Animation Extractor (see REPORT.md §8)
- [ ] **Optional**: Tool 02 hue run (design system skill) — 不改變 Decision Tree，可延後

---

*Part of [`ai-website-cloner-template`](../..) · Internal accelerator for [Source Code Intelligence](https://source-code.tw)*
