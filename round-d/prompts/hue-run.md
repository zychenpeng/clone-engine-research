# Hue Pre-Answer Script — Linear.app Clone Run

**Purpose**: hue skill has 16 interactive phases. To use it as a batch tool in Round D, we pre-answer every gate here. Start a fresh Claude Code session and work through this script top-to-bottom.

**Expected wall-clock**: 15-20 min total. Most time is hue's generation steps — not our typing.

---

## Session start

**Paste to Claude**:
```
Use the hue skill on the brand: linear.app

I want you to generate a complete design skill at ~/.claude/skills/linear-design/ including all 4 HTML visual outputs (preview.html, component-library.html, landing-page.html, app-screen.html).

Below I'll pre-answer every phase gate so you don't need to ask. Treat this as a batch run.
```

## Phase 1 — Input Analysis (URL)

When hue says *"I found [url] — is this the right one?"*:

**Answer**: `Yes, https://linear.app is correct. Proceed with URL analysis path.`

If hue asks about Chrome DevTools MCP:
**Answer**: `If available use Chrome DevTools MCP. If not, proceed with WebFetch and flag reduced confidence as the skill instructs.`

## Phase 2 — Component Inventory

If hue asks for clarification on any tear-down sheet:
**Answer**: `Use your best judgment. Reference Linear's actual UI (buttons, cards, inputs, nav, tags, overlays). For components Linear doesn't have (e.g. toggle switches if absent), derive with explicit justification.`

## Phase 3 — Icon Kit Selection

If hue asks to confirm icon kit pick:
**Answer**: `Approved. Go with your top pick per the match profile in references/icon-kits.md. For Linear (thin-stroke, humanist geometric icons), Phosphor regular or Lucide are both acceptable — choose the closer match.`

## Phase 4 — Hero Stage Analysis

If hue presents hero stage dials for approval:
**Answer**: `Approved as-is. Linear's hero uses a subtle mesh gradient with a floating app window mockup offset to the right — classic "device-on-mesh" preset. Go with subject: device, relation: shadow-only or flat, bleed: low. Do not invent animations beyond what's observed.`

## Phase 5 — Confirm Direction

When hue presents 2-3 sentence direction summary:
**Answer**: `Approved. Proceed.`

## Phase 6 — Token Preview

When hue presents core tokens for final check:
**Answer**: `Approved. Proceed to generation.`

## Phases 7-13 — Generation (auto)

Hue will write `design-model.yaml`, `SKILL.md`, `references/`, `preview.html`, `component-library.html`, `landing-page.html`, `app-screen.html`. No interaction needed; monitor for errors.

## Phase 14 — Self-Validation

If hue flags any self-validation issues:
**Answer**: `Fix them and re-validate. Do not show me the issues — just fix and move on.`

## Phase 15 — Offer Iteration

When hue asks if you want adjustments:
**Answer**: `No iteration needed. This is a baseline run for experiment purposes. Skip to phase 16.`

## Phase 16 — Installation Reminder

Hue will print the restart reminder. Acknowledge and close.

---

## After hue finishes

1. Verify `~/.claude/skills/linear-design/` exists with all 4 HTMLs
2. Copy to workspace:
   ```bash
   cp -r ~/.claude/skills/linear-design/* \
     C:/Users/johns/projects/ai-website-cloner-template/experiments/round-d-linear/outputs/02-hue/
   ```
3. Record the wall-clock time in `outputs/02-hue/_run-metadata.txt`

## Risks / Recovery

- **If hue asks a question not covered above**: Answer `Use your best judgment per the SKILL.md, skip asking me, proceed with defaults.`
- **If hue mid-run asks to confirm a low-confidence color extraction**: Answer `Accept your best guess, flag in disclaimer section, continue.`
- **If hue errors out mid-phase**: Note the phase + error in run metadata. Do not retry more than once.
- **If this takes >25 min wall-clock**: Checkpoint. Skip to what's done. Don't let one tool burn Day 1.
