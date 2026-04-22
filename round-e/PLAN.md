# Round E: Dedicated Animation Extractor

**Date**: 2026-04-22
**Owner**: Sean (@zychenpeng)
**Version**: v0.1 (initial, post-Round D)
**Status**: Plan drafted, awaiting review before execution
**Predecessor**: [../round-d/REPORT.md](../round-d/REPORT.md)

---

## Changelog

- **v0.1 (2026-04-22)**: Initial plan, drafted immediately after Round D completion to capture context freshness. Based on Round D Decision Tree Branch ④ firing (all tools Dynamic < 50%). Explicit goals, success criteria, phased execution. Risks enumerated. 7-day rough timeline.

---

## 1. Context

Round D 量化證實：**4 個 SOTA AI 克隆工具全員 0/27 動畫捕捉**。這是產業系統性盲點，不是單一工具 bug。

Round D 同時 prove 了：**2-layer hybrid probe (DOM `getAnimations()` + Claude Vision on frames) 可以成功擷取 27 unique animations** — 零重疊的兩層互補擷取。這是 Round E 的 PoC。

Round E 要做的是把 PoC 工業化，並加上 **code generation 能力**（animation spec → Framer Motion .tsx）。

## 2. Positioning in Roadmap

```
Round D (完成) → [Round E 現在] → Round F → Round G → Round H → Round I
 baseline          animation extractor  code emitter  domain transfer  self-improve  production
```

Round E 是**第一個真正產出 capability** 的 round（Round D 只產出 insight）。Round F 繼續向下游推（把 extractor 產的 spec → full Next.js emitter），Round G 擴展到跨品牌轉換。

## 3. North Star for Round E

> **"輸入任意網站 URL，輸出 `.tsx` 檔，其 Framer Motion 動畫在瀏覽器呈現出來，人眼看起來跟原網站的動畫相似度 ≥ 70%。"**

達成此 North Star 後，Sean 的 mother goal（"90 分鐘 clone 到 ship"）剩下 Round F (emitter) 和 Round G (domain transfer) 就完成。

## 4. Goals (Measurable)

1. **Extractor coverage**: Linear.app 從 0/27 → **≥ 18/27 (67%)**；5 站平均 coverage **≥ 70%**
2. **Taxonomy accuracy**: 動畫類型分類正確率 **≥ 80%**（100 個人工標註樣本）
3. **Code-gen fidelity**: Emitter 產出的 Framer Motion code 語義正確率 **avg ≥ 2.0**（0-3 scale）
4. **E2E demo**: Linear clone 在 `npm run dev` render 後能肉眼看到至少 10 個 scroll-triggered 動畫
5. **Cloner v2 Dynamic score**: 從 Round D 的 48 → **≥ 75**
6. **Multi-site robust**: 跑 5 站不會崩，各站 coverage 都 ≥ 50%

## 5. Success Criteria (Binary Gates)

Round E 通關 if ALL of：

- [ ] Linear.app re-clone Dynamic score ≥ 75（vs Round D Baseline 48）
- [ ] `tools/animation-extractor/` 可跑任意 URL，不當機
- [ ] `tools/motion-emitter/` 產出的 .tsx 所有檔案都 TypeScript compile pass
- [ ] 5 站 ground truth corpus 完成（含 Linear 已有的 27，加 4 站 × ~25 = 125 animations total）
- [ ] E2E demo GIF `round-e/demo/linear-clone-animated.gif` 產出
- [ ] Round E REPORT.md 寫完（類似 Round D 的量化對比格式）

## 6. Target Sites (5 站)

選這 5 站涵蓋動畫多樣性，避免只對 Linear 過擬合：

| Site | 動畫特色 | 預期 GT 規模 | Round D 已有? |
|------|---------|------------|--------------|
| [linear.app](https://linear.app) | Framer Motion scroll-driven + Radix dropdown | 27 | ✅ |
| [stripe.com](https://stripe.com) | 密集 CSS transitions + WebGL mesh hero | ~40 | ❌ |
| [raycast.com](https://raycast.com) | Sculptural WebGL + macOS-style hover | ~30 | ❌ |
| [vercel.com](https://vercel.com) | Subtle mesh + parallax + text fades | ~25 | ❌ |
| [apple.com/mac](https://apple.com/mac) | Lottie + video reveal + pin scroll | ~20 | ❌ |

Apple.com 刻意放在最後（Lottie 是最難的 category，如果前 4 通過再挑戰 Apple，若失敗則 document 為 known limitation）。

## 7. Methodology

### 7.1 Architecture

```
┌──────────────────────────────────────────────────────────┐
│  tools/animation-extractor/         tools/motion-emitter/│
│  ├── extract-dom.mjs    ─┐          ├── emit-motion.mjs  │
│  ├── extract-vision.mjs ─┤          ├── template/        │
│  ├── merge.mjs          ─┤          │   ├── fade-up.tsx  │
│  └── schema.ts          ─┘          │   ├── slide-in.tsx │
│                         │           │   └── ...          │
│                         ↓           │                    │
│            ┌─────────────────────┐  │                    │
│            │ animation-spec.json │──┤                    │
│            │ (canonical format)  │  ↓                    │
│            └─────────────────────┘  motion-components.tsx│
│                         ↓                                 │
│                  integrated into                          │
│            tools/v2/capture/ + rebuild/                   │
└──────────────────────────────────────────────────────────┘
```

### 7.2 Canonical `animation-spec.json` Schema

```typescript
interface AnimationSpec {
  version: "1.0";
  target_url: string;
  captured_at: string;
  total: number;
  by_provenance: { dom: number; vision: number; both: number };
  animations: Animation[];
}

interface Animation {
  id: string;                            // stable hash
  provenance: Array<"dom" | "vision">;
  confidence: number;                    // 0.0-1.0

  // Target identification
  element: string;                       // human-readable
  selector?: string;                     // DOM path (from Layer 1)
  role?: string;                         // hero | cta | card | logo | etc.

  // Motion semantics
  motion_type: MotionType;
  trigger: TriggerType;
  duration_ms: number;
  easing: EasingType;
  iterations?: number | "infinite";

  // Layer 1 extras (precise)
  keyframes?: Array<Record<string, string | number>>;

  // Layer 2 extras (semantic)
  frames_involved?: number[];
  needs_review?: boolean;
}

type MotionType =
  | "fade-up" | "fade-in" | "fade-out"
  | "slide-left" | "slide-right" | "slide-up" | "slide-down"
  | "scale-in" | "scale-out"
  | "rotate"
  | "reveal-on-scroll"
  | "hover-lift" | "hover-glow"
  | "parallax"
  | "shader-ambient"
  | "typewriter"
  | "stagger"
  | "loop"                              // ongoing
  | "one-shot"                          // play once on trigger
  | "other";

type TriggerType =
  | "on-load" | "on-mount"
  | "scroll-in" | "scroll-out" | "scroll-progress"
  | "hover" | "focus" | "click"
  | "continuous";

type EasingType =
  | "linear" | "ease-in" | "ease-out" | "ease-in-out"
  | "spring" | "cubic-bezier"
  | "unknown";
```

此 schema 是 Round E 最重要的 **interface contract** — extractor 產它，emitter 吃它，Round F code emitter 也吃它。

### 7.3 Framer Motion Emitter Mapping

Each MotionType → a template. 10 core templates:

| MotionType | Template snippet |
|------------|------------------|
| `fade-up` | `<motion.TAG initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: D, ease: E }} viewport={{ once: true }} />` |
| `fade-in` | `{opacity: 0} → {opacity: 1}` |
| `slide-left` | `{x: -100, opacity: 0} → {x: 0, opacity: 1}` |
| `slide-right` | `{x: 100, opacity: 0} → {x: 0, opacity: 1}` |
| `scale-in` | `{scale: 0.8, opacity: 0} → {scale: 1, opacity: 1}` |
| `reveal-on-scroll` | `useScroll + useTransform clip-path` |
| `hover-lift` | `whileHover={{ y: -2 }}` |
| `parallax` | `useScroll + useTransform y` |
| `loop` | `animate={{...}} transition={{ repeat: Infinity }}` |
| `shader-ambient` | fallback to CSS gradient + noise texture |

Coverage 10 types 能 cover ~80% 實際 patterns。長尾 (`typewriter`, custom easing, stagger 細節) 進 Round F。

### 7.4 Merge Rule Upgrade (from Round D)

Round D 的 merge 只用 `duration ±30% + element keyword`。Round E 升級：

- 加 `motion_type matching`（DOM 不知 type，預設 loop/one-shot；Vision 有 type；merge 時 DOM 繼承 Vision 的）
- 加 `trigger matching`（DOM 不知 trigger；Vision 有）
- 衝突解決：Vision 優先 describe 語義，DOM 優先 describe 精確 timing

## 8. Execution Phases

### Phase E1 — Extractor Industrialization (2 days)

基於 Round D `round-d/scripts/probe-animations.mjs` 和 `probe-vision.mjs` 重構：

**Day 1**:
- [ ] 建 `tools/animation-extractor/` 目錄 + `package.json`
- [ ] 定義 `schema.ts` (TypeScript types)
- [ ] 重構 `extract-dom.mjs` 加錯誤處理（Cloudflare detection, empty animation list, timeout）
- [ ] 重構 `extract-vision.mjs` 加 retry + confidence filtering
- [ ] 重構 `merge.mjs` 加 type/trigger 升級

**Day 2**:
- [ ] CLI: `npx extract <url> --out <path>` → `animation-spec.json`
- [ ] Unit tests (mock Linear, verify schema conformance)
- [ ] Integration test on Linear.app（smoke test, should match Round D's 27）

### Phase E2 — Ground Truth Corpus (0.5 days)

- [ ] 跑 extractor 對 5 站（auto, ~5 min total）
- [ ] 人工 review + 修正每站的 spec（每站 ~15-20 min，total ~1.5 hr）
- [ ] 存 `round-e/ground-truth/{site}.json`，建立 canonical test corpus

### Phase E3 — Framer Motion Emitter (2-3 days) ⚠️ 最大風險

**Day 3**:
- [ ] 建 `tools/motion-emitter/` 目錄
- [ ] 寫 10 個 `template/{motion_type}.tsx` mustache-style templates
- [ ] `emit-motion.mjs` 吃 spec → 產 `motion-components.tsx`

**Day 4**:
- [ ] 對每種 MotionType 寫 emitter unit test（spec entry → expected tsx string）
- [ ] Integration test: spec → emit → tsc compile check
- [ ] Edge cases: missing fields, unknown motion_type (fallback to CSS)

**Day 5** (buffer/overflow):
- [ ] 優化 output readability（human reviewable code，避免 LLM soup）
- [ ] 加 `export` annotations 讓 components 可被 cloner v2 rebuild 引用

### Phase E4 — Cloner v2 Integration (1 day)

**Day 6**:
- [ ] Patch `tools/v2/capture/` 呼叫 animation-extractor
- [ ] 產出的 spec 寫入 manifest.json `animations` 欄位
- [ ] Patch `tools/v2/rebuild/prompts/section-to-react.md`：若 spec 有對應 section 的 animations，叫 rebuild prompt `import { ... } from './motion-components'` + 把 element 包起來
- [ ] Smoke test：整合後 pipeline 不當機

### Phase E5 — E2E Validation (1 day)

**Day 7**:
- [ ] 重跑 linear.app 整條 pipeline
- [ ] 比較 scorecard：Dynamic 48 → 目標 75+
- [ ] 產出 E2E demo：`round-e/demo/linear-original-scroll.mp4` + `linear-clone-scroll.mp4`
- [ ] 人工看一眼 + Claude Vision 跑並排比對評分
- [ ] 寫 `round-e/REPORT.md`（模仿 Round D 的結構）
- [ ] Commit + push

### Timeline Summary

| Phase | Days | 核心產物 |
|-------|------|---------|
| E1 Extractor industrialization | 2 | `tools/animation-extractor/` 可獨立運行 |
| E2 Ground truth corpus | 0.5 | 5 站 × ~25 animations |
| E3 Framer Motion emitter | 2-3 | `tools/motion-emitter/` 10 templates |
| E4 Cloner v2 integration | 1 | E2E pipeline 不當機 |
| E5 Validation + report | 1 | Demo GIF + REPORT.md |
| **總計** | **~7 天** | 全部通關 |

## 9. Test Methodology

### 9.1 Coverage Metric

```
per-site coverage = |captured animations| / |ground truth animations|
overall coverage = arithmetic mean across 5 sites

Target: per-site ≥ 50%, overall ≥ 70%, Linear ≥ 67% (18/27)
```

### 9.2 Taxonomy Accuracy

100 個人工標註 samples (50 Linear + 50 across 其他 4 站)，對比 extractor 輸出的 `motion_type`：

```
taxonomy_accuracy = correct_type / 100

Target: ≥ 80%
```

分類混淆可接受 if 語義相近（`fade-up` 誤判為 `fade-in` 半分；誤判為 `rotate` 0 分）。

### 9.3 Code-Gen Fidelity

對 20 個 spec entries，讓 emitter 產 tsx，評 0-3：
- 0 = 完全錯（compile fail / 語義偏差）
- 1 = 有意識但錯（對的 motion_type 錯的 timing）
- 2 = 對但細節偏（對的但 easing 不準）
- 3 = 語義完全對

**Target**: avg ≥ 2.0

雙重評分：
- Sean 人工評 10 個
- Claude Sonnet 4.5 as judge 評 20 個
- Agreement ≥ 80%（sanity check）

### 9.4 E2E Side-by-Side

Linear.app Round E clone vs original：

```
方法 1: Claude Vision on GIF pair → 0-10 「動畫相似度」
方法 2: 人工看 3 秒片段（隨機挑 scroll 位置）→ 0-10
方法 3: pHash 時序差（可選，fuzzy）

通關: 方法 1 或 2 ≥ 6.0（看起來相似即算通關；完美太 long tail）
```

## 10. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Claude Vision hallucinate 無存在的動畫 | Medium | Medium | Confidence threshold 0.7 + 人工 spot check 5% sample |
| R2 | Framer Motion emitter 產 TypeScript compile error | Medium | High | Unit test each template; CI pass required before merge |
| R3 | 10 motion_type 不夠覆蓋（long tail） | High | Medium | Fallback to `other` + CSS，document limitation in REPORT |
| R4 | Multi-site Cloudflare variance（Stripe/Apple 擋） | Medium | Low | 延用 Round D fallback: manual Save Page As |
| R5 | 8GB RAM 仍是 cloner v2 integration 瓶頸 | High | Medium | Round D 已證明 CONCURRENCY=2 + skip verify phase 可行；Round E 維持此 config |
| R6 | Lottie (Apple.com) 完全抓不到 | High | Low | Already acknowledged as long-tail; skip if prior 4 sites OK |
| R7 | E2E demo 看起來還是不對 | Medium | High | Budget 0.5 day buffer 為 emitter template 微調 |
| R8 | API cost 爆炸 | Low | Medium | 每 phase 記 cost，>$15 total kill switch |
| R9 | Sean 中途想 pivot（發現更有趣方向） | Medium | Low | Weekly check-in；Round E plan 是 7 天，中途止損也無傷 |

## 11. Kill Criteria

Round E 中止條件（任一觸發立刻停，寫 partial REPORT）：

- Phase E1 結束時 extractor coverage < 50% on Linear → 先 debug PoC，不進 E3
- Phase E3 中 emitter 產 code compile error > 30% → 降 motion_type coverage 到 5 個
- Total API cost > $15 → stop, write partial
- Day 5 時 E3 仍未跑通 emitter smoke test → 跳過 E4 integration，單獨 validate extractor + emitter

## 12. Deliverables

| # | 產物 | 位置 |
|---|------|------|
| 1 | `tools/animation-extractor/` package | repo root (not `round-e/`, 方便其他 round 使用) |
| 2 | `tools/motion-emitter/` package | repo root |
| 3 | 5-site ground truth corpus | `round-e/ground-truth/{site}.json` |
| 4 | E2E demo videos / GIFs | `round-e/demo/` |
| 5 | `round-e/REPORT.md` | 對比 Round D 的量化報告 |
| 6 | 更新後 scorecard | `round-e/evaluation/scorecard.md`（對比 Round D → E 差異） |
| 7 | `schema.ts` canonical types | `tools/animation-extractor/schema.ts` |

## 13. Budget

| 項目 | 估計 |
|------|------|
| Vision probe × 5 sites | 5 × $0.15 = $0.75 |
| Cloner v2 pipeline re-run on Linear | ~$1 |
| Emitter smoke test (LLM-generated code review) | $0.50 |
| Code-gen judge (Claude Vision on 20 samples) | $0.50 |
| E2E validation (side-by-side judge) | $0.25 |
| Buffer | $2 |
| **Total** | **~$5** |

## 14. Open Questions（要 Sean 決定）

### Q1. Emitter target: Framer Motion v12 還是自製 CSS variants?

- **A. Framer Motion** (我推薦) — 業界標準、API 穩定、可 SSR、tree-shake 好
- **B. 純 CSS + Intersection Observer** — 無 library dependency，bundle 小，但 scroll-progress 動畫難做
- **C. motion (formerly framer-motion, 現在獨立 package)** — 最新版，更小 bundle

### Q2. 是否在 Round E 加入 Tool 02 hue (Round D 延後的)？

- **A. 加** — hue 的 `design-model.yaml` schema 可啟發 animation-spec schema
- **B. 不加**（我推薦）— hue 是 Round F (emitter + design system) 的 scope，Round E 單攻動畫 focus 更清楚

### Q3. Multi-site ground truth 人工標註時，Sean 要 involve 嗎？

- **A. 全自動** — extractor 產、人工只 spot check 5%，省 1.5 hr
- **B. 全手動** — 每站 Sean 自己過一次，品質保證但 1.5 hr 佔用
- **C. Claude assist**（我推薦）— Claude 產，Sean 看 10 個 sample 判對錯，coverage 高又省時

### Q4. Round E REPORT.md 的展示對象？

- **A. 繁中 internal** (same as Round D)
- **B. 英文 public**（升級，對外投 arXiv / HN）
- **C. 雙版本**（繁中 + 英文 executive summary）

## 15. Pre-Round-E Preparation

在開始 Phase E1 前先做這幾件（各 ~15 min，不算在 7 天 timeline 內）：

1. [ ] Sean review + approve 這份 PLAN
2. [ ] 回答 §14 四個 open questions
3. [ ] Fork / prep 5 target sites 各一次 screenshot（測 Cloudflare/Turnstile 是否擋新站）
4. [ ] 清 workspace（確認 8GB RAM 有 4GB+ free）
5. [ ] 升級 Claude Code / dependency（若有 Sonnet 4.6+ released 可能好用些）

## 16. References

- [Round D REPORT](../round-d/REPORT.md) — baseline findings + Decision Tree
- [Round D scripts](../round-d/scripts/) — 將被 refactor 進 `tools/animation-extractor/`
- [Framer Motion docs](https://www.framer.com/motion/) — primary emitter target
- [rrweb](https://github.com/rrweb-io/rrweb) — alternative capture（若 getAnimations 不夠 Round F 可考慮）

---

**下一步**：Sean review + 回答 §14 四個 Q → approve → 開新 session 執行 Phase E1。

建議開 **新 session** 執行（不要在這個 session 裡直接做，因為 context 已經很大了）。當日可做 PoC Phase E1 Day 1 的 extractor refactor。
