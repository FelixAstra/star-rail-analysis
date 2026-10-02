// ─────────────────────────────────────────────────────────────────────────────
// 「抽卡分析」页的两个图表看板
//
//   A. 吉时 · 平时 · 凶时 的出金分布（W.AlmDash）
//      —— 三档的颗数 / 中位与平均出金抽数、**三块上下排列的小面板直方图**、
//         出金时辰分布，以及必须写在页面上的读图提示与数据表。
//   B. 出金抽数预测与回测（W.PredictDash）
//      —— 各池「已垫 m 抽 → 还要多少抽」、生存曲线（模型 vs 实际）、
//         walk-forward 回测（预测 vs 实际 + P10~P90 带）。
//
// ⚠️ 图表全部**自绘 SVG**：项目零依赖，vendor 里只有 Vue，不引任何图表库。
//    与 divination.js 的罗盘 / 龟壳同一路子。
// ⚠️ 色值一律走 theme.css 的 token（图表样式见 styles.css 的 .dsh-* 段），不在这里写死。
//    吉 = --gold · 平 = --cyan · 凶 = --red（红 = 不利，与股市红涨绿跌无关）。
// ⚠️ 图形几何全部放 computed（数组形式），**不要在 v-for 里调方法取几何** ——
//    那样每个 <text> / <line> 都会重算一遍整个几何，节点一多就卡。
// ⚠️ 浮层位置用**百分比**而不是像素：SVG 是 viewBox 等比缩放，按 viewBox 的宽高
//    换算成百分比后，在任何容器宽度下都落在同一根柱子上，不必去读 getBoundingClientRect
//    （那会强制同步布局，而且在窄屏横向滚动时算出来的是视口坐标，会错位）。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  // ── SVG 版面常量 ────────────────────────────────────────────────────────────
  // ⚠️ viewBox 的宽度要**贴近实际渲染宽度**（桌面内容区约 1060px）：SVG 是等比缩放，
  //    viewBox 若写成 620 而实际画到 1060px，字会被放大 1.7 倍变成巨无霸。
  //    这里整幅取 1000，接近 1:1；窄屏则靠容器横向滚动保持这个比例。
  const STK = {
    w: 1000, h: 368,
    labR: 150,                 // 左侧「组名 + n + 中位」栏的右边界
    plotL: 176, plotR: 976,    // 绘图区左右边界
    top: 14, ph: 78, gap: 30,  // 三块小面板：高 78、间距 30
    barW: 44,
  };
  const STK_BOTTOM = STK.top + 3 * STK.ph + 2 * STK.gap;      // 308

  const SC = { w: 1000, h: 292, L: 52, R: 976, T: 24, B: 222, barW: 46 };

  // 预测看板：并排两张小图（生存曲线 / 回测）
  const HALF = { L: 44, R: 470, T: 18, B: 180, vb: '0 0 480 220' };

  const pct1 = v => (v == null ? '—' : v.toFixed(1));
  const pct0 = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
  const num1 = v => (v == null ? '—' : v.toFixed(1));
  const num0 = v => (v == null ? '—' : String(Math.round(v)));

  /** 把 [x, y] 点列转成 path 的 d；遇到 null 就断开（用于实际样本曲线里的空缺） */
  function toPath(pts) {
    let d = '', pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      pen = true;
    }
    return d;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 看板 A · 吉时 / 平时 / 凶时 的出金分布
  // ═══════════════════════════════════════════════════════════════════════════
  W.AlmDash = {
    inject: ['goto'],
    props: { a: Object },
    data() {
      // 两张图各一个浮层状态。null = 不显示。
      // { left, top, below, main, sub } —— left/top 是相对画布的百分比。
      return { tip: null, tip2: null };
    },
    computed: {
      d() { return this.a.dashboards; },
      al() { return this.d && this.d.almanac; },
      meta() { return this.d && this.d.meta; },

      /** 组名 → 该组统计的查表（直方图面板左侧要用 n / 中位 / 均值 / 角色池占比） */
      bmap() {
        const o = {};
        if (this.al) this.al.buckets.forEach(b => { o[b.key] = b; });
        return o;
      },

      /**
       * 直方图几何：**三块上下排列的小面板**，各自只画一个评级。
       * 比三色挤在同一个区间更容易对应 —— 柱与标签是一对一的。
       * 三块共用横轴区间与纵轴上限，所以柱高可以直接横向比。
       */
      histG() {
        const al = this.al;
        if (!al) return null;
        const h = al.hist, yMax = h.yMax, S = STK;
        const bw = (S.plotR - S.plotL) / h.nBins;      // 800 / 9 ≈ 88.9
        const rows = h.series.map((s, si) => {
          const top = S.top + si * (S.ph + S.gap);
          const bottom = top + S.ph;
          const bins = h.bins.map((b, i) => {
            const v = s.pct[i];
            const cnt = s.counts[i];
            const hh = v == null ? 0 : v / yMax * S.ph;
            const x0 = S.plotL + i * bw;
            return {
              i, lo: b.lo, hi: b.hi, cnt, pct: v, den: s.n,
              cx: x0 + bw / 2,
              hitX: x0 + 1, hitW: bw - 2, hitY: top, hitH: S.ph,
              bx: x0 + (bw - S.barW) / 2, by: bottom - hh, bh: hh,
              cntY: bottom - hh - 4,
            };
          });
          return {
            key: s.key, label: s.label, en: s.en, n: s.n, empty: !s.n,
            st: this.bmap[s.key],
            top, bottom, bins,
            ticks: [0, 0.5, 1].map(f => ({ y: bottom - f * S.ph, v: Math.round(yMax * f) })),
          };
        });
        const xlabels = h.bins.map((b, i) => ({
          x: S.plotL + i * bw + bw / 2, t: b.lo + '–' + b.hi,
        }));
        return { rows, xlabels, S, yMax, bottom: STK_BOTTOM };
      },

      /** 出金时辰分布（十二根柱；每根柱带该时辰覆盖的钟点范围） */
      scG() {
        const al = this.al;
        if (!al) return null;
        const list = al.shichen, S = SC;
        const maxN = Math.max(4, ...list.map(x => x.n));
        const yMax = Math.ceil(maxN / 4) * 4;
        const bw = (S.R - S.L) / 12;                    // 924 / 12 = 77
        const bars = list.map((x, i) => {
          const hh = Math.max(0, x.n / yMax * (S.B - S.T));
          const x0 = S.L + i * bw;
          return {
            i, zhi: x.zhi, n: x.n, pct: x.pct, range: x.range, short: x.short,
            cx: x0 + bw / 2,
            hitX: x0 + 1, hitW: bw - 2, hitY: S.T, hitH: S.B - S.T,
            bx: x0 + (bw - S.barW) / 2, by: S.B - hh, bh: hh,
            cntY: S.B - hh - 5,
          };
        });
        const ticks = [0, 0.5, 1].map(f => ({ y: S.B - f * (S.B - S.T), v: Math.round(yMax * f) }));
        return { bars, ticks, S, yMax };
      },

      /** 数据表（直方图）：一行 = 「某评级 × 某个抽数区间」，逐格列出颗数与分母 */
      histTbl() {
        const g = this.histG;
        if (!g) return [];
        const out = [];
        g.rows.forEach(r => {
          r.bins.forEach(b => out.push({
            id: r.key + '-' + b.i, key: r.key, label: r.label, en: r.en,
            lo: b.lo, hi: b.hi, cnt: b.cnt, den: r.n, pct: b.pct,
          }));
        });
        return out;
      },

      /** 图上方常驻的读图提示（不藏在浮层里 —— 用户看不懂的正是这一句） */
      histHint() {
        return this.L(
          '每组的百分比都以<b>该组自己的五星总数</b>为分母。例如「凶 · 71–80 抽 · 50%」表示这一组里有一半的五星落在 71–80 抽，<b>不是</b>说这个区间每抽有一半概率出金。',
          'Every percentage is a share of <b>that group’s own five-stars</b>. “Ominous · pulls 71–80 · 50%” means half of that group landed in 71–80 — <b>not</b> that a pull in that window has a 50% chance of a 5★.');
      },

      /** 数据来源那一句（数字是运行时的，整句拼好再交给模板） */
      srcTx() {
        const m = this.meta;
        if (!m) return '';
        return this.L(
          '数据源：本地导入的接口记录，共 ' + m.goldTotal + ' 颗五星；纳入统计 ' + m.used +
          ' 颗 —— 排除「保底跨接口窗口」的 ' + m.crossExcluded + ' 颗（那段抽数接口已查不到）与不在角色 / 光锥活动跃迁的 ' + m.poolExcluded + ' 颗。',
          'Source: locally imported API records — ' + m.goldTotal + ' five-stars in total, ' + m.used +
          ' used. Excluded: ' + m.crossExcluded + ' whose pity spans the API retention edge (that stretch is no longer queryable), and ' + m.poolExcluded + ' from pools other than Character / Light Cone Event Warp.');
      },
    },
    methods: {
      pct1, num1,

      // ── 文案 ────────────────────────────────────────────────────────────────
      bucketTx(b) { return this.L(b.label, b.en); },
      medTx(b) {
        if (!b || !b.n) return '';
        return this.L('中位 ' + num0(b.median) + ' 抽', 'Median ' + num0(b.median));
      },
      avgChTx(b) {
        if (!b || !b.n) return '';
        return this.L('均值 ' + num1(b.avg) + ' 抽 · 角色池 ' + num0(b.chShare) + '%',
                      'Mean ' + num1(b.avg) + ' · ' + num0(b.chShare) + '% character pool');
      },
      allMedTx() {
        const o = this.al.overall;
        return this.L('中位 ' + num0(o.median) + ' 抽', 'Median ' + num0(o.median));
      },
      allSubTx() {
        const o = this.al.overall;
        return this.L('均值 ' + num1(o.avg) + ' 抽 · 角色池 ' + num0(o.chShare) + '%',
                      'Mean ' + num1(o.avg) + ' · ' + num0(o.chShare) + '% character pool');
      },

      // ── 浮层文案 ────────────────────────────────────────────────────────────
      /** 一根柱的主行：比如「平 · 71–80 抽」 */
      binMain(r, b) {
        return this.L(r.label + ' · ' + b.lo + '–' + b.hi + ' 抽',
                      r.en + ' · pulls ' + b.lo + '–' + b.hi);
      },
      /** 一根柱的次行：颗数 / 分母 / 组内占比 —— 三个数一起给，省得用户自己除 */
      binSub(r, b) {
        if (!r.n) return this.L('本组暂无样本', 'No five-stars in this group');
        return this.L(b.cnt + '/' + r.n + ' 颗 · ' + b.pct.toFixed(1) + '%',
                      b.cnt + ' of ' + r.n + ' · ' + b.pct.toFixed(1) + '%');
      },
      binAria(r, b) { return this.binMain(r, b) + '，' + this.binSub(r, b); },

      scMain(b) { return b.zhi + ' · ' + b.range; },
      scSub(b) {
        return this.L(b.n + ' 颗 · ' + b.pct.toFixed(1) + '%',
                      b.n + ' five-stars · ' + b.pct.toFixed(1) + '%');
      },
      scAria(b) {
        // ⚠️ 这里**不带地支汉字**：aria-label 走属性层扫描，英文态下不能出现中文。
        //    钟点范围本身就唯一标识了时辰，读屏也更好懂。
        return this.L(b.range + '：' + b.n + ' 颗 · ' + b.pct.toFixed(1) + '%',
                      b.range + ': ' + b.n + ' five-stars · ' + b.pct.toFixed(1) + '%');
      },

      // ── 浮层定位 ────────────────────────────────────────────────────────────
      // 柱顶离画布上缘太近时翻到下方；柱靠近左右边缘时换锚点 ——
      // 否则半个浮层会被 viewBox / 面板边界切掉（最右一档尤其明显）。
      place(cx, barTop, canvasTop, W_, H_) {
        const below = barTop - 8 < canvasTop + 6;
        const f = cx / W_;
        return {
          left: f * 100,
          top: (below ? canvasTop + 4 : barTop - 8) / H_ * 100,
          below,
          at: f < 0.16 ? 'l' : (f > 0.84 ? 'r' : ''),
        };
      },
      showBin(r, b) {
        const S = STK;
        this.tip = Object.assign(this.place(b.cx, b.by, r.top, S.w, S.h), {
          main: this.binMain(r, b), sub: this.binSub(r, b),
        });
      },
      showSC(b) {
        const S = SC;
        this.tip2 = Object.assign(this.place(b.cx, b.by, S.T, S.w, S.h), {
          main: this.scMain(b), sub: this.scSub(b),
        });
      },
      hideTip() { this.tip = null; },
      hideTip2() { this.tip2 = null; },
    },
    template: `
    <div class="sec dsh" v-if="al">
      <h2>{{ L('吉时 · 平时 · 凶时 的出金分布', 'Five-star pulls by almanac rating') }}
        <small>{{ L('只统计本地有精确时间戳的五星记录', 'Uses only five-star records that carry an exact timestamp') }}</small>
      </h2>

      <div class="dsh-cards">
        <div class="dsh-card" v-for="b in al.buckets" :key="b.key" :class="'b-' + b.key">
          <div class="k"><i class="dsh-dot" :class="'d-' + b.key"></i>{{ bucketTx(b) }}</div>
          <div class="v">{{ b.n }}<i>{{ t('颗') }}</i></div>
          <template v-if="b.n">
            <div class="m">{{ medTx(b) }}</div>
            <div class="s">{{ avgChTx(b) }}</div>
            <div class="small" v-if="b.small">{{ L('样本少，仅供回看', 'Few samples — look back only') }}</div>
          </template>
          <div class="small" v-else>{{ L('本组暂无样本', 'No five-stars in this group') }}</div>
        </div>

        <div class="dsh-card b-all">
          <div class="k"><i class="dsh-dot d-all"></i>{{ L('全体对照', 'All five-stars') }}</div>
          <div class="v">{{ al.overall.n }}<i>{{ t('颗') }}</i></div>
          <div class="m">{{ allMedTx() }}</div>
          <div class="s">{{ allSubTx() }}</div>
          <div class="small">{{ L('角色 + 光锥活动跃迁', 'Character + Light Cone') }}</div>
        </div>
      </div>

      <div class="dsh-charts">
        <!-- ① 三块小面板直方图 -->
        <div class="dsh-chart">
          <div class="ct">{{ L('五星在第几抽出现', 'Which pull each five-star arrived on') }}
            <span class="ct-sub">{{ L('按出金当时的黄历评级分组 · 仅展示本地历史记录', 'Grouped by the almanac rating the moment it dropped · local history only') }}</span>
          </div>
          <div class="dsh-hint" v-html="histHint"></div>

          <div class="dsh-scroll">
            <div class="dsh-plot">
              <svg class="dsh-svg" viewBox="0 0 1000 368" width="100%" role="img"
                   :aria-label="L('吉、平、凶三档的出金抽数直方图，三块面板共用同一纵轴刻度', 'Histogram of pulls per five-star, one panel per rating, sharing a single vertical scale')">
                <g v-for="r in histG.rows" :key="'p-' + r.key">
                  <line v-for="t2 in r.ticks" :key="'g' + r.key + t2.v" class="gl"
                        :x1="histG.S.plotL" :x2="histG.S.plotR" :y1="t2.y" :y2="t2.y"/>

                  <text class="bk" :class="'bk-' + r.key" x="14" :y="r.top + 24">{{ L(r.label, r.en) }}</text>
                  <text class="bn" x="42" :y="r.top + 24" v-if="!r.empty">n={{ r.n }} {{ t('颗') }}</text>
                  <template v-if="!r.empty">
                    <text class="bm" x="14" :y="r.top + 46">{{ medTx(r.st) }}</text>
                    <text class="bs" x="14" :y="r.top + 64">{{ avgChTx(r.st) }}</text>
                  </template>
                  <text class="be" x="14" :y="r.top + 46" v-else>{{ L('本组暂无样本', 'No five-stars in this group') }}</text>

                  <text v-for="t2 in r.ticks" :key="'y' + r.key + t2.v" class="by"
                        :x="histG.S.plotL - 8" :y="t2.y" text-anchor="end" dominant-baseline="central">{{ t2.v }}%</text>

                  <g v-for="b in r.bins" :key="'b-' + r.key + b.i" class="bin"
                     tabindex="0" :aria-label="binAria(r, b)"
                     @mouseenter="showBin(r, b)" @mouseleave="hideTip()"
                     @focus="showBin(r, b)" @blur="hideTip()" @click="showBin(r, b)">
                    <rect class="hit" :x="b.hitX" :y="b.hitY" :width="b.hitW" :height="b.hitH"/>
                    <rect v-if="b.cnt > 0" class="bar" :class="'bb-' + r.key"
                          :x="b.bx" :y="b.by" :width="histG.S.barW" :height="b.bh" rx="2"/>
                    <text v-if="b.cnt > 0" class="cnt" :x="b.cx" :y="b.cntY" text-anchor="middle">{{ b.cnt }}</text>
                  </g>
                </g>
                <!-- 纵轴单位：刻度只写数字会被读成「抽数」，这里点明是组内比例 -->
                <text class="by ax-t" :x="histG.S.plotL - 8" y="9" text-anchor="end"
                      >{{ L('占本组五星的比例', 'Share of the group') }}</text>
                <g class="lb">
                  <text v-for="l in histG.xlabels" :key="'x' + l.t" :x="l.x" :y="histG.bottom + 20"
                        text-anchor="middle">{{ l.t }}</text>
                  <text :x="(histG.S.plotL + histG.S.plotR) / 2" :y="histG.bottom + 40" text-anchor="middle" class="ax-t"
                        >{{ L('出金所用抽数（每格 10 抽，从上次五星之后算起）', 'Pulls used per five-star (10-pull bins, counted from your previous 5★)') }}</text>
                </g>
              </svg>
              <div class="dsh-tip" v-if="tip" :class="{ below: tip.below, 'at-l': tip.at === 'l', 'at-r': tip.at === 'r' }"
                   :style="{ left: tip.left + '%', top: tip.top + '%' }">
                <b>{{ tip.main }}</b><span>{{ tip.sub }}</span>
              </div>
            </div>
          </div>
          <div class="dsh-scroll-hint">{{ L('图表可左右滑动查看', 'Scroll the chart sideways') }}</div>

          <details class="dsh-tbl">
            <summary>{{ L('数据表 · 每根柱的精确数值', 'Data table · the exact number behind every bar') }}</summary>
            <table>
              <thead><tr>
                <th>{{ L('评级', 'Rating') }}</th>
                <th>{{ L('抽数区间', 'Pulls') }}</th>
                <th class="c">{{ L('颗数', '5★') }}</th>
                <th class="c">{{ L('该组总数', 'Group n') }}</th>
                <th class="c">{{ L('组内占比', 'Share') }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="r in histTbl" :key="r.id">
                  <td><i class="dsh-dot" :class="'d-' + r.key"></i>{{ L(r.label, r.en) }}</td>
                  <td class="mono">{{ r.lo }}–{{ r.hi }}</td>
                  <td class="c num">{{ r.cnt }}</td>
                  <td class="c num">{{ r.den }}</td>
                  <td class="c num">{{ r.pct == null ? '—' : r.pct.toFixed(1) + '%' }}</td>
                </tr>
              </tbody>
            </table>
          </details>
        </div>

        <!-- ② 出金时辰分布 -->
        <div class="dsh-chart dsh-sm">
          <div class="ct">{{ L('出金时辰分布', 'Five-star pulls by double-hour') }}
            <span class="ct-sub">{{ L('悬停或聚焦某一格看它覆盖的钟点', 'Hover or focus a bar to see the hours it covers') }}</span>
          </div>

          <div class="dsh-scroll">
            <div class="dsh-plot">
              <svg class="dsh-svg" viewBox="0 0 1000 292" width="100%" role="img"
                   :aria-label="L('十二时辰的出金颗数柱状图', 'Bar chart of five-star pulls across the twelve double-hours')">
                <g class="ax">
                  <line v-for="t2 in scG.ticks" :key="'sg' + t2.v" class="gl"
                        :x1="scG.S.L" :x2="scG.S.R" :y1="t2.y" :y2="t2.y"/>
                </g>
                <g v-for="b in scG.bars" :key="'sb' + b.i" class="bin"
                   tabindex="0" :aria-label="scAria(b)"
                   @mouseenter="showSC(b)" @mouseleave="hideTip2()"
                   @focus="showSC(b)" @blur="hideTip2()" @click="showSC(b)">
                  <rect class="hit" :x="b.hitX" :y="b.hitY" :width="b.hitW" :height="b.hitH"/>
                  <rect v-if="b.n" class="bar bb-sc" :x="b.bx" :y="b.by" :width="scG.S.barW" :height="b.bh" rx="2"/>
                  <text v-if="b.n" class="cnt" :x="b.cx" :y="b.cntY" text-anchor="middle">{{ b.n }}</text>
                </g>
                <g class="lb">
                  <text v-for="t2 in scG.ticks" :key="'sy' + t2.v" :x="scG.S.L - 8" :y="t2.y"
                        text-anchor="end" dominant-baseline="central">{{ t2.v }}</text>
                  <template v-for="b in scG.bars" :key="'sz' + b.i">
                    <text class="zhi" :x="b.cx" :y="scG.S.B + 20" text-anchor="middle">{{ b.zhi }}</text>
                    <text class="zrng" :x="b.cx" :y="scG.S.B + 34" text-anchor="middle">{{ b.short }}</text>
                  </template>
                  <text :x="(scG.S.L + scG.S.R) / 2" :y="scG.S.B + 56" text-anchor="middle" class="ax-t"
                        >{{ L('出金时刻落在哪个时辰 —— 它反映的是你的作息，不是游戏机制', 'Which double-hour each five-star landed in — this reflects when you play, not the game') }}</text>
                </g>
              </svg>
              <div class="dsh-tip" v-if="tip2" :class="{ below: tip2.below, 'at-l': tip2.at === 'l', 'at-r': tip2.at === 'r' }"
                   :style="{ left: tip2.left + '%', top: tip2.top + '%' }">
                <b>{{ tip2.main }}</b><span>{{ tip2.sub }}</span>
              </div>
            </div>
          </div>
          <div class="dsh-scroll-hint">{{ L('图表可左右滑动查看', 'Scroll the chart sideways') }}</div>

          <details class="dsh-tbl">
            <summary>{{ L('数据表 · 十二时辰的钟点与颗数', 'Data table · hours and five-stars per double-hour') }}</summary>
            <table>
              <thead><tr>
                <th>{{ L('时辰', 'Double-hour') }}</th>
                <th>{{ L('时间段', 'Hours') }}</th>
                <th class="c">{{ L('颗数', '5★') }}</th>
                <th class="c">{{ L('占比', 'Share') }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="x in al.shichen" :key="'st' + x.i">
                  <td class="dsh-zhi">{{ x.zhi }}</td>
                  <td class="mono">{{ x.range }}</td>
                  <td class="c num">{{ x.n }}</td>
                  <td class="c num">{{ x.pct.toFixed(1) }}%</td>
                </tr>
              </tbody>
            </table>
          </details>
        </div>
      </div>

      <div class="dsh-note">
        <div><b>{{ L('这张图能说什么、不能说什么', 'What this chart does and does not show') }}</b></div>
        <div v-html="L('抽卡结果具有随机性；<b>黄历评级不参与游戏的抽卡概率机制</b> —— 所以这张图<b>不能判断哪个时辰更容易出金</b>。三档之间若有些差距，来自样本波动与你自己的抽卡习惯（例如更愿意在吉时抽），<b>不是因果</b>。',
                        'Warp results are random and <b>the almanac rating plays no part in the game’s drop rates</b> — so this chart <b>cannot tell you when to pull for better odds</b>. Any gap between the groups comes from sampling noise and your own habits (pulling more often at, say, auspicious hours), <b>not causation</b>.')"></div>
        <div v-html="L('每档的均值同时受<b>卡池构成</b>影响（角色池硬保底 90 抽、光锥池 80 抽），所以卡片上另给了该档里角色池的占比；这也是不要拿三档平均数直接比高低的另一个原因。',
                        'Each group’s mean is also shaped by <b>which pool the pulls came from</b> (hard pity is 90 for characters but 80 for light cones), so every card also shows the character-pool share — another reason not to read the three means as a straight comparison.')"></div>
        <div><span class="rd-more" @click="goto('help')">{{ L('完整口径与读法 →', 'Full definitions and how to read it →') }}</span></div>
        <div class="dim">{{ srcTx }}</div>
      </div>
    </div>`,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 看板 B · 出金抽数预测与回测
  // ═══════════════════════════════════════════════════════════════════════════
  W.PredictDash = {
    props: { a: Object },
    data() { return { hoveredDot: null }; },
    computed: {
      d() { return this.a.dashboards; },
      pr() { return this.d && this.d.predict; },
      pools() { return (this.pr && this.pr.pools) || []; },

      /** 生存曲线几何（每池一份，预先算好） */
      survG() {
        return this.pools.map(p => {
          const { L, R, T, B } = HALF;
          const hard = p.hard;
          const X = k => L + k / hard * (R - L);
          const Y = v => B - v / 100 * (B - T);
          return {
            modelPath: toPath(p.survival.model.map((v, i) => [X(i), Y(v)])),
            empPath: toPath(p.survival.empirical.map((v, i) => (v == null ? null : [X(i), Y(v)]))),
            ticks: [0, 50, 100].map(v => ({ y: Y(v), v })),
            xTicks: [0, 0.25, 0.5, 0.75, 1].map(f => ({ x: X(hard * f), v: Math.round(hard * f) })),
            softX: X(p.soft), T, B, L, R,
          };
        });
      },

      /** 回测折线几何（每池一份；样本不足时该池为 null，模板里就不渲染那张图） */
      btG() {
        return this.pools.map(p => {
          const bt = p.backtest;
          if (!bt || !bt.points.length) return null;
          const { L, R, T, B } = HALF;
          const n = bt.points.length, hard = p.hard;
          const X = i => L + (n <= 1 ? 0.5 : (i - 1) / (n - 1)) * (R - L);
          const Y = v => B - Math.min(v, hard) / hard * (B - T);
          const hi = bt.points.map((pt, i) => [X(i + 1), Y(pt.hi)]);
          const lo = bt.points.map((pt, i) => [X(i + 1), Y(pt.lo)]).reverse();
          // ⚠️ 首末两个刻度贴住绘图区左右边界，若还用 text-anchor=middle 居中，
          //    最后一个「第 N 颗」会有一半落到 viewBox 外面被裁掉（右侧尤其明显）。
          //    所以首刻度改成 start、末刻度改成 end；只有一个点时保持居中。
          const idx = n <= 1 ? [0] : [0, n - 1];
          return {
            bandPath: toPath(hi.concat(lo)) + 'Z',
            dots: bt.points.map((pt, i) => ({ x: X(i + 1), y: Y(pt.actual), v: pt.actual, i: pt.i })),
            cumPath: toPath(bt.points.map((pt, i) => [X(i + 1), Y(pt.cumAvg)])),
            predPath: toPath(bt.points.map((pt, i) => [X(i + 1), Y(pt.pred)])),
            ticks: [0, 0.5, 1].map(f => ({ y: Y(hard * f), v: Math.round(hard * f) })),
            xTicks: idx.map(i => ({
              x: X(i + 1), v: bt.points[i].i,
              a: n <= 1 ? 'middle' : (i === 0 ? 'start' : 'end'),
            })),
            T, B, L, R,
          };
        });
      },
      btTip() {
        if (!this.hoveredDot) return null;
        const q = this.hoveredDot.q;
        return {
          pi: this.hoveredDot.pi,
          i: q.i, v: q.v,
          x: Math.max(94, Math.min(386, q.x)),
          y: q.y < 70 ? q.y + 13 : q.y - 58,
        };
      },
    },
    methods: {
      pct1, num1,
      showDot(pi, q) { this.hoveredDot = { pi, q }; },
      hideDot() { this.hoveredDot = null; },
      nameTx(p) { return this.L(p.name, p.nameEn); },
      padTx(p) { return this.L('已垫 ' + p.padded + ' 抽', p.padded + ' pulls in'); },
      winTx(p, d, v) { return this.L(d + ' 抽内 ' + pct0(v), pct0(v) + ' in ' + d); },
      metaTx(p) {
        return this.L(
          '样本 ' + p.samples + ' 颗 · 硬保底 ' + p.hard + ' 抽 · 软保底 ' + p.soft + ' 抽起',
          p.samples + ' samples · hard pity ' + p.hard + ' · soft pity from ' + p.soft);
      },
      btTx(p) {
        const b = p.backtest;
        return this.L(
          '回测 ' + b.n + ' 次 · 覆盖率 ' + pct1(b.coverage) + '% · 平均绝对误差 ' + num1(b.mae) + ' 抽',
          b.n + ' backtests · coverage ' + pct1(b.coverage) + '% · MAE ' + num1(b.mae));
      },
    },
    template: `
    <div class="sec dsh" v-if="pools.length">
      <h2>{{ L('出金抽数预测', 'Pulls to next five-star') }}
        <small>{{ L('保底 + 概率递增模型 · 每次导入自动用最新样本重算', 'Pity + rising-rate model · refit on every import') }}</small>
      </h2>

      <div class="dsh-cards dsh-cards-p">
        <div class="dsh-card b-pred" v-for="p in pools" :key="p.gt">
          <div class="k">{{ nameTx(p) }}</div>
          <div class="s">{{ padTx(p) }}</div>
          <div class="v">{{ num1(p.remain) }}<i>{{ t('抽') }}</i></div>
          <div class="m">{{ L('还要这么多抽（期望值）', 'Expected pulls still to go') }}</div>
          <div class="probs">
            <span>{{ winTx(p, 10, p.p10) }}</span>
            <span>{{ winTx(p, 20, p.p20) }}</span>
            <span>{{ winTx(p, 40, p.p40) }}</span>
          </div>
          <div class="small">{{ metaTx(p) }}</div>
        </div>
      </div>

      <div class="dsh-charts two">
        <div class="dsh-chart" v-for="(p, pi) in pools" :key="'pan-' + p.gt">
          <div class="ct">
            {{ nameTx(p) }}
            <span class="ct-sub" v-if="btG[pi] && p.backtest.n">{{ btTx(p) }}</span>
          </div>

          <svg class="dsh-svg" viewBox="0 0 480 220" width="100%" role="img"
               :aria-label="L('累积出金概率曲线：模型与实际样本', 'Cumulative pull-rate curve: model vs observed')">
            <g class="ax">
              <line v-for="t2 in survG[pi].ticks" :key="'g' + p.gt + t2.v" class="gl"
                    :x1="survG[pi].L" :x2="survG[pi].R" :y1="t2.y" :y2="t2.y"/>
              <line :x1="survG[pi].softX" :x2="survG[pi].softX"
                    :y1="survG[pi].T" :y2="survG[pi].B" class="soft"/>
            </g>
            <path :d="survG[pi].modelPath" class="ln-model"/>
            <path :d="survG[pi].empPath" class="ln-emp"/>
            <g class="lb sm">
              <text v-for="t2 in survG[pi].ticks" :key="'y' + p.gt + t2.v"
                    :x="survG[pi].L - 6" :y="t2.y" text-anchor="end" dominant-baseline="central">{{ t2.v }}%</text>
              <text v-for="t2 in survG[pi].xTicks" :key="'x' + p.gt + t2.v"
                    :x="t2.x" :y="survG[pi].B + 15" text-anchor="middle">{{ t2.v }}</text>
            </g>
          </svg>

          <div class="dsh-axis-note" v-if="btG[pi]">{{ L('回测图 · 横轴：历史第几颗五星 · 纵轴：该颗出金抽数', 'Backtest · X: five-star order · Y: pulls for that five-star') }}</div>
          <svg class="dsh-svg" v-if="btG[pi]" viewBox="0 0 480 220" width="100%" role="img" @mouseleave="hideDot()"
               :aria-label="L('逐颗五星回测：灰色圆点是实际出金抽数，虚线是预测抽数', 'Five-star backtest: gray dots show actual pulls, dashed line shows predicted pulls')">
            <g class="ax">
              <line v-for="t2 in btG[pi].ticks" :key="'bg' + p.gt + t2.v" class="gl"
                    :x1="btG[pi].L" :x2="btG[pi].R" :y1="t2.y" :y2="t2.y"/>
            </g>
            <path :d="btG[pi].bandPath" class="band"/>
            <path :d="btG[pi].cumPath" class="ln-cum"/>
            <path :d="btG[pi].predPath" class="ln-pred"/>
            <g v-for="(q, i) in btG[pi].dots" :key="'d' + p.gt + i" class="dot-point" tabindex="0"
               :aria-label="L('第' + q.i + '颗五星：' + q.v + '抽', 'Five-star #' + q.i + ': ' + q.v + ' pulls')"
               @mouseenter="showDot(pi, q)" @mouseleave="hideDot()"
               @focus="showDot(pi, q)" @blur="hideDot()" @click="showDot(pi, q)">
              <circle :cx="q.x" :cy="q.y" r="8" class="dot-hit"/>
              <circle :cx="q.x" :cy="q.y" r="3" class="dot"/>
            </g>
            <g class="lb sm">
              <text v-for="t2 in btG[pi].ticks" :key="'by' + p.gt + t2.v"
                    :x="btG[pi].L - 6" :y="t2.y" text-anchor="end" dominant-baseline="central">{{ t2.v }}</text>
              <text v-for="t2 in btG[pi].xTicks" :key="'bx' + p.gt + t2.v"
                    :x="t2.x" :y="btG[pi].B + 15" :text-anchor="t2.a">{{ L('第' + t2.v + '颗五星', 'Five-star #' + t2.v) }}</text>
            </g>
            <g v-if="btTip && btTip.pi === pi" class="dot-tip" aria-hidden="true">
              <rect :x="btTip.x - 86" :y="btTip.y" width="172" height="46" rx="7" class="dot-tip-bg"/>
              <text :x="btTip.x" :y="btTip.y + 19" text-anchor="middle" class="dot-tip-main">{{ L('第' + btTip.i + '颗五星', 'Five-star #' + btTip.i) }}</text>
              <text :x="btTip.x" :y="btTip.y + 36" text-anchor="middle" class="dot-tip-sub">{{ L('实际出金：' + btTip.v + ' 抽', 'Actual: ' + btTip.v + ' pulls') }}</text>
            </g>
          </svg>
          <div class="dsh-mini" v-else>{{ L('样本还太少，回测暂不展示', 'Not enough samples for a backtest yet') }}</div>
        </div>
      </div>

      <div class="dsh-legend">
        <span><i class="sw-model"></i>{{ L('模型预测', 'Model') }}</span>
        <span><i class="sw-emp"></i>{{ L('实际累计出金概率（上图）', 'Observed cumulative rate (top chart)') }}</span>
        <span><i class="sw-dot"></i>{{ L('每颗五星实际出金抽数（灰点）', 'Actual pulls per five-star (gray dots)') }}</span>
        <span><i class="sw-cum"></i>{{ L('累积平均', 'Running mean') }}</span>
        <span><i class="sw-band"></i>{{ L('P10 ~ P90 区间', 'P10–P90 band') }}</span>
      </div>

      <div class="dsh-note">
        <div><b>{{ L('怎么读这两张图', 'How to read these') }}</b></div>
        <div v-html="L('单次出金抽数的方差极大（本账号见过 2 抽也见过 82 抽），所以「预测」是<b>期望值</b>，不是「你下一颗一定在第 N 抽出」。真正衡量模型好坏的是<b>覆盖率</b>：实际落在 P10~P90 区间内的比例，理想值约 80%。',
                        'The pull count for a single five-star varies enormously (this account has seen both 2 and 82), so the forecast is an <b>expectation</b>, not “your next five-star lands on pull N”. What measures the model is <b>coverage</b>: the share of outcomes inside the P10–P90 band, ideally around 80%.')"></div>
        <div v-html="L('回测用 <b>walk-forward</b>：预测第 i 颗时只用它之前的数据重新拟合，<b>不偷看未来</b>，所以「预测 vs 实际」的差距是诚实的。图上每个点是那一颗的实际出金抽数，悬停可以看到具体数字。',
                        'The backtest is <b>walk-forward</b>: forecasting the i-th five-star refits on earlier data only — <b>no peeking ahead</b> — which keeps the predicted-vs-actual gap honest. Each dot is the actual pull count of that five-star; hover it for the number.')"></div>
        <div v-html="L('分布来自<b>你自己的历史出金抽数</b>，再用公开发布的机制（角色池 90 抽硬保底 / 74 抽起递增，光锥池 80 / 66）在样本稀疏处兜底 —— 样本越多，数据的话语权越大。',
                        'The distribution comes from <b>your own pull history</b>, with the published mechanics (hard pity 90 / ramp from 74 for characters, 80 / 66 for light cones) filling in where samples are thin — the more data, the more it speaks for itself.')"></div>
        <div v-html="L('竖虚线是<b>软保底起点</b>：从这一抽起单抽概率开始逐抽抬升。',
                        'The dashed vertical line marks <b>where soft pity starts</b> — from there the per-pull rate climbs with every warp.')"></div>
      </div>
    </div>`,
  };
})();
