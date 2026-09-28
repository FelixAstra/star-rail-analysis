// ─────────────────────────────────────────────────────────────────────────────
// 卡池节奏（banner phase）—— 把每一次抽卡归到「它所属的那个真实卡池开放实例」，
// 再判断这一抽落在该卡池开放期的前 1/3 / 中 1/3 / 后 1/3。
//
// 为什么不能按版本半期算：同一个版本里可以同时开着「整版卡池」和「只在半期开的卡池」。
//   实测 4.0：爻光整版开（02-13 → 03-24），长夜月+海瑟音+黑天鹅只到 03-03。
//   同一天出的金，在 A 池可能是中期、在 B 池已经是后期 —— 所以时间单位必须是
//   **每个真实卡池自己的开放区间**，版本号只当标签。
//
// ⚠️ 三条不可退让的纪律：
//   ① 边界不能靠猜。历史表里每一条都必须带来源与精度；精度不足就在该端点挂不确定量，
//      落在不确定带里的抽卡标 boundaryUncertain，而不是硬塞进某个阶段。
//   ② 不能用「版本号 / 固定 21 天 / 相邻池开始日 / 抽到五星的日期」反推边界。允许的
//      只有两类证据：公开可核实的公告时刻，以及「本地记录 / 五星 UP 名」用于**识别是哪一池**。
//   ③ 一抽只能进一个阶段或一个明确的排除状态，绝不重复计数。
//
// 数据分层（需求文档 §2 结尾那段）：
//   · core/banner-history.json —— 随代码发布的历史真值表（本文件读它）
//   · data/banner-cache.json   —— 第三方日历的运行时快照（由 core/banner.js 维护）
//   两者绝不互相写入：第三方源的时间不会自动覆盖已核实的官方边界。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./pools.js');
const ACC = require('./account.js').load();

const HISTORY_FILE = path.join(__dirname, 'banner-history.json');

// 阶段：恒定三档。判定用真实毫秒；边界正好落在三分点上的记录进**后**一档。
const PHASES = ['early', 'mid', 'late'];
const ALL_POOL_TYPES = [11, 12, 21, 22];

// ── 时间工具 ─────────────────────────────────────────────────────────────────
// ⚠️ 本地记录的 time 是**无时区**字符串。崩铁国服只有一个区服，按 +08:00 解释；
//    +08:00 没有夏令时，所以可以当固定偏移直接算，不必引入时区库。
/** 'YYYY-MM-DD HH:mm(:ss)' → 毫秒（按 +08:00 解释）；解析不了返回 NaN */
function parseServerTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? '' : s));
  if (!m) return NaN;
  return Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + '+08:00');
}
/** 毫秒 → 'YYYY-MM-DD HH:mm'（服务器时间 = +08:00）。与机器所在时区无关。 */
function fmtServerTime(ms) {
  if (!isFinite(ms)) return '';
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}
const serverDay = ms => fmtServerTime(ms).slice(0, 10);

/**
 * 一抽在某个开放区间里的阶段。
 * @param {number} t 抽卡时刻  @param {number} s 开池  @param {number} e 关池（右开）
 * @returns {'early'|'mid'|'late'|null} 区间外返回 null
 */
function phaseOf(t, s, e) {
  if (!isFinite(t) || !isFinite(s) || !isFinite(e) || !(e > s)) return null;
  if (t < s || t >= e) return null;
  const q = (t - s) / (e - s);
  return q < 1 / 3 ? 'early' : (q < 2 / 3 ? 'mid' : 'late');
}
const progressOf = (t, s, e) => (e > s ? (t - s) / (e - s) : null);

// ── 历史表读取与校验 ─────────────────────────────────────────────────────────
function loadHistory(file) { return JSON.parse(fs.readFileSync(file || HISTORY_FILE, 'utf8')); }

/** 内容修订号：日历一改，缓存键就变（需求 §6.4：只盯 records.json 会让日历修正后仍显示旧结论） */
function historyRevision(history) {
  return crypto.createHash('sha1').update(JSON.stringify(history)).digest('hex').slice(0, 12);
}

/**
 * schema 校验。**任何一条不合格就整体拒绝**（同 core/external.js 的思路）：
 * 半截可信的日历比没有日历更危险 —— 它会静默算出一批错的阶段。
 */
function validate(history) {
  const errors = [], warnings = [];
  const h = history || {};
  if (!Array.isArray(h.entries)) return { ok: false, errors: ['entries 不是数组'], warnings };
  const keys = new Set(), slots = new Set();
  h.entries.forEach((e, i) => {
    const at = 'entries[' + i + ']' + (e && e.key ? '(' + e.key + ')' : '');
    if (!e || typeof e !== 'object') return errors.push(at + ' 不是对象');
    if (!e.key || typeof e.key !== 'string') errors.push(at + ' 缺 key');
    else if (keys.has(e.key)) errors.push(at + ' key 重复');
    else keys.add(e.key);
    if (!Array.isArray(e.poolTypes) || !e.poolTypes.length) errors.push(at + ' poolTypes 必须是数组');
    else e.poolTypes.forEach(t => { if (ALL_POOL_TYPES.indexOf(Number(t)) < 0) errors.push(at + ' 出现未知池类型 ' + t); });
    if (!e.featured || typeof e.featured !== 'object') errors.push(at + ' 缺 featured');
    const s = Date.parse(e.startAt);
    if (isNaN(s)) errors.push(at + ' startAt 解析不了：' + e.startAt);
    if (e.endAtExclusive != null) {
      const en = Date.parse(e.endAtExclusive);
      if (isNaN(en)) errors.push(at + ' endAtExclusive 解析不了：' + e.endAtExclusive);
      else if (!(en > s)) errors.push(at + ' endAtExclusive 必须晚于 startAt');
    }
    if (['minute', 'day', 'unknown'].indexOf(e.startPrecision) < 0) errors.push(at + ' startPrecision 非法');
    if (['minute', 'day', 'unknown'].indexOf(e.endPrecision) < 0) errors.push(at + ' endPrecision 非法');
    if (['verified', 'provisional'].indexOf(e.status) < 0) errors.push(at + ' status 非法');
    const id = e.version + '|' + e.slot + '|' + (e.poolTypes || []).join(',');
    if (slots.has(id)) errors.push('重复的版本+期次+池类型：' + id);
    slots.add(id);
  });
  // ⚠️ 同类型并行卡池**允许**重叠：需求 §3 说的正是「整版池 + 半期池同时开着」。
  //    重叠不是错误，只是让「这一抽属于哪一池」需要额外证据；只在提示里列出来供人工复核。
  const flat = [];
  h.entries.forEach(e => {
    const s = Date.parse(e.startAt), en = e.endAtExclusive == null ? Infinity : Date.parse(e.endAtExclusive);
    (e.poolTypes || []).forEach(t => flat.push({ t: Number(t), s, e: en, key: e.key }));
  });
  flat.sort((a, b) => a.t - b.t || a.s - b.s);
  for (let i = 1; i < flat.length; i++) {
    if (flat[i - 1].t === flat[i].t && flat[i].s < flat[i - 1].e) {
      warnings.push('同类型区间并行：' + flat[i - 1].key + ' 与 ' + flat[i].key + '（' + flat[i].t + ' 类）');
    }
  }
  return { ok: !errors.length, errors, warnings };
}

// ── 主入口 ───────────────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {Array}  o.records   全量去重抽卡记录（loadRecords().list）
 * @param {object} [o.history] 自定义历史表（测试用；缺省读 core/banner-history.json）
 * @param {number} [o.nowMs]   当前时刻（测试用）
 * @param {number[]} [o.pools] 纳入的池类型，缺省 [11,12]
 */
function build(o) {
  o = o || {};
  const history = o.history || loadHistory();
  const v = validate(history);
  if (!v.ok) throw new Error('banner-history.json 校验失败：' + v.errors.join('；'));

  const nowMs = o.nowMs != null ? o.nowMs : Date.now();
  const pools = (o.pools && o.pools.length ? o.pools : [11, 12]).map(Number);
  const records = o.records || [];

  const entries = history.entries.map(e => {
    const s = Date.parse(e.startAt);
    const en = e.endAtExclusive == null ? null : Date.parse(e.endAtExclusive);
    return {
      key: e.key, version: e.version, slot: e.slot, poolTypes: e.poolTypes.map(Number),
      title: e.title || '', featured: e.featured || {},
      s, e: en, su: e.startUncertaintyMs || 0, eu: e.endUncertaintyMs || 0,
      status: e.status, sourceUrl: e.sourceUrl, sourceType: e.sourceType,
      startRaw: e.startRaw || '', endRaw: e.endRaw || '',
      startPrecision: e.startPrecision, endPrecision: e.endPrecision,
      conflicts: e.conflicts || [], note: e.note || '',
      openEnded: en == null,
      closed: en != null && en <= nowMs,
    };
  });
  const pick = gt => entries.filter(e => e.poolTypes.indexOf(gt) >= 0);

  // ── 按 (gacha_type, gacha_id) 归组（一次遍历，后面全部复用）────────────────
  const groups = new Map();
  records.forEach(r => {
    const gt = Number(r.gacha_type);
    if (pools.indexOf(gt) < 0) return;
    const k = gt + '|' + r.gacha_id;
    let g = groups.get(k);
    if (!g) { g = { gt, gid: String(r.gacha_id), k, pulls: [], golds: [], upNames: [], t0: NaN, t1: NaN }; groups.set(k, g); }
    const t = parseServerTime(r.time);
    g.pulls.push(t);
    if (!isFinite(g.t0) || t < g.t0) g.t0 = t;
    if (!isFinite(g.t1) || t > g.t1) g.t1 = t;
    if (String(r.rank_type) === '5') {
      const isUp = !P.stdSet(String(gt)).has(r.name);
      g.golds.push({ name: r.name, id: r.item_id, gt, gid: String(r.gacha_id), time: r.time, t,
        up: isUp, cross: ACC.isCross(r.gacha_id, r.name) });
      if (isUp) g.upNames.push(r.name);
    }
  });
  groups.forEach(g => { g.pulls.sort((a, b) => a - b); g.n = g.pulls.length; });

  // ── 归期 ─────────────────────────────────────────────────────────────────
  // 判据分四层，理由见文件头「三条纪律」：
  //   ① 时间包含：该 ID 的**全部**记录都落在一个已核实区间内 → 唯一命中
  //   ② UP 证据：命中多个候选时，用「本 ID 抽到的 UP 五星」去认领（需求 §2 规则 2 明确允许）
  //   ③ 阶段一致：候选区间的 S/E 不同，但**每一抽**算出的阶段都一样 → 阶段确定、池名未确认
  //   ④ 都不成立 → ambiguous / unmapped，进人工复核队列，**绝不按数组顺序静默分配**
  const assign = new Map();
  const pending = [];
  groups.forEach(g => {
    const cands = pick(g.gt).filter(e => !e.openEnded && g.t0 >= e.s && g.t1 < e.e);

    if (cands.length === 1) return void assign.set(g.k, { entry: cands[0], src: 'time' });

    if (cands.length > 1) {
      // ② UP 证据
      const names = [...new Set(g.upNames)];
      const matched = names.length
        ? cands.filter(e => { const f = e.featured[String(g.gt)] || []; return names.every(n => f.indexOf(n) >= 0); })
        : [];
      if (matched.length === 1) return void assign.set(g.k, { entry: matched[0], src: 'up' });
      // ③ 阶段一致：用**逐抽**判定比，不能拿五星列表比 —— 没有五星时两者都是空串，
      //    会「空判定」为一致，把跨期的池静默塞进第一个候选（踩过）。
      const verdicts = cands.map(e => g.pulls.map(t => phaseOf(t, e.s, e.e)).join(','));
      if (verdicts.every(x => x === verdicts[0])) {
        return void assign.set(g.k, { entry: cands[0], src: 'shared-window', altKeys: cands.map(e => e.key) });
      }
      return void pending.push({
        gt: g.gt, gid: g.gid, n: g.n, golds: g.golds.length,
        first: fmtServerTime(g.t0), last: fmtServerTime(g.t1), state: 'ambiguous', code: 'ambig-multi',
        candidates: cands.map(e => e.key),
        reason: '同类型的多个卡池区间都容得下本 ID 的全部记录，且算出的阶段不同 —— 需要人工确认是哪一池',
      });
    }

    // 放宽到端点不确定带
    const loose = pick(g.gt).filter(e => !e.openEnded && g.t0 >= e.s - e.su && g.t1 < e.e + e.eu);
    if (loose.length === 1) return void assign.set(g.k, { entry: loose[0], src: 'boundary-window' });
    if (loose.length > 1) {
      return void pending.push({
        gt: g.gt, gid: g.gid, n: g.n, golds: g.golds.length,
        first: fmtServerTime(g.t0), last: fmtServerTime(g.t1), state: 'ambiguous', code: 'ambig-loose',
        candidates: loose.map(e => e.key), reason: '放宽到不确定带后仍有多个候选卡池',
      });
    }

    // 长期开放（没有公布结束时刻）的池：区间只知一半 → 不生成前/中/后
    const openEnded = pick(g.gt).filter(e => e.openEnded && g.t0 >= e.s);
    if (openEnded.length === 1) return void assign.set(g.k, { entry: openEnded[0], src: 'open-ended' });

    // ⚠️ 「说不清是哪一池」有两种，必须分开报（需求 §3 要求 out_of_range 单列）：
    //    · out-of-range：历史表里**有**候选池，但本 ID 的记录起止跨出去了（同一 ID 多次开放 / 复刻）
    //    · unmapped    ：历史表里**根本**没有覆盖这个 ID 的区间
    // 两者都进人工复核队列，但排查方向不同 —— 前者要拆开放实例，后者要补历史表。
    // 区分方式是 code（unmapped-span / unmapped-nocover），state 跟着 code 走，
    // 这样 coverage.excluded 的两个桶不会混在一起（原来 59 抽的联动池会和「跨期」混算）。
    const near = pick(g.gt).filter(e => !e.openEnded && g.t0 >= e.s - 7 * 86400000 && g.t0 < e.e + 7 * 86400000);
    pending.push({
      gt: g.gt, gid: g.gid, n: g.n, golds: g.golds.length,
      first: fmtServerTime(g.t0), last: fmtServerTime(g.t1),
      state: near.length ? 'outOfRange' : 'unmapped',
      code: near.length ? 'unmapped-span' : 'unmapped-nocover',
      candidates: near.map(e => e.key),
      reason: near.length ? '记录的起止跨出了候选卡池区间（同一 gacha_id 可能对应多次开放）' : '本地历史表里没有覆盖这个 ID 的开放区间',
    });
  });

  // ── 落阶段 ───────────────────────────────────────────────────────────────
  const blank = () => ({ early: { pulls: 0, golds: 0 }, mid: { pulls: 0, golds: 0 }, late: { pulls: 0, golds: 0 } });
  const byKey = {};
  entries.forEach(e => {
    byKey[e.key] = {
      key: e.key, version: e.version, slot: e.slot, title: e.title,
      poolTypes: e.poolTypes, featured: e.featured,
      start: e.s, end: e.e, startText: fmtServerTime(e.s),
      endText: e.openEnded ? '' : fmtServerTime(e.e), endRaw: e.endRaw, startRaw: e.startRaw,
      startPrecision: e.startPrecision, endPrecision: e.endPrecision,
      days: e.openEnded ? null : Math.round((e.e - e.s) / 8640000) / 10,
      status: e.status, openEnded: e.openEnded, closed: e.closed,
      sourceUrl: e.sourceUrl, sourceType: e.sourceType, conflicts: e.conflicts, note: e.note,
      pulls: 0, golds: 0, boundaryPulls: 0, boundaryGolds: 0, phases: blank(), dayHist: {},
    };
  });

  const detail = [];
  const ongoing = {};
  const perPoolType = {};
  const coverage = {
    included: { pulls: 0, golds: 0 },
    // 暂定（provisional）且**已结束**的卡池：起止时刻来自运行时快照，还没走人工核实。
    // 需求 §2 末尾：这类条目「确认后才可进入『已结束卡池』主汇总」。所以它们自己算一遍
    // 前/中/后给自己看，但**不进** included、不进阶段占比、不进一句话结论 —— 否则日历往前
    // 推进一天、暂定池一关，它就会悄悄改变用户已经看过的历史结论。
    tentative: { pulls: 0, golds: 0, pools: 0 },
    // ⚠️ 桶名必须与 pending[].state 逐字相同 —— 下面的归类循环直接拿 state 当键取桶。
    excluded: {
      ambiguous: { pulls: 0, golds: 0 }, unmapped: { pulls: 0, golds: 0 },
      outOfRange: { pulls: 0, golds: 0 }, openEnded: { pulls: 0, golds: 0 },
    },
    boundary: { pulls: 0, golds: 0 },
    undatedBackfillGolds: (ACC.histRows || []).length,
  };

  groups.forEach(g => {
    const a = assign.get(g.k);
    if (!a) {
      const p = pending.find(x => x.gid === g.gid && x.gt === g.gt);
      if (p) { coverage.excluded[p.state].pulls += g.n; coverage.excluded[p.state].golds += g.golds.length; }
      return;
    }
    const e = a.entry;
    const isOngoing = e.openEnded || !e.closed;
    // 已结束但仍是「暂定」的池：算得出前/中/后，但**不算进正式汇总**（见上面 coverage.tentative 的说明）
    const isTentative = !isOngoing && e.status !== 'verified';
    const target = isOngoing
      ? (ongoing[e.key] || (ongoing[e.key] = {
          key: e.key, version: e.version, slot: e.slot, title: e.title, featured: e.featured,
          startText: fmtServerTime(e.s), endText: e.openEnded ? '' : fmtServerTime(e.e),
          start: e.s, end: e.e,
          progressNow: e.openEnded ? null : progressOf(nowMs, e.s, e.e),
          openEnded: e.openEnded, status: e.status,
          elapsedDays: Math.round((nowMs - e.s) / 8640000) / 10,
          pulls: 0, golds: 0, phases: blank(),
        }))
      : byKey[e.key];
    if (!perPoolType[g.gt]) perPoolType[g.gt] = { gt: g.gt, pulls: 0, golds: 0, phases: blank() };
    const pt = perPoolType[g.gt];

    // ── 端点不确定量的处理 ──────────────────────────────────────────────────
    // 历史表里精度不足的端点（多为「版本更新后」这种只到日的开池时刻）带一个不确定量。
    // 阶段的判定规则是：**所有与已知事实相容的端点组合都必须给出同一个阶段**，否则
    // 这一抽标 boundaryUncertain 并排除出阶段分母 —— 不猜。
    //
    // ⚠️ 端点的可行区间会被「本 ID 自己已经证明存在的时刻」收窄（开池不可能晚于本 ID 的
    //    首抽，关池不可能早于本 ID 的末抽）。这不是用记录去**反推**边界（需求明文禁止
    //    用首抽日反推开池日），而是把不确定量裁到与已观测事实相容的最小范围 —— 边界本身
    //    仍然取历史表里的值与来源，改的只是「这一抽算不算不确定」。
    const sHiRaw = Math.min(e.s + e.su, g.t0);
    const sLo = Math.min(e.s - e.su, sHiRaw);
    const eHi = e.openEnded ? Infinity : e.e + e.eu;
    const eLo = e.openEnded ? Infinity : Math.max(e.e - e.eu, g.t1 + 1);
    const corners = e.openEnded ? [[e.s, Infinity]] : [[sLo, eHi], [sHiRaw, eHi], [sLo, eLo], [sHiRaw, eLo]];
    const verified = t => {
      const vs = corners.map(c => phaseOf(t, c[0], c[1]));
      const uniq = [...new Set(vs)];
      return { ph: uniq.length === 1 && uniq[0] ? uniq[0] : null, uncertain: uniq.length !== 1 };
    };

    g.pulls.forEach(t => {
      target.pulls++;
      if (isOngoing) {
        const ph = e.openEnded ? null : phaseOf(t, e.s, e.e);
        if (ph) target.phases[ph].pulls++;
        return;
      }
      const d = serverDay(t);
      target.dayHist[d] = (target.dayHist[d] || 0) + 1;
      const r = verified(t);
      if (r.uncertain || !r.ph) {
        coverage.boundary.pulls++;
        target.boundaryPulls = (target.boundaryPulls || 0) + 1;
        return;
      }
      // 暂定池：本池的三段照算（页面要显示「暂定前/中/后」），但**不进**正式分母。
      // 所以先在 target（= 本池自己的行）上落阶段，再由 isTentative 决定要不要进 included。
      target.phases[r.ph].pulls++;
      if (isTentative) { coverage.tentative.pulls++; return; }
      coverage.included.pulls++;
      pt.pulls++;
      pt.phases[r.ph].pulls++;
    });

    // 五星
    g.golds.forEach(x => {
      const r = isOngoing ? { ph: e.openEnded ? null : phaseOf(x.t, e.s, e.e), uncertain: false } : verified(x.t);
      const unc = !!(r.uncertain || !r.ph);
      target.golds++;
      if (r.ph) target.phases[r.ph].golds++;
      // 保底完整性：crossGold 的抽数被接口窗口截断（拿不到窗口之前的那几次）。
      // account.json 里的 histCross 是工坊截图补录的**完整**抽数 —— 有就一并给出并注明来源，
      // 不拿截断的抽数冒充完整保底（需求 §4）。
      const hc = ACC.histCross[x.name];
      detail.push({
        time: x.time, name: x.name, id: x.id, gt: x.gt, gid: x.gid,
        poolKey: e.key, poolLabel: e.version + (e.slot ? ' ' + e.slot : ''), poolTitle: e.title,
        version: e.version, slot: e.slot,
        phase: r.ph, progress: progressOf(x.t, e.s, e.e),
        up: x.up, cross: x.cross, pityComplete: !x.cross,
        pityFull: (x.cross && typeof hc === 'number') ? hc : null,
        pitySource: (x.cross && typeof hc === 'number') ? 'account.json' : null,
        boundaryUncertain: unc, tentative: isTentative,
        assignSrc: a.src, altKeys: a.altKeys || null, ongoing: isOngoing,
      });
      if (isOngoing) return;
      if (unc) { coverage.boundary.golds++; pt.boundaryGolds = (pt.boundaryGolds || 0) + 1; return; }
      if (isTentative) { coverage.tentative.golds++; return; }
      coverage.included.golds++;
      pt.golds++;
      pt.phases[r.ph].golds++;
    });
  });

  // 逐池的边界金数（抽数在落阶段那一遍里已经累加）
  groups.forEach(g => {
    const a = assign.get(g.k);
    if (!a) return;
    const e = a.entry;
    if (e.openEnded || !e.closed) return;
    const sHiRaw = Math.min(e.s + e.su, g.t0);
    const sLo = Math.min(e.s - e.su, sHiRaw);
    const eHi = e.e + e.eu, eLo = Math.max(e.e - e.eu, g.t1 + 1);
    const corners = [[sLo, eHi], [sHiRaw, eHi], [sLo, eLo], [sHiRaw, eLo]];
    let nb = 0;
    g.golds.forEach(x => {
      const vs = corners.map(c => phaseOf(x.t, c[0], c[1]));
      const uniq = [...new Set(vs)];
      if (uniq.length !== 1 || !uniq[0]) nb++;
    });
    if (nb) byKey[e.key].boundaryGolds = (byKey[e.key].boundaryGolds || 0) + nb;
  });

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  // ⚠️ 只有 status='verified' 的已结束卡池才进正式汇总（需求 §2 末尾）。
  //    暂定的已结束卡池单列 tentativeRows —— 页面照常展示它的前/中/后，但**不动**历史结论。
  const inScope = e => !e.openEnded && e.closed && e.poolTypes.some(t => pools.indexOf(t) >= 0);
  const closedKeys = entries.filter(e => inScope(e) && e.status === 'verified').map(e => e.key);
  const tentativeKeys = entries.filter(e => inScope(e) && e.status !== 'verified').map(e => e.key);
  coverage.tentative.pools = tentativeKeys.filter(k => byKey[k].pulls > 0).length;
  const agg = blank();
  closedKeys.forEach(k => PHASES.forEach(p => { agg[p].pulls += byKey[k].phases[p].pulls; agg[p].golds += byKey[k].phases[p].golds; }));

  const rate = (g, p) => (p ? Math.round(g / p * 1000) / 10 : null);
  const totals = coverage.included;

  const phases = PHASES.map(p => ({
    key: p, pulls: agg[p].pulls, golds: agg[p].golds,
    pullShare: totals.pulls ? Math.round(agg[p].pulls / totals.pulls * 1000) / 10 : null,
    goldShare: totals.golds ? Math.round(agg[p].golds / totals.golds * 1000) / 10 : null,
    goldsPer100Pulls: rate(agg[p].golds, agg[p].pulls),
    pools: closedKeys.filter(k => byKey[k].phases[p].pulls > 0).length,
  }));

  // 逐池行：抽数/金数用**含边界**的全量（这是本池真实发生了多少），
  // 三段抽数只装已判定的部分 —— 差额就是该池的 boundaryPulls，页面要显式写出来。
  const rowOf = k => {
    const b = byKey[k];
    return Object.assign({}, b, {
      goldsPer100Pulls: rate(b.golds, b.pulls),
      phasesTotal: b.phases.early.pulls + b.phases.mid.pulls + b.phases.late.pulls,
      dayHist: Object.keys(b.dayHist).sort().map(d => ({ d, n: b.dayHist[d] })),
    });
  };
  const poolRows = closedKeys.map(rowOf).filter(r => r.pulls > 0).sort((a, b) => a.start - b.start);
  const tentativeRows = tentativeKeys.map(rowOf).filter(r => r.pulls > 0).sort((a, b) => a.start - b.start);

  const ongoingRows = Object.keys(ongoing).map(k => ongoing[k]).sort((a, b) => a.startText < b.startText ? 1 : -1);

  // 已知缺口（历史表自己登记「这里我还没核实」的条目）也要带上**实际影响**：
  // 光说「未映射」没用，得让用户看到它吃掉了多少抽、多少金（需求 §5D）。
  // ⚠️ 这里刻意绕过池类型筛选去数 —— 缺口往往正落在当前筛选之外的池上（如联动池），
  //    只按筛选后的 groups 数会得出 0，看起来像「没影响」。
  const gapRows = (history.knownGaps || []).map(g => {
    const rs = records.filter(r => Number(r.gacha_type) === Number(g.poolType) && String(r.gacha_id) === String(g.gachaId));
    const ts = rs.map(r => parseServerTime(r.time)).filter(isFinite).sort((a, b) => a - b);
    return Object.assign({}, g, {
      n: rs.length,
      golds: rs.filter(r => String(r.rank_type) === '5').length,
      first: ts.length ? fmtServerTime(ts[0]) : '',
      last: ts.length ? fmtServerTime(ts[ts.length - 1]) : '',
    });
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    nowMs,
    tz: 'Asia/Shanghai',
    revision: historyRevision(history),
    warnings: v.warnings,
    convention: history.convention || {},
    sources: history.sources || {},
    knownGaps: gapRows,
    pools,
    coverage: {
      included: totals,
      tentative: coverage.tentative,
      tentativeNote: '起止时刻来自运行时快照、尚未人工核实的已结束卡池。它们自己算得出前/中/后（页面单列），但不计入上面的正式总览、阶段占比与一句话结论。',
      excluded: coverage.excluded,
      boundary: coverage.boundary,
      undatedBackfillGolds: coverage.undatedBackfillGolds,
      undatedBackfillNote: '截图补录的历史汇总没有逐抽时间，因此既进不了分母也进不了分子；这里只报「被排除的行数」，它可能与接口记录存在重叠。',
    },
    totals: {
      pulls: totals.pulls, golds: totals.golds, pools: poolRows.length,
      goldsPer100Pulls: rate(totals.golds, totals.pulls),
    },
    phases,
    poolRows,
    tentativeRows,
    ongoing: ongoingRows,
    pending: pending.sort((a, b) => (a.first < b.first ? -1 : 1)),
    // 明细按时间正序（字符串比较即可：'YYYY-MM-DD HH:mm:ss' 字典序 = 时间序）。
    // 页面默认倒序展示，但接口给正序 —— 这样导出 CSV 与逐池顺序一致，也便于脚本断言。
    detail: detail.sort((a, b) => (a.time < b.time ? -1 : (a.time > b.time ? 1 : 0))),
    perPoolType: Object.keys(perPoolType).map(t => Object.assign(perPoolType[t], {
      goldsPer100Pulls: rate(perPoolType[t].golds, perPoolType[t].pulls),
    })),
  };
}

module.exports = {
  build, validate, loadHistory, historyRevision,
  phaseOf, progressOf, parseServerTime, fmtServerTime, serverDay,
  PHASES, ALL_POOL_TYPES, HISTORY_FILE,
};
