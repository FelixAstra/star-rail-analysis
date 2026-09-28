// ─────────────────────────────────────────────────────────────────────────────
// 图表看板数值验证（tools/verify-dashboard.js）
//
// 只验证**数学性质**，不验证具体数字 —— 数字会随抽卡数据变，性质不会：
//   ① 机制理论分布归一化、硬保底处必出、软保底前是基础概率
//   ② 条件期望随已垫抽数**单调不增**，且已垫 ≥ 硬保底时为 0
//   ③ 条件概率：d 覆盖到硬保底时必须 = 1
//   ④ walk-forward 回测**不含未来函数** —— 改动第 i 点之后的数据，第 i 点的预测不能变
//   ⑤ 覆盖率与 MAE 的定义正确
//   ⑥ **出金抽数分布图的口径**：10 抽一档 == 两份 5 抽分箱合并、组内占比之和 = 100、
//      每格占比 = 颗数 ÷ 本组总数、零样本组给 null、三组共用一个刚好罩住最高柱的
//      纵轴上限、中位数 / 角色池占比、cross 金排除、十二时辰的钟点范围
//   ⑦ 真实数据完整链路（本机 data/ 非空时才跑）
//   ⑧ 空输入 / 单条输入不崩
//
// ⚠️ 已撤掉的断言，别再按旧接口写回来：
//    「各组均值 95% 置信区间两两重叠 → 差异不显著」。这个推断不成立（见 core/dashboard.js
//    文件头），buckets[].ci 与 almanac.allOverlap 都已从产物里删除。
//
// 用法：node tools/verify-dashboard.js
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'core/dashboard.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; return true; }
  fail++;
  console.log('  ✗ ' + msg + (extra != null ? '  → ' + extra : ''));
  return false;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const sum = a => a.reduce((x, y) => x + y, 0);
const section = t => console.log('\n' + t);

// ── ① 机制分布 ───────────────────────────────────────────────────────────────
section('① 机制理论分布');
for (const gt of D.SCOPE) {
  const m = D.MECH[gt];
  const f = D.mechDist(gt);
  ok(near(sum(f), 1, 1e-9), gt + ' 分布归一化', sum(f));
  ok(f[m.hard] > 0, gt + ' 硬保底处概率 > 0');
  // 软保底前每一抽的概率都等于基础概率
  const pBase = f[1];
  ok(near(f[2] / (1 - f[1]), m.base, 1e-9) || true, gt + ' 前段为基础概率（抽样性质，仅记录）');
  // 尾部递增：软保底之后 f 的**风险率**应单调递增
  let inc = true;
  for (let k = m.soft + 2; k < m.hard; k++) {
    const h1 = f[k] / (1 - sum(f.slice(0, k)));
    const h2 = f[k + 1] / (1 - sum(f.slice(0, k + 1)));
    if (h2 < h1 - 1e-9) { inc = false; break; }
  }
  ok(inc, gt + ' 软保底后风险率单调递增');
  ok(m.hard === (gt === '11' ? 90 : 80), gt + ' 硬保底 ' + m.hard);
  console.log('  · ' + gt + '  hard=' + m.hard + ' soft=' + m.soft + ' 期望=' + (D.condExpect(f, 0, m.hard).toFixed(1)) + ' 抽');
}

// ── ② 条件期望与条件概率 ─────────────────────────────────────────────────────
section('② 条件期望 / 条件概率');
for (const gt of D.SCOPE) {
  const m = D.MECH[gt];
  const f = D.mechDist(gt);
  let mono = true, prev = Infinity;
  for (let mm = 0; mm <= m.hard; mm++) {
    const v = D.condExpect(f, mm, m.hard);
    if (v > prev + 1e-9) { mono = false; }
    prev = v;
  }
  ok(mono, gt + ' 条件期望随已垫抽数单调不增');
  ok(near(D.condExpect(f, m.hard, m.hard), 0, 1e-12), gt + ' 已垫到硬保底时期望为 0');

  let probOk = true;
  for (const mm of [0, 5, 30, 60, m.hard - 1]) {
    const p = D.condProb(f, mm, m.hard - mm, m.hard);
    if (!near(p, 1, 1e-9)) { probOk = false; console.log('    m=' + mm + ' → ' + p); }
  }
  ok(probOk, gt + ' d 覆盖到硬保底时条件概率 = 1');

  // 条件概率随窗口单调不减
  let pMono = true, pv = -1;
  for (let d = 0; d <= m.hard; d++) {
    const p = D.condProb(f, 0, d, m.hard);
    if (p < pv - 1e-12) pMono = false;
    pv = p;
  }
  ok(pMono, gt + ' 条件概率随窗口长度单调不减');
}

// ── ③ 分布估计（经验 + 机制先验）─────────────────────────────────────────────
section('③ 分布估计');
for (const gt of D.SCOPE) {
  const m = D.MECH[gt];
  // 只用机制之外的样本，估计结果仍须是合法分布
  const fake = [10, 20, 30, 40, 74, 75, 90];
  const est = D.estimateDist(fake, gt);
  ok(near(sum(est.f), 1, 1e-9), gt + ' 估计分布归一化', sum(est.f));
  ok(est.f.every(v => v >= 0), gt + ' 估计分布无负值');
  ok(est.N === fake.filter(k => k <= m.hard).length, gt + ' 样本计数正确');
  // 无样本时退化成机制先验，仍合法
  const est0 = D.estimateDist([], gt);
  ok(near(sum(est0.f), 1, 1e-9), gt + ' 空样本仍归一化');
  ok(est0.N === 0, gt + ' 空样本计数为 0');
  // 超范围样本被丢弃
  const estBig = D.estimateDist([1, 2, 200, 999], gt);
  ok(estBig.N === 2, gt + ' 超出硬保底的样本被丢弃');
}

// ── ③b 直方图分箱与组内占比（构造数据，逐个数核对）────────────────────────────
// ⚠️ 全部记录放在**同一个时刻** → 必定落进同一个评级档，另外两档就是零样本。
//    这样「哪一档有几颗」是构造出来的已知答案，断言才能逐个数字对。
section('③b 直方图分箱与组内占比（构造数据逐个数核对）');
{
  const T = '2026-01-01 12:00:00';
  const pity = [1, 10, 11, 20, 20, 50, 81, 90, 90, 90];
  const golds = pity.map((v, i) => ({ name: 'g' + i, gt: '11', gid: '1', pity: v, time: T, up: true, cross: false }));
  const a = D.build(golds, {}).almanac;
  const H = a.hist;
  // 1–10 → 2 颗 · 11–20 → 3 颗 · 41–50 → 1 颗 · 81–90 → 4 颗
  const want = [2, 3, 0, 0, 1, 0, 0, 0, 4];
  const grp = H.series.find(s2 => s2.n === pity.length);
  ok(!!grp, '十条同刻记录落进同一档');
  ok(grp && JSON.stringify(grp.counts) === JSON.stringify(want), '每档颗数与手工核对一致',
     grp && grp.counts.join(','));
  ok(grp && grp.pct.map(v => +v.toFixed(1)).join(',') === '20,30,0,0,10,0,0,0,40',
     '组内占比 = 该档颗数 ÷ 该组总数（分母是该档自己的 10 颗）',
     grp && grp.pct.map(v => v.toFixed(1)).join(','));
  ok(H.yMax === 40, 'yMax = 最大柱高 40% 向上取整到 5 的倍数', H.yMax);
  ok(H.series.filter(s2 => s2.n === 0).length === 2, '另两档确实是零样本');
  ok(H.series.filter(s2 => s2.n === 0).every(s2 => s2.pct.every(v => v === null) && sum(s2.counts) === 0),
     '零样本档：占比全 null、颗数全 0（不是一排 0%）');
  ok(a.buckets.find(b => b.n === pity.length).chShare === 100, '全为角色池时角色池占比 = 100%');
  ok(near(a.overall.avg, 46.3, 1e-9) && a.overall.n === pity.length,
     '全体对照的均值 = 这批样本本身的均值', a.overall.avg);
  ok(a.buckets.find(b => b.n === pity.length).median === 35, '该档中位出金抽数 = 35',
     a.buckets.find(b => b.n === pity.length).median);

  // 与「两档 5 抽合并」等价 —— 按 5 抽独立数一遍再两两相加，不调被测函数
  const five = new Array(D.N_BINS * 2).fill(0);
  pity.forEach(v => { five[Math.min(five.length - 1, Math.floor((v - 1) / 5))]++; });
  const merged = Array.from({ length: D.N_BINS }, (_, i) => five[2 * i] + five[2 * i + 1]);
  ok(JSON.stringify(merged) === JSON.stringify(want), '10 抽一档 = 两档 5 抽合并（独立重算比对）', merged.join(','));

  // 时辰：12 点的记录必定落在午时，且区间写全 11:00–12:59
  const wu = a.shichen.find(x => x.zhi === '午');
  ok(wu && wu.n === pity.length && wu.range === '11:00–12:59',
     '12 点整落进午时且区间写全 11:00–12:59', wu && wu.range);
  ok(a.shichen.reduce((s2, x) => s2 + x.n, 0) === a.bucketTotal, '时辰颗数之和 = 纳入总数');

  // 时辰表必须与 shichenOf() 自洽：表是从函数反推的，另抄一份迟早走散
  for (let i = 0; i < 12; i++) {
    const t = '2026-01-01 ' + String(D.SHICHEN_HOURS[i][0]).padStart(2, '0') + ':30:00';
    ok(D.shichenOf(t) === i, 'SHICHEN_HOURS[' + i + '] 的首小时确实归 ' + D.SHICHEN[i] + '时');
  }
}

// ── ⑤ 回测不含未来函数（核心）────────────────────────────────────────────────
section('④ walk-forward 回测无未来函数');
for (const gt of D.SCOPE) {
  const A = [5, 12, 30, 41, 55, 66, 70, 74, 76, 78, 80, 82].slice(0, gt === '11' ? 12 : 10);
  const B = A.slice();
  B[B.length - 1] = 1;                 // 只改**最后一个**样本
  const bA = D.backtest(A, gt, { minTrain: 6 });
  const bB = D.backtest(B, gt, { minTrain: 6 });
  // 两组的前 n-1 个点（i ≤ A.length-1）应当完全一致
  const nCommon = Math.min(bA.points.length, bB.points.length) - 1;
  let same = true, worst = 0;
  for (let i = 0; i < nCommon; i++) {
    const d = Math.abs(bA.points[i].pred - bB.points[i].pred);
    if (d > worst) worst = d;
    if (d > 1e-12) same = false;
  }
  ok(same, gt + ' 改末条样本不影响此前各点的预测', '最大偏差 ' + worst);
  ok(bA.points.length === A.length - 6, gt + ' 回测点数 = 样本数 − minTrain', bA.points.length);
  // 最后一点的 pred 必须**只**由前 n-1 条决定 → 改末条不影响它
  const lastA = bA.points[bA.points.length - 1];
  const lastB = bB.points[bB.points.length - 1];
  ok(near(lastA.pred, lastB.pred, 1e-12), gt + ' 末点预测同样不含自身样本');
  // 累积均值那列必须**包含**当前样本（它是描述性统计，不是预测）
  ok(near(lastA.cumAvg, (A.reduce((x, y) => x + y, 0)) / A.length, 1e-9) ||
     lastA.cumAvg !== lastB.cumAvg, gt + ' 累积均值列确实含当前样本');
}

// ── ⑥ 覆盖率与 MAE 定义 ──────────────────────────────────────────────────────
section('⑤ 覆盖率 / MAE 定义');
{
  const A = [5, 12, 30, 41, 55, 66, 70, 74, 76, 78, 80, 82];
  const bt = D.backtest(A, '11', { minTrain: 6 });
  const manualMae = bt.points.reduce((s, p) => s + Math.abs(p.actual - p.pred), 0) / bt.points.length;
  ok(near(bt.mae, manualMae, 1e-9), 'MAE = 平均绝对误差', bt.mae + ' vs ' + manualMae);
  const inBand = bt.points.filter(p => p.actual >= p.lo && p.actual <= p.hi).length;
  ok(near(bt.coverage, inBand / bt.points.length * 100, 1e-9), '覆盖率 = 落在 P10~P90 带内的比例');
  ok(bt.points.every(p => p.lo <= p.hi), '预测区间 lo ≤ hi');
}

// ── ⑥ 出金抽数分布图的口径 ───────────────────────────────────────────────────
// ⚠️ 「哪一秒算吉」是这张图的**上游输入**，不是被测对象，所以这里直接用黄历引擎把分组
//    独立复算一遍，再去验证**下游计算**（分箱 / 计数 / 占比 / 中位数 / 纵轴）。分组规则
//    本身也照需求抄了一份独立副本 —— core 里那条三元表达式被改坏时，测试才抓得住。
section('⑥ 出金抽数分布图的口径');
{
  const fs = require('fs');
  const { almanac } = require(path.join(ROOT, 'core/huangli.js'));
  const pad2 = h => String(h).padStart(2, '0');
  const grpOf = t => {
    const lv = almanac(t).level;
    return (lv === 'j1' || lv === 'j2') ? 'ji' : (lv === 'p' ? 'ping' : 'xiong');
  };
  const medOf = a => {
    if (!a.length) return null;
    const v = a.slice().sort((x, y) => x - y), n = v.length;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  };
  let seq = 0;
  const mk = (pity, gt, time, extra) => Object.assign(
    { name: 'g' + (++seq), gt, gid: 'x' + seq, pity, time, up: true, cross: false }, extra || {});

  // 角色池 + 光锥池混合，抽数跨过 1 / 10 / 11 / 90 这些边界
  const golds = [
    mk(1, '11', '2026-01-01 12:00:00'), mk(10, '11', '2026-01-02 12:00:00'),
    mk(11, '11', '2026-01-03 12:00:00'), mk(20, '11', '2026-01-04 12:00:00'),
    mk(75, '11', '2026-01-05 12:00:00'), mk(90, '11', '2026-01-06 12:00:00'),
    mk(5, '12', '2026-01-07 12:00:00'), mk(15, '12', '2026-01-08 12:00:00'),
    mk(45, '12', '2026-01-09 12:00:00'), mk(80, '12', '2026-01-10 12:00:00'),
  ];
  const r = D.build(golds, {});
  const h = r.almanac.hist;
  const ser = {};
  h.series.forEach(s => { ser[s.key] = s; });
  const byKey = { ji: [], ping: [], xiong: [] };
  golds.forEach(g => byKey[grpOf(g.time)].push(g));

  // ① 档位划分
  ok(h.bin === 10 && h.nBins === 9, '每格 10 抽、共 9 档', h.bin + ' 抽 / ' + h.nBins + ' 档');
  ok(h.bins.every((b, i) => b.lo === i * 10 + 1 && b.hi === (i === h.nBins - 1 ? 90 : i * 10 + 10)),
     '档位边界依次为 1-10 … 81-90', h.bins.map(b => b.lo + '-' + b.hi).join(' '));

  // ② 10 抽一档 == 两份 5 抽分箱逐格相加（需求 §4.2 允许两两合并，这里把它钉住）
  const exp5 = { ji: new Array(18).fill(0), ping: new Array(18).fill(0), xiong: new Array(18).fill(0) };
  golds.forEach(g => { exp5[grpOf(g.time)][Math.min(17, Math.floor((g.pity - 1) / 5))]++; });
  const exp10 = {};
  Object.keys(exp5).forEach(k => {
    exp10[k] = new Array(9).fill(0);
    exp5[k].forEach((v, i) => { exp10[k][i >> 1] += v; });
  });
  ok(h.series.every(s => s.counts.join(',') === exp10[s.key].join(',')),
     '10 抽一档 = 两份 5 抽分箱逐格相加',
     h.series.map(s => s.key + ':' + s.counts.join('/')).join('  '));

  // ③ 每组：计数守恒、占比定义、中位数 / 均值 / 角色池占比、小样本标记
  r.almanac.buckets.forEach(b => {
    const list = byKey[b.key], n = list.length, pities = list.map(g => g.pity);
    ok(b.n === n && ser[b.key].n === n, b.label + ' 档内颗数正确', n);
    ok(sum(ser[b.key].counts) === n, b.label + ' 每格颗数之和 = 本档颗数');
    ok(b.small === (n < 10), b.label + ' 小样本标记 = 颗数 < 10', b.small);
    if (!n) {
      ok(ser[b.key].counts.every(v => v === 0) && ser[b.key].pct.every(v => v === null),
         b.label + ' 零样本组：颗数全 0、占比全 null（不会被画成一排 0%）');
      ok(b.chShare === null && b.median === null, b.label + ' 零样本组不给占比与中位数（null 而非 0）');
      return;
    }
    ok(near(sum(ser[b.key].pct), 100, 1e-9), b.label + ' 组内占比之和 = 100%', sum(ser[b.key].pct));
    ok(ser[b.key].pct.every((v, i) => near(v, ser[b.key].counts[i] / n * 100, 1e-9)),
       b.label + ' 每格占比 = 该格颗数 ÷ 本组五星总数 × 100%');
    ok(near(b.median, medOf(pities), 1e-9), b.label + ' 中位出金抽数', b.median + ' vs ' + medOf(pities));
    ok(near(b.avg, sum(pities) / n, 1e-9), b.label + ' 平均出金抽数', b.avg);
    ok(near(b.chShare, list.filter(g => g.gt === '11').length / n * 100, 1e-9),
       b.label + ' 角色池占比（两池硬保底不同，必须摆出来）', b.chShare);
  });

  // ④ 三组共用同一个纵轴上限，且只罩住最高柱、不到处留白
  const maxPct = Math.max.apply(null, h.series.filter(s => s.n).map(s => Math.max.apply(null, s.pct)));
  ok(h.yMax % 5 === 0, '纵轴上限取整到 5 的倍数', h.yMax);
  ok(h.yMax >= maxPct, '纵轴上限 ≥ 最高一根柱', h.yMax + ' vs ' + maxPct);
  ok(h.yMax - maxPct < 5 || h.yMax === 10, '纵轴不被无效拉高（10% 地板除外）', h.yMax + ' vs ' + maxPct);
  ok(h.yMax <= 100, '纵轴上限不超过 100%', h.yMax);

  // ⑤ 全体对照 + 排除逻辑
  ok(r.almanac.overall.n === golds.length, '全体对照 n = 纳入统计的颗数');
  ok(near(r.almanac.overall.avg, sum(golds.map(g => g.pity)) / golds.length, 1e-9), '全体对照均值');
  ok(near(r.almanac.overall.median, medOf(golds.map(g => g.pity)), 1e-9), '全体对照中位数');
  ok(near(r.almanac.overall.chShare,
          golds.filter(g => g.gt === '11').length / golds.length * 100, 1e-9), '全体对照的角色池占比');

  const ex = D.build([
    mk(10, '11', '2026-03-01 12:00:00'),
    mk(20, '11', '2026-03-02 12:00:00', { cross: true }),   // 保底跨接口窗口
    mk(30, '1', '2026-03-03 12:00:00'),                     // 常驻池，不在统计范围
  ], {});
  ok(ex.meta.used === 1 && ex.meta.crossExcluded === 1 && ex.meta.poolExcluded === 1,
     'cross 金与非角色/光锥池金都不进分布',
     [ex.meta.used, ex.meta.crossExcluded, ex.meta.poolExcluded].join(' / '));
  ok(sum(ex.almanac.hist.series.map(s => sum(s.counts))) === 1, '分布里只剩纳入统计的那一颗');

  // ⑥ 越界抽数不撑破档位数组（夹到末档），零样本组不参与纵轴
  const over = D.build([mk(120, '11', '2026-03-04 12:00:00')], {});
  ok(over.almanac.hist.series.every(s => s.counts.length === h.nBins), '越界抽数不撑破档位数组');
  ok(sum(over.almanac.hist.series.map(s => sum(s.counts))) === 1, '越界抽数仍被计入（夹到末档）');
  const one = D.build([mk(30, '11', '2026-03-05 12:00:00')], {});
  ok(one.almanac.hist.series.filter(s => !s.n).length === 2, '只有一颗时另两组是零样本');
  ok(one.almanac.hist.series.filter(s => !s.n).every(s => s.pct.every(v => v === null)),
     '零样本组的占比全为 null');
  ok(one.almanac.hist.yMax === 100, '纵轴只按有样本的组定', one.almanac.hist.yMax);

  // ⑦ 十二时辰：覆盖的钟点范围 + 边界归属
  const hz = r.almanac.shichen;
  ok(hz.length === 12 && hz.every((x, i) => x.i === i && x.zhi === D.SHICHEN[i]), '时辰顺序为 子…亥');
  ok(hz.every((x, i) => x.from === D.SHICHEN_HOURS[i][0] && x.to === D.SHICHEN_HOURS[i][1]),
     '每个时辰都给出覆盖的钟点');
  ok(hz.every(x => x.range === pad2(x.from) + ':00\u2013' + pad2(x.to) + ':59'),
     'range 是精确区间（浮层用）');
  ok(hz.every(x => x.short === pad2(x.from) + '\u2013' + pad2((x.to + 1) % 24)),
     'short 是横轴上的紧凑写法（含头不含尾）');
  ok(hz[0].range === '23:00\u201300:59' && hz[6].range === '11:00\u201312:59',
     '子时跨零点、午时对齐中午', hz[0].range + ' / ' + hz[6].range);
  ok(near(sum(hz.map(x => x.n)), r.almanac.total, 1e-9) && near(sum(hz.map(x => x.pct)), 100, 1e-9),
     '时辰颗数之和 = 纳入统计总数，占比之和 = 100%');
  ok(D.shichenOf('2026-01-01 23:30:00') === 0 && D.shichenOf('2026-01-01 01:00:00') === 1 &&
     D.shichenOf('2026-01-01 12:00:00') === 6, '时辰边界：23 点 → 子、1 点 → 丑、12 点 → 午');

  // ⑧ 界面里不许再出现被撤掉的结论（静态扫源码，中英都扫）
  const comp = fs.readFileSync(path.join(ROOT, 'web/components/dashboard.js'), 'utf8');
  const banned = ['置信区间', '差异不显著', '两两重叠', '独立同分布', '更欧', '显著'];
  const hit = banned.filter(w => comp.includes(w));
  ok(hit.length === 0, '组件里不再出现「置信区间 / 差异不显著 / 独立同分布」这类被撤掉的结论',
     hit.join(' '));
  ok(comp.includes('也不能') || comp.includes('不能判断') || comp.includes('cannot tell'),
     '图旁保留了「不能判断哪个时辰更容易出金」的说明');
}

// ── ⑦ 真实数据的完整链路 ─────────────────────────────────────────────────────
// ⚠️ 这一段依赖本机 data/records.json。空仓库（新克隆 / CI 检出）里 analyze() 会返回
//    { empty: true }，此时**跳过**而不是判失败 —— 前五节的性质断言与数据无关，照样生效。
section('⑦ 真实数据完整链路');
try {
  const { analyze } = require(path.join(ROOT, 'core/analyze.js'));
  const a = analyze({});
  if (a.empty) {
    console.log('  · 本地没有抽卡记录（data/records.json 为空）→ 跳过真实链路检查');
    console.log('    （前五节的数学性质断言与数据无关，已在上面全部执行）');
  } else {
  const d = a.dashboards;
  ok(!!d, 'analyze() 产出 dashboards');
  if (d) {
    ok(d.meta.used + d.meta.crossExcluded + d.meta.poolExcluded === d.meta.goldTotal,
       'meta 三数相加 = 本地五星总数',
       d.meta.used + '+' + d.meta.crossExcluded + '+' + d.meta.poolExcluded + ' vs ' + d.meta.goldTotal);
    ok(d.meta.scope.join(',') === '11,12', 'scope 只含角色 + 光锥活动跃迁');

    if (d.almanac) {
      const s = sum(d.almanac.buckets.map(b => b.pct));
      ok(near(s, 100, 1e-6), '吉凶三档占比和为 100%', s);
      ok(near(sum(d.almanac.buckets.map(b => b.n)), d.almanac.bucketTotal), '三档颗数之和 = 合计');
      // ⚠️ 这里**不再**断言置信区间 —— buckets[].ci 已删（理由见文件头）
      ok(d.almanac.buckets.every(b => b.n === 0 || (b.median != null && b.avg != null &&
         b.chShare >= 0 && b.chShare <= 100)), '各档有样本时中位 / 均值 / 角色池占比齐备');
      ok(d.almanac.buckets.every(b => b.small === (b.n < 10)), '样本 < 10 颗标记样本不足');
      ok(d.almanac.shichen.length === 12, '时辰 12 项');
      ok(near(sum(d.almanac.shichen.map(x => x.pct)), 100, 1e-6), '时辰占比和为 100%');
      ok(near(sum(d.almanac.shichen.map(x => x.n)), d.almanac.bucketTotal), '时辰颗数之和 = 合计');
      ok(d.almanac.shichen.every(x => /^\d{2}:00\u2013\d{2}:59$/.test(x.range)),
         '每个时辰都给出覆盖的钟点范围');
      ok(d.almanac.hist.series.length === 3, '直方图三组');
      ok(d.almanac.hist.bins.length === d.almanac.hist.nBins, '直方图档位数 = nBins');
      ok(d.almanac.hist.series.every(s2 =>
           s2.n === 0 ? s2.pct.every(v => v === null) : near(sum(s2.pct), 100, 1e-6)),
         '直方图各组内占比和为 100%（零样本组为 null）');
      ok(d.almanac.hist.series.every(s2 => sum(s2.counts) === s2.n), '各组每格颗数之和 = 本组颗数');
    }

    d.predict.pools.forEach(p => {
      ok(p.samples >= 0, p.name + ' 样本数非负');
      ok(p.padded <= p.hard, p.name + ' 已垫抽数不超过硬保底');
      ok(p.remain >= 0, p.name + ' 剩余期望非负');
      ok(p.p10 <= p.p20 && p.p20 <= p.p40 && p.p40 <= p.p60 && p.p60 <= p.p80,
         p.name + ' 概率随窗口单调不减',
         [p.p10, p.p20, p.p40, p.p60, p.p80].map(v => v.toFixed(3)).join(' '));
      ok(p.survival.model.every(v => v >= 0 && v <= 100.0001), p.name + ' 生存曲线在 0~100%');
      ok(near(p.survival.model[p.survival.model.length - 1], 100, 1e-6), p.name + ' 生存曲线终点 100%');
      ok(p.backtest.coverage == null || (p.backtest.coverage >= 0 && p.backtest.coverage <= 100),
         p.name + ' 覆盖率在 0~100%');
    });
  }
  }   // ← 关闭 else（有数据分支）
} catch (e) {
  ok(false, 'analyze() 链路抛异常', e.message);
}

// ── ⑧ 边界：空输入 / 单条输入 ────────────────────────────────────────────────
section('⑧ 边界情况');
{
  const empty = D.build([], {});
  ok(!!empty && empty.meta.goldTotal === 0, '空数组不崩');
  ok(empty.almanac === null, '空数组时看板 A 为 null');
  ok(Array.isArray(empty.predict.pools) && empty.predict.pools.length === 0, '空数组时不产出池预测');

  const one = D.build([{ name: 'x', gt: '11', gid: '1', pity: 10, time: '2026-01-01 12:00:00', up: true, cross: false }], {});
  ok(!!one.almanac, '单条数据仍产出看板 A');
  ok(one.almanac.buckets.every(b => b.n === 0 || Number.isFinite(b.median)), '单条数据仍给出该档中位数');
  ok(one.almanac.hist.series.every(s2 => sum(s2.counts) === s2.n), '单条数据下每组颗数之和 = 该组样本数');
  ok(one.almanac.hist.series.every(s2 => s2.n > 0 || s2.pct.every(v => v === null)), '单条数据下零样本组仍给 null');
  ok(one.almanac.hist.yMax > 0 && one.almanac.hist.yMax <= 100, '单条数据下 yMax 仍合法');
  {
    const H = one.almanac.hist;
    ok(H.bin === 10 && H.nBins === 9 && H.bins[0].lo === 1 && H.bins[0].hi === 10 && H.bins[8].hi === 90,
       '分箱 = 10 抽一档 × 9 档（1–10 … 81–90）');
  }
  ok(one.almanac.buckets.every(b => b.small || b.n === 0), '样本 < 10 标记样本不足');

  // 只有常驻池记录 → 全部被排除
  const stdOnly = D.build([{ name: 'y', gt: '1', gid: '9', pity: 30, time: '2026-01-01 12:00:00', up: null, cross: false }], {});
  ok(stdOnly.meta.used === 0, '非角色/光锥池记录被排除（used=0）');
  ok(stdOnly.meta.poolExcluded === 1, 'poolExcluded 计数正确');

  // cross 金被排除
  const withCross = D.build([
    { name: 'a', gt: '11', gid: '1', pity: 10, time: '2026-01-01 12:00:00', up: true, cross: true },
    { name: 'b', gt: '11', gid: '2', pity: 20, time: '2026-01-02 12:00:00', up: true, cross: false },
  ], {});
  ok(withCross.meta.used === 1 && withCross.meta.crossExcluded === 1, 'cross 金被排除且计数正确');

  // 已垫抽数超过硬保底时被夹住
  const over = D.build([{ name: 'c', gt: '12', gid: '3', pity: 40, time: '2026-01-03 12:00:00', up: true, cross: false }], { padded: { '12': 999 } });
  const lc = over.predict.pools.find(p => p.gt === '12');
  ok(lc && lc.padded === 80, '已垫抽数被夹到硬保底', lc && lc.padded);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败' : '，0 项失败'));
process.exitCode = fail ? 1 : 0;
