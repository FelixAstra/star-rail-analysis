// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 图表看板（吉凶分布 + 出金抽数预测）
//
// 两个看板，全部只用**链接抓取到的、带精确时间戳的五星记录**：
//   A. 吉时 / 平时 / 凶时 的出金分布 —— 颗数、占比、中位与平均出金抽数、角色池占比、
//      出金时辰分布（含每个时辰覆盖的钟点）、三块上下排列的直方图（10 抽一档）。
//   B. 出金抽数预测与回测 —— 经验分布 + 机制约束的模型、当前各池的条件期望、
//      生存曲线、walk-forward 回测（预测 vs 实际）。
//
// ⚠️ 三条必须守住的边界（错一条结论就是假的）：
//   ① **补录数据一律不进**。`data/account.json` 里的 histRows / oth 只有
//      「[类型, 名字, 抽数, 标记, 出处]」五个字段，**没有时间戳** —— 没有时间就算不出
//      黄历评级、也进不了抽数序列。它们本来就没接入 analyze 链路，这里也不接。
//   ② **cross 金必须排除**。被 `account.json` 的 crossGold 标记的那几条，保底是从接口
//      保留期之外续起来的，`pity` 只含窗口内能解析到的部分 —— 掺进均值会把它拉低。
//   ③ **角色池与光锥池分开建模**。硬保底不同（90 / 80），软保底起点也不同（74 / 66），
//      共用一套分布等于把两种机制混成一个，均值必然失真。
//
// ⚠️ 统计诚实（页面上必须写明，别只写在注释里）：
//   抽卡结果具有随机性，游戏机制里**没有黄历这个变量**。三组的差异若出现，来自样本
//   波动与玩家自己的抽卡习惯（例如更愿意在吉时抽），不是因果。
//
// ⚠️⚠️ 删掉的两样东西，别再加回来：
//   ① 「三组均值的 95% 置信区间两两重叠 → 差异不显著」。这个推断不成立：区间重叠
//      与不重叠都不等价于显著性检验，而且这里只比了部分配对。要正经比较组间差异，
//      得另设计（分池、控制保底进度、按样本量做检验），不在本页范围内。
//   ② 「出金是独立同分布的随机过程」。保底机制会让**单抽**出金概率随已垫抽数变化，
//      逐抽概率并不相同。准确的说法只有一句：「抽卡结果具有随机性」。
// ─────────────────────────────────────────────────────────────────────────────
const { almanac } = require('./huangli.js');
const { POOL, HARD, POOL_EN } = require('./pools.js');

// ── 机制参数 ─────────────────────────────────────────────────────────────────
// 来源：HoYoverse 帮助中心（基础概率与硬保底）+ 社区实测整理的软保底起点。
//   角色活动跃迁：基础 0.600%，含保底综合 1.600%，最多 90 抽必出
//   光锥活动跃迁：基础 0.800%，含保底综合 1.870%，最多 80 抽必出
// ⚠️ 这些参数**只用作尾部先验**（样本稀疏的地方兜底）。样本充足的区间一律由历史数据
//    主导 —— 见 estimateDist 里的混合权重。所以参数略有出入不会带偏整体结论。
const MECH = {
  '11': { base: 0.006, soft: 74, step: 0.06, hard: 90 },
  '12': { base: 0.008, soft: 66, step: 0.07, hard: 80 },
};

// 本页统计覆盖的池（用户口径：只看角色 + 光锥活动跃迁）
const SCOPE = ['11', '12'];

// 十二时辰（23:00–00:59 归子时，与 core/huangli.js 的 hourIdx 同口径）
const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 十二时辰各自覆盖的钟点（**从 shichenOf 的定义反推，不是另抄一份表**）：
//   子 23:00–00:59 · 丑 01:00–02:59 · 寅 03:00–04:59 … 亥 21:00–22:59
// 界面在时辰标签上给出这个范围 —— 只写一个「未」字，没人知道是哪两个小时。
const SHICHEN_HOURS = SHICHEN.map((_, i) => (i === 0 ? [23, 0] : [2 * i - 1, 2 * i]));
const pad2 = h => String(h).padStart(2, '0');

// 直方图分箱宽度（抽）。
// ⚠️ 从 5 抽一档改成 10 抽一档、18 档改成 9 档：三组样本分别只有几十颗，5 抽一档
//    会把样本切得太碎，柱子高度几乎全由稀疏噪声决定，看着热闹其实读不出形状。
const BIN = 10;
const N_BINS = 9;    // 1-10 … 81-90

// ── 小工具 ───────────────────────────────────────────────────────────────────
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = a => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const round = (v, d = 1) => (v == null ? null : Number(v.toFixed(d)));

/** 记录时刻落在哪个时辰（0=子 … 11=亥）。23 点与 0 点同属子时。 */
function shichenOf(time) {
  const h = Number(String(time).slice(11, 13));
  if (!Number.isFinite(h)) return null;
  return h === 23 ? 0 : Math.floor((h + 1) / 2);
}

/**
 * 机制理论分布 f(k) = P(距上颗金恰好 k 抽出金)，k = 1..hard。
 * 概率在第 soft 抽起每抽 +step，到 hard 抽为 100%。
 */
function mechDist(gt) {
  const m = MECH[gt];
  if (!m) return null;
  const f = new Array(m.hard + 1).fill(0);
  let surv = 1;
  for (let k = 1; k <= m.hard; k++) {
    let p;
    if (k >= m.hard) p = 1;
    else if (k >= m.soft) p = Math.min(1, m.base + m.step * (k - m.soft + 1));
    else p = m.base;
    f[k] = surv * p;
    surv *= 1 - p;
  }
  const s = f.reduce((a, b) => a + b, 0) || 1;
  for (let k = 1; k <= m.hard; k++) f[k] /= s;
  return f;
}

/**
 * 经验分布 + 机制先验的混合估计（经验贝叶斯式正则化）。
 *
 *   f(k) ∝ 平滑后的观测计数 + λ · 机制先验(k)
 *
 * 观测区（样本充足）由数据主导，稀疏区与尾部由机制兜底 —— 两边的权重是固定的 λ，
 * 所以样本越多，数据的话语权越大。λ 取 8，相当于「机制先验值 8 颗金」。
 */
function estimateDist(samples, gt, opts = {}) {
  const m = MECH[gt];
  if (!m) return null;
  const hard = m.hard;
  const lam = opts.lambda != null ? opts.lambda : 8;
  const mech = mechDist(gt);

  const counts = new Array(hard + 1).fill(0);
  let N = 0;
  for (const k of samples) if (k >= 1 && k <= hard) { counts[k]++; N++; }

  // 三角核（半径 1）轻平滑：避免相邻抽数一有一无造成的锯齿
  const sm = new Array(hard + 1).fill(0);
  for (let k = 1; k <= hard; k++) {
    let s = 0, w = 0;
    for (const d of [-1, 0, 1]) {
      const j = k + d;
      if (j < 1 || j > hard) continue;
      const wt = d === 0 ? 1 : 0.5;
      s += counts[j] * wt; w += wt;
    }
    sm[k] = s / w;
  }

  const f = new Array(hard + 1).fill(0);
  let sum = 0;
  for (let k = 1; k <= hard; k++) { f[k] = sm[k] + lam * mech[k]; sum += f[k]; }
  for (let k = 1; k <= hard; k++) f[k] /= (sum || 1);
  return { f, N, hard, soft: m.soft, mechWeight: lam };
}

/** 条件期望：已垫 m 抽时，**还要**多少抽出金。m=0 即无条件期望 E[X]。 */
function condExpect(f, m, hard) {
  let num = 0, den = 0;
  for (let k = m + 1; k <= hard; k++) { num += (k - m) * f[k]; den += f[k]; }
  return den > 0 ? num / den : 0;
}

/** 条件概率：已垫 m 抽时，**d 抽之内**出金的概率。 */
function condProb(f, m, d, hard) {
  let num = 0, den = 0;
  for (let k = m + 1; k <= hard; k++) { den += f[k]; if (k <= m + d) num += f[k]; }
  return den > 0 ? num / den : 1;
}

/** 分布的分位数（最小的 k 使累积概率 ≥ q）。 */
function quantile(f, q, hard) {
  let acc = 0;
  for (let k = 1; k <= hard; k++) { acc += f[k]; if (acc >= q) return k; }
  return hard;
}

// ── 看板 A：吉凶 × 出金 ──────────────────────────────────────────────────────
// label / en 成对产出，前端用 L(zh, en) 二选一（与统计卡 key/keyEn 同一套写法）。
const BUCKETS = [
  { key: 'ji', label: '吉', en: 'Auspicious', levels: ['大吉', '吉'] },
  { key: 'ping', label: '平', en: 'Neutral', levels: ['平'] },
  { key: 'xiong', label: '凶', en: 'Inauspicious', levels: ['凶'] },
];

function buildAlmanac(usable) {
  const groups = { ji: [], ping: [], xiong: [] };
  const tagged = usable.map(g => {
    const a = almanac(g.time);
    const key = (a.level === 'j1' || a.level === 'j2') ? 'ji' : (a.level === 'p' ? 'ping' : 'xiong');
    const rec = { ...g, level: a.level, label: a.label, zhi: a.hour.zhi, sc: shichenOf(g.time) };
    groups[key].push(rec);
    return rec;
  });

  const total = tagged.length;

  const buckets = BUCKETS.map(b => {
    const list = groups[b.key];
    const pities = list.map(x => x.pity);
    const n = list.length;
    return {
      key: b.key, label: b.label, en: b.en,
      n,
      pct: total ? n / total * 100 : 0,
      avg: mean(pities),
      // 中位数给到卡片主位：出金抽数的分布右偏（保底把尾部拉长），均值会被少数
      // 高抽数拖走，中位数更接近「一般是多少抽出金」。
      median: median(pities),
      // 该组里角色池占的比例 —— 两池硬保底不同（90 / 80），合并后的均值会被池构成
      // 带偏，所以卡片上要把它摆出来，而不是只给一个「平均出金抽数」让人自行脑补。
      chShare: n ? list.filter(x => x.gt === '11').length / n * 100 : null,
      small: n < 10,          // 样本不足：均值不可靠，界面要标注
    };
  });

  // ── 直方图：10 抽一档，共 9 档 ────────────────────────────────────────────
  const bins = Array.from({ length: N_BINS }, (_, i) => ({
    i,
    lo: i * BIN + 1,
    hi: i === N_BINS - 1 ? 90 : i * BIN + BIN,   // 最后一档收到 90（角色池硬保底）
  }));

  // 每组：**组内占比**（该区间颗数 ÷ 该组五星总数）。用组内比例而不是绝对计数，
  // 形状才可比 —— 三组的颗数本来就不同。
  // ⚠️ 零样本组给 **null 而不是 0**：一排 0% 柱子会被读成「这个区间确实没人出过金」，
  //    而真实情况是「这一组根本没有样本」。界面据 null 显示空状态。
  const series = BUCKETS.map(b => {
    const list = groups[b.key];
    const counts = new Array(N_BINS).fill(0);
    list.forEach(x => { counts[Math.min(N_BINS - 1, Math.floor((x.pity - 1) / BIN))]++; });
    const n = list.length;
    return {
      key: b.key, label: b.label, en: b.en,
      n, counts,
      pct: n ? counts.map(c => c / n * 100) : new Array(N_BINS).fill(null),
    };
  });

  // 三组共用同一个纵轴上限，柱高才可横向比；零样本组不参与计算。
  // 向上取整到 5 的倍数（并给一个 10% 的地板），避免刻度出现 18.7% 这种数。
  const observed = series.filter(s => s.n).map(s => Math.max.apply(null, s.pct));
  const maxPct = observed.length ? Math.max.apply(null, observed) : 0;
  const yMax = Math.min(100, Math.max(10, Math.ceil(maxPct / 5) * 5));

  // ── 出金时辰分布（全样本，不分组）────────────────────────────────────────
  const sc = new Array(12).fill(0);
  tagged.forEach(x => { if (x.sc != null) sc[x.sc]++; });
  const shichen = SHICHEN.map((zhi, i) => {
    const h0 = SHICHEN_HOURS[i][0], h1 = SHICHEN_HOURS[i][1];
    return {
      zhi, i,
      n: sc[i],
      pct: total ? sc[i] / total * 100 : 0,
      from: h0, to: h1,                                  // 覆盖的钟点（含两端小时）
      range: pad2(h0) + ':00\u2013' + pad2(h1) + ':59',   // 精确区间，给浮层用
      short: pad2(h0) + '\u2013' + pad2((h1 + 1) % 24),   // 轴上的紧凑写法（含头不含尾）
    };
  });

  return {
    total,
    bucketTotal: total,
    buckets,
    hist: { bin: BIN, nBins: N_BINS, bins, yMax, series },
    shichen,
    // 全体对照：n / 均值 / 中位数，**不给置信区间**（理由见文件头）
    overall: {
      n: total,
      avg: mean(tagged.map(x => x.pity)),
      median: median(tagged.map(x => x.pity)),
      chShare: total ? tagged.filter(x => x.gt === '11').length / total * 100 : null,
    },
  };
}

// ── 看板 B：出金抽数预测与回测 ───────────────────────────────────────────────
/**
 * walk-forward 回测：预测第 i 颗金时，**只用前 i-1 颗**的样本重估分布。
 * 这是这套图里唯一能验证「模型是不是真有用」的东西 —— 一旦用全样本预测，
 * 就是偷看未来，误差会假性变小。
 */
function backtest(samples, gt, opts = {}) {
  const minTrain = opts.minTrain || 8;
  const m = MECH[gt];
  const points = [];
  if (!m) return { points, n: 0, mae: null, coverage: null, minTrain };

  for (let i = minTrain; i < samples.length; i++) {
    const train = samples.slice(0, i);
    const est = estimateDist(train, gt);
    const pred = condExpect(est.f, 0, est.hard);
    const lo = quantile(est.f, 0.10, est.hard);
    const hi = quantile(est.f, 0.90, est.hard);
    const upto = samples.slice(0, i + 1);
    points.push({
      i: i + 1,
      gt,
      actual: samples[i],
      pred,
      lo, hi,
      cumAvg: mean(upto),          // 累积平均（大数定律：它会收敛到真实期望）
    });
  }

  if (!points.length) return { points, n: 0, mae: null, coverage: null, minTrain };
  const errs = points.map(p => Math.abs(p.actual - p.pred));
  return {
    points,
    n: points.length,
    mae: mean(errs),
    // 覆盖率：实际落在 P10~P90 带内的比例，理想值 ≈ 80%
    coverage: points.filter(p => p.actual >= p.lo && p.actual <= p.hi).length / points.length * 100,
    minTrain,
  };
}

function buildPredict(usable, padded) {
  const pools = SCOPE.map(gt => {
    const list = usable.filter(g => g.gt === gt);
    const samples = list.map(g => g.pity);           // 保持时间顺序，回测要用
    const est = estimateDist(samples, gt);
    const m = Math.max(0, Number(padded[gt]) || 0);
    const mech = MECH[gt];
    const paddedIn = Math.min(m, mech.hard);         // 已垫抽数不可能超过硬保底

    const remain = condExpect(est.f, paddedIn, est.hard);
    const window = d => condProb(est.f, paddedIn, Math.min(d, est.hard - paddedIn), est.hard);

    // 生存曲线（累积出金率）：模型 vs 实际样本 —— 两线贴合说明模型可信
    const modelCum = [], empCum = [], xs = [];
    const sorted = samples.slice().sort((a, b) => a - b);
    let acc = 0;
    for (let k = 0; k <= est.hard; k++) {
      if (k > 0) acc += est.f[k];
      xs.push(k);
      modelCum.push(acc * 100);
      empCum.push(sorted.length ? sorted.filter(v => v <= k).length / sorted.length * 100 : null);
    }

    return {
      gt, name: POOL[gt], nameEn: POOL_EN[gt],
      samples: est.N,
      hard: mech.hard, soft: mech.soft, base: mech.base,
      padded: paddedIn,
      remain,
      p10: window(10), p20: window(20), p40: window(40), p60: window(60), p80: window(80),
      enough: est.N >= 12,
      survival: { x: xs, model: modelCum, empirical: empCum },
      backtest: backtest(samples, gt),
    };
  });
  return { pools };
}

// ── 入口 ─────────────────────────────────────────────────────────────────────
/**
 * @param {Array} golds analyze.js 里那份跨池五星列表
 *        [{ name, gt, gid, pity, time, up, cross }]
 * @param {Object} opts  { padded: { '11': 4, '12': 4 } }  当前各池已垫抽数
 */
function build(golds, opts = {}) {
  const all = Array.isArray(golds) ? golds : [];
  const inScope = all.filter(g => SCOPE.includes(g.gt));
  const usable = inScope.filter(g => !g.cross);
  const crossExcluded = inScope.length - usable.length;
  const poolExcluded = all.length - inScope.length;

  const meta = {
    goldTotal: all.length,       // 本地全部五星条数
    used: usable.length,         // 真正进入统计的
    crossExcluded,               // 因「保底跨接口窗口」被排除
    poolExcluded,                // 因「不在角色/光锥活动跃迁」被排除
    scope: SCOPE.slice(),
    scopeNames: SCOPE.map(gt => POOL[gt]),
    scopeNamesEn: SCOPE.map(gt => POOL_EN[gt]),
    hard: SCOPE.map(gt => HARD[gt]),
    enough: usable.length >= 20,
  };

  // 数据太少时仍然返回结构（界面好显示「样本不足」），但看板 A 的三组统计会明显偏弱
  if (!usable.length) {
    return {
      meta,
      almanac: null,
      predict: { pools: [] },
    };
  }

  return {
    meta,
    almanac: buildAlmanac(usable),
    predict: buildPredict(usable, opts.padded || {}),
  };
}

module.exports = { build, buildAlmanac, buildPredict, backtest, estimateDist, mechDist,
                   condExpect, condProb, quantile, shichenOf,
                   SHICHEN, SHICHEN_HOURS, MECH, SCOPE, N_BINS, BIN };
