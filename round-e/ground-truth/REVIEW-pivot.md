# Phase E-Pivot Ground-Truth Review（人工 Spot-Check 第二輪）

Generated: 2026-04-22T16:24:22.998Z

> **背景**：第一輪 Phase E2 REVIEW.md 你做完 18/18 全部 ❌ 幻覺，觸發了 PIVOT.md 的 B+C 架構改寫（加 rrweb DOM mutation recorder + cross-validator 作為 Vision 候選的 gate）。這份是跑 5-stage 新 pipeline 後的結果，要你再看一次系統現在有沒有把事情做對。

---

## 📖 如何 Review（3 分鐘）

### 和上次（E2 REVIEW.md）差在哪

上一輪全部都是 ✅/⚠️/❌ 直接判 Vision 對不對。這一輪因為 cross-validator 已經自動拒絕了絕大多數 Vision 候選，所以**兩種 section 要分開看**：

1. **VERIFIED 區**（通過 rrweb 驗證的少數項目）— 理論上應該是真的，你要抓出**還是幻覺**的漏網之魚。
2. **REJECTED 區**（被 cross-validator 拒絕的大多數項目）— 你要**反向抽查**：系統會不會**冤枉了**真的有的動畫（false negative）？每站 5 個代表樣本。

### 兩種打勾標準

**VERIFIED 項目**（Vision 說有 + rrweb 有 motion mutation 背書）：

| 符號 | 意思 | 代表 |
|:---:|------|------|
| ✅ | **真的有這動畫** | 系統對，保留 |
| ⚠️ | **有動畫但描述不完全對** | 系統大致對（type 或 trigger 差一點）|
| ❌ | **根本沒這動畫（幻覺）** | 系統還是漏了一個 false positive（壞消息）|

**REJECTED 項目**（Vision 說有 + rrweb 沒背書）：

| 符號 | 意思 | 代表 |
|:---:|------|------|
| ✅ | **同意拒絕** | 真的沒這動畫，系統對 |
| ⚠️ | **部分冤枉** | 有動畫但 Vision 的描述細節確實不對 |
| ❌ | **冤枉！** | 真的有這動畫，cross-validator 誤判（false negative，系統要改）|

### Step 1：打開網站找元素

用無痕視窗（Ctrl+Shift+N）打開網站，用 Ctrl+F 搜尋 element 描述中的文字跳到位置。如果 trigger 是 `scroll-in`，先回頂部再慢慢滑。

### Step 2：動畫類型中英對照

| 英文代號 | 中文 | 看起來像 |
|---------|------|---------|
| **fade-in** | 淡入 | 元素從透明變清楚 |
| **fade-up** | 淡入+上升 | 透明 + 從下方浮上來 |
| **fade-out** | 淡出 | 從清楚變透明 |
| **slide-left/right/up/down** | 滑入 | 從某方向滑進來 |
| **scale-in/out** | 放大/縮小進入 | 大小變化 |
| **reveal-on-scroll** | 滾動顯現 | 隨滾動才顯現 |
| **shader-ambient** | WebGL 環境光 | 背景發光/波動 |
| **parallax** | 視差 | 背景和前景滾動速度不同 |
| **loop** | 循環 | 一直在動（logo carousel 那種）|
| **one-shot** | 一次性 | 載入時播放一次就停 |

### Step 3：Trigger 中英對照

| 英文 | 中文 | 什麼時候播 |
|------|------|----------|
| **on-load** | 載入時 | 頁面打開就播 |
| **scroll-in** | 滾動進入 | 滾動到該元素才播 |
| **scroll-out** | 滾動離開 | 元素離開視野時 |
| **continuous** | 持續 | 一直在跑 |
| **hover** | 懸浮 | 滑鼠移上去才播 |

### 💡 小訣竅

1. **VERIFIED 區很短**（全站總共 3 個，stripe 就佔了全部）— 先把這 3 個看完再看 REJECTED。
2. **REJECTED 區** 5/站 × 5 站 = 25 個。動畫看不出來直接給 ⚠️，不要糾結太久。
3. **如果 ❌（冤枉）很多**，代表 cross-validator 要放寬（keyword match、time window、還是 motion prop 集合）；會寫進下一輪 iteration。
4. **GitHub 網頁直接點 checkbox 自動 commit**。

---

## 📊 E-Pivot 對照 E2 總覽

| 網站 | E2 Total | E2 → Pivot (final) | Vision 候選 | Verified | Rejected | Motion muts 可用 |
|------|--------:|:-------------------|-----------:|---------:|---------:|----------------:|
| linear.app | 35 | 35 → **12** | 21 | 0 | 21 | 20 |
| stripe.com | 111 | 111 → **102** | 16 | 3 | 13 | 1110 |
| raycast.com | 50 | 50 → **30** | 18 | 0 | 18 | 258 |
| vercel.com | 25 | 25 → **8** | 15 | 0 | 15 | 591 |
| apple.com/mac | 26 | 26 → **21** | 9 | 0 | 9 | 2115 |

**合計**：Vision 候選 **79**，通過 **3**（3.8%），拒絕 **76**。Final spec 總量 247 → **173**（DOM-dominated，少但乾淨）。

> **預期解讀**：Verified rate 3.8% 遠低於 PIVOT.md §4.1 的 10% 目標。關鍵是：這 3 個 verified 是不是真的，以及 76 個 rejected 有沒有冤枉。

---

# ✅ VERIFIED — true positive check（3 項全看）

> 全站 corpus 只有 **3 個 verified**（都在 Stripe），以下逐個評。

## stripe.com（3 個 verified）

### stripe.com V1. [reveal / scroll-in（滾動進入）]

- **Element 描述**：usage meter bar chart animation in 'Enable any billing model' card
- **Window**：t=3493ms → 4998ms · frames_involved
- **rrweb 證據**：t=4556ms，props=`opacity, transform`
- **證據 selector**：`html#​ > body > div#__next > div > main#main-content > section.hds-color-mode.section > div.section-container.section-ro`
- **判斷**：
  - [ ] ✅ 真的有這動畫（true positive — 系統對）
  - [ ] ⚠️ 有動畫但描述不完全對（type 或 trigger 差一點）
  - [ ] ❌ 根本沒這動畫（幻覺，和 E2 一樣 — 系統還有漏網之魚）

### stripe.com V2. [shader-webgl / scroll-in（滾動進入）]

- **Element 描述**：particle circle animation in 'Monetize through agentic commerce' card
- **Window**：t=3998ms → 5505ms · frames_involved
- **rrweb 證據**：t=4556ms，props=`opacity, transform`
- **證據 selector**：`html#​ > body > div#__next > div > main#main-content > section.hds-color-mode.section > div.section-container.section-ro`
- **判斷**：
  - [ ] ✅ 真的有這動畫（true positive — 系統對）
  - [ ] ⚠️ 有動畫但描述不完全對（type 或 trigger 差一點）
  - [ ] ❌ 根本沒這動畫（幻覺，和 E2 一樣 — 系統還有漏網之魚）

### stripe.com V3. [shader-webgl / scroll-in（滾動進入）]

- **Element 描述**：gradient background in 'Make your SaaS platform' section
- **Window**：t=8074ms → 9588ms · frames_involved
- **rrweb 證據**：t=8672ms，props=`opacity, transform`
- **證據 selector**：`html#​ > body > div#__next > div > main#main-content > section.hds-color-mode.business-sizes-section > div.section-conta`
- **判斷**：
  - [ ] ✅ 真的有這動畫（true positive — 系統對）
  - [ ] ⚠️ 有動畫但描述不完全對（type 或 trigger 差一點）
  - [ ] ❌ 根本沒這動畫（幻覺，和 E2 一樣 — 系統還有漏網之魚）

---

# ❓ REJECTED — false-negative spot-check（5/站）

> 每站 5 個代表樣本，系統自動依 (rejection reason × motion_type) 分桶取差異大的。檢查：cross-validator 是不是冤枉了真的存在的動畫。

## linear.app（共 21 個拒絕；原因：element_mismatch_in_window=5, no_motion_in_time_window=16）

### linear.app R1. [fade / scroll-out（滾動離開）]

- **Element 描述**：Hero section with headline 'The product development system for teams and agents'
- **Window**：t=4845ms → 6355ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### linear.app R2. [scale / scroll-out（滾動離開）]

- **Element 描述**：Issue tracking interface modal/window
- **Window**：t=4845ms → 6355ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### linear.app R3. [fade / scroll-in（滾動進入）]

- **Element 描述**：Company logos (Vercel, CURSOR, Oscar, OpenAI, coinbase, Cash App, BOOM, ramp)
- **Window**：t=5355ms → 6863ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### linear.app R4. [slide / scroll-in（滾動進入）]

- **Element 描述**：Todo/In Progress issue board interface
- **Window**：t=6888ms → 8390ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### linear.app R5. [fade / scroll-in（滾動進入）]

- **Element 描述**：Section 'Define the product direction' with roadmap visualization
- **Window**：t=7390ms → 8904ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

---

## stripe.com（共 13 個拒絕；原因：element_mismatch_in_window=13）

### stripe.com R1. [shader-webgl / continuous（持續）]

- **Element 描述**：hero mesh gradient background (purple-pink-orange waves)
- **Window**：t=3493ms → 12150ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### stripe.com R2. [typewriter（打字機） / on-load（載入時）]

- **Element 描述**：Global GDP running on Stripe percentage counter
- **Window**：t=3493ms → 4493ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### stripe.com R3. [stagger（錯落出現） / scroll-in（滾動進入）]

- **Element 描述**：bar chart showing tokens used in last 30 days
- **Window**：t=3493ms → 4998ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### stripe.com R4. [shader-webgl / scroll-in（滾動進入）]

- **Element 描述**：money movement particles/dots in 'Access borderless money movement' card
- **Window**：t=3998ms → 5505ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### stripe.com R5. [typewriter（打字機） / scroll-in（滾動進入）]

- **Element 描述**：$1.9T counter animation
- **Window**：t=5524ms → 6524ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

---

## raycast.com（共 18 個拒絕；原因：element_mismatch_in_window=17, no_motion_in_time_window=1）

### raycast.com R1. [parallax（視差） / scroll-in（滾動進入）]

- **Element 描述**：Red diagonal stripe background pattern
- **Window**：t=18966ms → 23026ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### raycast.com R2. [fade / scroll-out（滾動離開）]

- **Element 描述**：Hero section headline 'Your shortcut to everything.'
- **Window**：t=18966ms → 21451ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### raycast.com R3. [fade / on-load（載入時）]

- **Element 描述**：Banner 'Introducing Glaze | Join waitlist'
- **Window**：t=20451ms → 21451ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### raycast.com R4. [stagger（錯落出現） / scroll-in（滾動進入）]

- **Element 描述**：Clipboard History icon panel with 5 icons
- **Window**：t=20451ms → 23026ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### raycast.com R5. [morph / continuous（持續）]

- **Element 描述**：Linear extension card animation icons (circle, half-moon, checkmark)
- **Window**：t=23582ms → 26093ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

---

## vercel.com（共 15 個拒絕；原因：element_mismatch_in_window=11, no_motion_in_time_window=4）

### vercel.com R1. [shader-webgl / continuous（持續）]

- **Element 描述**：Hero colorful gradient background with horizontal lines
- **Window**：t=5247ms → 11421ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### vercel.com R2. [fade / scroll-out（滾動離開）]

- **Element 描述**：Security incident banner 'Vercel April 2026 security incident'
- **Window**：t=5247ms → 6786ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### vercel.com R3. [slide / scroll-in（滾動進入）]

- **Element 描述**：Social proof testimonials 'runway build times went from 7m to 40s.'
- **Window**：t=5247ms → 7296ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### vercel.com R4. [fade / scroll-in（滾動進入）]

- **Element 描述**：Agents 'Thinking...' loading animation with typing indicator
- **Window**：t=6296ms → 8365ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### vercel.com R5. [reveal / scroll-in（滾動進入）]

- **Element 描述**：Framework-Defined Infrastructure diagram with colorful connection lines
- **Window**：t=7365ms → 8880ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

---

## apple.com/mac（共 9 個拒絕；原因：no_motion_in_time_window=4, element_mismatch_in_window=5）

### apple.com/mac R1. [fade / scroll-in（滾動進入）]

- **Element 描述**：Product cards in 'Explore the lineup' section
- **Window**：t=4072ms → 5586ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### apple.com/mac R2. [reveal / scroll-in（滾動進入）]

- **Element 描述**：Financing details text (for 12 mo.)
- **Window**：t=4586ms → 5586ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### apple.com/mac R3. [fade / scroll-in（滾動進入）]

- **Element 描述**：Why Apple is the best place to buy Mac cards
- **Window**：t=5100ms → 6608ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### apple.com/mac R4. [fade / scroll-in（滾動進入）]

- **Element 描述**：Learn more and Buy buttons
- **Window**：t=4586ms → 5586ms · frames_involved
- **拒絕原因**：`no_motion_in_time_window`（Vision 宣稱的時間窗內 rrweb 沒 motion mutation）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

### apple.com/mac R5. [fade / scroll-in（滾動進入）]

- **Element 描述**：Apple Trade In and Mac migration images
- **Window**：t=8173ms → 9173ms · frames_involved
- **拒絕原因**：`element_mismatch_in_window`（時間窗內有 motion，但元素（selector / class）不對）
- **判斷**：
  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）
  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）
  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）

---

# 🚦 決策閘

Review 完後，根據標記結果決定下一步：

| 情境 | 行動 |
|------|------|
| VERIFIED 區 3/3 都是 ✅ / ⚠️，REJECTED 區 ❌ 冤枉 ≤ 2 | **通過 E-Pivot.4 → 開 Phase E3 emitter** |
| VERIFIED 區出現 ❌ 幻覺 | cross-validator 還要再緊（tighter keyword match / element role gating） |
| REJECTED 區 ❌ 冤枉 ≥ 3 | cross-validator 太嚴（放寬 time window / 降低 min_matches / 加 selector-tag match） |
| 混合問題 | 討論後列 E-Pivot.5 iteration |

---

*Review 完成後，把這份 commit 回 repo，新 session 讀你的判斷後決定是否進 E3 emitter。*

---

## 🔴 Sean Final Verdict (2026-04-23)

### TLDR

**B+C 架構（rrweb + cross-validator）也是 dead-end。**

| 輪次 | Verified 數 | 人工 review 結果 | Hallucination rate |
|------|-----------:|:----------------|-------------------:|
| Phase E2（raw Vision） | 18（樣本）| **18/18 ❌** 幻覺 | 100% |
| E-Pivot.3（rrweb-gated）| 3（Stripe 全數）| **3/3 ❌** keyword collision 假陽性 | 100% |

PIVOT.md §4.1 訂的 "<10% hallucination" 目標沒達到。Cross-validator 沒 fail 任何「壞的」Vision 判斷都沒救，因為 **它讓壞的 3 個通過了**。不進 E-Pivot.4，不進 E3 emitter。

### 為什麼 rrweb 也救不起來（root cause）

Stripe 3 個 "verified" 的共同模式：
- Vision 描述含「section/container」類泛結構詞 → 2-keyword overlap 門檻仍命中 DOM path 上的 `section.hds-color-mode` / `div.section-container.section-root`
- rrweb 確實在 Vision 宣稱的 frame window 內錄到某元素 `opacity + transform` 變化
- **但那個在變的元素，不是 Vision 描述的元素**

**rrweb 給的是 correlational evidence，不是 causal evidence**。它能告訴你「這段時間有東西在變」，但沒辦法告訴你「Vision 描述的那個元素**就是**這個在變的元素」。element identity 這件事需要更 ground-truth 的信號，而不是兩組詞彙的模糊比對。

### matcher 不能再嚴的原因

試過的加嚴路線都死：
- **完整 selector match** — rrweb path 被 build tool hash 化（`Layout_container__BVtmP`），Vision prose 不可能產出這種 token → 5 站 collapse 到 0 verified → 等同於放棄 Vision layer
- **Vision 詞彙 → semantic selector 對映** — 依賴 DOM class name 語意化，但 Next.js / CSS Modules / CSS-in-JS 主流 build 會 hash class 名
- **AI semantic embedding matching** — 成本高且重新引入 LLM hallucination 風險

**結論**：用 Vision 當 primary truth source + 任何 post-hoc gate 的路線都是死的。架構要換 source，不是換 gate。

### Round E 進入 Re-Pivot — Tier 1 三管齊下

不再走 LLM-Vision + 後驗證的路線。新方向：三個獨立 evidence source，**conjunction rule（≥2 tier 同意才 verified）**：

| Tier | 技術 | 抓什麼 | 防幻覺性 |
|------|------|--------|:--------:|
| **1.a JS AST** | 靜態分析 loaded bundle（acorn / `@babel/parser`）| `framer-motion` / `gsap` / `motion` / `lottie` / `@react-spring` 的 API 呼叫位置 + 參數 | 高（code = truth）|
| **1.b Differential Render** | Playwright 高幀率 screenshot，scroll offset mask 後求像素殘差 | 不能被「scroll 進出」解釋的真實視覺變化 | 中（仍視覺層，但已 control scroll）|
| **1.c rAF Intercept** | Monkey-patch `requestAnimationFrame` / `Element.animate()` / CSSStyleDeclaration setter，錄 caller + 影響節點 | CSS keyframe / WAAPI / canvas / shader 的實際 render 事件 | 高（runtime callable trace）|

Vision 若保留，只當第 4 個 tier 且權重最低。

### 凍結狀態（以下全部保留，不刪）

| 項目 | 狀態 |
|------|------|
| Phase E3 emitter | Frozen（理由升級：等 Re-Pivot Tier 1 收斂）|
| `tools/animation-extractor/extract-rrweb.mjs` | 保留（infra 日後可能被 Tier 1.c 複用）|
| `tools/animation-extractor/cross-validate.mjs` | 保留（規則引擎 + pure helpers 可能被 Re-Pivot conjunction logic 重用）|
| `round-e/ground-truth/*.json`（E2 baseline）| 保留為 hallucination 對照組 #1 |
| `round-e/ground-truth/pivot/*.json`（E-Pivot 產出）| 保留為 hallucination 對照組 #2（post-gate 仍失敗）|
| 全部 unit tests（80 綠燈）| 保留，none asserts Vision truth |

### Sign-off

**Round E Phase E-Pivot 結束。B+C 架構證實不夠。Re-Pivot Tier 1（JS AST + Differential Render + rAF Intercept）立項，由新 session 接手。詳細 post-mortem 見 `round-e/ARCHIVE-B-C-pivot.md`。**

— Sean @ 2026-04-23
