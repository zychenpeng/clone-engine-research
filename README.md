# Clone Engine Research

> Benchmarking and building an AI-driven website cloning pipeline with full animation fidelity. Internal research lab for [Source Code Intelligence](https://source-code.tw).

## What's here

This repository documents rounds of experiments to answer one question:

> **Can AI clone a production website — including its animations — into pixel-perfect Next.js code, in minutes?**

State of the art (2026-04): **no**. We're building it.

## Rounds

| Round | Focus | Status |
|:---:|:---|:---:|
| [D](./round-d/) | Baseline comparison (4 tools × Linear.app) | ✅ Complete |
| [E](./round-e/) | Dedicated Animation Extractor | 📝 Planning |
| F | Next.js 16 + Tailwind v4 emitter | ⏳ Pending |
| G | Domain transfer (clone X, reskin for Y) | ⏳ Pending |
| H | Self-improvement loop | ⏳ Pending |
| I | Production hardening | ⏳ Pending |

## Round D Headline Result

**0 / 27 animations captured** across all 4 SOTA tools (Cloner v2, v0.dev, Claude-naive, Claude-null).

All tools hit 47-76% static fidelity but **none** produced any motion library imports, CSS `@keyframes`, or animation components. This is not a single-tool bug — it's a systemic industry blind spot.

| Rank | Tool | Static | Dynamic | Practical | Overall |
|:---:|:---|:---:|:---:|:---:|:---:|
| 🥇 | Cloner v2 (self-built) | 74 | 48 | 82 | 65 |
| 🥈 | v0.dev | 76 | 39 | 89 | 64 |
| 🥉 | Claude-naive (URL+prompt) | 72 | 37 | 94 | 63 |
| 4 | Claude-null (screenshot-only) | 47 | 38 | 95 | 57 |

Full scorecard + methodology: [round-d/REPORT.md](./round-d/REPORT.md)

## Methodology Contribution

**2-layer hybrid animation probe**:
- Layer 1: `document.getAnimations()` via Playwright with scripted scroll+hover
- Layer 2: Claude Sonnet 4.5 Vision on 20 sampled frames
- Merge rule: fuzzy match by element keyword + duration ±30%

First run on Linear.app yielded 27 unique animations (12 DOM + 15 Vision, **0 overlap** — layers capture orthogonal phenomena). This is the PoC for Round E's extractor.

## North Star

> A Claude Code skill that takes a reference URL + brand brief and produces a production-grade Next.js 16 + Tailwind v4 site on Vercel in 90 minutes — good enough that Source Code Intelligence bills 2-week landing pages at 4-week quality.

## Positioning

**Internal accelerator**, not outward SaaS. Rationale:
- Legal risk (copyright + phishing enablement)
- Low retention (one-shot need)
- Integration is the moat, not individual capabilities

## How to reproduce Round D

See [round-d/REPORT.md § Appendix C](./round-d/REPORT.md#附錄-c-再現性).

## License

TBD. Not open source for now — internal research docs.

## Authors

- Sean (@zychenpeng) — Mnemox AI / Source Code Intelligence
- With Claude Sonnet 4.5 as implementation partner

---

*Research in public. Plans evolve each round. See each round's `PLAN.md` changelog for decision history.*
