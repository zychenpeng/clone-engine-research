# Round E PIVOT — Vision Layer Systematic Hallucination Discovered

**Date**: 2026-04-22
**Triggered by**: Sean's 45-minute human review of Phase E2 `REVIEW.md`
**Verdict**: 18/18 items ❌ hallucinated → Round E architecture must pivot

---

## 1. Finding（本 Round 迄今最重要 insight）

### 1.1 Sean's Review Result

對 Phase E2 產出的 18 個 spot-check items（10 Linear 新增 + 8 跨站 sample）：

| Classification | Count | Ratio |
|----------------|------:|------:|
| ✅ Real animation | 0 | 0% |
| ⚠️ Partially correct | 0 | 0% |
| ❌ Hallucination | **18** | **100%** |

**所有項目都是 Claude Vision layer 幻覺**，包含 `confidence=0.85-0.92` 的高信度項。

### 1.2 Objective Validation via Frame Diff

使用 Round D 既有的 20 frames 跑 pixel diff（consecutive frames）：

| Frame pair | % pixels changed | Interpretation |
|-----------|-----------------:|----------------|
| 00 → 01 | 39.3% | 正常 scroll + 新內容 viewport 進入 |
| 01 → 02 | 45.4% | 同上 |
| 02 → 03 | 17.8% | 正常 scroll |
| 03 → 04 | 9.2% | 偏低，近似靜止 |
| 05 → 06 | 17.3% | 正常 |
| 14 → 15 | 7.8% | 接近靜止 |

**結論**：所有 frame-to-frame 變化都可以被「scroll viewport 進出 + 無動畫靜態內容」完美解釋。**不需要假設有動畫**就能解釋數據。

### 1.3 Vision Layer Failure Mode（關鍵 insight）

```
Vision 看到:
  Frame N:   Element A 不在畫面
  Frame N+1: Element A 在畫面

Vision 推測: "Element A has fade-in animation with scroll-in trigger"

實際:
  Element A 始終 opacity=1, transform=none
  僅因為 window.scrollY 增加使其進入 viewport
  這不是動畫，是 scroll 本身
```

Vision 系統性地把「**element enters viewport via scroll**」誤判為「**element has its own fade-in animation**」。

**關鍵**：這不是 prompt engineering 問題：
- Confidence filter (≥0.7) 無效 — 幻覺項信心已 0.85+
- 加入 "direction" 欄位無效 — Phase E2 已加，仍 100% 幻覺
- 這是 vision model 對「靜態內容 vs 動態動畫」的**本質認知限制**

### 1.4 Why This Wasn't Caught in Round D

Round D 報告宣稱「2-layer probe 抓到 27 animations」— **但從未人工驗證這 27 個是不是真的**。Round D 把 extraction count 當品質指標，沒做 ground-truth 驗證。

**這是 Round D 的 methodology bug**，現在補驗證了，才發現 Vision 的 15 個裡面可能大多也是幻覺（Round E 新增的 10 個全錯，Round D 舊的 15 個可能也大多是假的 — 需要後續補 review）。

---

## 2. Pivot Decision: B + C Hybrid

Sean 選定（5 個 options 中）：

- **B**: Vision + DOM cross-validate — Vision 抓到的動畫必須有對應 CSS `opacity`/`transform` 變化證據
- **C**: rrweb 錄 DOM mutation — 錄 scroll 過程 CSSOM 實際變化，比 Vision 客觀

### 為什麼 B+C 最合理

- B 和 C 是**同一方向的兩半**：B 是規則（必須有證據），C 是證據提供者（rrweb 錄變化）
- 合併後：**rrweb 提供 DOM mutation 證據，cross-validator 用證據決定 Vision 候選 accept/reject**
- 徹底解掉 1.3 節的 failure mode：如果元素 opacity/transform 沒變，rrweb 不會記錄 mutation → Vision 宣稱的 "fade-in" 必 reject

---

## 3. Revised Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Round E Pivot Architecture — rrweb-validated Extraction  │
│                                                            │
│  [Layer 1] document.getAnimations() — UNCHANGED            │
│    Direct Web Animations API, precise, no hallucination    │
│    Output: 12 animations for Linear (robust baseline)      │
│                          ↓                                 │
│  [Layer 2] rrweb Mutation Recorder — NEW                   │
│    During scripted scroll + hover + focus:                 │
│    - Record every style / attribute / class mutation       │
│    - Record CSSOM rule changes                             │
│    - Playwright evaluate scoping, no live replay needed    │
│    Output: mutation-log.json (diffable stream)             │
│                          ↓                                 │
│  [Layer 3] Claude Vision — RE-PURPOSED AS CANDIDATE ONLY   │
│    Vision produces: candidate animation spec entries       │
│    Every entry tagged `verified=false` by default          │
│                          ↓                                 │
│  [Layer 4] Cross-Validator — NEW (the critical component)  │
│    For each Vision candidate:                              │
│    - Search mutation-log for element (by selector/keyword) │
│    - Required evidence (all must hold):                    │
│      a. element exists in mutation log                     │
│      b. has opacity OR transform OR filter mutation        │
│      c. mutation timing within ±500ms of claimed trigger   │
│    - If all pass → promote to `verified=true`              │
│    - If any fail → demote to `rejected`, log reason        │
│    Output: verified-spec.json + rejected.json              │
│                          ↓                                 │
│  Final: animation-spec.json                                │
│    { verified: [...], rejected: [...] }                    │
│    Only `verified` feeds into Framer Motion emitter.       │
└───────────────────────────────────────────────────────────┘
```

### Key design principles

1. **Pessimistic default**: Vision candidates 默認 `verified=false`，必須 earn verified status
2. **Explainable rejection**: `rejected.json` 說明為何每個 Vision claim 被拒（沒找到元素 / 無 opacity 變化 / timing 不對）— 用來後續調 prompt
3. **DOM Layer 1 unchanged**: `document.getAnimations()` 結果直接 accept（API-level truth, no hallucination）
4. **WebGL still unsolved**: rrweb 不會抓到 `<canvas>` 內部的 shader 變化 — Stripe/Linear 的 WebGL mesh 仍漏（known limitation, 放 Round G+）

---

## 4. Revised Goals & Timeline

### 4.1 New Success Metric

**原計畫**：Linear Dynamic score 48 → **≥ 75**
**修正後**：Linear Dynamic score 48 → **60-65**

為什麼降低：
- Vision layer 大部分產出會被 cross-validator 拒絕
- 實際 animation count 會大幅下降（Linear 可能從 Round E 的 35 掉到 12-15）
- 但 **精度** 大幅提升（幻覺率應從 100% 降到 <10%）

**誠實的 trade-off**：我們寧願少但對，不要多但錯。

### 4.2 Revised Phases

| Phase | 原計畫 | 修正後 |
|-------|-------|-------|
| E1 Extractor industrialization | ✅ Done (2 days) | ✅ Done |
| E2 Ground truth corpus | ✅ Done (0.5 day) | ✅ Done，但現在知道結果不可靠 |
| **E2.5 (新)** Pivot investigation | — | Root cause analysis + this PIVOT.md ← **現在** |
| **E-Pivot.1 (新)** rrweb integration | — | 1.5 day |
| **E-Pivot.2 (新)** Cross-validator | — | 1 day |
| **E-Pivot.3 (新)** Re-run 5 sites | — | 0.5 day |
| **E-Pivot.4 (新)** Sean re-review | — | 0.5 day（希望 hallucination rate < 10%） |
| E3 Framer Motion emitter | 2-3 days | 2-3 days（僅 base on verified spec） |
| E4 Cloner v2 integration | 1 day | 1 day |
| E5 E2E validation | 1 day | 1 day |
| **總計** | 7 days | **~10-11 days** |

Extra 3-4 days 是 pivot 成本，可接受。

### 4.3 Budget Impact

原預算 $5，已用 $0.63。Pivot 新增成本估：
- rrweb 本身不花錢（browser-side library）
- Re-run 5 sites extractor 跑新 pipeline: ~$0.50
- Re-review Sean 人工：0 成本
- **Pivot 新增 API cost**: ~$0.50

新估 total: **$1.50 / $5**（仍在預算內）

---

## 5. Methodological Contribution

### 5.1 Honest Finding to Report

這個 pivot 的發現本身**有研究價值**，會寫進 Round E REPORT.md：

> **"Claude Sonnet 4.5 Vision 在 2026-04 無法可靠分辨 scroll-driven viewport entry 與 real animation，即使信心度 ≥ 0.85。Prompt engineering（加 direction 欄位、confidence filter）無效。需要 DOM mutation cross-validation 層才能 reliable."**

這是**第一個量化證據**（18/18 = 100% hallucination rate on high-confidence entries），可能比 Round D 的「0/27 captured」更有 value：
- Round D 說「工具不會抓」
- Round E Pivot 說「AI 以為抓到，其實亂抓，而且它不知道自己亂抓」

### 5.2 Implications beyond this project

如果其他 pipeline 用 LLM Vision 當 sole truth source，可能有類似 systematic hallucination。我們的 cross-validator 架構是 generally applicable 的 mitigation。

---

## 6. Immediate Next Steps

### 6.1 For New Session

1. **DO NOT start Phase E3 emitter** — 不能基於 18/18 錯的 spec 產 code
2. **Read this PIVOT.md in full** before any next action
3. **Start Phase E-Pivot.1**: rrweb integration + mutation recording
4. **Preserve existing Phase E2 artifacts** as-is (作為 hallucination 對照組，別刪)

### 6.2 For Sean

**今天**：
- ✅ Already done: 45 min review 完成，結論明確
- 💡 Update Round E PLAN.md header: mark v0.1 → v0.2 with pivot note（optional, can defer）
- 😴 休息，pivot investigation 已經是今天最重要成果

**明天（或新 session 自動進行）**：
- 新 session 開始 E-Pivot.1 rrweb integration
- 用 Round D 既有 20 frames 當 regression test（新架構跑完 Linear 應該 reject 95%+ Vision candidates）
- Sean 早上一起床看 progress

### 6.3 Update Round E REPORT Expectations

Round E 結束後的 REPORT 會有兩個章節：
- **Part 1**: 原計畫 Dedicated Animation Extractor — PARTIAL SUCCESS（rrweb-validated）
- **Part 2**: **Vision Hallucination Systematic Discovery** — COMPLETE FINDING

Part 2 可能比 Part 1 引用價值更高。

---

## 7. Decision Trail

| Time | Decision | By |
|------|----------|-----|
| 2026-04-22 early | Plan v3.1 with Vision as primary layer | Sean (ex ante) |
| 2026-04-22 mid | Phase E2 complete, 247 animations extracted, high confidence | New session |
| 2026-04-22 evening | Sean 45-min spot-check: 18/18 hallucinated | Sean |
| 2026-04-22 late | Frame diff validation: Sean's judgment supported | Old session (Claude) |
| 2026-04-22 late | Pivot B+C chosen | Sean |
| 2026-04-22 late | This PIVOT.md written | Old session (Claude) |
| next | Execute E-Pivot.1: rrweb integration | New session |

---

## Appendix: Why This Is Good News, Actually

1. **Better to find this in Phase E2 than Phase E5** — 若進 E3 產 emitter 後才發現 base spec 是假的，整條 pipeline 要打掉重做，浪費 3+ days
2. **Sean's 45-min review caught a 100% failure rate** — 人工 review 的價值再度被 validate（Q3 選 C "Claude assist with Sean spot-check" 是對的）
3. **Research contribution 反而更強** — 「AI 以為看到動畫其實沒有」是 novel finding，市面上沒人 document 過
4. **$0.63 成本**買到這個 insight 極划算

Pivot 不是失敗，是**誠實的 scientific process**。
