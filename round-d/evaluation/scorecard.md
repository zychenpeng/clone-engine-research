# Round D Scorecard — Linear.app Clone

**Generated:** 2026-04-22T06:34:39.456Z
**Target:** https://linear.app (homepage, 1440px)
**Ground truth:** 27 merged animations (DOM + Vision)

## Overall Ranking (weighted: Static×1.0 + Dynamic×1.5 + Practical×1.0)

| Rank | Tool | Static | Dynamic | Practical | **Overall** |
|------|------|--------|---------|-----------|-------------|
| 1 | `01-cloner-v2` | 74 | 48 | 82 | **65** |
| 2 | `05-v0dev` | 76 | 39 | 89 | **64** |
| 3 | `03-claude-naive` | 72 | 37 | 94 | **63** |
| 4 | `04-claude-null` | 47 | 38 | 95 | **57** |

## Static Fidelity (LLM-as-judge, Claude Sonnet 4.5 Vision)

| Tool | Visual | Color | Typography | Layout | Composite | Notes |
|------|--------|-------|------------|--------|-----------|-------|
| `01-cloner-v2` | 72 | 85 | 65 | 78 | **74** | Strong dark theme implementation with accurate color palette (blacks, grays, accent colors). Layout  |
| `05-v0dev` | 78 | 72 | 65 | 85 | **76** | Strong structural layout with correct sections (hero, features, operations, roadmap, agents, code re |
| `03-claude-naive` | 72 | 78 | 55 | 85 | **72** | Strong layout structure with appropriate sections (hero, features, command-line, testimonials, CTA,  |
| `04-claude-null` | 42 | 65 | 30 | 58 | **47** | Code captures basic dark theme and section structure, but misses Linear's precise spatial rhythm, ic |

## Dynamic Fidelity (static code analysis vs 27 ground-truth animations)

| Tool | Animations captured | vs Truth | Interactions | Composite |
|------|---------------------|----------|--------------|-----------|
| `01-cloner-v2` | 0 | 0% | 84 | **48** |
| `05-v0dev` | 0 | 0% | 36 | **39** |
| `03-claude-naive` | 0 | 0% | 29 | **37** |
| `04-claude-null` | 0 | 0% | 30 | **38** |

## Practical Utility

| Tool | Format | LOC | Cost | Composite |
|------|--------|-----|------|-----------|
| `01-cloner-v2` | react-multi-section | 1809 | n/a | **82** |
| `05-v0dev` | react-full-project | 973 | n/a | **89** |
| `03-claude-naive` | react-single-page | 410 | $0.115 | **94** |
| `04-claude-null` | react-single-page | 475 | $0.106 | **95** |

## Key Insights

- **Overall winner**: `01-cloner-v2` (65)
- **Static winner**: `05-v0dev` (76)
- **Dynamic winner**: `01-cloner-v2` (48)
- **Practical winner**: `04-claude-null` (95)
- **Best animation coverage**: 0% of 27 ground-truth animations
- ⚠️ **ALL tools under 50% animation coverage** — this is the stated core gap, confirmed quantitatively

See `score-static.json`, `score-dynamic.json`, `score-practical.json` for raw data.