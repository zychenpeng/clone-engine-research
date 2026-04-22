# Phase E2 Ground-Truth Review（人工 Spot-Check）

Generated: 2026-04-22T09:38:04.651Z · Sean 中文 review 版本

> **Review 方式**：對每個項目打勾 ✅（正確）/ ⚠️（部分正確）/ ❌（AI 幻覺，根本沒這動畫），改完直接在 GitHub 上 commit。

---

## 📖 如何 Review（先讀這段 3 分鐘）

### Step 1：打開網站

每個項目有「網站」+「元素描述」+「動畫類型」三個資訊。你要做的是：**打開那個網站，找到那個元素，看看有沒有那個動畫**。

### Step 2：找到元素

- 用瀏覽器 `Ctrl+F` 搜尋項目裡的文字（例如 "Make product operations self-driving"）
- 按 Enter 跳到位置
- 如果動畫是 `trigger: scroll-in`（滾動進入）→ 先 `Ctrl+Home` 回到頂部，然後**慢慢用滾輪往下滑**直到那個元素出現

### Step 3：判斷動畫類型

動畫類型中英對照（這份 REVIEW 只會出現幾種）：

| 英文代號 | 中文 | 看起來像 |
|---------|------|---------|
| **fade-in** | 淡入 | 元素本來透明，漸漸變清楚 |
| **fade-up** | 淡入+上升 | 透明 + 從下方稍微浮上來 |
| **fade-out** | 淡出 | 本來清楚，漸漸變透明/消失 |
| **slide-left** | 往左滑入 | 從右邊滑進來 |
| **reveal-on-scroll** | 滾動顯現 | 隨滾動才顯現（fade + transform 綜合） |
| **shader-ambient** | WebGL 環境光 | 背景有發光/波動效果（Linear/Stripe hero） |
| **one-shot** | 一次性 | 載入時播放一次就停，非常細微 |
| **continuous** | 持續循環 | 一直在動（logo carousel 那種） |

### Step 4：判斷 trigger 對不對

Trigger 中文對照：

| 英文代號 | 中文 | 什麼時候播 |
|---------|------|----------|
| **on-load** | 載入時 | 頁面打開就播 |
| **scroll-in** | 滾動進入 | 滾動到該元素進入視野時 |
| **scroll-out** | 滾動離開 | 元素要離開視野時 |
| **continuous** | 持續 | 一直在跑 |
| **hover** | 滑鼠懸浮 | 滑鼠移到元素上才播 |

### Step 5：打勾

| 符號 | 意思 | 標準 |
|:---:|------|------|
| ✅ | **正確** | 我看到了這個動畫，type 和 trigger 都對 |
| ⚠️ | **部分正確** | 我看到動畫了，但 type 或 trigger 有點差（例如 AI 說 fade-in 其實是 fade-up） |
| ❌ | **AI 幻覺** | 我**完全沒看到**這個動畫，元素是靜態的 |

**重點**：我們要抓出的是 ❌（AI 幻覺），⚠️ 可以放寬。

### 💡 小訣竅

1. **用無痕視窗**（Ctrl+Shift+N）打開網站 — 避免 cookies 觸發不同 A/B 測試版本
2. **動畫很短**（400-800ms）要注意看，必要時重新載入頁面再看一次
3. **看不出來就給 ⚠️**，不要猶豫太久
4. **Linear 滾動到底**可能要 scroll 10-15 次，耐心一點
5. **GitHub 網頁直接點 `[ ]` checkbox** — 會自動 commit，不用打指令

---

## 📊 5 站總覽

| 網站 | 動畫總數 | DOM | Vision | 兩層重疊 | 最常見類型 | 信心度 | 成本 |
|------|------:|----:|-------:|-----:|:---------------|---------:|-----:|
| linear.app | 35 | 12 | 23 | **0** | fade-in (淡入) 21 個 | 0.901 | $0.13 |
| stripe.com | 111 | 95 | 12 | 4 | one-shot (一次性) 95 個 | 0.968 | $0.12 |
| raycast.com | 50 | 18 | 25 | 7 | fade-in (淡入) 22 個 | 0.866 | $0.14 |
| vercel.com | 25 | 5 | 16 | 4 | reveal-on-scroll (滾動顯現) 5 個 | 0.856 | $0.13 |
| apple.com/mac | 26 | 18 | 5 | 3 | one-shot (一次性) 17 個 | 0.968 | $0.11 |

**合計**：247 個動畫，18 個兩層重疊，**$0.63** Vision 成本

> 預算提醒：Round E 預算 $5，Phase E2 已用 12.6%。

## ⚠️ Linear 零重疊異常（Phase E3 前要解）

Linear 是**唯一一個**兩層 `both = 0` 的網站，其他 4 站都有 3–7 個重疊。

**根因推測**：Linear 的 DOM 動畫全部都是 `iterations=null` 連續 loop（1750–3200ms 循環），而 Vision 抓的是 scroll 觸發的 reveal（~600ms）。merge.mjs 的 `±30% 時長 match` 完全橋不起來。

**Sean 的決定**：Phase E3 前先改 `merge.mjs`，當 Vision trigger 是 `scroll-*` 時**放寬到只比對 keyword**。

---

# 🆕 Linear — 10 個 Round E 新增動畫（vs Round D 舊 ground truth）

Round D 抓到 27 個（12 DOM + 15 Vision）。Round E Vision 抓 23 個，其中 13 個和 Round D 文字有重疊（Jaccard ≥ 0.15），**10 個是 Round E 新增候選**。

**你要判斷**：這 10 個動畫是 Round D 真的漏掉了（✅ 補上）？還是 Round E Vision 在幻覺（❌ 亂猜）？

### L1. `anim-21a33892`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in（滾動進入）/ 500ms / 信心度 0.80 · frames 1,2
- **元素**：標題 `'A new species of product tool'`
- **怎麼找**：開 linear.app → `Ctrl+F` 搜 "A new species" → 如果找到，滾到該位置看有沒有淡入

---

### L2. `anim-5fc3add8`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 700ms / 信心度 0.90 · frames 2,3
- **元素**：三個等距 3D 立體圖形（標記為 FIG 0.2, FIG 0.3, FIG 0.4）
- **怎麼找**：滾動過第一屏之後，找到 3 個 3D 方塊/立體造型（Linear 常用的幾何設計元素）

---

### L3. `anim-70f2330c`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 600ms / 信心度 0.85 · frames 3,4
- **元素**：「Make product operations self-driving」段落
- **怎麼找**：`Ctrl+F` 搜 "Make product operations"

---

### L4. `anim-fc61e00f`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 600ms / 信心度 0.85 · frames 4,5
- **元素**：Issue intake 看板（有 "Todo" 和 "In Progress" 兩欄）
- **怎麼找**：找看起來像 Kanban 看板的元素，應該有「Todo / In Progress」欄位

---

### L5. `anim-2717ef9f`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 400ms / 信心度 0.75 · frames 5
- **元素**：導航項目 '1.1 Linear Agent', '1.2 Triage', '1.3 Customer Requests', '1.4 Linear Asks'
- **怎麼找**：`Ctrl+F` 搜 "1.1 Linear Agent" 或 "Triage"

---

### L6. `anim-e88a5517`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 600ms / 信心度 0.85 · frames 5,6
- **元素**：「Define the product direction」段落
- **怎麼找**：`Ctrl+F` 搜 "Define the product direction"

---

### L7. `anim-f56e98dc`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 400ms / 信心度 0.75 · frames 9,10
- **元素**：導航項目 '3.1 Issues', '3.2 Agents', '3.3 Linear MCP', '3.4 Git automations', '3.5 Cycles'
- **怎麼找**：`Ctrl+F` 搜 "Linear MCP" 或 "Git automations"

---

### L8. `anim-006f7f7f`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 600ms / 信心度 0.85 · frames 10
- **元素**：「Review PRs and agent output」段落
- **怎麼找**：`Ctrl+F` 搜 "Review PRs"

---

### L9. `anim-f0b3a605`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 600ms / 信心度 0.85 · frames 12
- **元素**：「Understand progress at scale」段落
- **怎麼找**：`Ctrl+F` 搜 "Understand progress at scale"

---

### L10. `anim-62e18b52`  [ ] ✅ 正確 [ ] ⚠️ 部分 [ ] ❌ 幻覺
**fade-in（淡入）** / scroll-in / 600ms / 信心度 0.85 · frames 14,15
- **元素**：Changelog 段落，有 4 張卡片
- **怎麼找**：滾到接近底部，找「Changelog」字樣 + 4 張卡片排列

---

# 🔬 跨站 Spot-check（每站 2 個 = 8 個）

### stripe.com（開 https://stripe.com）

#### stripe.com #1（overlap，DOM + Vision 都抓到）  [ ] ✅ [ ] ⚠️ [ ] ❌
**shader-ambient（WebGL 環境光）** / continuous（持續）/ 11950ms / 信心度 0.95 · frames 0,1,2,3,4…
- **元素**：Hero 區的 mesh 漸層背景（繽紛色彩的流動光影）
- **怎麼找**：打開 stripe.com 首頁，看最上方 hero 區的背景 — 應該有**持續流動的光影/顏色變化**（WebGL shader 效果）

---

#### stripe.com #2（只有 Vision 抓到）  [ ] ✅ [ ] ⚠️ [ ] ❌
**slide-left（往左滑）** / continuous（持續）/ 10000ms / 信心度 0.90 · frames 0,1,2,3,4…
- **元素**：客戶 logo 跑馬燈（amazon, nvidia, ford, coinbase, google, shopify, mindbody）
- **怎麼找**：滾到 "Join millions of businesses" 那段附近，找 logo 橫向滾動帶 — 應該**一直往左滑動**

---

### raycast.com（開 https://raycast.com）

#### raycast.com #1（overlap）  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-in（淡入）** / on-load（載入時）/ 1000ms / 信心度 0.90 · frames 0
- **元素**：Hero 背景的紅色斜條紋
- **怎麼找**：打開 raycast.com，看 hero 區背景 — 紅色斜線條紋應該會**淡入出現**（載入時）

---

#### raycast.com #2（只有 Vision 抓到）  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-in（淡入）** / on-load（載入時）/ 600ms / 信心度 0.90 · frames 0
- **元素**：Hero 主文字 'Your shortcut to everything.'
- **怎麼找**：打開 raycast.com，hero 主標應該會**淡入顯示**（載入時，很快 600ms）

---

### vercel.com（開 https://vercel.com）

#### vercel.com #1（overlap）  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-out（淡出）** / scroll-out（滾動離開）/ 300ms / 信心度 0.90 · frames 0,1
- **元素**：最上方 Banner 「Vercel April 2026 security incident」+「Read the bulletin」按鈕
- **怎麼找**：看最上方橫幅 — 往下滾時它應該**淡出消失**（300ms，很快）

---

#### vercel.com #2（只有 Vision 抓到）  [ ] ✅ [ ] ⚠️ [ ] ❌
**reveal-on-scroll（滾動顯現）** / scroll-in / 600ms / 信心度 0.90 · frames 11,12
- **元素**：AI Gateway 程式碼編輯器區塊（有 syntax highlight 語法高亮）
- **怎麼找**：滾到中下段，找 AI Gateway / 程式碼片段的區塊 — 應該滾動靠近時**顯現出來**

---

### apple.com/mac（開 https://www.apple.com/mac/）

#### apple.com/mac #1（overlap）  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-in（淡入）** / scroll-in / 700ms / 信心度 0.90 · frames 6,7
- **元素**：「Help me choose」互動段落，有彩色 hello 文字 + Mac 插圖
- **怎麼找**：`Ctrl+F` 搜 "Help me choose"，滾到該位置看是否淡入

---

#### apple.com/mac #2（只有 Vision 抓到）  [ ] ✅ [ ] ⚠️ [ ] ❌
**fade-up（淡入+上升）** / scroll-in / 800ms / 信心度 0.92 · frames 4,5
- **元素**：「Get to know Mac」功能卡片（Performance, AI, macOS 三張）
- **怎麼找**：`Ctrl+F` 搜 "Get to know" 或 "Performance"，應該有 3 張卡片**從下方浮入**

---

# ✅ Review 完成後做什麼

1. **統計你的勾選**：
   - Linear 10 項：✅ = __ / ⚠️ = __ / ❌ = __
   - 跨站 8 項：✅ = __ / ⚠️ = __ / ❌ = __

2. **通關標準**：
   - **≥ 14/18 是 ✅ 或 ⚠️** → Vision 可信，進 Phase E3 emitter
   - **≥ 5/18 是 ❌** → Vision 幻覺嚴重，要調 prompt

3. **通知新 session**：
   ```
   REVIEW.md 做完：
   - Linear: ✅[x] / ⚠️[y] / ❌[z]
   - 跨站: ✅[x] / ⚠️[y] / ❌[z]
   - 總體可信度：[通關/要調整]
   
   進 Phase E3 emitter。
   ```

---

# Phase E3 前置作業（新 session 已經知道的待辦）

Day 2 review note 已決定，Phase E3 開始前要做：

- [ ] 改 `tools/animation-extractor/merge.mjs` fuzzy match — 當 Vision trigger 是 `scroll-*` 時放寬（DOM 很少知道 scroll 語意）
- [ ] 加第二輪 match：selector-tag 對 element-role（例如 `<h1>` 要 match 到 Vision 標為 "headline" 的項目）
- [ ] 在改 live spec **之前**先寫 unit test（防止 regression）

順序：**unit test → tag-role → scroll duration relax**（test first）

---

*原英文版本 archive 在 git 歷史（commit `c138daa`）。此檔為 Sean 閱讀用的中文翻譯+教學版本，後續由新 session 或本次 review 更新。*
