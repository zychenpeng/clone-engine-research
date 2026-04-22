# Round E Re-Pivot — Human Review (Angle 3 PoC)

**Date**: 2026-04-23  
**Reviewer**: Sean  
**Background**: Angle 3 rAF interception against linear.app 找到 37 `Element.animate` calls + 10 rAF-driven CSS mutation elements。37 calls 實際是 10 個 distinct path × 不同 property，非 37 個獨立動畫。以下 10-item sample 覆蓋全部 distinct path。

---

## 如何 Review（3 分鐘）

用無痕視窗打開 https://linear.app。觀察每個描述的動畫，依三個判斷打勾：

| 符號 | 意思 |
|:---:|------|
| ✅ | **真的有這動畫**，Angle 3 signal 有效 |
| ⚠️ | **有但描述不完全對**（方向/timing 差一點） |
| ❌ | **根本沒這動畫**，false positive |

---

## WAAPI calls（Element.animate — 7 items）

### W1. Hero headline — word reveal (show-mobile spans)

- **Signal type**: `Element.animate` (WAAPI)
- **Path**: `h1.sc-d5151d0-0.bgDIHX > span > span.show-mobile` (12 calls, 4 spans × 3 props)
- **Keyframes**: `opacity`, `filter`, `transform`
- **Duration**: 1000ms | **Easing**: `cubic-bezier(0.25, 0.1, 0.25, 1)` | **t**: ~1983ms (on-load)
- **What to look for**: Hero headline words fade in with blur + upward slide, staggered across words
- **Dedup note**: 12 calls = 4 word-spans × {opacity, filter, transform} — these are 1 stagger animation, not 12

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### W2. Hero headline — word reveal (hide-mobile spans)

- **Signal type**: `Element.animate` (WAAPI)
- **Path**: `h1.sc-d5151d0-0.bgDIHX > span > span.hide-mobile` (6 calls, 2 spans × 3 props)
- **Keyframes**: `opacity`, `filter`, `transform`
- **Duration**: 1000ms | **Easing**: `cubic-bezier(0.25, 0.1, 0.25, 1)` | **t**: ~1983ms (on-load)
- **What to look for**: Same headline, desktop version (hide-mobile spans)
- **Dedup note**: Same animation as W1, different responsive breakpoint. Should merge to 1 spec.

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對（e.g., W1 和 W2 在桌面都可見，沒有分開執行）
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### W3. Hero description paragraph

- **Signal type**: `Element.animate` (WAAPI)
- **Path**: `p.sc-d5151d0-0.dhJTq > span.Hero_description__Clw_0` (3 calls, 1 span × 3 props)
- **Keyframes**: `opacity`, `filter`, `transform`
- **Duration**: 1000ms | **Easing**: `cubic-bezier(0.25, 0.1, 0.25, 1)` | **t**: ~1983ms (on-load)
- **What to look for**: 副標題文字 fade in，與 hero headline 同時段

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### W4. Hero feature link span

- **Signal type**: `Element.animate` (WAAPI)
- **Path**: `a.hide-mobile.Hero_newFeatureLink__PHt6b > span` (3 calls, 1 span × 3 props)
- **Keyframes**: `opacity`, `filter`, `transform`
- **Duration**: 1000ms | **Easing**: `cubic-bezier(0.25, 0.1, 0.25, 1)` | **t**: ~1983ms (on-load)
- **What to look for**: Hero 區塊上方的 "New feature" / 版本公告 badge fade in

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### W5. Frame app background fade-in

- **Signal type**: `Element.animate` (WAAPI)
- **Path**: `div.Frame_wrapper___hKDg > ... > div.Frame_background__iLZh4` (1 call)
- **Keyframes**: `opacity`, `offset` (motion path)
- **Duration**: 1500ms | **Easing**: `cubic-bezier(0.455, 0.03, 0.515, 0.955)` | **t**: ~1983ms (on-load)
- **What to look for**: Hero section 下方的「app frame」（mock Linear interface）的背景從透明淡入，帶 easeInOut

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### W6. Frame sidebar + view fade-in

- **Signal type**: `Element.animate` (WAAPI)
- **Path**: `nav.Sidebar_sidebar__yeDLZ` + `div.Frame_view__tT3ze` (各 1 call)
- **Keyframes**: `opacity`
- **Duration**: 1500ms | **Easing**: `cubic-bezier(0.455, 0.03, 0.515, 0.955)` | **t**: ~1983ms (on-load)
- **What to look for**: App frame 內 sidebar 和主內容區 fade in（可能 staggered）

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### W7. Frame content area opacity fade (rAF)

- **Signal type**: rAF inline style mutation
- **Path**: `div.Bleed_root__EzNZN > ... > div.Frame_frame__xbIar > div` (3 mutations)
- **Before → After**: `opacity: 0` → `opacity: 0.425903` (progressive)
- **t**: 3645ms–6361ms (scroll-driven)
- **What to look for**: App frame 內某個元素，隨 scroll 漸漸顯現（不是 WAAPI，是 rAF loop 逐 frame 推高 opacity）

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

## rAF CSS custom property mutations（3 items）

### R1. Frame shine — mouse-tracking sparkle

- **Signal type**: rAF CSS var mutation
- **Path**: `div.Frame_shine__Ei3zB.Frame_shineInner__wPfoO` (18 mutations)
- **CSS vars**: `--mask-x`, `--mask-y`
- **Before → After**: `--mask-x: 0%; --mask-y: 25%` → `--mask-x: 1.71618%; --mask-y: 12.98675%`
- **t**: 2595ms–3595ms (shortly after page load)
- **What to look for**: App frame 上有 spotlight/sparkle 效果，跟著滑鼠位置或 scroll 移動

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### R2. Section background parallax

- **Signal type**: rAF CSS var mutation
- **Path**: 4 section containers (SlackIssue, Plan, Build, Monitor boxes) 各 12 mutations
- **CSS var**: `--bg-offset-y`
- **Before → After**: `--bg-offset-y: -1271px` → `--bg-offset-y: -1031px` (increases ~240px per scroll step)
- **t**: 4761ms–11595ms (throughout scroll)
- **What to look for**: 各 section 的背景圖或 glow 效果，滾動時有視差（比 content 慢）

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

### R3. Frame scroll shine

- **Signal type**: rAF CSS var mutation
- **Path**: `div.Frame_shine__Ei3zB.Frame_shineScroll__lRFOP` (10 mutations)
- **CSS var**: `--mask-y` only（no --mask-x）
- **Before → After**: `--mask-y: 20%` → `--mask-y: 19.945%` (slowly decreasing)
- **t**: 3145ms–3595ms (early scroll phase)
- **What to look for**: App frame 的 shine 效果有兩種：一種跟滑鼠（R1），一種跟 scroll（這個）

判斷：
- [ ] ✅ 真的有
- [ ] ⚠️ 有但不完全對
- [ ] ❌ 沒有（false positive）

備註：_______________

---

## 決策閘

| 情境 | 行動 |
|------|------|
| ≥8/10 ✅ / ⚠️ | **Angle 3 通過 — 討論 conjunction rule 是否從 ≥2 放寬** |
| 6-7/10 ✅ / ⚠️ | Angle 3 partial pass — 需要 dedup filter + 特定 path 類型排除，才能討論 conjunction |
| ≤5/10 ✅ / ⚠️ 或任何 WAAPI ❌ | Angle 3 fail — 回頭審查 interception script |

---

## 技術確認項（非人工 review — 直接填）

- [ ] 37 WAAPI calls dedup 後 = _____ 個獨立動畫規格（填完這個後再決定 dedup 邏輯）
- [ ] Stripe angle3 結果已跑完：WAAPI calls = _____（若 0 → "Angle 3 primary" 假設裂）
- [ ] Conjunction rule 修改提案由 Sean 簽字，不由 PoC author 單方面生效

---

*Review 完成後 commit，新 session 讀判斷結果後決定 conjunction rule 和下一步。*
