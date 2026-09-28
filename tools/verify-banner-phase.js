#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 「卡池节奏」的**性质**验收（无依赖、离线、不起服务；CI 里跑）。
//
// 只验证数学与口径性质，不验证具体数字 —— 数字会随抽卡数据与历史表更新而变，性质不会：
//   ① 历史表 schema：任何一条不合格都必须被**整体拒绝**，不能半截可信
//   ② 阶段判定：S / S+D/3 / S+2D/3 / E 四个边界的归属；三分点进后一档；区间外不归段
//   ③ 时区：本地记录的无时区字符串一律按 +08:00 解释，与机器所在时区无关
//   ④ 归期：唯一命中 / 五星 UP 认领 / 同期同区间（阶段一致）/ 歧义 / 未映射 / 长期开放
//   ⑤ 边界不确定：端点有不确定量时，阶段会翻转的抽卡必须被标出来并排除出阶段分母；
//      「本 ID 已证明存在的时刻」能收窄不确定带，不许把已确定的抽卡误报成不确定
//   ⑥ 并行异长：同一版本的整版池与半期池，同一时刻在不同池里可以是不同阶段
//   ⑦ 一致性：三阶段之和 = 已纳入；每抽恰好进一个阶段或一个明确排除状态，绝不重复
//   ⑧ 筛选：角色池 + 光锥池 = 常规活动池（逐阶段）
//
// 用法：node tools/verify-banner-phase.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const bp = require(path.join(__dirname, '..', 'core', 'banner-phase.js'));
const { loadRecords } = require(path.join(__dirname, '..', 'core', 'analyze.js'));

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-9 : e);
const sumP = ph => bp.PHASES.reduce((a, k) => a + ph[k].pulls, 0);
const sumG = ph => bp.PHASES.reduce((a, k) => a + ph[k].golds, 0);
const section = t => console.log('\n' + t);

// ── 造数据的小工具 ───────────────────────────────────────────────────────────
let _id = 0;
/** 造一条抽卡记录。time 用服务器时间写法（无时区），与真实记录一致。 */
const rec = (gt, gid, time, rank, name) => ({
  id: 'x' + (++_id), gacha_type: String(gt), gacha_id: String(gid), time: time,
  rank_type: String(rank), name: name || (String(rank) === '5' ? '测试UP' : '测试三星'),
  item_id: 'i' + _id, item_type: String(gt) === '12' || String(gt) === '22' ? '光锥' : '角色', count: '1',
});
/** 造一条历史表条目。slot 默认跟着 key 走，避免测试数据自己撞上「版本+期次+池类型」唯一性校验 */
const ent = (o) => Object.assign({
  key: 'k', version: '9.9', slot: String((o && o.key) || 'k'), poolTypes: [11], title: 't',
  featured: { 11: [], 12: [] },
  startAt: '2026-01-01T12:00:00+08:00', endAtExclusive: '2026-01-22T12:00:00+08:00',
  startPrecision: 'minute', endPrecision: 'minute',
  startUncertaintyMs: 0, endUncertaintyMs: 0,
  status: 'verified', sourceType: 'official', sourceUrl: 'about:blank', verifiedAt: '2026-01-01',
}, o);
const hist = (...entries) => ({ schema: 1, entries });

// ═════════════════════════════════════════════════════════════════════════════
section('① 历史表 schema：不合格必须整体拒绝');
{
  ok(bp.validate(hist(ent({}))).ok, '正常条目通过');
  ok(!bp.validate(hist(ent({ key: '' }))).ok, '缺 key 被拒');
  ok(!bp.validate(hist(ent({ key: 'a' }), ent({ key: 'a' }))).ok, 'key 重复被拒');
  ok(!bp.validate(hist(ent({ startAt: '不是时间' }))).ok, 'startAt 解析不了被拒');
  ok(!bp.validate(hist(ent({ endAtExclusive: '2025-12-31T00:00:00+08:00' }))).ok, 'end 早于 start 被拒');
  ok(!bp.validate(hist(ent({ startPrecision: 'week' }))).ok, '非法 precision 被拒');
  ok(!bp.validate(hist(ent({ status: 'maybe' }))).ok, '非法 status 被拒');
  ok(!bp.validate(hist(ent({ poolTypes: [99] }))).ok, '未知池类型被拒');
  ok(!bp.validate(hist(ent({ poolTypes: [] }))).ok, '空 poolTypes 被拒');
  ok(!bp.validate(hist(ent({ version: '9.9', slot: '上半' }), ent({ version: '9.9', slot: '上半' }))).ok,
     '同版本+同期次+同池类型写重了被拒');
  // 并行卡池（整版池 + 半期池）是合法形态，只给提示不给错误
  const par = bp.validate(hist(
    ent({ key: 'all', endAtExclusive: '2026-01-22T12:00:00+08:00' }),
    ent({ key: 'half', endAtExclusive: '2026-01-11T12:00:00+08:00' })));
  ok(par.ok, '同类型区间并行不算错误');
  ok(par.warnings.length === 1, '并行会给出提示', par.warnings);
  // 坏表必须让 build 直接抛错，而不是算出一堆错阶段
  let threw = false;
  try { bp.build({ records: [], history: hist(ent({ key: '' })) }); } catch (e) { threw = true; }
  ok(threw, '校验失败时 build 直接抛错');
}

section('② 阶段判定与边界');
{
  const S = Date.parse('2026-01-01T12:00:00+08:00');
  const E = Date.parse('2026-01-22T12:00:00+08:00');
  const D = E - S;
  const P = t => bp.phaseOf(t, S, E);
  ok(P(S) === 'early', 'S 此刻 → 前期', P(S));
  ok(P(S + D / 3 - 1) === 'early', '三分点前 1ms → 前期');
  ok(P(S + D / 3) === 'mid', '正好落在 1/3 点 → 中期（边界进后一档）', P(S + D / 3));
  ok(P(S + 2 * D / 3 - 1) === 'mid', '2/3 点前 1ms → 中期');
  ok(P(S + 2 * D / 3) === 'late', '正好落在 2/3 点 → 后期', P(S + 2 * D / 3));
  ok(P(E - 1) === 'late', '关池前 1ms → 后期');
  ok(P(E) === null, 'T = E 不再属于该池');
  ok(P(S - 1) === null, '开池前 1ms 不属于该池');
  ok(bp.progressOf(S, S, E) === 0 && near(bp.progressOf(E, S, E), 1, 1e-12), '进度 0→1');
  ok(bp.phaseOf(S, S, S) === null, '零长度区间不给阶段');
  // 判定用真实毫秒、不先取整：差 1 毫秒必须可能改变归属
  ok(P(S + D / 3 - 1) !== P(S + D / 3), '跨三分点 1ms 即换档（没有按天取整）');
}

section('③ 服务器时区解释（+08:00，与机器时区无关）');
{
  ok(bp.parseServerTime('2026-01-01 12:00:00') === Date.parse('2026-01-01T12:00:00+08:00'), '无时区字符串按 +08:00');
  ok(bp.parseServerTime('2026-01-01T12:00') === bp.parseServerTime('2026-01-01 12:00'), 'T 与空格写法等价');
  ok(bp.parseServerTime('2026-01-01 12:00') === bp.parseServerTime('2026-01-01 12:00:00'), '缺秒补 00');
  ok(bp.fmtServerTime(bp.parseServerTime('2026-01-01 00:05:00')) === '2026-01-01 00:05', '格式化回同一时刻');
  ok(bp.fmtServerTime(Date.parse('2025-12-31T16:00:00Z')) === '2026-01-01 00:00', 'UTC 16:00 = 本地 00:00');
  ok(isNaN(bp.parseServerTime('')), '空串解析为 NaN');
}

section('④ 归期判定');
{
  const H = hist(
    ent({ key: 'A', startAt: '2026-01-01T12:00:00+08:00', endAtExclusive: '2026-01-22T12:00:00+08:00',
          featured: { 11: ['甲'], 12: [] } }),
    // 与 A 同时开场、但更早关：整版池 vs 半期池
    ent({ key: 'B', startAt: '2026-01-01T12:00:00+08:00', endAtExclusive: '2026-01-11T12:00:00+08:00',
          featured: { 11: ['乙'], 12: [] } }));
  // ① 唯一命中（只落在一个区间内）
  let r = bp.build({ records: [rec(11, '1', '2026-01-15 12:00:00', 5, '甲')], history: H, pools: [11] });
  ok(r.coverage.included.pulls === 1 && r.poolRows[0].key === 'A', '只落在一个区间 → 唯一命中');
  ok(r.poolRows[0].phases.late.pulls === 1, '该抽落后期', r.poolRows[0].phases);

  // ② 落在两个候选里、但有 UP 证据 → 认领
  r = bp.build({ records: [rec(11, '2', '2026-01-02 12:00:00', 5, '乙')], history: H, pools: [11] });
  ok(r.poolRows.length === 1 && r.poolRows[0].key === 'B', 'UP 名把歧义解开', r.poolRows.map(x => x.key));
  ok(r.detail[0].assignSrc === 'up', '识别依据 = UP 认领', r.detail[0].assignSrc);

  // ③ 两个候选起止完全相同 → 阶段可确定、不算歧义
  const H2 = hist(
    ent({ key: 'C', startAt: '2026-02-01T12:00:00+08:00', endAtExclusive: '2026-02-22T12:00:00+08:00', featured: { 11: ['丙'], 12: [] } }),
    ent({ key: 'D', startAt: '2026-02-01T12:00:00+08:00', endAtExclusive: '2026-02-22T12:00:00+08:00', featured: { 11: ['丁'], 12: [] } }));
  r = bp.build({ records: [rec(11, '3', '2026-02-03 12:00:00', 3)], history: H2, pools: [11] });
  ok(r.pending.length === 0 && r.coverage.included.pulls === 1, '同期同区间 → 计入已确认，不进待核实');
  ok(r.detail.length === 0, '没有五星就没有明细行（但抽数已计入）');

  // ④ 候选起止不同、又没有 UP 证据 → ambiguous，排除出结论
  //    取 01-06：在 A（21 天）里是前期（24%），在 B（10 天）里已是中期（50%）→ 阶段不同
  r = bp.build({ records: [rec(11, '4', '2026-01-06 12:00:00', 3)], history: H, pools: [11] });
  ok(r.pending.length === 1 && r.pending[0].state === 'ambiguous', '阶段可能不同 → 歧义', r.pending);
  ok(r.pending[0].code === 'ambig-multi', '歧义带机器可读原因码');
  ok(r.coverage.excluded.ambiguous.pulls === 1, '歧义抽数进排除统计');
  ok(r.coverage.included.pulls === 0, '歧义不进已纳入');

  // ⑤ 任何区间都容不下 → unmapped
  r = bp.build({ records: [rec(11, '5', '2026-05-05 12:00:00', 3)], history: H, pools: [11] });
  ok(r.pending.length === 1 && r.pending[0].state === 'unmapped', '区间外 → 未映射');
  ok(r.pending[0].code === 'unmapped-nocover', '未映射原因码');

  // ⑥ 记录跨出候选区间 → unmapped-span
  r = bp.build({ records: [rec(11, '6', '2026-01-05 12:00:00', 3), rec(11, '6', '2026-01-25 12:00:00', 3)], history: H, pools: [11] });
  ok(r.pending.length === 1 && r.pending[0].code === 'unmapped-span', '跨出区间 → unmapped-span', r.pending.map(p => p.code));

  // ⑦ 长期开放（没有结束时刻）→ 只进「进行中」，不生成三段
  const H3 = hist(ent({ key: 'LD', poolTypes: [21], startAt: '2026-01-01T12:00:00+08:00', endAtExclusive: null, endPrecision: 'unknown' }));
  r = bp.build({ records: [rec(21, '7', '2026-03-01 12:00:00', 5, '联动UP')], history: H3, pools: [21] });
  ok(r.ongoing.length === 1 && r.ongoing[0].openEnded, '长期开放进进行中区', r.ongoing);
  ok(r.coverage.included.pulls === 0, '长期开放不计入已纳入');
}

section('⑤ 端点不确定与边界不确定');
{
  // 开池只到「日」精度：不确定量 3 小时
  const H = hist(ent({
    key: 'U', startAt: '2026-03-01T11:00:00+08:00', endAtExclusive: '2026-03-22T12:00:00+08:00',
    startPrecision: 'day', startUncertaintyMs: 3 * 3600 * 1000,
  }));
  const S = Date.parse('2026-03-01T11:00:00+08:00'), E = Date.parse('2026-03-22T12:00:00+08:00');
  // 正好落在 1/3 分界前后 1 小时 → 端点抖动会改判 → 必须标出来
  const nearCut = new Date(S + (E - S) / 3 - 3600 * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const farFromCut = '2026-03-02 12:00:00';
  // 注意：这里构造的 time 是「服务器时间字符串」，用 UTC 转一下保持可读性
  const srv = ms => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const recNear = rec(11, 'u1', srv(S + (E - S) / 3 - 3600 * 1000), 3);
  const recFar = rec(11, 'u2', srv(S + 2 * 3600 * 1000), 3);
  let r = bp.build({ records: [recNear, recFar], history: H, pools: [11] });
  ok(r.coverage.boundary.pulls === 1, '只有贴着三分点的那一抽被标为边界不确定', r.coverage.boundary);
  ok(r.coverage.included.pulls === 1, '另一抽正常纳入');
  ok(r.poolRows[0].boundaryPulls === 1, '逐池也记了边界不确定抽数');

  // 「本 ID 自己已证明存在」能收窄不确定带：首抽就在估计开池时刻之前
  const early = rec(11, 'u3', srv(S - 7 * 60 * 1000), 3);   // 比最佳估计早 7 分钟（真实数据里就有这个情形）
  r = bp.build({ records: [early, rec(11, 'u3', srv(S + 3600 * 1000), 3)], history: H, pools: [11] });
  ok(r.coverage.boundary.pulls === 0, '开池估计晚于首抽时不会误报边界不确定', r.coverage.boundary);
  ok(r.coverage.included.pulls === 2, '这两抽都能判定阶段');

  // 结束端点不确定量很大时，靠近末端且会翻转的抽卡要被标出来
  const H2 = hist(ent({
    key: 'U2', startAt: '2026-04-01T12:00:00+08:00', endAtExclusive: '2026-04-22T12:00:00+08:00',
    endUncertaintyMs: 24 * 3600 * 1000,
  }));
  const S2 = Date.parse('2026-04-01T12:00:00+08:00'), E2 = Date.parse('2026-04-22T12:00:00+08:00');
  const recLateCut = rec(11, 'u4', srv(S2 + 2 * (E2 - S2) / 3 + 4 * 3600 * 1000), 3);
  const recSafe = rec(11, 'u5', srv(S2 + 3600 * 1000), 3);
  r = bp.build({ records: [recLateCut, recSafe], history: H2, pools: [11] });
  ok(r.coverage.boundary.pulls === 1, '2/3 点附近 + 24 小时不确定量 → 标出 1 抽', r.coverage.boundary);
}

section('⑥ 并行异长：整版池与半期池，同一时刻阶段可以不同');
{
  const H = hist(
    ent({ key: 'V-全版', startAt: '2026-06-01T12:00:00+08:00', endAtExclusive: '2026-07-13T12:00:00+08:00' }),
    ent({ key: 'V-上半', startAt: '2026-06-01T12:00:00+08:00', endAtExclusive: '2026-06-22T12:00:00+08:00' }));
  const S = Date.parse('2026-06-01T12:00:00+08:00');
  const E1 = Date.parse('2026-06-22T12:00:00+08:00');   // 21 天
  const E2 = Date.parse('2026-07-13T12:00:00+08:00');   // 42 天
  // 取「半期池已过 1/3、但整版池还没到 1/3」的那一天：
  //   半期池 21 天 → 1/3 点在第 7 天；整版池 42 天 → 1/3 点在第 14 天。第 8 天正好卡在中间。
  const t = S + 8 * 86400000;
  ok(bp.phaseOf(t, S, E1) === 'mid', '同一天在半期池里是中期');
  ok(bp.phaseOf(t, S, E2) === 'early', '同一天在整版池里还是前期');
  const srv = ms => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const r = bp.build({ records: [rec(11, 'v1', srv(t), 3)], history: H, pools: [11] });
  ok(r.pending.length === 1, '两条并行卡池都容得下 → 阶段不同即歧义（不静默分配）', r.pending.map(p => p.code));
}

section('⑦ 聚合一致性');
{
  const recs = loadRecords().list;
  const nowMs = Date.parse('2026-09-28T23:09:00+08:00');
  for (const pools of [[11, 12], [11], [12], [21, 22]]) {
    const r = bp.build({ records: recs, pools, nowMs });
    const tag = 'pools=' + pools.join(',');
    ok(sumP({ early: r.phases[0], mid: r.phases[1], late: r.phases[2] }) === r.coverage.included.pulls,
       tag + ' 三阶段抽数之和 = 已纳入');
    ok(sumG({ early: r.phases[0], mid: r.phases[1], late: r.phases[2] }) === r.coverage.included.golds,
       tag + ' 三阶段金数之和 = 已纳入');
    const poolPulls = r.poolRows.reduce((a, x) => a + x.pulls, 0);
    const poolBound = r.poolRows.reduce((a, x) => a + (x.boundaryPulls || 0), 0);
    ok(poolPulls - poolBound === r.coverage.included.pulls, tag + ' 逐池抽数 − 边界 = 已纳入', [poolPulls, poolBound, r.coverage.included.pulls]);
    ok(poolBound === r.coverage.boundary.pulls, tag + ' 逐池边界抽数之和 = 总体边界抽数');
    let bad = 0;
    r.poolRows.forEach(x => {
      const s = sumP(x.phases);
      if (s + (x.boundaryPulls || 0) !== x.pulls) bad++;
    });
    ok(bad === 0, tag + ' 每一池：三阶段 + 边界 = 该池总抽数（一抽只进一个状态）');
    // 逐池的三阶段之和 = 总体三阶段
    for (const k of bp.PHASES) {
      const s = r.poolRows.reduce((a, x) => a + x.phases[k].pulls, 0);
      const g = r.poolRows.reduce((a, x) => a + x.phases[k].golds, 0);
      ok(s === r.phases.find(p => p.key === k).pulls, tag + ' 逐池 ' + k + ' 抽数 = 总体 ' + k);
      ok(g === r.phases.find(p => p.key === k).golds, tag + ' 逐池 ' + k + ' 金数 = 总体 ' + k);
    }
    // 占比之和
    if (r.coverage.included.pulls) {
      ok(near(r.phases.reduce((a, p) => a + p.pullShare, 0), 100, 0.35), tag + ' 抽数占比之和 ≈ 100%');
      ok(near(r.phases.reduce((a, p) => a + p.goldShare, 0), 100, 0.35), tag + ' 五星占比之和 ≈ 100%');
    }
  }
}

section('⑧ 筛选一致性：角色池 + 光锥池 = 常规活动池');
{
  const recs = loadRecords().list;
  const nowMs = Date.parse('2026-09-28T23:09:00+08:00');
  const both = bp.build({ records: recs, pools: [11, 12], nowMs });
  const ch = bp.build({ records: recs, pools: [11], nowMs });
  const lc = bp.build({ records: recs, pools: [12], nowMs });
  ok(ch.coverage.included.pulls + lc.coverage.included.pulls === both.coverage.included.pulls, '抽数可加');
  ok(ch.coverage.included.golds + lc.coverage.included.golds === both.coverage.included.golds, '金数可加');
  for (const k of bp.PHASES) {
    const a = ch.phases.find(p => p.key === k), b = lc.phases.find(p => p.key === k), c = both.phases.find(p => p.key === k);
    ok(a.pulls + b.pulls === c.pulls, k + ' 抽数可加');
    ok(a.golds + b.golds === c.golds, k + ' 金数可加');
  }
  // 同一个开放区间被角色池与光锥池共用一条记录，所以池数不能直接相加；
  //  正确的性质是：常规活动池的池集合 = 角色池池集合 ∪ 光锥池池集合（无遗漏、无多余）
  const setOf = x => new Set(x.poolRows.map(r2 => r2.key));
  const u = setOf(ch); lc.poolRows.forEach(r2 => u.add(r2.key));
  const b = setOf(both);
  ok(u.size === b.size && [...u].every(k => b.has(k)), '常规活动池的池集合 = 角色池 ∪ 光锥池');
}

section('⑨ 真实数据的完整链路（计数不写死，只校验守恒与覆盖）');
{
  const recs = loadRecords().list;
  const nowMs = Date.parse('2026-09-28T23:09:00+08:00');
  const r = bp.build({ records: recs, pools: [11, 12], nowMs });
  const cov = r.coverage;
  // 活动池（11/12）的全部抽数必须能对上账：已纳入 + 边界 + 歧义 + 未映射 + 进行中
  const evt = recs.filter(x => x.gacha_type === '11' || x.gacha_type === '12').length;
  const ongoing = r.ongoing.reduce((a, x) => a + x.pulls, 0);
  const acc = cov.included.pulls + cov.boundary.pulls
    + cov.excluded.ambiguous.pulls + cov.excluded.unmapped.pulls + ongoing;
  ok(acc === evt, '活动池抽数全部有去向（已纳入+边界+歧义+未映射+进行中）', [acc, evt]);
  const evtG = recs.filter(x => (x.gacha_type === '11' || x.gacha_type === '12') && x.rank_type === '5').length;
  const accG = cov.included.golds + cov.boundary.golds
    + cov.excluded.ambiguous.golds + cov.excluded.unmapped.golds
    + r.ongoing.reduce((a, x) => a + x.golds, 0);
  ok(accG === evtG, '活动池五星全部有去向', [accG, evtG]);

  // 每个已纳入的五星都必须有阶段；每个未纳入的都必须能在待核实里找到理由
  ok(r.detail.filter(d => !d.ongoing).every(d => d.phase === null || bp.PHASES.indexOf(d.phase) >= 0), '明细里的阶段取值合法');
  ok(r.detail.filter(d => !d.ongoing && d.boundaryUncertain).every(d => d.phase === null), '标了边界不确定的五星不参与阶段计数');
  ok(r.pending.every(p => p.reason && p.state && p.first && p.last), '每条待核实都带原因与首末抽时间');
  ok(r.poolRows.every(x => x.start < x.end && x.days > 0), '逐池的起止与天数自洽');
  ok(r.poolRows.every(x => x.status === 'verified' || x.status === 'provisional'), '逐池状态合法');
  ok(r.poolRows.every(x => x.sourceUrl), '逐池都带来源链接');
  ok(r.revision && r.revision.length === 12, '有日历内容修订号（用于让已打开的页面重算）');
  // 进行中的池不进入正式总览
  const ongoingKeys = r.ongoing.map(x => x.key);
  ok(r.poolRows.every(x => ongoingKeys.indexOf(x.key) < 0), '进行中/未来池不出现在正式总览里');
  // 覆盖率的默认筛选题面：常规活动池
  ok(r.pools.length === 2 && r.pools.indexOf(11) >= 0 && r.pools.indexOf(12) >= 0, '默认池类型 = 11/12');
}

section('⑩ 边界情况');
{
  const H = hist(ent({ key: 'Z' }));
  let r = bp.build({ records: [], history: H, pools: [11] });
  ok(r.coverage.included.pulls === 0 && r.poolRows.length === 0 && r.pending.length === 0, '空输入不崩且全为零');
  ok(r.totals.goldsPer100Pulls === null, '分母为 0 时比率给 null 而不是 0/NaN');
  ok(r.phases.every(p => p.pullShare === null || p.pullShare === 0 || p.pullShare === 100), '空输入时占比不产生 NaN');

  r = bp.build({ records: [rec(11, 'z1', '2026-01-05 12:00:00', 5, '甲')], history: H, pools: [11] });
  ok(r.coverage.included.pulls === 1 && r.detail.length === 1, '单条输入正常');
  ok(r.totals.goldsPer100Pulls === 100, '单条即出金时比率 100');

  // 完全空的历史表：任何记录都必须进未映射，不能崩
  r = bp.build({ records: [rec(11, 'z2', '2026-01-05 12:00:00', 3)], history: hist(), pools: [11] });
  ok(r.pending.length === 1 && r.coverage.included.pulls === 0, '空历史表下一切进待核实');
  ok(bp.validate(hist()).ok, '空 entries 是合法表');

  // 非活动池（常驻）默认被排除
  r = bp.build({ records: [rec(1, '1001', '2026-01-05 12:00:00', 5, '姬子')], history: H, pools: [11, 12] });
  ok(r.coverage.included.pulls === 0 && r.pending.length === 0, '常驻池默认完全不参与');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
