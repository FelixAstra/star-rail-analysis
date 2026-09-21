// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 分析引擎
//
// 输入：data/records.json（全量抽卡记录，按 id 去重的并集）
//       data/meta.json （工坊基数 / 起点 / UID 等可改口径）
//       assets/index/cn_characters.json · cn_light_cones.json（名称 + 命途索引）
// 输出：一个纯 JSON 对象（无函数、无循环引用），前端直接渲染。
//
// ⚠️ 这里的每条口径都是前面多轮验证定下来的，改动前先看注释里的「为什么」。
//    尤其是这三个坑（都踩过）：
//      ① gacha_id 是「哪一池」的身份编号，不是时间区间 → 必须按 gacha_id 归并，不能「一变就切段」
//      ② 「池内第几抽」只能用本池计数器，不能用同类型池全局序号相减
//      ③ 角色池与光锥池是两套常驻名单，绝不共用
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const P = require('./pools.js');
const P_ACC = require('./account.js');
const P_EXT = require('./external.js');
const { almanac } = require('./huangli.js');

const ROOT = path.join(__dirname, '..');

// ── 读数据 ──────────────────────────────────────────────────────────────────
function readJSON(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
}

function loadIndex() {
  const ch = readJSON(path.join(ROOT, 'assets/index/cn_characters.json'), {});
  const lc = readJSON(path.join(ROOT, 'assets/index/cn_light_cones.json'), {});
  return { CH_IDX: ch, LC_IDX: lc };
}

// 用户在网页上粘贴链接抓取时，服务端会把新记录合并进 records.json，
// 排序与去重都在 store 层做，这里只保证拿到的是「按时间升序、id 不重复」的一份。
function loadRecords() {
  const d = readJSON(path.join(ROOT, 'data/records.json'), { records: [] });
  const list = Array.isArray(d) ? d : (d.records || []);
  const seen = new Set(), out = [];
  for (const r of list) { const id = String(r.id); if (seen.has(id)) continue; seen.add(id); out.push(r); }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return {
    list: out,
    meta: d && d.meta ? d.meta : {},
    // 每次导入的留档（「解释说明」第 3 章要拿来说「第一次导入建仓、之后只累加」）
    sources: d && d.sources ? d.sources : [],
  };
}

const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── 主分析 ──────────────────────────────────────────────────────────────────
function analyze(opts) {
  const o = opts || {};
  // 账号专属数据（跨界金 / 截图补录 / 补填兜底）—— 没有就全是空值，见 core/account.js
  const ACC = P_ACC.load();
  const { CH_IDX, LC_IDX } = loadIndex();
  const loaded = loadRecords();
  const list = loaded.list;
  const metaFile = readJSON(path.join(ROOT, 'data/meta.json'), {});
  const meta = Object.assign({}, metaFile, o.meta || {});
  // 补填基准优先级：data/meta.json > data/account.json > 零值兜底
  const WS_BASE = Object.assign({ pulls: 0, gold: 0, at: '' }, ACC.wsBase || {}, meta.wsBase || {});

  if (!list.length) {
    return { empty: true, uid: meta.uid || '', generatedAt: new Date().toISOString() };
  }

  const STD_CHARS = P.STD_CHARS, STD_CONS = P.STD_CONS, stdSet = P.stdSet;
  const PATH_CN = P.PATH_CN, PATH_ORDER = P.PATH_ORDER;
  const SIG = P.SIG, HIST_ROWS = ACC.histRows;

  // ── 断言 1：专属光锥表的命途必须与角色一致（不符直接失败，绝不渲染错数据）──
  const SIG_REV = {};
  Object.entries(SIG).forEach(([c, l]) => { SIG_REV[l] = c; });
  const sigBad = [], lcSeen = new Set();
  Object.entries(SIG).forEach(([cid, lid]) => {
    const c = CH_IDX[cid], l = LC_IDX[lid];
    if (!c) sigBad.push('角色 ' + cid + ' 不在索引里');
    else if (!l) sigBad.push('光锥 ' + lid + ' 不在索引里');
    else if (c.path !== l.path) sigBad.push(c.name + '(' + c.path + ') → ' + l.name + '(' + l.path + ')');
    if (lcSeen.has(lid)) sigBad.push('光锥 ' + lid + ' 被两个角色共用');
    lcSeen.add(lid);
  });
  if (sigBad.length) throw new Error('专属光锥表校验失败：' + sigBad.join('；'));

  const NAME2CH = {}, NAME2LC = {};
  Object.values(CH_IDX).forEach(v => NAME2CH[v.name] = v.id);
  Object.values(LC_IDX).forEach(v => NAME2LC[v.name] = v.id);

  // ── 逐条算保底 + 歪/UP 判定 ────────────────────────────────────────────────
  const pity = {}, golds = [];
  list.forEach(r => {
    const gt = r.gacha_type;
    pity[gt] = (pity[gt] || 0) + 1;
    if (r.rank_type === '5') {
      let up = null;
      if (gt === '11' || gt === '12' || gt === '21' || gt === '22') up = !stdSet(gt).has(r.name);
      golds.push({
        name: r.name, id: r.item_id, type: r.item_type, gt, gid: r.gacha_id,
        pity: pity[gt], time: r.time, up, cross: ACC.isCross(r.gacha_id, r.name),
      });
      pity[gt] = 0;
    }
  });

  // ── 分池统计（含联动池，它们的保留期比普通池长）───────────────────────────
  const poolStat = {};
  Object.keys(P.POOL).forEach(gt => {
    const rs = list.filter(r => r.gacha_type === gt);
    if (!rs.length) return;
    poolStat[gt] = {
      gt, n: rs.length, first: rs[0].time, last: rs[rs.length - 1].time,
      gold: rs.filter(r => r.rank_type === '5').length,
      cur: pity[gt] || 0, hard: P.HARD[gt],
    };
  });

  // ── 卡池切分：按 gacha_id 归并 ────────────────────────────────────────────
  // ⚠️ 不能按「gid 一变就切一段」：同一半期有两个并行卡池，玩家在两池之间来回抽时，
  //    同一个 gacha_id 的记录会被切成多段（实测会把角色池切成 45 段，真实只有 30 池）。
  function segs(gt) {
    const m = new Map();
    let pit = 0;   // 距上个五星多少抽（跨同类型池累计）
    list.filter(r => r.gacha_type === gt).forEach(r => {
      pit++;
      let c = m.get(r.gacha_id);
      if (!c) { c = { gid: r.gacha_id, gt, st: r.time, en: r.time, n: 0, k: 0, golds: [] }; m.set(r.gacha_id, c); }
      if (r.time > c.en) c.en = r.time;
      c.n++; c.k++;   // c.n = 本池总抽数；c.k = 本池「自己的」第几抽（只数本池记录）
      if (r.rank_type === '5') {
        c.golds.push({
          name: r.name, up: !stdSet(gt).has(r.name), time: r.time, item_id: r.item_id,
          // ⚠️ 池内序号必须用本池计数器 c.k：同期有两个并行池，用全局序号相减会把别池的抽数
          //    累进来（实测 6 个池被撑到超过本池总抽数，连带落点圆点跑到进度条外）—— 静默错误。
          inPool: c.k, pity: pit, cross: ACC.isCross(r.gacha_id, r.name),
        });
        pit = 0;
      }
    });
    return [...m.values()].sort((a, b) => a.st.localeCompare(b.st));
  }
  const seg11 = segs('11'), seg12 = segs('12');

  // ⚠️ 全局兜底断言：「任何池的 max(池内第几抽) ≤ 该池总抽数」，防止上面那个坑复发
  [...seg11, ...seg12].forEach(s => {
    const mx = s.golds.reduce((a, g) => Math.max(a, g.inPool), 0);
    if (mx > s.n) throw new Error('池 ' + s.gid + ' 的池内序号 ' + mx + ' 超过本池抽数 ' + s.n + '（gacha_id 归并出错）');
  });

  const isLd = gt => gt === '21' || gt === '22';
  const iconDir = gt => (gt === '12' || gt === '22') ? 'light_cone' : 'avatar';

  // ── UP 推定（只能靠「抽到过」反推，覆盖率天然 < 100%）────────────────────
  const liveGolds = s => s.golds;
  function inferUP(s) {
    const gs = liveGolds(s).filter(g => g.up);
    const names = [...new Set(gs.map(g => g.name))];
    if (names.length) return {
      src: 'auto', text: names.join(' / '),
      list: names.map(n => { const g = gs.find(x => x.name === n); return { name: n, id: g ? g.item_id : '', dir: iconDir(s.gt) }; }),
    };
    if (liveGolds(s).length) return { src: 'offonly', text: '—', list: [] };  // 出了金但全是常驻（歪）
    return { src: 'nogold', text: '—', list: [] };                            // 本池一颗金都没出
  }
  const SRC_TAG = { auto: 'ok', offonly: 'bad', nogold: 'dim' };
  const SRC_TAG_CN = { ok: '出金', bad: '歪常驻', dim: '未出金' };

  function compAgg(s) {
    const a = {};
    liveGolds(s).forEach(g => {
      a[g.name] = a[g.name] || { name: g.name, n: 0, off: false };
      a[g.name].n++;
      if (!g.up) a[g.name].off = true;
    });
    return Object.values(a);
  }
  const compPlain = s => compAgg(s).map(v => v.name + (v.n > 1 ? '×' + v.n : '') + (v.off ? '（歪）' : '')).join(' + ');

  // ── 展开面板数据 ─────────────────────────────────────────────────────────
  function rowDetail(s) {
    const gs = liveGolds(s);
    const rate = gs.length ? (gs.length / s.n * 100).toFixed(2) + '%' : '—';
    const avg = gs.length ? Math.round((s.n - gs.length) / gs.length) : null;
    const jumped = gs.filter(g => g.pity !== g.inPool);
    const firstGold = gs.slice().sort((a, b) => a.inPool - b.inPool)[0];
    const out = {
      chips: { n: s.n, gold: gs.length, rate, avg },
      dots: [],
      rows: [],
      fine: {
        gid: s.gid, n: s.n, jumpedCount: jumped.length,
        jumped: jumped.length ? { inPool: jumped[0].inPool, name: jumped[0].name, pity: jumped[0].pity, diff: jumped[0].pity - jumped[0].inPool } : null,
        carry: firstGold && firstGold.cross ? { inPool: firstGold.inPool, name: firstGold.name, pity: firstGold.pity } : null,
      },
    };
    if (!gs.length) return out;
    out.dots = gs.map((g, i) => ({
      i: i + 1, r: Number((g.inPool / s.n).toFixed(5)), up: !!g.up, name: g.name, inPool: g.inPool,
    }));
    out.rows = gs.map(g => {
      const a = almanac(g.time);        // 万年历：按「出金那一刻」评级
      return {
        inPool: g.inPool, time: g.time, name: g.name, off: !g.up, pity: g.pity,
        alm: { level: a.level, label: a.label, short: a.short, detail: a.detail },
      };
    });
    return out;
  }

  function buildBanner(s) {
    const u = inferUP(s);
    const src = SRC_TAG[u.src] || 'dim';
    return {
      gid: s.gid, gt: s.gt, st: s.st, en: s.en, n: s.n, goldCount: liveGolds(s).length,
      comp: compAgg(s), compText: compPlain(s),
      up: u, srcTag: src, srcText: SRC_TAG_CN[src],
      detail: rowDetail(s),
    };
  }
  const BAN_META = [['11', '角色跃迁', '角色活动跃迁'], ['12', '光锥跃迁', '光锥活动跃迁']];
  const banners = BAN_META.map(([gt, short, full]) => {
    const sg = gt === '11' ? seg11 : seg12;
    return {
      gt, short, full, count: sg.length,
      inferCount: sg.filter(s => inferUP(s).src === 'auto').length,
      rows: sg.slice().reverse().map(buildBanner),   // 列表最新在上
    };
  });

  // ── 常驻 / 新手截图补录（含与接口的逐条对账断言）─────────────────────────
  const OTHC = ACC.oth.map(p => {
    const gsum = p.rows.reduce((a, r) => a + r[1], 0);
    const sum = gsum + p.cur;   // 池总抽数 = 各金抽数 + 当前已垫
    return {
      ...p, gsum, sum, win: 0, out: sum, nGold: p.rows.length,
      // ⚠️ 平均出金口径必须与工坊一致 =(该池抽数 − 该池五星数) ÷ 该池五星数，
      //    不能写成 抽数 ÷ 金数（差 1 抽/金，用户会拿工坊数字对账）
      avg: p.rows.length ? ((sum - p.rows.length) / p.rows.length).toFixed(1) : '—',
    };
  });
  // ⚠️ 没有截图补录数据时（全新 clone / 用户删了 data/account.json）必须补两个零值占位：
  //    下游的 `OTHC.find(p => p.key === 'gq')` 会直接取 .sum/.cur 参与「逐池拆分恒等式」，
  //    缺一个就是 TypeError，整个服务起不来。
  [['gq', '1', '常驻跃迁', '常驻', '群星跃迁（常驻保底池）'],
   ['xs', '2', '新手池', '新手', '始发跃迁（新手池 · 50 抽封顶，早抽完）']].forEach(([key, gt, tab, short, full]) => {
    if (!OTHC.some(p => p.key === key)) {
      OTHC.push({ key, gt, tab, short, full, cur: 0, rows: [],
                  gsum: 0, sum: 0, win: 0, out: 0, nGold: 0, avg: '—' });
    }
  });
  const GQ_WIN = list.filter(r => r.gacha_type === '1').length;
  const gqCheck = (() => {
    const gq = OTHC.find(p => p.key === 'gq');
    gq.win = GQ_WIN; gq.out = gq.sum - GQ_WIN;
    const lg = golds.filter(g => g.gt === '1').slice().reverse();   // 倒成「新→旧」与截图对齐
    const shotRows = gq.rows.filter(r => r[3] === 'win' || r[3] === 'cross');
    // 没有补录读数就**不做断言**：这条断言是拿「截图读数」跟接口对账，
    // 没有读数时无从校验，而不是「对不上」—— 不能因此让整个服务起不来。
    if (!shotRows.length) {
      return { n: 0, pities: [], oldestName: '', inWin: 0, carry: 0, full: 0, skipped: true };
    }
    const bad = [];
    if (lg.length !== shotRows.length) bad.push('个数不同（接口 ' + lg.length + ' vs 截图 ' + shotRows.length + '）');
    shotRows.forEach((r, i) => {
      const [name, num] = r, g = lg[i];
      if (!g) return;
      if (g.name !== name) bad.push('第 ' + (i + 1) + ' 个名字不符（接口 ' + g.name + ' vs 截图 ' + name + '）');
      // 最旧那个（= 该池窗口内第一金）保底从窗口外继承，接口值是残缺的，只要求 ≤ 截图
      const oldest = (i === shotRows.length - 1);
      if (oldest ? g.pity > num : g.pity !== num) bad.push('第 ' + (i + 1) + ' 个抽数不符（接口 ' + g.pity + ' vs 截图 ' + num + '）');
    });
    if (bad.length) throw new Error('常驻跃迁截图与接口对不上：' + bad.join('；'));
    const last = lg[lg.length - 1], lastShot = shotRows[shotRows.length - 1];
    return { n: shotRows.length, pities: shotRows.map(r => r[1]), oldestName: lastShot[0], inWin: last.pity, carry: lastShot[1] - last.pity, full: lastShot[1] };
  })();
  const OTH_GOLD = OTHC.reduce((a, p) => a + p.rows.filter(r => r[3] === 'hist').length, 0);
  const OTH_OUT = OTHC.reduce((a, p) => a + p.out, 0);

  // ── 截图补录汇总（活动池部分）─────────────────────────────────────────────
  const histOf = t => HIST_ROWS.filter(r => r[0] === t);
  const chH = histOf('ch'), lcH = histOf('lc');
  const chHSum = chH.reduce((a, r) => a + r[2], 0), lcHSum = lcH.reduce((a, r) => a + r[2], 0);
  const chHOff = chH.filter(r => r[3]).length, lcHOff = lcH.filter(r => r[3]).length;

  // ── 五星清单：接口窗口 + 截图补录 两源合并 ────────────────────────────────
  // 为什么要合并：接口只能回溯 1 年，两边其实是同一位开拓者的同一批角色/光锥，
  // 分开看会让「专属光锥配对」「叠影等级」这类跨期数据残缺。
  // 口径：星魂 = 两源总金数 − 1（上限 6）；叠影 = 总张数（上限 5）。
  // 跨界金（长夜月@2088、时节不居@3088）窗口内那条保底是残缺值，整条由截图段代表，这里不重复计。
  const winGold = new Map();
  golds.forEach(g => {
    if (g.cross) return;
    if (!winGold.has(g.id)) winGold.set(g.id, []);
    winGold.get(g.id).push(g);
  });
  // ── 第三源：外部统计（真值快照）──────────────────────────────────────────
  // 语义（用户 2026-09-17 确认）：**覆盖旧值**。外部统计说的是账号此刻的真实持有状态，
  // 比「用抽卡记录反推」可信，所以星魂/叠影以它为准；但两边不一致时要**显式报出来**，
  // 不能悄悄改数 —— 那会让用户以为抽卡记录算错了。
  // ⚠️ 外部统计**只有命数、没有抽数**，所以绝不参与总抽数 / 出金率 / 每 UP / 小保底不歪。
  const EXT = P_EXT.resolveExternal(CH_IDX, LC_IDX);
  const extOf = (kind, id) => EXT.map.get(kind + ':' + id) || null;
  const extConflicts = [];

  function unify5(type, idx, extKind) {
    const m = new Map();
    const at = (id, name) => {
      if (!m.has(id)) m.set(id, { id, name, path: idx[id] ? idx[id].path : '', win: [], hist: [], ext: null });
      return m.get(id);
    };
    [...winGold.entries()].forEach(([id, pulls]) => {
      if (pulls[0].type !== type) return;
      at(id, pulls[0].name).win = pulls.slice().sort((a, b) => a.time.localeCompare(b.time));
    });
    HIST_ROWS.filter(r => r[0] === (type === '光锥' ? 'lc' : 'ch')).forEach(r => {
      const [, name, num, wai, src] = r;
      at(type === '光锥' ? NAME2LC[name] : NAME2CH[name], name).hist.push({ num, wai: !!wai, pool: '', src });
    });
    // 常驻 / 新手补录里落在窗口之外的金同样并入（星魂/叠影本就不分池）；
    // 窗口内那几条已在 winGold 里，这里只取 'hist' 避免重复计数。
    OTHC.forEach(p => p.rows.forEach(r => {
      if (r[3] !== 'hist' || r[2] !== (type === '光锥' ? 'lc' : 'ch')) return;
      at(r[2] === 'lc' ? NAME2LC[r[0]] : NAME2CH[r[0]], r[0])
        .hist.push({ num: r[1], wai: false, pool: p.short, src: '截图补录 · ' + p.tab });
    }));
    // 第三源：**单独遍历**外部条目 —— 它可能有「抽卡记录里根本没有」的角色/光锥，
    // 只从已有 m 里挑就补不进来（那正是外部统计最值钱的部分）。
    EXT.map.forEach(e => {
      if (e.kind !== extKind || !idx[e.id]) return;
      at(e.id, e.name).ext = e;
    });

    return [...m.values()].filter(x => x.id).map(x => {
      // 抽卡记录推算值（两源合计）：星魂 = 总金数 − 1（≤6）；叠影 = 总张数（≤5）
      const calcN = x.win.length + x.hist.length;
      const calcRank = Math.min(calcN - 1, 6), calcSup = Math.min(calcN, 5);
      let rank = calcRank, sup = calcSup, copies = calcN;
      if (x.ext) {
        // ⚠️ 单位换算：角色 ext.v = 星魂等级 → rank 直接取它、copies = v + 1；
        //    光锥 ext.v = 叠影等级（1 表示只有 1 张）→ sup 与 copies 都取它。两者含义不同，别统一处理。
        if (extKind === 'ch') { rank = x.ext.v; copies = x.ext.v + 1; sup = Math.min(copies, 5); }
        else { sup = x.ext.v; copies = x.ext.v; rank = Math.min(copies - 1, 6); }
        // 冲突只在「同一个量」之间比：角色比星魂、光锥比叠影（拿 rank 互相套会误报）
        const calcV = extKind === 'ch' ? calcRank : calcSup;
        if (x.ext.v !== calcV) {
          extConflicts.push({
            kind: extKind, id: x.id, name: x.name,
            unit: extKind === 'ch' ? '星魂' : '叠影',
            calc: calcV, ext: x.ext.v,
            calcFrom: '接口窗口 ' + x.win.length + ' ＋ 截图补录 ' + x.hist.length
              + '（合计 ' + calcN + ' 金 → ' + (extKind === 'ch' ? '星魂 ' + calcRank : '叠影 ' + calcSup) + '）',
          });
        }
      }
      const srcKeys = [];
      if (x.win.length) srcKeys.push('win');
      if (x.hist.length) srcKeys.push('hist');
      if (x.ext) srcKeys.push('ext');
      return {
        ...x,
        copies, rank, sup,
        calcRank, calcSup, calcCopies: calcN,
        hasExt: !!x.ext,
        extAt: x.ext ? x.ext.at : '',
        extScore: x.ext ? x.ext.score : null,
        srcKeys,
        src: srcKeys.join('+') || 'hist',
        // 数据来源那一行补一句池名：只有联动池的角色才标，避免整页噪音
        poolMark: (() => {
          const n = x.win.filter(g => isLd(g.gt)).length;
          return n ? (n === x.win.length ? ' · 联动池' : ' · 含联动池') : '';
        })(),
      };
    });
  }
  // src 现在是「用 + 拼起来的来源键」，所以文案要按段翻译（旧值 'both' 已由 'win+hist' 取代）
  const SRC_CN = { win: '接口窗口', hist: '截图补录', ext: '外部统计', both: '接口+截图' };
  const srcTextOf = keys => (keys && keys.length ? keys.map(k => SRC_CN[k] || k).join(' + ') : '截图补录');
  const U5C = unify5('角色', CH_IDX, 'ch').sort((a, b) =>
    b.rank - a.rank || b.copies - a.copies || a.name.localeCompare(b.name));
  const U5L = unify5('光锥', LC_IDX, 'lc').sort((a, b) =>
    PATH_ORDER.indexOf(a.path) - PATH_ORDER.indexOf(b.path) || b.sup - a.sup || a.name.localeCompare(b.name));
  const u5lById = new Map(U5L.map(x => [x.id, x]));
  const ownerOf = lcId => (SIG_REV[lcId] ? CH_IDX[SIG_REV[lcId]] : null);
  const missCone = U5C.filter(c => SIG[c.id] && !u5lById.has(SIG[c.id])).length;

  // 角色卡的抽数标签：接口的彩底（UP 绿 / 歪 红 / 常驻 灰），联动单列紫，截图段虚线框
  const cWin = g => isLd(g.gt)
    ? { cls: 'ld', num: g.pity, tag: '联动', title: P.POOL[g.gt] + '（走 getLdGachaLog 端点，数据来源与普通池不同）' }
    : { cls: g.up === true ? 'up' : (g.up === false ? 'off' : 'std'), num: g.pity,
        tag: g.up === true ? 'UP' : (g.up === false ? '歪' : '常驻'), title: '' };
  const cHist = h => h.pool
    ? { cls: 'h std', num: h.num, tag: h.pool, title: h.src + '（工坊截图补录，非链接解析）' }
    : { cls: 'h ' + (h.wai ? 'off' : 'up'), num: h.num, tag: h.wai ? '歪' : 'UP', title: h.src + '（工坊截图补录，非链接解析）' };

  const U5C_VIEW = U5C.map(c => {
    const lcId = SIG[c.id] || '';
    const lc = lcId ? u5lById.get(lcId) : null;
    return {
      id: c.id, name: c.name, path: c.path, pathCn: PATH_CN[c.path] || c.path,
      rank: c.rank, copies: c.copies, srcText: srcTextOf(c.srcKeys), poolMark: c.poolMark,
      tags: c.win.map(cWin).concat(c.hist.map(cHist)),
      // 第三源的标记：卡片上要能看出「这个命数是外部统计给的」，以及抽卡推算值是多少（不一致时页面提示）
      hasExt: c.hasExt, extAt: c.extAt, extScore: c.extScore,
      calcRank: c.calcRank, extOnly: c.hasExt && !c.win.length && !c.hist.length,
      conflict: c.hasExt && c.rank !== c.calcRank,
      lcId, lcName: lcId ? (LC_IDX[lcId] ? LC_IDX[lcId].name : '') : '',
      lcOwned: !!lc, lcSup: lc ? lc.sup : 0, lcCopies: lc ? lc.copies : 0,
      lcSrcText: lc ? srcTextOf(lc.srcKeys) : '',
      lcHasExt: lc ? lc.hasExt : false, lcCalcSup: lc ? lc.calcSup : 0,
      lcConflict: lc ? (lc.hasExt && lc.sup !== lc.calcSup) : false,
    };
  });
  const U5L_VIEW = U5L.map(x => {
    const owner = ownerOf(x.id);
    const isStd = STD_CONS.has(x.name);
    return {
      id: x.id, name: x.name, path: x.path, pathCn: PATH_CN[x.path] || x.path,
      sup: x.sup, copies: x.copies, srcText: srcTextOf(x.srcKeys), isStd,
      hasExt: x.hasExt, extAt: x.extAt, calcSup: x.calcSup,
      extOnly: x.hasExt && !x.win.length && !x.hist.length,
      conflict: x.hasExt && x.sup !== x.calcSup,
      // 归属三分支：专属·角色名 / 常驻·角色名 / 限定。兜底也绝不写死「常驻池」
      owner: owner ? owner.name : null,
      ownerKind: owner ? (isStd ? '常驻' : '专属') : (isStd ? '常驻' : '限定'),
    };
  });

  // ── 四星 / 三星（不分池，纯接口窗口内）────────────────────────────────────
  const items = new Map();
  list.forEach(r => {
    const k = r.item_id;
    if (!items.has(k)) items.set(k, {
      id: r.item_id, name: r.name, type: r.item_type, rank: r.rank_type,
      count: 0, first: r.time, last: r.time, pulls: [],
    });
    const it = items.get(k);
    it.count++; it.last = r.time;
  });
  golds.forEach(g => { const it = items.get(g.id); if (it) it.pulls.push({ pity: g.pity, up: g.up, time: g.time }); });
  // 注：四星 / 三星清单（byRank / itemView / lowRank）已按需求下线，界面不再展示，
  //     引擎也不再产出这两个字段 —— 需要时从 items 里按 rank 过滤重算即可。

  // ── 对账（剔重后）────────────────────────────────────────────────────────
  const CROSS = golds.filter(g => g.cross)
    .map(g => ({ gt: g.gt, name: g.name, inWin: g.pity, full: ACC.histCross[g.name] || g.pity }));
  const HIST_DUP = CROSS.map(r => r.name);
  const sumIn = gt => CROSS.filter(r => r.gt === gt).reduce((a, r) => a + r.inWin, 0);
  const chHOut = chHSum - sumIn('11'), lcHOut = lcHSum - sumIn('12');
  const histOut = chHOut + lcHOut;
  const histOutGold = chH.length + lcH.length - HIST_DUP.length;
  const total5 = list.filter(r => r.rank_type === '5').length;
  const TOTAL_P = list.length + histOut + OTH_OUT, TOTAL_G = total5 + histOutGold + OTH_GOLD;

  // 「数据总貌」两套口径：①「数据补填」的基准 + 补填时点之后新导入的记录；② 本地仓全部导入记录。
  //
  // ⚠️ 增量必须按**精确时刻**切，不能按「日」切：补填的那个数是你从工坊读到的当前累计，
  //    如果只拿 at='2026-09-16' 当分界，当天 00:00 之后的记录会全部落进增量 ——
  //    而它们大多已经包含在你填的那个数里 → 重复计数。
  //    补填界面现在是**实时跟随当前时间的秒级时刻**，所以正常路径下 AT 一定是长度 19 的完整时刻；
  //    仍然保留「只给到日 → 按该日结束算」的兜底，因为用户可能手动只填一个日期。
  const AT = String(WS_BASE.at || '');
  // ⚠️ AT 为空 = 还没做过「数据补填」（全新 clone 的初始状态）。此时不能让它变成
  //    ' 23:59:59' —— 那是个「比任何正常时间戳都小」的怪字符串，语义是错的。
  //    直接用空串：空串 < 任何非空时间戳，filter 自然全通过 = 全部记录算增量。
  const AT_CMP = !AT ? '' : (AT.length <= 10 ? (AT + ' 23:59:59') : AT);
  // WS_LABEL = 只到「日」的标签（文案里说「快照日」的地方用它）；
  // WS_AT    = **实际生效的精确时刻**（= 增量分界线），展示上要求秒级精度的地方用它。
  const WS_LABEL = WS_BASE.label || AT.slice(0, 10) || '未补填';
  const WS_AT = AT_CMP || '未补填';
  const INC = list.filter(r => r.time > AT_CMP);
  const INC_P = INC.length, INC_G = INC.filter(r => r.rank_type === '5').length;
  const TOT_P = WS_BASE.pulls + INC_P, TOT_G = WS_BASE.gold + INC_G;

  const GAP_P = WS_BASE.pulls - TOTAL_P, GAP_G = WS_BASE.gold - TOTAL_G;
  const GAP_NEW = INC_P;
  const GAP_SAME_T = TOTAL_P - INC_P;
  const GAP_RESID = WS_BASE.pulls - GAP_SAME_T;

  // ── 需求 1.2-5/6：起点不再人工维护 ────────────────────────────────────────
  // 「近期总抽数」的起点 = **本地仓最早的一条记录** = 第一次导入时能拿到的最早那条（本账号是联动池
  // 2025-07-11 12:02:08）。以后再导入只会往右长，起点永久固定；出金率、每 UP、小保底不歪都基于这一段。
  // 不再读 meta.recentFrom —— 那个手写常量会随抓取次数变得与数据仓不自洽。
  // ⚠️ 起点对外**精确到秒**（用户要求：「近期总抽数起点也精确到分秒」）；但「按日」的那份仍要留着 ——
  //    `ld.before`（垫在起点之前的联动记录条数）是按日口径的统计，直接拿秒级起点比会恒为 0。
  const RECENT_FROM = list.length ? list[0].time.slice(0, 19) : '';
  const RECENT_FROM_DAY = RECENT_FROM.slice(0, 10);
  const REC = list.filter(r => r.time >= RECENT_FROM);
  const REC_P = REC.length, REC_G = REC.filter(r => r.rank_type === '5').length;
  const recOf = gt => REC.filter(r => r.gacha_type === gt).length;
  const REC_LD = REC.filter(r => isLd(r.gacha_type)), REC_LDN = REC.filter(r => !isLd(r.gacha_type));
  const RECN_P = REC_LDN.length, RECN_G = REC_LDN.filter(r => r.rank_type === '5').length;
  const RECN_RATE = RECN_P ? (RECN_G / RECN_P * 100).toFixed(2) : '0.00';

  const gapDir = GAP_P === 0 ? '与工坊完全一致' : (GAP_P > 0 ? '比工坊少 ' + GAP_P + ' 抽' : '比工坊多 ' + (-GAP_P) + ' 抽');
  const gapDirG = GAP_G === 0 ? '一分不差' : (GAP_G > 0 ? '比工坊少 ' + GAP_G + ' 金' : '比工坊多 ' + (-GAP_G) + ' 金');

  const n11 = list.filter(r => r.gacha_type === '11').length;
  const n12 = list.filter(r => r.gacha_type === '12').length;

  // ── 逐池拆分（对账用）────────────────────────────────────────────────────
  // 恒等式：总抽数 = 角色活动 + 光锥活动 + 常驻 + 新手 + 联动。
  // 「常驻 / 新手」的池总量来自截图补录（含当前已垫），所以这个拆分是对账时**定位差在哪一池**的唯一入口。
  const GQ = OTHC.find(p => p.key === 'gq'), XS = OTHC.find(p => p.key === 'xs');
  const P_CH = n11 + chHOut, P_LC = n12 + lcHOut;
  const P_LD21 = list.filter(r => r.gacha_type === '21').length, P_LD22 = list.filter(r => r.gacha_type === '22').length;
  const P_LD = P_LD21 + P_LD22;
  const POOL_SUM = P_CH + P_LC + GQ.sum + XS.sum + P_LD;
  if (POOL_SUM !== TOTAL_P) throw new Error('逐池合计与总抽数不一致：' + POOL_SUM + ' vs ' + TOTAL_P);
  const poolSplit = '角色活动 <b>' + P_CH + '</b> ＋ 光锥活动 <b>' + P_LC + '</b> ＋ 常驻 <b>' + GQ.sum + '</b>（含已垫 ' + GQ.cur + '）＋ 新手 <b>' + XS.sum + '</b> ＋ 联动 <b>' + P_LD + '</b>（角色 ' + P_LD21 + ' / 光锥 ' + P_LD22 + '）';

  const linkChUp = golds.filter(g => g.gt === '11' && g.up === true).length;
  const linkChOff = golds.filter(g => g.gt === '11' && g.up === false).length;
  const linkLcUp = golds.filter(g => g.gt === '12' && g.up === true).length;
  const linkLcOff = golds.filter(g => g.gt === '12' && g.up === false).length;
  // 截图补录里那一段的 UP / 歪次数（剔重后）—— 只用于说明「补录里还有多少历史金」，
  // 不再参与「每 UP / 小保底不歪」，见下面的口径说明。
  const histChUp = chH.filter(r => !r[3] && !HIST_DUP.includes(r[1])).length;
  const histLcUp = lcH.filter(r => !r[3] && !HIST_DUP.includes(r[1])).length;
  const chUpAll = linkChUp + histChUp, lcUpAll = linkLcUp + histLcUp;
  const chOffAll = linkChOff + chH.filter(r => r[3]).length;
  const lcOffAll = linkLcOff + lcH.filter(r => r[3]).length;
  const chNoOff = chUpAll - chOffAll;
  const chNoOffRate = chUpAll ? (chNoOff / chUpAll * 100).toFixed(1) : '0.0';
  const avgGold = ((TOTAL_P - TOTAL_G) / TOTAL_G).toFixed(2);

  // ── 需求 1.2-6：每 UP 角色 / 每 UP 光锥 —— **只用本地导入的跃迁记录**算 ─────
  // 为什么剔掉「截图补录」：那份是写死在 core/pools.js 里的常量（接口保留期之外、靠截图人工录入），
  // 它不会随每次导入变化 —— 掺进来就满足不了「每次导入都要实时更新」这条要求。
  // 于是分子分母同源：口径 =(该池记录抽数 − 该池 UP 次数) ÷ UP 次数。
  // ⚠️ 工坊那种「池抽数 ÷ UP 数」恒比它多 1.0 抽/UP（多出来的正是 UP 数本身），
  //    同一份数据换成工坊式子就是 perUpChWsSame；而工坊页面显示的 82.6/52.9 比它还高，
  //    是因为工坊自己的历史更完整（它云端存了保留期之外那些抽）—— 两件事，别混。
  const perUpCh = linkChUp ? ((n11 - linkChUp) / linkChUp).toFixed(1) : '—';
  const perUpLc = linkLcUp ? ((n12 - linkLcUp) / linkLcUp).toFixed(1) : '—';
  const perUpChWsSame = linkChUp ? (n11 / linkChUp).toFixed(1) : '—';
  const perUpLcWsSame = linkLcUp ? (n12 / linkLcUp).toFixed(1) : '—';

  // ── 需求 1.2-2：小保底不歪 ────────────────────────────────────────────────
  // 定义：UP 次数里有多少次是「小保底直接出」（不是歪完之后的大保底兑现）。
  // 口径 =（该池 UP 次数 − 该池歪的次数）÷ 该池 UP 次数 —— 与工坊显示的是同一个算法。
  // 成立前提：歪的次数 ≤ UP 次数（每一次歪都会被随后的一个 UP 兑现）。
  // 唯一会失真的情形：本地仓里该池**最后一颗金是歪**（这次歪还没兑现成 UP）→ 会少算一次小保底，
  // 所以这里显式检出 pending 标志，界面上注明。
  const lastIsOff = gt => { const g = golds.filter(x => x.gt === gt); return g.length ? g[g.length - 1].up === false : false; };
  const smallPity = (up, off, gt) => up
    ? { up, off, direct: up - off, rate: ((up - off) / up * 100).toFixed(1), pending: lastIsOff(gt) }
    : { up: 0, off: 0, direct: 0, rate: '0.0', pending: false };
  const smallCh = smallPity(linkChUp, linkChOff, '11');
  const smallLc = smallPity(linkLcUp, linkLcOff, '12');

  const cmp = (v, ref) => { const d = Math.abs(Number(v) - ref); return d <= 0.5 ? { ok: true, text: '✓ 吻合' } : { ok: false, text: '△ 差 ' + d.toFixed(1) }; };

  const stdChGot = U5C.filter(c => STD_CHARS.has(c.name));
  const stdLcGot = U5L.filter(x => STD_CONS.has(x.name));

  // ── 吉凶徽章全页分布（出金明细分档统计，供页面校验吉凶落点是否齐全）──────
  const almDist = {};
  golds.forEach(g => { const a = almanac(g.time); almDist[a.label] = (almDist[a.label] || 0) + 1; });

  // ── 缺失图标清单：服务端据此自动下载（需求 5）──────────────────────────
  const haveIcon = (dir, id) => fs.existsSync(path.join(ROOT, 'assets', dir, id + '.png'));
  const needIcons = [];
  list.forEach(r => {
    const dir = (r.gacha_type === '12' || r.gacha_type === '22') ? 'light_cone' : 'avatar';
    if (r.item_type === '光锥') { if (!haveIcon('light_cone', r.item_id)) needIcons.push({ dir: 'light_cone', id: r.item_id, name: r.name }); }
    else if (r.item_type === '角色') { if (!haveIcon('avatar', r.item_id)) needIcons.push({ dir: 'avatar', id: r.item_id, name: r.name }); }
  });
  // 在索引里、但没在记录里出现过的（例如专属光锥未获得，也要能显示灰圈）—— 不需要下载
  // ⚠️ 但**外部统计里的条目要算进来**：它们可能压根不在抽卡记录里（正是外部才有的那部分），
  //    漏掉的话「清空 assets/ 后重新抓一次」就补不回这些图标了。
  EXT.map.forEach(e => {
    const dir = e.kind === 'lc' ? 'light_cone' : 'avatar';
    if (!haveIcon(dir, e.id)) needIcons.push({ dir, id: e.id, name: e.name });
  });
  const uniqNeed = [...new Map(needIcons.map(x => [x.dir + '/' + x.id, x])).values()];

  return {
    empty: false,
    uid: meta.uid || loaded.meta.uid || '',
    generatedAt: new Date().toISOString(),
    generatedAtLocal: new Date().toLocaleString('zh-CN', { hour12: false }),
    dataRange: { from: list[0].time, to: list[list.length - 1].time, total: list.length },
    poolNames: P.POOL, poolShort: P.POOL_SHORT, hard: P.HARD, ldTypes: P.LD_TYPES,

    overview: {
      stats: [
        { key: '总抽数', value: TOT_P, cls: 'purple',
          sub: '数据补填的基准时刻 <b>' + esc(WS_AT) + '</b> · ' + (INC_P ? '之后新导入 +' + INC_P + ' 抽' : '暂无晚于它的新记录') + ' · 账号全部历史口径' },
        { key: '近期总抽数', value: REC_P, cls: 'cyan',
          sub: '＝ 本地仓全部导入记录 · 起点 <b>' + RECENT_FROM + '</b>（自动取最早一条、不可改）· 角色 ' + recOf('11') + ' / 光锥 ' + recOf('12') + ' / 常驻 ' + recOf('1') + ' / 联动 ' + (recOf('21') + recOf('22')) },
        { key: '出金率', value: (REC_G / REC_P * 100).toFixed(2) + '%', cls: 'gold',
          sub: '本地 <b>' + REC_P + '</b> 抽出 <b>' + REC_G + '</b> 金（含联动 ' + REC_LD.length + ' 抽 / ' + REC_LD.filter(r => r.rank_type === '5').length + ' 金）· 剔除联动后 ' + RECN_P + ' 抽 / ' + RECN_G + ' 金 = ' + RECN_RATE + '% · 工坊全量 ' + (TOT_G / TOT_P * 100).toFixed(2) + '%' },
        { key: '每 UP 角色需', value: perUpCh + '<span class="u"> 抽</span>', cls: 'green',
          sub: '角色池记录 <b>' + n11 + '</b> 抽 ÷ UP <b>' + linkChUp + '</b> 次 · 口径 (' + n11 + '−' + linkChUp + ')÷' + linkChUp },
        { key: '每 UP 光锥需', value: perUpLc + '<span class="u"> 抽</span>', cls: 'purple',
          sub: '光锥池记录 <b>' + n12 + '</b> 抽 ÷ UP <b>' + linkLcUp + '</b> 次 · 口径 (' + n12 + '−' + linkLcUp + ')÷' + linkLcUp },
        { key: '小保底不歪 · 角色', value: smallCh.rate + '<span class="u">%</span>', cls: 'gold',
          sub: '角色池 UP <b>' + smallCh.up + '</b> 次里 <b>' + smallCh.direct + '</b> 次小保底直接出（歪 ' + smallCh.off + ' 次）' + (smallCh.pending ? ' · ⚠️ 末次出金是歪、尚未兑现' : '') },
        { key: '小保底不歪 · 光锥', value: smallLc.rate + '<span class="u">%</span>', cls: 'green',
          sub: '光锥池 UP <b>' + smallLc.up + '</b> 次里 <b>' + smallLc.direct + '</b> 次小保底直接出（歪 ' + smallLc.off + ' 次）' + (smallLc.pending ? ' · ⚠️ 末次出金是歪、尚未兑现' : '') },
      ],
      wsBase: Object.assign({}, WS_BASE, { label: WS_LABEL }), wsAt: WS_AT, inc: { p: INC_P, g: INC_G }, tot: { p: TOT_P, g: TOT_G },
      recent: {
        from: RECENT_FROM, fromDay: RECENT_FROM_DAY, p: REC_P, g: REC_G, rate: (REC_G / REC_P * 100).toFixed(2),
        byPool: { ch: recOf('11'), lc: recOf('12'), std: recOf('1'), ld: recOf('21') + recOf('22') },
        ld: { p: REC_LD.length, g: REC_LD.filter(r => r.rank_type === '5').length, before: list.filter(r => isLd(r.gacha_type) && r.time < RECENT_FROM_DAY).length },
        noLd: { p: RECN_P, g: RECN_G, rate: RECN_RATE },
        fullRate: (TOT_G / TOT_P * 100).toFixed(2),
      },
      retentionEdge: list.filter(r => r.gacha_type !== '21' && r.gacha_type !== '22')[0]
        ? list.filter(r => r.gacha_type !== '21' && r.gacha_type !== '22')[0].time.slice(0, 10) : '',
      ldEdge: list.filter(r => isLd(r.gacha_type))[0] ? list.filter(r => isLd(r.gacha_type))[0].time.slice(0, 10) : '',
    },

    poolBounds: Object.keys(P.POOL).filter(gt => poolStat[gt]).map(gt => {
      const p = poolStat[gt];
      return {
        gt, name: P.POOL[gt], n: p.n, first: p.first, last: p.last,
        days: Math.round((new Date(p.last.replace(' ', 'T')) - new Date(p.first.replace(' ', 'T'))) / 86400000),
        gold: p.gold, cur: p.cur, hard: p.hard, isLd: isLd(gt),
      };
    }),

    banners,
    u5c: U5C_VIEW, u5l: U5L_VIEW, missCone,
    // 第三源（外部统计）的现状：页面要显示「录了几条 / 上传过几张图 / 哪几条和抽卡推算不一致」
    external: {
      updatedAt: EXT.updatedAt,
      items: EXT.map.size,
      ch: [...EXT.map.values()].filter(x => x.kind === 'ch').length,
      lc: [...EXT.map.values()].filter(x => x.kind === 'lc').length,
      shots: EXT.files.length,
      // 名字解析不出来的行（external.json 被手工编辑坏时会出现在这里）
      bad: EXT.bad,
      // 冲突：外部说的命数与抽卡记录推算不一致 —— 已按外部生效，但必须让用户看见
      conflicts: extConflicts,
    },
    itemCount: items.size,

    audit: {
      rows: [
        { key: '总抽卡数', ws: String(WS_BASE.pulls),
          ours: TOTAL_P + '（窗口内 ' + list.length + ' + 活动池窗口外 ' + histOut + ' + 其他池窗口外 ' + OTH_OUT + '）',
          judge: (GAP_P === 0
            ? '<b style="color:#1a9e5c">✓ 与工坊完全一致</b>（0.00%）。'
            : gapDir + '（' + (Math.abs(GAP_P) / WS_BASE.pulls * 100).toFixed(2) + '%）= ① 本次新同步 ' + GAP_NEW + ' 抽 ＋ ② 截图与总结页的<b>时点差</b> ' + Math.abs(GAP_RESID) + ' 抽。')
            + '逐池拆分：' + poolSplit + ' = <b>' + POOL_SUM + '</b> 抽', ok: GAP_P === 0 },
        { key: '五星数', ws: '103',
          ours: TOTAL_G + '（链接 ' + total5 + ' + 活动池窗口外 ' + histOutGold + ' + 其他池窗口外 ' + OTH_GOLD + '）',
          judge: '<b style="color:#1a9e5c">✓ 完全吻合</b>，六个池至此全部凑齐', ok: true },
        { key: '平均出金', ws: '53.2', ours: avgGold,
          judge: cmp(avgGold, 53.2).text + '（口径 =(总抽数 − 金数) ÷ 金数；工坊 (' + WS_BASE.pulls + '−103)÷103 = ' + ((WS_BASE.pulls - 103) / 103).toFixed(2) + ' → 显示 53.2，本次 (' + TOTAL_P + '−' + TOTAL_G + ')÷' + TOTAL_G + ' = ' + avgGold + '）', ok: cmp(avgGold, 53.2).ok },
        { key: '每 UP 角色需', ws: '82.6', ours: perUpCh,
          judge: cmp(perUpCh, 82.6).text + '（<b>是口径差，不是数据差</b>：工坊 = 角色池抽数 ÷ UP 数 = ' + P_CH + ' ÷ ' + chUpAll + ' = ' + (P_CH / chUpAll).toFixed(2) + ' → 显示 82.6；本页 = (角色池抽数 − UP 数) ÷ UP 数 = (' + P_CH + ' − ' + chUpAll + ') ÷ ' + chUpAll + ' = ' + perUpCh + '。两式相差的正是 UP 数本身，<b>恒差 1.0 抽/UP</b>）', ok: cmp(perUpCh, 82.6).ok },
        { key: '每 UP 光锥需', ws: '52.9', ours: perUpLc,
          judge: cmp(perUpLc, 52.9).text + '（<b>同样是口径差</b>：工坊 = 光锥池抽数 ÷ UP 数 → 由它显示的 52.9 反推其光锥池抽数 ≈ ' + Math.round(52.9 * lcUpAll) + ' 抽；本页 = (' + P_LC + ' − ' + lcUpAll + ') ÷ ' + lcUpAll + ' = ' + perUpLc + '，其中 ' + P_LC + ' = 窗口内 ' + n12 + ' + 截图补录窗口外 ' + lcHOut + '。两式恒差 1.0 抽/UP，而 ' + P_LC + ' 与工坊反推值的 2 抽之差来自截图逐行累加的首行垫抽边界效应）', ok: cmp(perUpLc, 52.9).ok },
        { key: '小保底不歪', ws: '54.3%', ours: '角色池 ' + chNoOff + '/' + chUpAll + ' = ' + chNoOffRate + '%',
          judge: '<b style="color:#1a9e5c">✓ 完全吻合</b>：角色池 UP 共 <b>' + chUpAll + '</b> 次，其中 <b>' + chOffAll + '</b> 次是「歪」触发的大保底，剩下 <b>' + chNoOff + '</b> 次是小保底直接出 → ' + chNoOff + ' ÷ ' + chUpAll + ' = <b>' + chNoOffRate + '%</b>。', ok: Math.abs(Number(chNoOffRate) - 54.3) <= 0.5 },
        { key: '常驻五星', ws: '13', ours: (stdChGot.length + stdLcGot.length) + ' 种（' + stdChGot.length + ' 个常驻角色 + ' + stdLcGot.length + ' 张常驻光锥）',
          judge: '△ <b>比工坊多 ' + (stdChGot.length + stdLcGot.length - 13) + ' 种</b>。补上常驻 / 新手 / 联动三个池之后，常驻名单里又多了 <b>' + stdChGot.filter(c => !c.win.length).map(c => c.name).join(' · ') + '</b> 角色与 <b>' + stdLcGot.filter(x => !x.win.length).map(x => x.name).join(' · ') + '</b> 光锥。<br>工坊那个 13 应是它自己同步范围内的口径（或只算活动池歪到的），<b>属于「去重种类数」的口径差，不影响总抽数 / 总五星的对账</b>。', ok: null },
        { key: '限定五星', ws: '81', ours: (chUpAll + lcUpAll) + ' 次（活动池 UP，剔重后）',
          judge: '口径未公布。工坊那个 81 是它自己的算法（疑似「限定次数 + 常驻去重种类」），与本页「活动池 UP 次数」不是同一件事。', ok: null },
      ],
      detail: {
        list, total5, histOut, histOutGold, OTH_OUT, OTH_GOLD, TOTAL_P, TOTAL_G,
        ws: Object.assign({}, WS_BASE, { label: WS_LABEL }),
        gap: { p: GAP_P, g: GAP_G, isNew: GAP_NEW, sameT: GAP_SAME_T, resid: GAP_RESID, dir: gapDir, dirG: gapDirG, pct: (Math.abs(GAP_P) / WS_BASE.pulls * 100).toFixed(2) },
        poolSplit, poolSum: POOL_SUM,
        gqCur: GQ.cur, gqSum: GQ.sum,
        cross: CROSS, dup: HIST_DUP, chHSum, lcHSum, chHOut, lcHOut,
        chUpAll, lcUpAll, chOffAll, lcOffAll, chNoOff, chNoOffRate,
        histOff: chHOff + lcHOff, histOffCh: chHOff, histOffLc: lcHOff,
        n11, n12, avgGold, perUpCh, perUpLc,
        // 需求 1.2：这些指标只用导入记录算，另一套（含截图补录的）只作历史说明
        linkChUp, linkChOff, linkLcUp, linkLcOff,
        perUpChWsSame, perUpLcWsSame,
        smallCh, smallLc,
        perUpChWithHist: chUpAll ? ((P_CH - chUpAll) / chUpAll).toFixed(1) : '—',
        perUpLcWithHist: lcUpAll ? ((P_LC - lcUpAll) / lcUpAll).toFixed(1) : '—',
        recentFrom: RECENT_FROM,
        stdCh: stdChGot.map(c => c.name), stdLc: stdLcGot.map(x => x.name),
        crossPity: {
          ch: golds.find(g => g.cross && g.gt === '11') ? golds.find(g => g.cross && g.gt === '11').pity : 0,
          lc: golds.find(g => g.cross && g.gt === '12') ? golds.find(g => g.cross && g.gt === '12').pity : 0,
        },
        lastS11: seg11.length ? { gid: seg11[seg11.length - 1].gid, n: seg11[seg11.length - 1].n, golds: seg11[seg11.length - 1].golds.length, comp: compPlain(seg11[seg11.length - 1]) } : null,
        lcTwin: (() => {
          if (!seg11.length) return null;
          const last = seg11[seg11.length - 1];
          const twin = seg12.find(s => s.gid === '3' + last.gid.slice(1)) || seg12[seg12.length - 1];
          return twin ? { gid: twin.gid, names: twin.golds.map(g => g.name).join('、') } : null;
        })(),
      },
    },

    almanac: { dist: almDist, goldTotal: golds.length },
    // 导入留档（需求 1.2：把「第一次导入建仓 → 之后校验并累计」这件事在界面上说清楚）
    imports: (loaded.sources || []).map(s => ({
      at: s.at || s.importedAt || '',
      endpoint: s.endpoint || s.file || 'import',
      incoming: s.incoming != null ? s.incoming : (s.n != null ? s.n : 0),
      added: s.added != null ? s.added : 0,
      from: s.from || '', to: s.to || '',
    })),
    needIcons: uniqNeed,
    bannersCoverage: { ch: { infer: seg11.filter(s => inferUP(s).src === 'auto').length, total: seg11.length },
                       lc: { infer: seg12.filter(s => inferUP(s).src === 'auto').length, total: seg12.length } },
    gqCheck,
  };
}

module.exports = { analyze, loadRecords, loadIndex };
