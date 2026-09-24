// 概率模型蒙特卡洛验证（node tools/verify-divination.js） —— 把解析解拿去和真实模拟对账
// 目的：证明页面上那个「第 N 抽」不是随口给的，而是能被独立模拟复现的
const path = require('path');
const D = require('../core/divination.js');
const { pAt, cumAt, needFor, needForUp, upWithin, goldPmf, cumTable, mulberry32, MODEL } = D;

const rng = mulberry32(777);
const N = 200000;
const rows = [];
const rec = (ok, label, got) => rows.push({ ok, label, got });

// ── ① 出金分布：解析 vs 模拟 ────────────────────────────────────────────────
function simGold(m, cur, cap, r) {
  let since = cur;
  for (let k = 1; k <= cap; k++) {
    since++;
    if (r() < pAt(m, since)) return k;
    if (since >= m.hard) return k;
  }
  return cap;
}

for (const gt of ['11', '12']) {
  const m = MODEL[gt];
  for (const cur of [0, 40, 70]) {
    const cap = m.hard - cur;
    const pmf = goldPmf(m, cur, cap);
    const emp = new Array(cap + 1).fill(0);
    let sum = 0;
    for (let i = 0; i < N; i++) { const k = simGold(m, cur, cap, rng); emp[k]++; sum += k; }
    // 逐抽偏差最大值
    let worst = 0, worstAt = 0;
    for (let k = 1; k <= cap; k++) {
      const d = Math.abs(emp[k] / N - pmf[k - 1]);
      if (d > worst) { worst = d; worstAt = k; }
    }
    rec(worst < 0.004, `${gt} 已垫${cur} 出金逐抽分布（解析 vs 模拟）`,
      `最大偏差 ${(worst * 100).toFixed(3)}pp @第${worstAt}抽`);
    // 均值
    const meanEmp = sum / N, meanAna = D.meanDraws(m, cur);
    rec(Math.abs(meanEmp - meanAna) < 0.15, `${gt} 已垫${cur} 平均出金抽数`,
      `模拟 ${meanEmp.toFixed(2)} / 解析 ${meanAna.toFixed(2)}`);
  }
}

// ── ② needFor 的命中率：应等于名义置信度 ───────────────────────────────────
for (const gt of ['11', '12']) {
  const m = MODEL[gt];
  for (const cur of [0, 55]) {
    for (const q of [0.5, 0.8, 0.95]) {
      const need = needFor(m, cur, q);
      const capFull = m.hard - cur;   // ⚠️ 必须跑完整区间再比 ≤ need，不然上限卡在 need 上就恒真
      const ana = cumAt(m, cur, need);
      // ⚠️ 离散分布的必然特性：软保底区一抽能跳 6~50 个百分点，累计曲线是阶梯状的，
      //    所以「≥q 的最小抽数」处实际把握会**超过** q。所以这里校验两件事：
      //    ① 解析值 == 实测值   ② 最小性：少一抽就不达标
      const minimal = need === 1 || cumAt(m, cur, need - 1) < q;
      let hit = 0;
      for (let i = 0; i < N; i++) if (simGold(m, cur, capFull, rng) <= need) hit++;
      const emp = hit / N;
      rec(Math.abs(emp - ana) < 0.006 && minimal && ana >= q,
        `${gt} 已垫${cur} 出金线 = 第 ${need} 抽（最小达标且可复现）`,
        `解析 ${(ana * 100).toFixed(2)}% / 实测 ${(emp * 100).toFixed(2)}%　名义目标 ${(q * 100).toFixed(0)}%，超额 ${((ana - q) * 100).toFixed(1)}pp 来自阶梯跳变`);
    }
  }
}

// ── ③ UP 线：含「先歪一次再吃大保底」的卷积 ─────────────────────────────────
function simUp(m, cur, n, pUp, r) {
  let since = cur, big = false;
  for (let k = 1; k <= n; k++) {
    since++;
    if (r() < pAt(m, since)) {
      if (big || r() < pUp) return true;
      big = true; since = 0;          // 歪了 → 转入大保底，计数归零重来
    }
  }
  return false;
}

for (const gt of ['11', '12']) {
  const m = MODEL[gt];
  for (const upMode of ['small', 'big']) {
    const pUp = upMode === 'big' ? 1 : m.up;
    for (const cur of [0, 60]) {
      const n = m.hard - cur;
      const ana = upWithin(m, cur, n, pUp);
      let hit = 0;
      for (let i = 0; i < N; i++) if (simUp(m, cur, n, pUp, rng)) hit++;
      const emp = hit / N;
      rec(Math.abs(emp - ana) < 0.006, `${gt} ${upMode} 已垫${cur} ${n}抽内拿UP把握`,
        `解析 ${(ana * 100).toFixed(2)}% / 实测 ${(emp * 100).toFixed(2)}%`);
    }
    // 稳拿所需：模拟最坏情况
    // ⚠️ 必须显式传 tol = 0：needForUp 默认带 5e-4 的浮点容差（那是给「目标把握线」用的），
    //    拿带容差的值当「稳拿」会得到 166 抽这种 99.98% 的数 —— 2 万次里必有漏网。
    //    产品侧 upSafe 也是显式传 0 的，这里必须跟它一致，否则验的不是同一个东西。
    const need = needForUp(m, 0, 1, pUp, 0);
    let allIn = true;
    for (let i = 0; i < 20000; i++) if (!simUp(m, 0, need, pUp, rng)) { allIn = false; break; }
    rec(allIn, `${gt} ${upMode} 「稳拿 ${need} 抽」真的必中（2 万次无一失手）`, allIn ? 'OK' : '有失败样本');
  }
}

// ── ④ 大衍法与铜钱法的动爻数分布应完全一致 ─────────────────────────────────
for (const key of ['coin', 'yarrow']) {
  const mkey = key === 'yarrow' ? 'yarrow' : 'coin';
  const draw = key === 'yarrow' ? D.yarrowOnce : D.throwOnce;
  const cnt = new Array(7).fill(0);
  const M = 300000;
  for (let i = 0; i < M; i++) {
    let mv = 0;
    for (let j = 0; j < 6; j++) { const v = draw(rng).value; if (v === 6 || v === 9) mv++; }
    cnt[mv]++;
  }
  const C6 = [1, 6, 15, 20, 15, 6, 1];   // B(6, 1/4) 的二项系数 × (1/4)^k (3/4)^(6-k)
  let worst = 0;
  const got = [];
  for (let k = 0; k <= 6; k++) {
    const want = C6[k] * Math.pow(0.25, k) * Math.pow(0.75, 6 - k);
    worst = Math.max(worst, Math.abs(cnt[k] / M - want));
    got.push(`${k}动${(cnt[k] / M * 100).toFixed(1)}%/${(want * 100).toFixed(1)}%`);
  }
  rec(worst < 0.005, `${D.METHODS[mkey].name} 动爻数分布 = B(6,1/4)`, got.join(' '));
}

// ── 输出 ───────────────────────────────────────────────────────────────────
const bad = rows.filter(r => !r.ok);
console.log('── 蒙特卡洛验证（每组 ' + N.toLocaleString() + ' 次）──');
rows.forEach(r => console.log((r.ok ? '  OK ' : '  ✗✗ ') + r.label + '\n        ' + r.got));
console.log('\n合计 ' + (rows.length - bad.length) + '/' + rows.length + (bad.length ? ' —— 有失败' : ' 全部通过'));
process.exit(bad.length ? 1 : 0);
