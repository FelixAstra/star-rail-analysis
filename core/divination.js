// ─────────────────────────────────────────────────────────────────────────────
// 八卦占卜引擎 —— 只输出 JSON，不碰 DOM
//
// 起卦：两套正统起卦法，默认三枚铜钱，可切大衍揲蓍
//   ① 铜钱法（《火珠林》/京房一脉）—— 背为阳，三枚公平硬币掷六次
//      三背（重）→ 老阳 9·动   二背一字（拆）→ 少阴 8·静
//      一背二字（单）→ 少阳 7·静  三字（交）→ 老阴 6·动
//      四象概率 1/8 · 3/8 · 3/8 · 1/8（不是四种各 1/4）
//   ② 大衍揲蓍法（《系辞》「大衍之数五十，其用四十有九」/ 朱熹《筮仪》）
//      四象概率 3/16 · 5/16 · 7/16 · 1/16（老阳 : 老阴 = 3 : 1）
//   ⚠️ 两法的 P(该爻为动爻) 都是 1/4，所以**动爻数分布完全相同**（B(6, 1/4)），
//      变卦分布也完全相同；差别只在「动的那一爻是阳变阴还是阴变阳」的方向比例。
//
// 解卦：朱熹《易学启蒙·考变占》的变占取用规则（按动爻数 0~6 决定读哪一段）
// 吉凶：用一张**可复核的关键词得分表**扫取用引文，不是拍脑袋给等级
// 时机：卦只决定「要到几成把握才出手」，**具体抽数是一个单点**，由官方公示概率模型解出
//   —— 出金线（任何 5★）与 UP 线（当期限定）分开算，UP 线把「先歪一次再吃大保底」算进去
// 万年历：复用 huangli.js 的日家 + 时家黄黑道；择时（选吉时）在 zeri.js 里单独算
//
// ⚠️ 本模块只做「参考」，不承诺任何产出。所有推导过程都随结果一起输出，供页面展示与复核。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const GUAD = require('./gua-data.js');
// 白话释义（本平台撰述，非原文）—— 与 gua-data.js 的卦序对齐，构建期已断言 64/64 + 384/384
const EX = require('./gua-explain.js').EX;
const AL = require('./huangli.js');
const ZR = require('./zeri.js');

// ── 官方公示概率模型 ────────────────────────────────────────────────────────
// base = 5★ 基础概率，S = 软保底起点，step = 起点之后每抽递增，hard = 硬保底
// up   = 出金时是当期限定的概率（角色 50%、光锥 75%）
//
// ⚠️ 官方只公示「基础概率 + 综合概率 + 硬保底」，**没有公示软保底曲线**。
//    下面这组参数是用官方综合概率反算校验过的：
//      角色 74 起每抽 +6% → 期望 62.30 抽 → 综合 1.605%（官方公示 1.600%）
//      光锥 66 起每抽 +7% → 期望 53.41 抽 → 综合 1.872%（官方公示 1.870%）
//    改这里的参数会让页面上的区间跟着变，校验断言见 assertModel()。
// unique = 该池有没有「当期限定」这个概念（常驻/新手池没有 → 出金即达成，UP 线 = 出金线）
const MODEL = {
  '11': { name: '角色活动跃迁', base: 0.006, S: 74, step: 0.06, hard: 90, up: 0.50, unique: true },
  '12': { name: '光锥活动跃迁', base: 0.008, S: 66, step: 0.07, hard: 80, up: 0.75, unique: true },
  '1': { name: '常驻跃迁', base: 0.006, S: 74, step: 0.06, hard: 90, up: null, unique: false },
  // ⚠️ 联动池官方未单独公示 UP 率，这里按同类池口径估（角色 50% / 光锥 75%）并打 upEstimated 标记
  '21': { name: '角色联动跃迁', base: 0.006, S: 74, step: 0.06, hard: 90, up: 0.50, unique: true, upEstimated: true },
  '22': { name: '光锥联动跃迁', base: 0.008, S: 66, step: 0.07, hard: 80, up: 0.75, unique: true, upEstimated: true },
  '2': { name: '新手跃迁', base: 0.006, S: null, step: null, hard: 50, up: null, unique: false, approx: true },
};

/** 第 k 抽出金的概率（k = 距上次出金的第几抽，从 1 开始） */
function pAt(m, k) {
  if (k >= m.hard) return 1;
  if (!m.S || k < m.S) return m.base;
  return Math.min(1, m.base + (k - m.S + 1) * m.step);
}

/** 已垫 cur 抽时，再抽 k 抽内出金的累计概率 */
function cumAt(m, cur, k) {
  let alive = 1;
  for (let i = 1; i <= k; i++) alive *= (1 - pAt(m, cur + i));
  return 1 - alive;
}

/** 已垫 cur 抽，要达到累计概率 q，还需抽多少抽 */
function needFor(m, cur, q) {
  const max = Math.max(0, m.hard - cur);
  for (let k = 1; k <= max; k++) if (cumAt(m, cur, k) >= q) return k;
  return max;
}

/** 出金分布：已垫 cur 抽时，第 k 抽（k 从 1 起）才是首次出金的概率 */
function goldPmf(m, cur, n) {
  const out = [];
  let alive = 1;
  for (let k = 1; k <= n; k++) {
    const p = pAt(m, cur + k);
    out.push(alive * p);
    alive *= (1 - p);
  }
  return out;
}

/** 从 0 垫开始、k 抽内出金的把握（查表；k=0 时为 0） */
function cumTable(m, n) {
  const t = new Array(n + 1); t[0] = 0;
  let alive = 1;
  for (let k = 1; k <= n; k++) { alive *= (1 - pAt(m, k)); t[k] = 1 - alive; }
  return t;
}

/**
 * n 抽内「拿到当期 UP」的把握 —— 这才是玩家真正在问的问题（出金 ≠ 拿到）
 * 中途出金时：以概率 pUp 直接拿到；以概率 1−pUp 歪到常驻，但会**转入大保底**，
 * 于是剩下 (n−t) 抽里只要再出一次金就必定是当期。
 * ⚠️ 这段「先歪一次再吃大保底」必须算进去，否则会系统性低估 —— 小保底时低估得尤其多。
 */
function upWithin(m, cur, n, pUp, pmf, G) {
  if (n <= 0) return 0;
  if (pUp == null || pUp >= 1 - 1e-9) return cumAt(m, cur, n);
  const f = pmf || goldPmf(m, cur, n);
  const g = G || cumTable(m, n);
  let s = 0;
  for (let t = 1; t <= n; t++) s += f[t - 1] * (pUp + (1 - pUp) * g[n - t]);
  return Math.min(1, s);
}

/**
 * 已垫 cur 抽，要达到「拿 UP 把握 ≥ q」，还需抽多少抽 —— 返回一个单点。
 * ⚠️ 小保底时这个数可能**超过本期剩余抽数**：最坏情况是「先歪一次、再吃满第二个保底」，
 *    合计要 (hard − cur) + hard 抽。这时返回的是真实所需，而不是硬压到本期上限 ——
 *    压上去会让页面给出一个根本达不到的把握。调用方用 reached 判断是否本期可行。
 */
// UP 线专用的目标容差：upWithin 是逐抽累积的连续量，会出现「本期上限 79.9996% vs 目标 80%」
// 这种浮点级抖动 —— 不留容差，页面就会显示「超出本期」，而其实只差万分之四。
// ⚠️ 「稳拿」（q = 1）调用时显式传 tol = 0，那里一点都不能松。
const GOAL_TOL = 5e-4;
function needForUp(m, cur, q, pUp, tol) {
  const max = Math.max(1, m.hard - cur);
  if (pUp == null || pUp >= 1 - 1e-9) return needFor(m, cur, q);
  const T = tol == null ? GOAL_TOL : tol;
  const cap = max + m.hard;                  // 允许多跨一个金（歪了之后的大保底）
  const f = goldPmf(m, cur, cap), g = cumTable(m, cap);
  for (let n = 1; n <= cap; n++) if (upWithin(m, cur, n, pUp, f, g) >= q - T) return n;
  return cap;
}

/** 平均还需多少抽出金（数学期望，不是模拟值） */
function meanDraws(m, cur) {
  const max = Math.max(1, m.hard - cur);
  let alive = 1, e = 0;
  for (let k = 1; k <= max; k++) { const p = pAt(m, cur + k); e += alive * p * k; alive *= (1 - p); }
  return e;
}

/**
 * 关键刻度 —— 把「离出金还有多远」拆成可逐条核对的锚点。
 * 每行给：本池第几抽 / 还差几抽 / 该抽的单抽概率 / 到这一抽为止的累计把握。
 * 存在意义：用户要的是「一个数字」，但一个孤零零的数字不可核对；
 *           给出刻度后，那个数字落在哪一段、为什么落在那里，一眼可验证。
 */
function anchorsOf(m, cur, mustAt, mustWhy) {
  const rows = [];
  const add = (abs, tag, why) => {
    if (abs <= cur || abs > m.hard) return;
    const k = abs - cur;
    const hit = rows.find(r => r.abs === abs);
    if (hit) { hit.tags.push(tag); hit.why.push(why); return; }
    rows.push({ abs, k, p1: pAt(m, abs), pc: cumAt(m, cur, k), tags: [tag], why: [why] });
  };
  if (m.S) {
    add(m.S, '软保底起跳', `第 ${m.S} 抽起单抽概率由 ${(m.base * 100).toFixed(1)}% 升到 ${(pAt(m, m.S) * 100).toFixed(1)}%，之后每抽 +${(m.step * 100).toFixed(0)}%`);
    for (const th of [0.10, 0.25, 0.50]) {
      const abs = m.S - 1 + Math.ceil((th - m.base) / m.step);
      if (abs > m.S && abs < m.hard) add(abs, `单抽首破 ${Math.round(th * 100)}%`, `第 ${abs} 抽这一抽单独出金的概率达到 ${(pAt(m, abs) * 100).toFixed(1)}%`);
    }
  }
  for (const [q, tag] of [[0.5, '累计半数把握'], [0.8, '累计八成把握'], [0.95, '累计九成五把握']]) {
    const abs = cur + needFor(m, cur, q);
    add(abs, tag, `抽到第 ${abs} 抽为止，出金把握累计 ${(cumAt(m, cur, abs - cur) * 100).toFixed(1)}%`);
  }
  // ★ 主推的那一抽必须出现在刻度表里 —— 否则「第 N 抽」就是个孤零零的数字，用户在表上核对不到它
  if (mustAt) add(mustAt, '卦象目标把握', mustWhy || '按卦象要求的把握解出的最小达标落点');
  add(m.hard, '硬保底', `第 ${m.hard} 抽必定出金`);
  rows.sort((a, b) => a.abs - b.abs);
  return rows;
}

/** 期望出金抽数（用于对着官方综合概率做自校验） */
function expectDraws(m) {
  let alive = 1, E = 0;
  for (let k = 1; k <= m.hard; k++) {
    const p = k === m.hard ? 1 : pAt(m, k);
    E += alive * p * k;
    alive *= (1 - p);
  }
  return E;
}

function assertModel() {
  const out = [];
  const chk = (gt, tgt) => {
    const m = MODEL[gt];
    if (!m.S) return;
    const rate = 1 / expectDraws(m);
    out.push({
      ok: Math.abs(rate - tgt) < 0.0002,
      label: `${m.name} 综合概率`,
      mine: (rate * 100).toFixed(3) + '%',
      official: (tgt * 100).toFixed(2) + '%',
    });
  };
  chk('11', 0.0160); chk('1', 0.0160); chk('21', 0.0160);
  chk('12', 0.0187); chk('22', 0.0187);
  const bad = out.filter(x => !x.ok);
  return { list: out, allOk: bad.length === 0 };
}

/** 可复现的随机源（自校验用，不污染调用方的 Math.random） */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 起卦法概率自校验（蒙特卡洛）—— 钉死四象概率的硬约束，不是仪式性检查。
 * 起因：网上流传的「大衍法概率」至少有一版把少阳/少阴对调了（写成少阳 7/16、少阴 5/16），
 *      所以这里用大样本把两法都锁住，改坏了立刻红。
 */
function assertCasting(n) {
  n = n || 600000;
  const rng = mulberry32(20260923);
  const out = [];
  for (const key of ['coin', 'yarrow']) {
    const cnt = { 6: 0, 7: 0, 8: 0, 9: 0 };
    const draw = key === 'yarrow' ? yarrowOnce : throwOnce;
    for (let i = 0; i < n; i++) cnt[draw(rng).value]++;
    const p = METHODS[key].p;
    let worst = 0, moving = 0;
    const detail = [];
    for (const v of [9, 8, 7, 6]) {
      const got = cnt[v] / n;
      worst = Math.max(worst, Math.abs(got - p[v]));
      if (v === 6 || v === 9) moving += got;
      detail.push(`${YAO_CN[v].slice(0, 3)} ${(got * 100).toFixed(2)}%/${(p[v] * 100).toFixed(2)}%`);
    }
    out.push({ ok: worst < 0.003, label: `${METHODS[key].name} 四象概率（实测/理论）`, got: detail.join(' · ') });
    out.push({
      ok: Math.abs(moving - MOVING_P) < 0.003, label: `${METHODS[key].name} 该爻为动爻的概率`,
      got: `${(moving * 100).toFixed(2)}% / ${(MOVING_P * 100).toFixed(2)}%（与另一法相同 → 动爻数分布一致）`,
    });
  }
  const gone = new Set(), remain = new Set();
  for (let i = 0; i < 20000; i++) { const r = yarrowOnce(rng); gone.add(r.removed); remain.add(r.remain); }
  out.push({ ok: gone.size === 4 && [13, 17, 21, 25].every(x => gone.has(x)), label: '大衍三变归奇只出 13/17/21/25', got: [...gone].sort((a, b) => a - b).join(' / ') });
  out.push({ ok: remain.size === 4 && [24, 28, 32, 36].every(x => remain.has(x)), label: '大衍余策只出 24/28/32/36', got: [...remain].sort((a, b) => a - b).join(' / ') });
  return { list: out, allOk: out.every(x => x.ok) };
}

// ── 吉凶关键词得分表 ───────────────────────────────────────────────────────
// ⚠️ 顺序无关（运行时按字数从长到短排），匹配后**占用字位**不再重复计分，
//    所以「无不利」不会被「不利」或「利」重复吃分，「悔亡」不会被「悔」吃分。
const LUCK = [
  ['吉无不利', 3], ['大吉', 2], ['元吉', 2], ['终吉', 2], ['贞吉', 2], ['元亨', 2],
  ['无不利', 2], ['利涉大川', 1], ['利有攸往', 1], ['利见大人', 1], ['利建侯', 1],
  ['利贞', 1], ['悔亡', 1], ['无咎', 1], ['有庆', 1], ['无尤', 1],
  ['无攸利', -2], ['贞凶', -2], ['终凶', -2], ['有厉', -1], ['勿用', -1], ['无成', -1],
  ['不利', -1], ['征凶', -2], ['大凶', -3],
  ['吉', 2], ['亨', 1], ['利', 1], ['贞', 1],
  ['凶', -2], ['厉', -1], ['吝', -1], ['悔', -1], ['灾', -2], ['眚', -1],
  ['亡', -1], ['丧', -1], ['折', -1], ['困', -1], ['蹇', -1], ['险', -1], ['忧', -1],
].sort((a, b) => b[0].length - a[0].length);

function scanLuck(text) {
  const t = String(text == null ? '' : text);
  const used = new Array(t.length).fill(false);
  const hits = [];
  for (const [w, s] of LUCK) {
    let from = 0, idx;
    while ((idx = t.indexOf(w, from)) !== -1) {
      let free = true;
      for (let k = idx; k < idx + w.length; k++) if (used[k]) { free = false; break; }
      if (free) {
        for (let k = idx; k < idx + w.length; k++) used[k] = true;
        hits.push({ w, s, at: idx });
      }
      from = idx + 1;
    }
  }
  hits.sort((a, b) => a.at - b.at);
  return { score: hits.reduce((a, h) => a + h.s, 0), words: hits.map(h => h.w), hits };
}

// ── 吉凶档位 ───────────────────────────────────────────────────────────────
// ⚠️ 阈值不是拍脑袋写的，是拿真实分数分布**按分位数标定**出来的（12000 次抽样）：
//    得分 P10=0 · P35=4 · P65=8 · P90=11 · 最小 -10 · 最大 21
//    所以 大吉≈10% / 吉≈25% / 小吉≈30% / 平≈25% / 小凶≈6% / 凶≈4%
//    改动 LUCK 词表会整体平移分布，届时需要重新标定这组阈值。
const LEVEL = [
  [11, 'j1', '大吉'], [8, 'j2', '吉'], [4, 'j3', '小吉'],
  [0, 'p', '平'], [-3, 'x1', '小凶'], [-99, 'x2', '凶'],
];
const levelOf = s => LEVEL.find(([t]) => s >= t).slice(1);

// ── 卦象 → 目标把握度 ───────────────────────────────────────────────────────
// ⚠️ 这一段**只决定「多稳才动手」，不改动任何概率** —— 所有数字都来自官方公示的保底模型。
//    换句话说：卦决定你要几成把握，数学决定那一步落在本池第几抽。
//    所以「推荐抽数」是一个单点，而不是「1~79 这种看一眼就没用的范围」。
const GOAL = {
  j1: [0.60, '大吉 · 六成把握即出手'],
  j2: [0.70, '吉 · 七成把握'],
  j3: [0.80, '小吉 · 八成把握'],
  p: [0.90, '平 · 九成把握'],
  x1: [0.95, '小凶 · 九成五把握'],
  x2: [1.00, '凶 · 只等硬保底'],
};

// ── 起卦 ───────────────────────────────────────────────────────────────────
const COIN_CN = { 1: '背', 0: '字' };
const YAO_CN = { 9: '老阳·重', 8: '少阴·拆', 7: '少阳·单', 6: '老阴·交' };

/** 三枚铜钱掷一次：返回 {coins:[背/字...], back, value} */
function throwOnce(rng) {
  const coins = [0, 0, 0].map(() => (rng() < 0.5 ? 1 : 0));   // 1 = 背(阳), 0 = 字(阴)
  const back = coins.reduce((a, b) => a + b, 0);
  const value = { 3: 9, 2: 8, 1: 7, 0: 6 }[back];             // 三背重 / 二背拆 / 一背单 / 三字交
  return { coins, back, value, method: 'coin' };
}

/**
 * 大衍揲蓍法掷一次（三变一爻，六爻十八变）
 * 四十九策，三变「归奇」之策相加只可能是 13 / 17 / 21 / 25，余策 36/32/28/24 除以 4 得 9/8/7/6。
 * ① 第一变：自 49 起算，归奇只能取 5 或 9，且 P(5) = 3/4（挂一之后左右两堆各余 1~4 的对称性）
 * ② 第二、三变：归奇只能取 4 或 8，各 1/2
 * 于是：
 *   13 = (5,4,4)                   → 3/4·1/2·1/2 = 3/16 → 老阳 9
 *   25 = (9,8,8)                   → 1/4·1/2·1/2 = 1/16 → 老阴 6
 *   17 = (5,4,8)|(5,8,4)|(9,4,4)   → 3/16+3/16+1/16 = 7/16 → 少阴 8
 *   21 = (5,8,8)|(9,4,8)|(9,8,4)   → 3/16+1/16+1/16 = 5/16 → 少阳 7
 * ⚠️ 网上不少页面把大衍法的少阳/少阴对调了（写成少阳 7/16、少阴 5/16）—— 那是错的。
 *    本模块不直接抽四象，而是**真实模拟三变路径**，再由断言核对出这组概率。
 */
function yarrowOnce(rng) {
  const gone = [
    rng() < 0.75 ? 5 : 9,        // 第一变归奇
    rng() < 0.5 ? 4 : 8,         // 第二变归奇
    rng() < 0.5 ? 4 : 8,         // 第三变归奇
  ];
  const removed = gone[0] + gone[1] + gone[2];
  const remain = 49 - removed;                        // 36 / 32 / 28 / 24
  return { coins: null, back: null, gone, removed, remain, value: remain / 4, method: 'yarrow' };
}

const METHODS = {
  coin: {
    key: 'coin', name: '三枚铜钱法', how: '三枚铜钱掷六次',
    rule: '背为阳（一背单·少阳 / 二背拆·少阴 / 三背重·老阳 / 三字交·老阴）',
    p: { 9: 1 / 8, 8: 3 / 8, 7: 3 / 8, 6: 1 / 8 },
  },
  yarrow: {
    key: 'yarrow', name: '大衍揲蓍法', how: '四十九策·十八变',
    rule: '大衍之数五十，其用四十有九（分二 · 挂一 · 揲四 · 归奇，三变一爻）',
    p: { 9: 3 / 16, 8: 7 / 16, 7: 5 / 16, 6: 1 / 16 },
  },
};
const MOVING_P = 1 / 4;   // 两法一致：P(老阳) + P(老阴) = 1/4

function sixThrows(rng, method) {
  const draw = method === 'yarrow' ? yarrowOnce : throwOnce;
  const out = [];
  for (let i = 0; i < 6; i++) out.push(draw(rng));
  return out;
}

const fmt = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ── 解卦取用（朱熹《易学启蒙·考变占》）──────────────────────────────────────
const RULE = {
  0: '六爻皆不动：以本卦卦辞占',
  1: '一爻动：以本卦该动爻的爻辞占',
  2: '二爻动：以本卦两动爻的爻辞占，以上爻为主',
  3: '三爻动：以本卦与变卦的卦辞占，以本卦为主（贞悔）',
  4: '四爻动：以变卦两个不动爻的爻辞占，以下爻为主',
  5: '五爻动：以变卦那个不动爻的爻辞占',
  6: '六爻皆动：乾用九、坤用六；其余以变卦卦辞占',
};
// 每种动爻数下应取用的条数（供构建期断言）
const EXPECT_CITED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1 };

function pickCited(ben, bian, moving) {
  const n = moving.length;
  const out = [];
  const push = (kind, label, text, primary, variants) =>
    out.push({ kind, label, text, primary: !!primary, variants: variants || null });
  const yaoOf = (g, i) => ({ label: g.yao[i].name, text: g.yao[i].ci, variants: g.yao[i].variants });

  if (n === 0) {
    push('本卦卦辞', ben.full + '卦辞', ben.ci, true);
  } else if (n === 1) {
    const y = yaoOf(ben, moving[0]);
    push('本卦动爻', y.label, y.text, true, y.variants);
  } else if (n === 2) {
    moving.forEach((i, k) => { const y = yaoOf(ben, i); push('本卦动爻', y.label, y.text, k === 1, y.variants); });
  } else if (n === 3) {
    push('本卦卦辞', ben.full + '卦辞', ben.ci, true);
    push('变卦卦辞', bian.full + '卦辞', bian.ci, false);
  } else if (n === 4) {
    const still = [0, 1, 2, 3, 4, 5].filter(i => !moving.includes(i));
    still.forEach((i, k) => { const y = yaoOf(bian, i); push('变卦不动爻', y.label, y.text, k === 0, y.variants); });
  } else if (n === 5) {
    const still = [0, 1, 2, 3, 4, 5].filter(i => !moving.includes(i));
    const y = yaoOf(bian, still[0]);
    push('变卦不动爻', y.label, y.text, true, y.variants);
  } else {
    if (ben.yong) push(ben.yong.name, ben.yong.name, ben.yong.ci, true);
    else push('变卦卦辞', bian.full + '卦辞', bian.ci, true);
  }
  return out;
}

// ── 时辰 ───────────────────────────────────────────────────────────────────
// ⚠️ 择时（十二时辰打分排序）全在 core/zeri.js 里做，本文件不再自己算黄黑道 ——
//    否则「页面上的吉时」与「万年历的吉时」会有两套口径，迟早对不上。
const HOUR_CACHE = new Map();   // 同一天反复占卜时不必重算 12 个时辰的农历
function hoursOf(dateStr) {
  const hit = HOUR_CACHE.get(dateStr);
  if (hit) return hit;
  const list = ZR.zeri(dateStr).hours;
  if (HOUR_CACHE.size > 32) HOUR_CACHE.clear();
  HOUR_CACHE.set(dateStr, list);
  return list;
}

// ── 主入口 ─────────────────────────────────────────────────────────────────
const viewOf = (g, key) => {
  const ex = EX[g.no] || {};
  return {
    no: g.no, key, name: g.name, full: g.full, xia: g.xia, shang: g.shang,
    ci: g.ci, xiang: g.xiang, tuan: g.tuan, za: g.za || null, yong: g.yong || null,
    xiangFrom: g.xiangFrom || null,
    // 白话释义：say = 全卦主旨，yaoSay = 六爻各一句直译。
    // ⚠️ 这一层是**本平台撰述**（唯一非古籍的一层），页面必须标注出来，不能混进注疏里。
    say: ex.t || null, yaoSay: ex.y || null,
  };
};
const luckOf = (total, lvKey, lvLabel, action, sMain, sBen, sBian) => ({
  total, main: sMain.score * 2, ben: sBen.score, bian: sBian.score,
  level: lvKey, label: lvLabel, action,
  mainWords: sMain.words, mainHits: sMain.hits, benWords: sBen.words, bianWords: sBian.words,
});

/**
 * @param {object} o
 *   o.lines    [6] 6/7/8/9 —— 给定则直接采用（便于测试与复现），否则随机摇
 *   o.rng      () => [0,1) —— 注入随机源（默认 Math.random）
 *   o.now      Date
 *   o.gt       卡池 gacha_type（决定用哪个保底模型）
 *   o.cur      已垫抽数（不传则从 analyze() 取该池）
 *   o.analysis 传 analyze() 的结果（避免重复解析）
 */
function cast(o) {
  o = o || {};
  const now = o.now instanceof Date ? o.now : new Date();
  const rng = typeof o.rng === 'function' ? o.rng : Math.random;
  const at = fmt(now);
  const day = at.slice(0, 10);
  const meth = METHODS[o.method] || METHODS.coin;

  // ① 摇卦
  const rolls = (Array.isArray(o.lines) && o.lines.length === 6)
    ? o.lines.map((v) => ({ coins: null, back: null, value: Number(v), given: true, method: meth.key }))
    : sixThrows(rng, meth.key);
  const lines = rolls.map(r => r.value);
  const yang = lines.map(v => v === 7 || v === 9);
  const moving = [];
  lines.forEach((v, i) => { if (v === 6 || v === 9) moving.push(i); });

  const benKey = yang.map(b => (b ? '1' : '0')).join('');
  const bianYang = yang.map((b, i) => (moving.includes(i) ? !b : b));
  const bianKey = bianYang.map(b => (b ? '1' : '0')).join('');
  const ben = GUAD.BY_KEY[benKey];
  const bian = GUAD.BY_KEY[bianKey];

  const yaoView = lines.map((v, i) => ({
    i, pos: i + 1, value: v, name: YAO_CN[v],
    coins: rolls[i].coins ? rolls[i].coins.map(c => COIN_CN[c]) : null,
    back: rolls[i].back, given: !!rolls[i].given,
    // 大衍揲蓍法没有铜钱，明细要显示「三变归奇 → 余策」，否则表格那一列会空着
    gone: rolls[i].gone || null, remain: rolls[i].remain || null,
    yang: yang[i], moving: moving.includes(i),
    yaoName: ben.yao[i].name,
    benCi: ben.yao[i].ci, bianCi: bian.yao[i].ci,
    // 解释层：小象传（逐爻解释爻辞的官方注）+ 吉/中/凶标签（384 爻全部有据）
    benXiang: ben.yao[i].xiang || null,
    benLuck: ben.yao[i].luck || null,
    benSay: (EX[ben.no] || {}).y ? (EX[ben.no].y[i] || null) : null,
    // 本卦与变卦同爻位恰好同辞时不重复给 —— 页面不必显示两遍一模一样的话
    bianXiang: (bianKey === benKey || bian.yao[i].ci === ben.yao[i].ci) ? null : (bian.yao[i].xiang || null),
    bianSay: (bianKey === benKey || bian.yao[i].ci === ben.yao[i].ci) ? null : ((EX[bian.no] || {}).y || [])[i] || null,
  }));

  // ② 取用
  const cited = pickCited(ben, bian, moving);

  // ③ 吉凶（可复核：把命中的词一起返回）
  // ⚠️ 去重：0 动爻时主引文就是本卦卦辞，不能既按主引文 ×2 又按卦辞 ×1 再算一遍
  const main = cited.find(c => c.primary) || cited[0];
  const sMain = scanLuck(main.text);
  const flat = s => String(s == null ? '' : s).replace(/\s/g, '');
  const sBen = flat(ben.ci) === flat(main.text) ? { score: 0, words: [] } : scanLuck(ben.ci);
  const sBian = flat(bian.ci) === flat(main.text) ? { score: 0, words: [] } : scanLuck(bian.ci);
  const score = { main: sMain.score * 2, ben: sBen.score, bian: sBian.score };
  const total = score.main + score.ben + score.bian;
  const [lvKey, lvLabel] = levelOf(total);
  const action = (lvKey === 'j1' || lvKey === 'j2') ? '宜进' : (lvKey === 'x1' || lvKey === 'x2') ? '宜等' : '宜守';

  // ④ 精确抽数 —— 卦只决定「要到几成把握才出手」，具体抽数由官方概率模型解出**一个单点**
  const gt = String(o.gt || '11');
  const m = MODEL[gt] || MODEL['11'];
  let analysis = o.analysis;
  if (o.cur == null && !analysis) {
    try { analysis = require('./analyze.js').analyze(); } catch (e) { analysis = null; }
  }
  let cur = o.cur;
  if (cur == null && analysis && analysis.poolBounds) {
    const p = analysis.poolBounds.find(x => String(x.gt) === gt);
    if (p) cur = p.cur;
  }
  if (cur == null || !isFinite(cur)) cur = 0;
  cur = Math.max(0, Math.min(m.hard - 1, Math.floor(cur)));

  const remain = m.hard - cur;
  const [goal, goalNote] = GOAL[lvKey];
  // 保底状态：小保底（出金只有 up 概率是当期）／大保底（出金必定是当期）
  // ⚠️ 我们不从记录里自动推定这个 —— 记录里没有「上一个金是不是 UP」的可靠字段，
  //    硬猜就是循环论证。默认按小保底（保守），由用户在页面上切换。
  const upMode = o.upMode === 'big' ? 'big' : 'small';
  const pUp = !m.unique ? 1 : (upMode === 'big' ? 1 : m.up);

  const goldDraws = needFor(m, cur, goal);
  const upDraws = needForUp(m, cur, goal, pUp);
  const goldChance = cumAt(m, cur, goldDraws);
  const upChance = upWithin(m, cur, upDraws, pUp);
  const upMax = upWithin(m, cur, Math.max(1, remain), pUp);
  const upReach = upDraws <= remain;
  // 页面主推哪个数字：本期够得到 UP 线就推 UP 线；够不到就直接摊开天花板 + 出金线，
  // 而不是硬塞一个达不到的把握 —— 那才是真正没用的「大范围建议」。
  const headline = {
    kind: upReach ? 'up' : 'gold',
    at: upReach ? cur + upDraws : cur + goldDraws,
    draws: upReach ? upDraws : goldDraws,
    chance: upReach ? upChance : goldChance,
    note: upReach
      ? `本池第 ${cur + upDraws} 抽前，拿到当期把握 ${(upChance * 100).toFixed(1)}%`
      : `小保底可能先歪一次，而剩余抽数不够再吃一次保底 —— 所以本期拿不到当期，先按出金线出手`,
  };

  const timing = {
    gt, pool: m.name, cur, hard: m.hard, remain,
    approx: !!m.approx, upEstimated: !!m.upEstimated,
    unique: !!m.unique, up: m.up, upMode, pUp,
    goal, goalNote, headline,
    // ★ 主推：两条单点线
    gold: { draws: goldDraws, at: cur + goldDraws, chance: goldChance },
    upLine: {
      draws: upDraws, at: cur + upDraws,
      chance: upChance,
      reached: upReach,          // 本期能不能做到
      maxChance: upMax,          // 本期天花板（抽完剩余抽数）
    },
    upSafe: needForUp(m, cur, 1, pUp, 0),   // 「稳拿」需要多少抽（严格 100%，不容差）
    mean: meanDraws(m, cur),
    // 参照刻度（页面做小注脚用）
    ref: { p50: needFor(m, cur, 0.5), p80: needFor(m, cur, 0.8), p95: needFor(m, cur, 0.95) },
    anchors: anchorsOf(m, cur, headline.at,
      `卦象要求 ${(goal * 100).toFixed(0)}% 把握 —— 最小达标就是第 ${headline.at} 抽（实际 ${(headline.chance * 100).toFixed(1)}%）`),
    // 双曲线：出金把握 + 拿 UP 把握（页面画图用）
    curve: (() => {
      const f = goldPmf(m, cur, remain), g = cumTable(m, remain);
      let acc = 0;
      return f.map((_, i) => {
        acc += f[i];
        return { k: i + 1, at: cur + i + 1, p: acc, u: upWithin(m, cur, i + 1, pUp, f, g) };
      });
    })(),
  };

  // ⑤ 万年历 + 择时（o.light 时跳过 —— 批量统计用，农历换算是这里最贵的一步）
  let almanac = null;
  if (!o.light) {
    const alm = AL.almanac(at);
    const z = ZR.zeri(day);
    almanac = {
      date: day, label: alm.label, level: alm.level, short: alm.short,
      day: {
        gz: alm.day.gz, lunar: alm.day.lunar, zhiXing: alm.day.zhiXing, xiu: alm.day.xiu,
        tianShen: alm.day.tianShen, type: alm.day.type, yi: alm.day.yi, ji: alm.day.ji,
        xun: z.day.xun, xunKong: z.day.xunKong,
        jiShen: z.day.jiShen, xiongSha: z.day.xiongSha,
        cai: z.day.cai, xi: z.day.xi, fu: z.day.fu,
      },
      hour: { zhi: alm.hour.zhi, gz: alm.hour.gz, tianShen: alm.hour.tianShen, type: alm.hour.type },
      hours: z.hours,          // 12 个时辰，已按择时得分降序、带 rank / marks / label
      best: z.best,            // 吉时榜榜首
      spots: z.spots,          // 前三名
      doc: z.doc,              // 评分维度与档位口径（页面直接摊开展示）
    };
  }

  // ⑥ 自检
  const asserts = [];
  const chk = (ok, label, got) => asserts.push({ ok, label, got });
  if (o.light) {
    chk(lines.length === 6 && !!ben && !!bian, '六爻齐备且能查到卦', `${lines.length} 爻`);
    return {
      ok: true, at, day, gt, coinRule: meth.rule, method: meth, rolls: yaoView,
      ben: viewOf(ben, benKey), bian: viewOf(bian, bianKey),
      moving, movingNames: moving.map(i => ben.yao[i].name),
      rule: { n: moving.length, text: RULE[moving.length] },
      cited, luck: luckOf(total, lvKey, lvLabel, action, sMain, sBen, sBian),
      timing, almanac, assertSummary: { all: 1, failed: asserts.filter(a => !a.ok).length }, asserts,
    };
  }
  chk(lines.length === 6, '六爻齐备', `${lines.length} 爻`);
  chk(lines.every(v => v === 6 || v === 7 || v === 8 || v === 9), '爻值合法（6/7/8/9）', lines.join(','));
  chk(!!ben && !!bian, '本卦与变卦都能查到', `${ben && ben.full} → ${bian && bian.full}`);
  const expectMoving = lines.map((v, i) => ((v === 6 || v === 9) ? i : -1)).filter(i => i >= 0).join(',');
  chk(moving.join(',') === expectMoving, '动爻 = 老阳/老阴的位置', moving.map(i => i + 1).join(',') || '无');
  // 变卦 = 且仅 = 动爻反转
  const recomputed = yang.map((b, i) => (moving.includes(i) ? !b : b)).map(b => (b ? '1' : '0')).join('');
  chk(recomputed === bianKey, '变卦恰为动爻反转所得', bianKey);
  if (moving.length === 0) chk(benKey === bianKey, '无动爻时本卦=变卦', benKey);
  else chk(benKey !== bianKey, '有动爻时本卦≠变卦', `${benKey}≠${bianKey}`);
  chk(cited.length === EXPECT_CITED[moving.length], '取用条数符合变占规则', `${cited.length} 条`);
  chk(cited.filter(c => c.primary).length === 1, '恰有一条主引文', cited.filter(c => c.primary).length + ' 条');
  chk(cited.every(c => c.text && c.text.length), '引文都有正文', cited.map(c => c.label).join(' / '));  chk(timing.hard === m.hard && timing.cur < m.hard, '保底进度在合法区间', `已垫 ${cur} / 硬保底 ${m.hard}`);
  chk(timing.gold.draws >= 1 && timing.gold.at <= m.hard, '出金线落在剩余范围内', `第 ${timing.gold.at} 抽（还需 ${timing.gold.draws}）`);
  // 出金线：既要达标，也要是**最小**达标抽数 —— 否则「第 N 抽」就成了随便给的一个数
  // ⚠️ 软保底区一抽能跳 6~50 个百分点，累计曲线是阶梯状的，所以实际把握会超过目标值，属正常
  chk(timing.gold.chance >= timing.goal - 1e-9 &&
    (timing.gold.draws === 1 || cumAt(m, cur, timing.gold.draws - 1) < timing.goal),
    '出金线是最小达标抽数（超出的部分是阶梯跳变，不是算宽了）',
    `第 ${timing.gold.draws} 抽 ${(timing.gold.chance * 100).toFixed(1)}% ≥ ${(timing.goal * 100).toFixed(0)}%` +
    (timing.gold.draws > 1 ? `，上一抽 ${(cumAt(m, cur, timing.gold.draws - 1) * 100).toFixed(1)}%` : '（首抽即达标）'));
  chk(timing.upLine.chance >= timing.goal - GOAL_TOL, 'UP 线达到了卦象要求的把握',
    `${(timing.upLine.chance * 100).toFixed(1)}% ≥ ${(timing.goal * 100).toFixed(0)}%（第 ${timing.upLine.at} 抽）`);
  chk(timing.upLine.reached === (timing.upLine.draws <= remain), 'reached 标记与实际抽数自洽',
    `${timing.upLine.draws} ${timing.upLine.reached ? '≤' : '>'} 剩余 ${remain}`);
  chk(timing.upLine.reached || timing.upLine.maxChance < timing.goal - GOAL_TOL,
    '本期不可达时，天花板确实够不到目标（不是算错）',
    `本期上限 ${(timing.upLine.maxChance * 100).toFixed(1)}% < ${(timing.goal * 100).toFixed(0)}%`);
  chk(timing.upLine.maxChance <= 1 + 1e-9 && timing.upLine.maxChance > 0,
    'UP 本期天花板落在 (0,1] 内', (timing.upLine.maxChance * 100).toFixed(1) + '%');
  // ⚠️ chance 是「达到目标把握那一刻」的把握（可能跨到下一期），maxChance 是「本期剩余抽数」的天花板，
  //    两者只在 reached 时才可直接比较 —— 不可达时 chance 必然大于 maxChance。
  chk(timing.upLine.reached
    ? timing.upLine.chance <= timing.upLine.maxChance + 1e-9
    : timing.upLine.chance > timing.upLine.maxChance,
    'reached 与「目标把握 vs 本期天花板」自洽',
    `目标 ${(timing.upLine.chance * 100).toFixed(1)}% ${timing.upLine.reached ? '≤' : '>'} 天花板 ${(timing.upLine.maxChance * 100).toFixed(1)}%`);
  chk(timing.upSafe >= timing.upLine.draws, '「稳拿」所需抽数 ≥ 目标把握所需',
    `稳拿 ${timing.upSafe} ≥ 目标 ${timing.upLine.draws}`);
  chk(timing.upLine.draws >= timing.gold.draws, 'UP 线不早于出金线（拿到当期 ⊆ 出金）',
    `UP 第 ${timing.upLine.at} 抽 ≥ 出金第 ${timing.gold.at} 抽`);
  chk(timing.headline.kind === (timing.upLine.reached ? 'up' : 'gold') &&
    timing.headline.at === (timing.upLine.reached ? timing.upLine.at : timing.gold.at),
    '主推数字与可达性一致', `${timing.headline.kind} → 本池第 ${timing.headline.at} 抽`);
  if (pUp >= 1 - 1e-9) chk(timing.upLine.draws === timing.gold.draws, '大保底时出金线 = UP 线', `${timing.gold.draws} / ${timing.upLine.draws}`);
  chk(Math.abs(timing.mean - meanDraws(m, cur)) < 1e-9, '平均抽数为解析解（非模拟）', timing.mean.toFixed(2));
  if (timing.curve.length) {
    const last = timing.curve[timing.curve.length - 1];
    chk(Math.abs(last.p - 1) < 1e-9, '概率曲线末端必为 100%', last.p);
    let mono = true, monoU = true;
    for (let i = 1; i < timing.curve.length; i++) {
      if (timing.curve[i].p < timing.curve[i - 1].p - 1e-12) mono = false;
      if (timing.curve[i].u < timing.curve[i - 1].u - 1e-12) monoU = false;
    }
    chk(mono, '出金累计概率单调不减', mono ? 'OK' : '有回落');
    chk(monoU, '拿 UP 累计概率单调不减', monoU ? 'OK' : '有回落');
    chk(timing.curve.every(r => r.u <= r.p + 1e-9), '拿 UP 把握恒 ≤ 出金把握',
      `末端 ${(last.u * 100).toFixed(1)}% ≤ ${(last.p * 100).toFixed(1)}%`);
  }
  // 新手池没有软保底，所有阈值都会落到硬保底上并合并成一行 —— 这是正确的，不是缺项
  chk(timing.anchors.length >= 1 && timing.anchors.every((r, i, a) => i === 0 || r.abs > a[i - 1].abs),
    '关键刻度按抽数升序', `${timing.anchors.length} 个锚点：${timing.anchors.map(r => r.abs).join('/')}`);
  chk(timing.anchors.some(r => r.tags.includes('硬保底')), '关键刻度必含硬保底',
    timing.anchors.map(r => r.tags.join('+')).join(' / '));
  chk(timing.anchors.some(r => r.abs === timing.headline.at), '关键刻度必含主推的那一抽（否则算不出它的来历）',
    `主推第 ${timing.headline.at} 抽 · 刻度 ${timing.anchors.map(r => r.abs).join('/')}`);
  chk(timing.anchors.every(r => r.p1 > 0 && r.p1 <= 1 && r.pc > 0 && r.pc <= 1), '刻度上的概率都在 (0,1]', timing.anchors.map(r => r.p1.toFixed(2)).join(','));
  const mdl = assertModel();
  chk(mdl.allOk, '概率模型对得上官方综合概率', mdl.list.filter(x => !x.ok).map(x => x.label).join(',') || '全部吻合');
  if (almanac) {
    const hs = almanac.hours;
    chk(hs.length === 12, '十二时辰齐备', hs.length + ' 个');
    chk(hs.every((h, i) => h.rank === i + 1), '吉时榜按分数降序排好', hs.map(h => h.zhi).join(''));
    chk(almanac.best.score === Math.max.apply(null, hs.map(h => h.score)), '榜首 = 最高分', almanac.best.zhi + '时 ' + almanac.best.score);
    // 不是每天都有「吉时」（实测 1100 天里 36 天没有，约 3%）——
    // 但「次吉及以上」每天必有，否则榜单就失去意义了
    chk(hs.some(h => h.good), '每日至少有一个次吉及以上', hs.filter(h => h.good).map(h => h.zhi).join('、'));
    chk(hs.every(h => h.marks.length >= 1), '每个时辰都带可复核的打分理由', hs.map(h => h.marks.length).join(','));
  }

  return {
    ok: true, at, day, gt,
    coinRule: meth.rule,
    method: meth,
    rolls: yaoView,
    ben: viewOf(ben, benKey),
    bian: viewOf(bian, bianKey),
    moving, movingNames: moving.map(i => ben.yao[i].name),
    rule: { n: moving.length, text: RULE[moving.length] },
    cited,
    luck: luckOf(total, lvKey, lvLabel, action, sMain, sBen, sBian),
    timing, almanac,
    assertSummary: { all: asserts.length, failed: asserts.filter(a => !a.ok).length },
    asserts,
  };
}

module.exports = {
  cast, MODEL, METHODS, MOVING_P, GOAL,
  // 概率工具（页面、测试、外部脚本都可以直接引用，口径只有这一处）
  pAt, cumAt, needFor, goldPmf, cumTable, upWithin, needForUp, meanDraws, anchorsOf,
  expectDraws, assertModel, assertCasting, mulberry32,
  scanLuck, LUCK, hoursOf, RULE, YAO_CN,
  throwOnce, yarrowOnce, sixThrows,
};
