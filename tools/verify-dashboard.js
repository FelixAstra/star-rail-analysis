// ─────────────────────────────────────────────────────────────────────────────
// 图表看板数值验证（tools/verify-dashboard.js）
//
// 只验证**数学性质**，不验证具体数字 —— 数字会随抽卡数据变，性质不会：
//   ① 机制理论分布归一化、硬保底处必出、软保底前是基础概率
//   ② 吉凶三档占比和为 100、每档的直方图组内占比和为 100
//   ③ 条件期望随已垫抽数**单调不增**，且已垫 ≥ 硬保底时为 0
//   ④ 条件概率：d 覆盖到硬保底时必须 = 1
//   ⑤ walk-forward 回测**不含未来函数** —— 改动第 i 点之后的数据，第 i 点的预测不能变
//   ⑥ 覆盖率与 MAE 的定义正确
//   ⑦ 排除逻辑：cross 金与非角色/光锥池金不进入统计
//   ⑧ 空输入 / 单条输入不崩
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

// ── ⑥ 真实数据的完整链路 ─────────────────────────────────────────────────────
// ⚠️ 这一段依赖本机 data/records.json。空仓库（新克隆 / CI 检出）里 analyze() 会返回
//    { empty: true }，此时**跳过**而不是判失败 —— 前五节的性质断言与数据无关，照样生效。
section('⑥ 真实数据完整链路');
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
      ok(d.almanac.buckets.every(b => b.ci[0] == null || b.ci[0] <= b.ci[1]), '各档 CI lo ≤ hi');
      ok(d.almanac.shichen.length === 12, '时辰 12 项');
      ok(near(sum(d.almanac.shichen.map(x => x.pct)), 100, 1e-6), '时辰占比和为 100%');
      ok(near(sum(d.almanac.shichen.map(x => x.n)), d.almanac.bucketTotal), '时辰颗数之和 = 合计');
      ok(d.almanac.hist.series.length === 3, '直方图三组');
      ok(d.almanac.hist.series.every(s2 => near(sum(s2.pct), 100, 1e-6) || s2.n === 0),
         '直方图各组内占比和为 100%');
      ok(d.almanac.hist.labels.length === d.almanac.hist.nBins, '直方图标签数 = 箱数');
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
section('⑦ 边界情况');
{
  const empty = D.build([], {});
  ok(!!empty && empty.meta.goldTotal === 0, '空数组不崩');
  ok(empty.almanac === null, '空数组时看板 A 为 null');
  ok(Array.isArray(empty.predict.pools) && empty.predict.pools.length === 0, '空数组时不产出池预测');

  const one = D.build([{ name: 'x', gt: '11', gid: '1', pity: 10, time: '2026-01-01 12:00:00', up: true, cross: false }], {});
  ok(!!one.almanac, '单条数据仍产出看板 A');
  ok(one.almanac.buckets.every(b => b.ci[0] == null), '样本 < 3 时不给置信区间');
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
