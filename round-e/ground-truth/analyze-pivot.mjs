// E-Pivot.3 analyzer.
// Reads the 5 site specs + cross-validation audits produced by the new
// 5-stage pipeline and writes:
//   - summary-pivot.json  per-site counts + before/after vs Phase E2
//   - REVIEW-pivot.md     Sean-facing Chinese review form:
//                          · all verified entries (true-positive check)
//                          · 5 rejected samples per site (false-negative check)
//
// Usage: node round-e/ground-truth/analyze-pivot.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SITES = [
  { slug: 'linear.app',    label: 'linear.app' },
  { slug: 'stripe.com',    label: 'stripe.com' },
  { slug: 'raycast.com',   label: 'raycast.com' },
  { slug: 'vercel.com',    label: 'vercel.com' },
  { slug: 'apple.com',     label: 'apple.com/mac' },
];

const MOTION_TYPE_ZH = {
  'fade-in': '淡入',
  'fade-out': '淡出',
  'fade-up': '淡入+上升',
  'slide-left': '往左滑入',
  'slide-right': '往右滑入',
  'slide-up': '向上滑入',
  'slide-down': '向下滑入',
  'scale-in': '放大進入',
  'scale-out': '縮小離開',
  'rotate': '旋轉',
  'reveal-on-scroll': '滾動顯現',
  'hover-lift': '懸浮上浮',
  'hover-glow': '懸浮發光',
  'parallax': '視差',
  'shader-ambient': 'WebGL 環境光',
  'typewriter': '打字機',
  'stagger': '錯落出現',
  'loop': '循環',
  'one-shot': '一次性',
  'other': '其他',
};

const TRIGGER_ZH = {
  'on-load': '載入時',
  'on-mount': '掛載時',
  'scroll-in': '滾動進入',
  'scroll-out': '滾動離開',
  'scroll-progress': '滾動進度',
  'hover': '滑鼠懸浮',
  'focus': '聚焦',
  'click': '點擊',
  'continuous': '持續',
  'unknown': '不明',
};

const REASON_ZH = {
  'no_motion_mutations_recorded': '整個 recording 完全沒 motion mutation（rrweb 零證據）',
  'no_keywords_in_vision_element': 'Vision 的 element 描述太短，抽不出 keyword',
  'no_motion_in_time_window': 'Vision 宣稱的時間窗內 rrweb 沒 motion mutation',
  'element_mismatch_in_window': '時間窗內有 motion，但元素（selector / class）不對',
};

function loadJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function motionZh(t) { return MOTION_TYPE_ZH[t] || t; }
function triggerZh(t) { return TRIGGER_ZH[t] || t; }

// Pick up to N rejected verdicts, preferring one from each
// (reason × motion_type) bucket so Sean sees diverse cases.
function sampleRejected(verdicts, n = 5) {
  const rejected = verdicts.filter((v) => v.verdict === 'rejected');
  const buckets = new Map();
  for (const v of rejected) {
    const k = `${v.reason}|${v.motion_type || '?'}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(v);
  }
  // Round-robin across buckets
  const picked = [];
  const iters = [...buckets.values()].map((arr) => arr[Symbol.iterator]());
  while (picked.length < n) {
    let grew = false;
    for (const it of iters) {
      const nx = it.next();
      if (!nx.done) {
        picked.push(nx.value);
        grew = true;
        if (picked.length >= n) break;
      }
    }
    if (!grew) break;
  }
  return picked;
}

function triggerBadge(trigger) {
  const zh = triggerZh(trigger);
  return zh === trigger ? trigger : `${trigger}（${zh}）`;
}

function motionBadge(motion_type) {
  const zh = motionZh(motion_type);
  return zh === motion_type ? motion_type : `${motion_type}（${zh}）`;
}

function fmtWindow(w) {
  if (!w) return '—';
  const src = w.source ? ` · ${w.source}` : '';
  return `t=${w.lo}ms → ${w.hi}ms${src}`;
}

function fmtVerified(v, i, site) {
  const lines = [];
  lines.push(`### ${site} V${i + 1}. [${motionBadge(v.motion_type)} / ${triggerBadge(v.trigger)}]`);
  lines.push('');
  lines.push('- **Element 描述**：' + v.element);
  lines.push('- **Window**：' + fmtWindow(v.window));
  lines.push(`- **rrweb 證據**：t=${v.evidence.mutation_t}ms，props=\`${v.evidence.motion_props.join(', ')}\``);
  lines.push(`- **證據 selector**：\`${(v.evidence.mutation_path || '').slice(0, 120)}\``);
  lines.push('- **判斷**：');
  lines.push('  - [ ] ✅ 真的有這動畫（true positive — 系統對）');
  lines.push('  - [ ] ⚠️ 有動畫但描述不完全對（type 或 trigger 差一點）');
  lines.push('  - [ ] ❌ 根本沒這動畫（幻覺，和 E2 一樣 — 系統還有漏網之魚）');
  lines.push('');
  return lines.join('\n');
}

function fmtRejected(v, i, site) {
  const lines = [];
  lines.push(`### ${site} R${i + 1}. [${motionBadge(v.motion_type)} / ${triggerBadge(v.trigger)}]`);
  lines.push('');
  lines.push('- **Element 描述**：' + v.element);
  lines.push('- **Window**：' + fmtWindow(v.window));
  lines.push(`- **拒絕原因**：\`${v.reason}\`（${REASON_ZH[v.reason] || '未分類'}）`);
  lines.push('- **判斷**：');
  lines.push('  - [ ] ✅ 同意拒絕（真的沒這動畫 — 系統對）');
  lines.push('  - [ ] ⚠️ 有動畫但描述細節確實不對（部分冤枉）');
  lines.push('  - [ ] ❌ 有冤枉！真的有這動畫，cross-validator 誤判（false negative — 系統有問題）');
  lines.push('');
  return lines.join('\n');
}

function main() {
  // Load all pivot data
  const sites = SITES.map((s) => {
    const spec = loadJSON(path.join(HERE, 'pivot', `${s.slug}.spec.json`));
    const audit = loadJSON(path.join(HERE, 'pivot', `${s.slug}.audit.json`));
    const e2Spec = (() => {
      try {
        return loadJSON(path.join(HERE, `${s.slug}.json`));
      } catch {
        return null;
      }
    })();
    return { ...s, spec, audit, e2Spec };
  });

  const summary = {
    generated_at: new Date().toISOString(),
    pipeline_version: 'E-Pivot.3 (5-stage: dom + rrweb + vision + cross-validate + merge)',
    sites: sites.map(({ label, spec, audit, e2Spec }) => ({
      site: label,
      e2_baseline: {
        total: e2Spec?.total ?? null,
        vision_count: e2Spec?.by_provenance?.vision ?? null,
        overlap: e2Spec?.by_provenance?.both ?? null,
      },
      pivot: {
        vision_candidates: audit.stats.total_candidates,
        verified: audit.stats.verified,
        rejected: audit.stats.rejected,
        verification_rate: audit.stats.verification_rate,
        motion_mutations_available: audit.stats.motion_mutations_available,
        rejection_by_reason: audit.stats.by_reason,
        final_spec_total: spec.total,
        final_by_provenance: spec.by_provenance,
      },
    })),
    totals: {
      vision_candidates: sites.reduce((s, x) => s + x.audit.stats.total_candidates, 0),
      verified: sites.reduce((s, x) => s + x.audit.stats.verified, 0),
      rejected: sites.reduce((s, x) => s + x.audit.stats.rejected, 0),
      motion_mutations_available: sites.reduce((s, x) => s + x.audit.stats.motion_mutations_available, 0),
      final_spec_total: sites.reduce((s, x) => s + x.spec.total, 0),
      e2_baseline_total: sites.reduce((s, x) => s + (x.e2Spec?.total || 0), 0),
    },
  };
  writeFileSync(path.join(HERE, 'summary-pivot.json'), JSON.stringify(summary, null, 2));

  // --- Build REVIEW-pivot.md ---
  const out = [];

  out.push('# Phase E-Pivot Ground-Truth Review（人工 Spot-Check 第二輪）');
  out.push('');
  out.push(`Generated: ${summary.generated_at}`);
  out.push('');
  out.push('> **背景**：第一輪 Phase E2 REVIEW.md 你做完 18/18 全部 ❌ 幻覺，觸發了 PIVOT.md 的 B+C 架構改寫（加 rrweb DOM mutation recorder + cross-validator 作為 Vision 候選的 gate）。這份是跑 5-stage 新 pipeline 後的結果，要你再看一次系統現在有沒有把事情做對。');
  out.push('');
  out.push('---');
  out.push('');
  out.push('## 📖 如何 Review（3 分鐘）');
  out.push('');
  out.push('### 和上次（E2 REVIEW.md）差在哪');
  out.push('');
  out.push('上一輪全部都是 ✅/⚠️/❌ 直接判 Vision 對不對。這一輪因為 cross-validator 已經自動拒絕了絕大多數 Vision 候選，所以**兩種 section 要分開看**：');
  out.push('');
  out.push('1. **VERIFIED 區**（通過 rrweb 驗證的少數項目）— 理論上應該是真的，你要抓出**還是幻覺**的漏網之魚。');
  out.push('2. **REJECTED 區**（被 cross-validator 拒絕的大多數項目）— 你要**反向抽查**：系統會不會**冤枉了**真的有的動畫（false negative）？每站 5 個代表樣本。');
  out.push('');
  out.push('### 兩種打勾標準');
  out.push('');
  out.push('**VERIFIED 項目**（Vision 說有 + rrweb 有 motion mutation 背書）：');
  out.push('');
  out.push('| 符號 | 意思 | 代表 |');
  out.push('|:---:|------|------|');
  out.push('| ✅ | **真的有這動畫** | 系統對，保留 |');
  out.push('| ⚠️ | **有動畫但描述不完全對** | 系統大致對（type 或 trigger 差一點）|');
  out.push('| ❌ | **根本沒這動畫（幻覺）** | 系統還是漏了一個 false positive（壞消息）|');
  out.push('');
  out.push('**REJECTED 項目**（Vision 說有 + rrweb 沒背書）：');
  out.push('');
  out.push('| 符號 | 意思 | 代表 |');
  out.push('|:---:|------|------|');
  out.push('| ✅ | **同意拒絕** | 真的沒這動畫，系統對 |');
  out.push('| ⚠️ | **部分冤枉** | 有動畫但 Vision 的描述細節確實不對 |');
  out.push('| ❌ | **冤枉！** | 真的有這動畫，cross-validator 誤判（false negative，系統要改）|');
  out.push('');
  out.push('### Step 1：打開網站找元素');
  out.push('');
  out.push('用無痕視窗（Ctrl+Shift+N）打開網站，用 Ctrl+F 搜尋 element 描述中的文字跳到位置。如果 trigger 是 `scroll-in`，先回頂部再慢慢滑。');
  out.push('');
  out.push('### Step 2：動畫類型中英對照');
  out.push('');
  out.push('| 英文代號 | 中文 | 看起來像 |');
  out.push('|---------|------|---------|');
  out.push('| **fade-in** | 淡入 | 元素從透明變清楚 |');
  out.push('| **fade-up** | 淡入+上升 | 透明 + 從下方浮上來 |');
  out.push('| **fade-out** | 淡出 | 從清楚變透明 |');
  out.push('| **slide-left/right/up/down** | 滑入 | 從某方向滑進來 |');
  out.push('| **scale-in/out** | 放大/縮小進入 | 大小變化 |');
  out.push('| **reveal-on-scroll** | 滾動顯現 | 隨滾動才顯現 |');
  out.push('| **shader-ambient** | WebGL 環境光 | 背景發光/波動 |');
  out.push('| **parallax** | 視差 | 背景和前景滾動速度不同 |');
  out.push('| **loop** | 循環 | 一直在動（logo carousel 那種）|');
  out.push('| **one-shot** | 一次性 | 載入時播放一次就停 |');
  out.push('');
  out.push('### Step 3：Trigger 中英對照');
  out.push('');
  out.push('| 英文 | 中文 | 什麼時候播 |');
  out.push('|------|------|----------|');
  out.push('| **on-load** | 載入時 | 頁面打開就播 |');
  out.push('| **scroll-in** | 滾動進入 | 滾動到該元素才播 |');
  out.push('| **scroll-out** | 滾動離開 | 元素離開視野時 |');
  out.push('| **continuous** | 持續 | 一直在跑 |');
  out.push('| **hover** | 懸浮 | 滑鼠移上去才播 |');
  out.push('');
  out.push('### 💡 小訣竅');
  out.push('');
  out.push('1. **VERIFIED 區很短**（全站總共 3 個，stripe 就佔了全部）— 先把這 3 個看完再看 REJECTED。');
  out.push('2. **REJECTED 區** 5/站 × 5 站 = 25 個。動畫看不出來直接給 ⚠️，不要糾結太久。');
  out.push('3. **如果 ❌（冤枉）很多**，代表 cross-validator 要放寬（keyword match、time window、還是 motion prop 集合）；會寫進下一輪 iteration。');
  out.push('4. **GitHub 網頁直接點 checkbox 自動 commit**。');
  out.push('');
  out.push('---');
  out.push('');

  // Per-site summary
  out.push('## 📊 E-Pivot 對照 E2 總覽');
  out.push('');
  out.push('| 網站 | E2 Total | E2 → Pivot (final) | Vision 候選 | Verified | Rejected | Motion muts 可用 |');
  out.push('|------|--------:|:-------------------|-----------:|---------:|---------:|----------------:|');
  for (const s of summary.sites) {
    const arrow = `${s.e2_baseline.total ?? '—'} → **${s.pivot.final_spec_total}**`;
    out.push(
      `| ${s.site} | ${s.e2_baseline.total ?? '—'} | ${arrow} | ${s.pivot.vision_candidates} | ${s.pivot.verified} | ${s.pivot.rejected} | ${s.pivot.motion_mutations_available} |`
    );
  }
  out.push('');
  out.push(`**合計**：Vision 候選 **${summary.totals.vision_candidates}**，通過 **${summary.totals.verified}**（${(summary.totals.verified / summary.totals.vision_candidates * 100).toFixed(1)}%），拒絕 **${summary.totals.rejected}**。Final spec 總量 ${summary.totals.e2_baseline_total} → **${summary.totals.final_spec_total}**（DOM-dominated，少但乾淨）。`);
  out.push('');
  out.push('> **預期解讀**：Verified rate 3.8% 遠低於 PIVOT.md §4.1 的 10% 目標。關鍵是：這 3 個 verified 是不是真的，以及 76 個 rejected 有沒有冤枉。');
  out.push('');
  out.push('---');
  out.push('');

  // --- Verified section ---
  out.push('# ✅ VERIFIED — true positive check（3 項全看）');
  out.push('');
  out.push('> 全站 corpus 只有 **3 個 verified**（都在 Stripe），以下逐個評。');
  out.push('');

  let verifiedIdx = 0;
  for (const s of sites) {
    const verified = s.audit.verdicts.filter((v) => v.verdict === 'verified');
    if (verified.length === 0) continue;
    out.push(`## ${s.label}（${verified.length} 個 verified）`);
    out.push('');
    verified.forEach((v) => {
      out.push(fmtVerified(v, verifiedIdx, s.label));
      verifiedIdx++;
    });
    out.push('---');
    out.push('');
  }

  // --- Rejected section ---
  out.push('# ❓ REJECTED — false-negative spot-check（5/站）');
  out.push('');
  out.push('> 每站 5 個代表樣本，系統自動依 (rejection reason × motion_type) 分桶取差異大的。檢查：cross-validator 是不是冤枉了真的存在的動畫。');
  out.push('');

  for (const s of sites) {
    const samples = sampleRejected(s.audit.verdicts, 5);
    const breakdown = s.audit.stats.by_reason || {};
    const breakdownStr = Object.entries(breakdown).map(([k, v]) => `${k}=${v}`).join(', ') || '—';
    out.push(`## ${s.label}（共 ${s.audit.stats.rejected} 個拒絕；原因：${breakdownStr}）`);
    out.push('');
    samples.forEach((v, i) => {
      out.push(fmtRejected(v, i, s.label));
    });
    out.push('---');
    out.push('');
  }

  // --- Next steps ---
  out.push('# 🚦 決策閘');
  out.push('');
  out.push('Review 完後，根據標記結果決定下一步：');
  out.push('');
  out.push('| 情境 | 行動 |');
  out.push('|------|------|');
  out.push('| VERIFIED 區 3/3 都是 ✅ / ⚠️，REJECTED 區 ❌ 冤枉 ≤ 2 | **通過 E-Pivot.4 → 開 Phase E3 emitter** |');
  out.push('| VERIFIED 區出現 ❌ 幻覺 | cross-validator 還要再緊（tighter keyword match / element role gating） |');
  out.push('| REJECTED 區 ❌ 冤枉 ≥ 3 | cross-validator 太嚴（放寬 time window / 降低 min_matches / 加 selector-tag match） |');
  out.push('| 混合問題 | 討論後列 E-Pivot.5 iteration |');
  out.push('');
  out.push('---');
  out.push('');
  out.push('*Review 完成後，把這份 commit 回 repo，新 session 讀你的判斷後決定是否進 E3 emitter。*');
  out.push('');

  writeFileSync(path.join(HERE, 'REVIEW-pivot.md'), out.join('\n'));

  console.log(`[analyze-pivot] ${summary.totals.vision_candidates} Vision candidates total, ${summary.totals.verified} verified, ${summary.totals.rejected} rejected`);
  console.log('[analyze-pivot] wrote summary-pivot.json + REVIEW-pivot.md');
}

main();
