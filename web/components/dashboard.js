// ─────────────────────────────────────────────────────────────────────────────
// 「抽卡分析」页的两个图表看板
//
//   A. 吉时 · 平时 · 凶时 的出金分布（W.AlmDash）
//      —— 三档的颗数 / 占比 / 平均出金抽数（带 95% 置信区间）、三组并排直方图、
//         出金时辰分布，以及必须写在页面上的机制说明。
//   B. 出金抽数预测与回测（W.PredictDash）
//      —— 各池「已垫 m 抽 → 还要多少抽」、生存曲线（模型 vs 实际）、
//         walk-forward 回测（预测 vs 实际 + P10~P90 带）。
//
// ⚠️ 图表全部**自绘 SVG**：项目零依赖，vendor 里只有 Vue，不引任何图表库。
//    与 divination.js 的罗盘 / 龟壳同一路子。
// ⚠️ 色值一律走 theme.css 的 token（定义见 styles.css 的 .dsh-* 段），不在这里写死。
//    吉 = --gold · 平 = --cyan · 凶 = --red（红 = 不利，与股市红涨绿跌无关）。
// ⚠️ 图形几何全部放 computed（数组形式），**不要在 v-for 里调方法取几何** ——
//    那样每个 <text> / <line> 都会重算一遍整个几何，节点一多就卡。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  // ── SVG 版面常量 ────────────────────────────────────────────────────────────
  // ⚠️ viewBox 的宽度要**贴近实际渲染宽度**（桌面内容区约 1060px）：SVG 是等比缩放，
  //    viewBox 若写成 620 而实际画到 1060px，字会被放大 1.7 倍变成巨无霸。
  //    这里整幅图取 1000（容器 ≈1060），并排小面板取 480（容器 ≈510），接近 1:1。
  const WIDE = { L: 52, R: 980, T: 20, B: 200, vb: '0 0 1000 260' };
  const HALF = { L: 44, R: 470, T: 18, B: 180, vb: '0 0 480 220' };

  const pct1 = v => (v == null ? '—' : v.toFixed(1));
  const pct0 = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
  const num1 = v => (v == null ? '—' : v.toFixed(1));

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
    props: { a: Object },
    computed: {
      d() { return this.a.dashboards; },
      al() { return this.d && this.d.almanac; },
      meta() { return this.d && this.d.meta; },

      /** 三组并排直方图：柱高用**组内占比**（三组颗数不同，只有形状可比） */
      histGeom() {
        if (!this.al) return null;
        const h = this.al.hist;
        const { L, R, T, B } = WIDE;
        const maxPct = Math.max(4, ...h.series.flatMap(s => s.pct));
        const yMax = Math.ceil(maxPct / 10) * 10;
        const bw = (R - L) / h.nBins;
        const gw = Math.max(4, Math.min(14, (bw - 6) / 3));
        const bars = [];
        h.series.forEach((s, si) => {
          s.pct.forEach((v, bi) => {
            const x0 = L + bi * bw + (bw - (gw * 3 + 4)) / 2 + si * (gw + 2);
            const hh = Math.max(0, v / yMax * (B - T));
            bars.push({ x: x0, y: B - hh, w: gw, h: hh, cls: 'bb-' + s.key });
          });
        });
        const ticks = [0, 0.5, 1].map(f => ({ y: B - f * (B - T), v: Math.round(yMax * f) }));
        // 每 3 个区间标一个，且**最后一个区间必须标出来**（否则最右端读不出刻度）
        const xlabels = h.labels.map((t, i) => ({ x: L + i * bw + bw / 2, t, i }))
          .filter(o => o.i % 3 === 0 || o.i === h.nBins - 1);
        return { bars, ticks, xlabels, L, R, T, B };
      },

      /** 出金时辰分布（十二根柱） */
      scGeom() {
        if (!this.al) return null;
        const sc = this.al.shichen;
        const { L, R, T, B } = WIDE;
        const maxN = Math.max(4, ...sc.map(x => x.n));
        const yMax = Math.ceil(maxN / 4) * 4;
        const bw = (R - L) / 12;
        const bars = sc.map((x, i) => {
          const hh = Math.max(0, x.n / yMax * (B - T));
          return { x: L + i * bw + bw * 0.16, y: B - hh, w: bw * 0.68, h: hh, zhi: x.zhi, n: x.n, pct: x.pct };
        });
        const ticks = [0, 0.5, 1].map(f => ({ y: B - f * (B - T), v: Math.round(yMax * f) }));
        return { bars, ticks, L, R, T, B };
      },

      /** 置信区间条：以角色池硬保底 90 抽作统一刻度，三组才能横向比 */
      ciGeom() {
        if (!this.al) return null;
        const mk = b => {
          if (!b || !b.ci || b.ci[0] == null) return null;
          return {
            left: b.ci[0] / 90 * 100,
            width: Math.max(1.5, (b.ci[1] - b.ci[0]) / 90 * 100),
            mid: b.avg == null ? null : b.avg / 90 * 100,
          };
        };
        const o = {};
        this.al.buckets.forEach(b => { o[b.key] = mk(b); });
        o.all = mk(this.al.overall);
        return o;
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
      avgTx(b) { return this.L('平均出金 ' + num1(b.avg) + ' 抽', 'Avg. ' + num1(b.avg) + ' pulls'); },
      allAvgTx() { return this.L('平均出金 ' + num1(this.al.overall.avg) + ' 抽', 'Avg. ' + num1(this.al.overall.avg) + ' pulls'); },
      allCiTx() {
        const c = this.al.overall.ci;
        if (!c || c[0] == null) return '';
        return this.L('95% 置信区间 ' + c[0].toFixed(0) + '–' + c[1].toFixed(0) + ' 抽',
                      '95% CI ' + c[0].toFixed(0) + '–' + c[1].toFixed(0) + ' pulls');
      },
      ciTx(b) {
        if (b.ci[0] == null) return '';
        return this.L('95% 置信区间 ' + b.ci[0].toFixed(0) + '–' + b.ci[1].toFixed(0) + ' 抽',
                      '95% CI ' + b.ci[0].toFixed(0) + '–' + b.ci[1].toFixed(0) + ' pulls');
      },
      bucketTx(b) { return this.L(b.label + '时', b.en + ' hours'); },
    },
    template: `
    <div class="sec dsh" v-if="al">
      <h2>{{ L('吉时 · 平时 · 凶时 的出金分布', 'Five-star pulls by almanac rating') }}
        <small>{{ L('只统计本地有精确时间戳的五星记录', 'Uses only five-star records that carry an exact timestamp') }}</small>
      </h2>

      <div class="dsh-cards">
        <div class="dsh-card" v-for="(b, i) in al.buckets" :key="b.key" :class="'b-' + b.key">
          <div class="k">{{ bucketTx(b) }}</div>
          <div class="v">{{ b.n }}<i>{{ t('颗') }}</i></div>
          <div class="s">{{ b.pct.toFixed(1) }}%</div>
          <div class="m">{{ avgTx(b) }}</div>
          <div class="ci" v-if="ciGeom[b.key]" :title="ciTx(b)">
            <span class="cibar">
              <i :style="{ left: ciGeom[b.key].left + '%', width: ciGeom[b.key].width + '%' }"></i>
              <b v-if="ciGeom[b.key].mid != null" :style="{ left: ciGeom[b.key].mid + '%' }"></b>
            </span>
          </div>
          <div class="small" v-if="b.small">{{ L('样本不足，均值不可靠', 'Too few samples — mean unreliable') }}</div>
        </div>

        <div class="dsh-card b-all">
          <div class="k">{{ L('全体对照', 'All five-stars') }}</div>
          <div class="v">{{ al.bucketTotal }}<i>{{ t('颗') }}</i></div>
          <div class="s">100.0%</div>
          <div class="m">{{ allAvgTx() }}</div>
          <div class="ci" v-if="ciGeom.all" :title="allCiTx()">
            <span class="cibar">
              <i :style="{ left: ciGeom.all.left + '%', width: ciGeom.all.width + '%' }"></i>
              <b v-if="ciGeom.all.mid != null" :style="{ left: ciGeom.all.mid + '%' }"></b>
            </span>
          </div>
          <div class="small">{{ L('角色 + 光锥活动跃迁', 'Character + Light Cone') }}</div>
        </div>
      </div>

      <div class="dsh-charts">
        <div class="dsh-chart">
          <div class="ct">{{ L('出金抽数分布（每档各自的占比）', 'Pulls per five-star (share within each rating)') }}</div>
          <svg class="dsh-svg" viewBox="0 0 1000 260" width="100%" role="img"
               :aria-label="L('吉、平、凶三档的出金抽数直方图', 'Histogram of pulls per five-star, split by rating')">
            <g class="ax">
              <line v-for="t2 in histGeom.ticks" :key="'g' + t2.v"
                    :x1="histGeom.L" :x2="histGeom.R" :y1="t2.y" :y2="t2.y"/>
            </g>
            <rect v-for="(b, i) in histGeom.bars" :key="'b' + i" :x="b.x" :y="b.y"
                  :width="b.w" :height="b.h" :class="b.cls" rx="1"/>
            <g class="lb">
              <text v-for="t2 in histGeom.ticks" :key="'y' + t2.v" :x="histGeom.L - 8" :y="t2.y"
                    text-anchor="end" dominant-baseline="central">{{ t2.v }}%</text>
              <text v-for="l in histGeom.xlabels" :key="'x' + l.t" :x="l.x" :y="histGeom.B + 16"
                    text-anchor="middle">{{ l.t }}</text>
              <text :x="(histGeom.L + histGeom.R) / 2" :y="histGeom.B + 34" text-anchor="middle" class="ax-t"
                    >{{ L('出金用了多少抽（横轴每格为一个抽数区间）', 'Pulls used per five-star (each tick is a bin)') }}</text>
            </g>
          </svg>
        </div>

        <div class="dsh-chart">
          <div class="ct">{{ L('出金时辰分布', 'Five-star pulls by double-hour') }}</div>
          <svg class="dsh-svg" viewBox="0 0 1000 260" width="100%" role="img"
               :aria-label="L('十二时辰的出金颗数柱状图', 'Bar chart of five-star pulls across the twelve double-hours')">
            <g class="ax">
              <line v-for="t2 in scGeom.ticks" :key="'sg' + t2.v"
                    :x1="scGeom.L" :x2="scGeom.R" :y1="t2.y" :y2="t2.y"/>
            </g>
            <rect v-for="(b, i) in scGeom.bars" :key="'sb' + i" :x="b.x" :y="b.y"
                  :width="b.w" :height="b.h" class="bb-sc" rx="2"/>
            <g class="lb">
              <text v-for="t2 in scGeom.ticks" :key="'sy' + t2.v" :x="scGeom.L - 8" :y="t2.y"
                    text-anchor="end" dominant-baseline="central">{{ t2.v }}</text>
              <template v-for="(b, i) in scGeom.bars" :key="'sz' + i">
                <text :x="b.x + b.w / 2" :y="scGeom.B + 16" text-anchor="middle" class="zhi">{{ b.zhi }}</text>
                <text v-if="b.n" :x="b.x + b.w / 2" :y="b.y - 5" text-anchor="middle" class="cnt">{{ b.n }}</text>
              </template>
              <text :x="(scGeom.L + scGeom.R) / 2" :y="scGeom.B + 34" text-anchor="middle" class="ax-t"
                    >{{ L('出金时刻落在哪个时辰 —— 它反映的是你的作息，不是游戏机制', 'Which double-hour each five-star landed in — this reflects when you play, not the game') }}</text>
            </g>
          </svg>
        </div>
      </div>

      <div class="dsh-note" :class="{ warn: al.allOverlap }">
        <div><b>{{ L('机制说明', 'What this does and does not show') }}</b></div>
        <div v-html="L('出金是独立同分布的随机过程，<b>游戏机制里没有「黄历」这个变量</b>。三档之间的均值差异若出现，来自样本波动与你自己偏好什么时候抽卡，<b>不是因果</b>。',
                        'Pulls are an independent random process — <b>the game has no notion of the almanac</b>. Any gap between ratings comes from sampling noise and when you happen to play, <b>not causation</b>.')"></div>
        <div v-if="al.allOverlap" v-html="L('本账号三档的 95% 置信区间<b>两两重叠</b>，即当前的均值差异可以被随机性完全解释 —— 不要据此判断「哪个时辰更欧」。',
                        'For this account the 95% confidence intervals of all three ratings <b>overlap pairwise</b>, so the differences are fully explainable by chance — do not read them as “this hour is luckier”.')"></div>
        <div v-html="L('每档的均值同时受<b>卡池构成</b>影响（角色池硬保底 90 抽、光锥池 80 抽），所以卡片上另给了该档里角色池的占比。',
                        'Each mean is also shaped by <b>which pool the pulls came from</b> (hard pity is 90 for characters but 80 for light cones), so each card also shows the character-pool share.')"></div>
        <div class="dim">{{ srcTx }}</div>
      </div>
    </div>`,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 看板 B · 出金抽数预测与回测
  // ═══════════════════════════════════════════════════════════════════════════
  W.PredictDash = {
    props: { a: Object },
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
          return {
            bandPath: toPath(hi.concat(lo)) + 'Z',
            dots: bt.points.map((pt, i) => ({ x: X(i + 1), y: Y(pt.actual) })),
            cumPath: toPath(bt.points.map((pt, i) => [X(i + 1), Y(pt.cumAvg)])),
            predPath: toPath(bt.points.map((pt, i) => [X(i + 1), Y(pt.pred)])),
            ticks: [0, 0.5, 1].map(f => ({ y: Y(hard * f), v: Math.round(hard * f) })),
            xTicks: [0, n - 1].map(i => ({ x: X(i + 1), v: bt.points[i].i })),
            T, B, L, R,
          };
        });
      },
    },
    methods: {
      pct1, num1,
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
              <line v-for="t2 in survG[pi].ticks" :key="'g' + p.gt + t2.v"
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

          <svg class="dsh-svg" v-if="btG[pi]" viewBox="0 0 480 220" width="100%" role="img"
               :aria-label="L('预测与实际出金抽数的折线对比', 'Predicted vs actual pulls per five-star')">
            <g class="ax">
              <line v-for="t2 in btG[pi].ticks" :key="'bg' + p.gt + t2.v"
                    :x1="btG[pi].L" :x2="btG[pi].R" :y1="t2.y" :y2="t2.y"/>
            </g>
            <path :d="btG[pi].bandPath" class="band"/>
            <path :d="btG[pi].cumPath" class="ln-cum"/>
            <path :d="btG[pi].predPath" class="ln-pred"/>
            <circle v-for="(q, i) in btG[pi].dots" :key="'d' + p.gt + i"
                    :cx="q.x" :cy="q.y" r="2.2" class="dot"/>
            <g class="lb sm">
              <text v-for="t2 in btG[pi].ticks" :key="'by' + p.gt + t2.v"
                    :x="btG[pi].L - 6" :y="t2.y" text-anchor="end" dominant-baseline="central">{{ t2.v }}</text>
              <text v-for="t2 in btG[pi].xTicks" :key="'bx' + p.gt + t2.v"
                    :x="t2.x" :y="btG[pi].B + 15" text-anchor="middle">{{ L('第' + t2.v + '颗', '#' + t2.v) }}</text>
            </g>
          </svg>
          <div class="dsh-mini" v-else>{{ L('样本还太少，回测暂不展示', 'Not enough samples for a backtest yet') }}</div>
        </div>
      </div>

      <div class="dsh-legend">
        <span><i class="sw-model"></i>{{ L('模型预测', 'Model') }}</span>
        <span><i class="sw-emp"></i>{{ L('实际样本', 'Observed') }}</span>
        <span><i class="sw-cum"></i>{{ L('累积平均', 'Running mean') }}</span>
        <span><i class="sw-band"></i>{{ L('P10 ~ P90 区间', 'P10–P90 band') }}</span>
      </div>

      <div class="dsh-note">
        <div><b>{{ L('怎么读这两张图', 'How to read these') }}</b></div>
        <div v-html="L('单次出金抽数的方差极大（本账号见过 2 抽也见过 82 抽），所以「预测」是<b>期望值</b>，不是「你下一颗一定在第 N 抽出」。真正衡量模型好坏的是<b>覆盖率</b>：实际落在 P10~P90 区间内的比例，理想值约 80%。',
                        'The pull count for a single five-star varies enormously (this account has seen both 2 and 82), so the forecast is an <b>expectation</b>, not “your next five-star lands on pull N”. What measures the model is <b>coverage</b>: the share of outcomes inside the P10–P90 band, ideally around 80%.')"></div>
        <div v-html="L('回测用 <b>walk-forward</b>：预测第 i 颗时只用它之前的数据重新拟合，<b>不偷看未来</b>，所以「预测 vs 实际」的差距是诚实的。',
                        'The backtest is <b>walk-forward</b>: forecasting the i-th five-star refits on earlier data only — <b>no peeking ahead</b> — which keeps the predicted-vs-actual gap honest.')"></div>
        <div v-html="L('分布来自<b>你自己的历史出金抽数</b>，再用公开发布的机制（角色池 90 抽硬保底 / 74 抽起递增，光锥池 80 / 66）在样本稀疏处兜底 —— 样本越多，数据的话语权越大。',
                        'The distribution comes from <b>your own pull history</b>, with the published mechanics (hard pity 90 / ramp from 74 for characters, 80 / 66 for light cones) filling in where samples are thin — the more data, the more it speaks for itself.')"></div>
        <div v-html="L('竖虚线是<b>软保底起点</b>：从这一抽起单抽概率开始逐抽抬升。',
                        'The dashed vertical line marks <b>where soft pity starts</b> — from there the per-pull rate climbs with every warp.')"></div>
      </div>
    </div>`,
  };
})();
