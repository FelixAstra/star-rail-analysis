// 卡池日历 + 剩余期内择日 的验证（node tools/verify-banner.js）
//
// 目的：证明「当期卡池日期」不是随手抄的、也不是拿抽到的东西反推的 ——
//   ① 日历源的期次结构自洽（起止单调、不重叠）
//   ② 开池时刻确实被本地抽卡记录校准过（源给的 start 偏 +7 小时）
//   ③ gacha_id → 期次 的映射与时间区间严格一致（不漏配、不错配）
//   ④ 日历给的 UP 名单能与本地「角色 ↔ 专属光锥」表交叉对上（这张表是三条证据拼的，可查）
//   ⑤ 择日区间按**关池时刻**截断（卡池到期日只开到凌晨，不能整天推荐）
//
// ⚠️ 这是全平台唯一联网的模块。取不到日历（离线/源挂了）时相关分组整体 SKIP，
//    不算失败 —— 但要明确打印出来，别让人以为「跑绿了」等于验证过了。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const B = require(path.join(ROOT, 'core/banner.js'));
const Z = require(path.join(ROOT, 'core/zeri.js'));
const P = require(path.join(ROOT, 'core/pools.js'));
const A = require(path.join(ROOT, 'core/analyze.js'));

const rows = [];
const rec = (ok, label, got) => rows.push({ ok, label, got: got === undefined ? '' : String(got) });
const skip = (label, why) => rows.push({ skip: true, label, got: why });
// 信息项：只打印、不断言、不计入通过率（用于把「数据长什么样」摊开给人看）
const note = (label, got) => rows.push({ note: true, label, got: got === undefined ? '' : String(got) });

const day = s => String(s).slice(0, 10);
const hm = s => String(s).slice(11, 16);
const readRecords = () => {
  try { return (JSON.parse(fs.readFileSync(path.join(ROOT, 'data/records.json'), 'utf8')).records) || []; }
  catch (e) { return []; }
};

(async () => {
  const records = readRecords();
  if (!records.length) { console.error('✗ data/records.json 里没有记录，先导入抽卡记录再跑'); process.exit(1); }

  let cal = null;
  try { cal = await B.calendar({ records }); }
  catch (e) { cal = { ok: false, error: e.message }; }

  // ── ① 日历结构 ───────────────────────────────────────────────────────────
  if (!cal || !cal.ok || !cal.currentTerm) {
    skip('① 日历结构', '取不到当期期次（' + ((cal && (cal.error || cal.warn)) || '离线') + '）');
    skip('② 本地校准', '同上');
    skip('③ 剩余时长自洽', '同上');
  } else {
    const t = cal.currentTerm;
    rec(!!(t.version && t.start && t.end), '① 当期期次四要素齐全（版本/起/止）',
      `v${t.version}${t.half ? ' ' + t.half : ''} ${t.start} ~ ${t.end}`);
    rec(B.parse(t.end) > B.parse(t.start), '① 结束晚于开始', `${t.start} → ${t.end}`);
    rec((t.upChars || []).length > 0, '① 当期 UP 角色名单非空', (t.upChars || []).join('/'));

    const terms = (cal.terms || []).slice().sort((a, b) => B.parse(a.start) - B.parse(b.start));
    // ⚠️ 同日开池是合法的：同一版本里会有「跨整版的长 banner」与「标准半期 banner」并存
    //    （实测 4.6：真珠 09-28~11-10 与 绯英 09-28~10-21 同日开）。所以判据是**非递减**，
    //    真正要抓的是「嵌进上一期中间才另起一段」这种异常。
    let mono = true; const overlap = [];
    for (let i = 1; i < terms.length; i++) {
      if (B.parse(terms[i - 1].start) > B.parse(terms[i].start)) mono = false;
      if (day(terms[i].start) !== day(terms[i - 1].start)
        && B.parse(terms[i - 1].end) > B.parse(terms[i].start)) {
        overlap.push(terms[i - 1].version + ' → ' + terms[i].version + ' @' + terms[i].start);
      }
    }
    rec(mono, '① 期次按开始时间非递减（同日并列合法）',
      terms.map(t => day(t.start) + '~' + day(t.end)).join('  '));
    // ⚠️ 这里**不作断言**：同一版本里「跨整版的长 banner」会天然包住「半期 banner」
    //    （实测 4.6：真珠 09-28~11-10 包住 千冶•刃 10-21~11-10）。这是数据源的结构，
    //    不是错误；把它当失败会让这条断言变成噪音，所以只摊开给人看。
    note('① 期次窗口重叠情况（信息项，不作断言）', overlap.join(' / ') || '无');
    // 真正重要的性质：当期期次必须覆盖此刻，且 UP 角色与光锥名单都齐全 ——
    // 否则「当期卡池」卡片会少一半信息，或者根本指错期。
    const cur = cal.currentTerm;
    const nowStr = B.fmt(Math.floor(Date.now() / 1000));   // ⚠️ fmt 收的是**秒**，不是 Date
    rec(nowStr >= cur.start && nowStr <= cur.end, '① 当期期次覆盖此刻', nowStr + ' ∈ [' + cur.start + ', ' + cur.end + ']');
    rec((cur.upChars || []).length > 0 && (cur.upCones || []).length > 0,
      '① 当期期次的 UP 角色与 UP 光锥都齐全',
      (cur.upChars || []).join('/') + ' || ' + (cur.upCones || []).join('/'));

    // ── ② 本地校准 ─────────────────────────────────────────────────────────
    const cald = (cal.list || []).filter(b => b.startFrom === 'local');
    if (!cald.length) skip('② 本地校准', '本期没有可用本地记录校准（记录里没有落在该期内的首抽）');
    else {
      const bad = cald.filter(b => hm(b.start) !== '12:00');
      rec(bad.length === 0, '② 被校准的期次，开池时刻一律 12:00（正午）',
        cald.map(b => day(b.start) + ' ' + hm(b.start)).join(' / '));
      rec(cald.every(b => !!b.originStart && B.parse(b.originStart) > B.parse(b.start)),
        '② 校准确实把源给的 start 往前提了（源偏 +7 小时）',
        cald.map(b => b.originStart + ' → ' + b.start).join(' | '));
      // ⚠️ 回归防线：引擎的 note 不许自己声称「已校准」——那句由组件按 bnCalibrated 追加，
      //    两边都写会在同一张卡上出现两遍（踩过）。
      rec(!/已用本地抽卡记录校准|已校准/.test(cal.note || ''),
        '② 引擎 note 不自称「已校准」（避免与组件追加的那句重复）',
        String(cal.note || '').slice(0, 70) + '…');
    }

    // ── ③ 剩余时长自洽 ─────────────────────────────────────────────────────
    const rm = cal.remain;
    const selfDays = Math.floor(rm.ms / 86400000), selfHours = Math.floor((rm.ms % 86400000) / 3600000);
    rec(rm.days === selfDays && rm.hours === selfHours, '③ 剩余天数/小时与毫秒自洽',
      `${rm.ms}ms → ${rm.days}天${rm.hours}小时`);
    rec(rm.text === (selfDays + ' 天 ' + selfHours + ' 小时'), '③ 剩余文案可复算', rm.text);
  }

  // ── ④ gid → 期次 映射 ────────────────────────────────────────────────────
  const terms = (cal && cal.terms) || [];
  if (!terms.length) skip('④ gid 映射', '没有可用期次');
  else {
    const map = B.mapGachaIds(terms, records);
    const ev = Object.values(map).filter(x => ['11', '12', '21', '22'].indexOf(x.gt) >= 0);
    const matched = ev.filter(x => x.matched);
    const lo = d => B.addDays(d, -1), hi = d => B.addDays(d, 1);
    const inTerm = x => terms.some(t => {
      const df = day(x.first);
      return (df >= day(t.start) && df <= day(t.end)) || (df >= lo(day(t.start)) && df <= hi(day(t.end)));
    });

    rec(matched.length > 0, '④ 至少有一个活动池 gid 落到期次上', matched.length + ' / ' + ev.length);
    rec(matched.every(inTerm), '④ 已匹配的 gid，首抽日必落在该期区间内（±1 天）',
      matched.map(x => `${x.gid}@${day(x.first)}→${x.label}`).join(' '));
    rec(matched.every(x => (x.upChars || []).length > 0), '④ 已匹配的 gid 都带 UP 角色名单',
      matched.map(x => x.gid + ':' + x.upChars.join('/')).join(' | '));
    // ⚠️ 这一条是回归防线：数据源把角色池与光锥池拆成两条并列 banner，
    //    曾经因为拿 list 而不是 terms 去匹配，UP 光锥恒为空
    rec(matched.every(x => (x.upCones || []).length > 0), '④ 已匹配的 gid 都带 UP 光锥名单',
      matched.map(x => x.gid + ':' + (x.upCones.join('/') || '【空】')).join(' | '));
    const unmatchedIn = ev.filter(x => !x.matched && inTerm(x));
    rec(unmatchedIn.length === 0, '④ 没有「落在期次区间内却没匹配上」的漏配',
      unmatchedIn.map(x => x.gid + '@' + day(x.first)).join(' ') || '无');

    // ── ⑤ UP 名单 × 本地「角色 ↔ 专属光锥」表 交叉验证 ─────────────────────
    let CH = {}, LC = {};
    try { const ix = A.loadIndex(); CH = ix.CH_IDX || {}; LC = ix.LC_IDX || {}; } catch (e) { /* 索引缺失就跳过 */ }
    const norm = s => String(s).replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    const nCh = {}, nLc = {};
    Object.values(CH).forEach(v => { nCh[norm(v.name)] = v; });
    Object.values(LC).forEach(v => { nLc[norm(v.name)] = v; });

    const uniqTerms = [];
    matched.forEach(x => { if (!uniqTerms.some(t => t.label === x.label)) uniqTerms.push(x); });
    if (!Object.keys(CH).length) skip('⑤ UP 名单交叉验证', '本地角色索引为空');
    else {
      const badC = [], badL = [];
      uniqTerms.forEach(x => {
        (x.upChars || []).forEach(n => { if (!nCh[norm(n)]) badC.push(x.label + ':' + n); });
        (x.upCones || []).forEach(n => { if (!nLc[norm(n)]) badL.push(x.label + ':' + n); });
      });
      rec(badC.length === 0, '⑤ UP 角色都能在本地索引里查到', badC.join(' ') || '全部命中 ' + uniqTerms.length + ' 期');
      rec(badL.length === 0, '⑤ UP 光锥都能在本地索引里查到', badL.join(' ') || '全部命中');
      // 1:1 的期次才谈得上「专属」对应关系；2 组 UP 的期次无法只靠时间区分，跳过
      const one = uniqTerms.filter(x => x.upChars.length === 1 && x.upCones.length === 1);
      const badPair = one.filter(x => {
        const c = nCh[norm(x.upChars[0])], l = nLc[norm(x.upCones[0])];
        return c && l && P.SIG[c.id] !== l.id;
      });
      rec(one.length === 0 || badPair.length === 0, '⑤ 1:1 期次的 UP 光锥 = 该角色的专属光锥（查 SIG 表）',
        one.length ? one.map(x => `${x.label}:${x.upChars[0]}↔${x.upCones[0]}`).join(' | ')
          : '没有 1:1 的已匹配期次（本机记录只覆盖 2 组 UP 的期次），跳过对应关系');
    }
  }

  // ── ⑥⑦ 剩余期内择日 ─────────────────────────────────────────────────────
  if (!cal || !cal.ok || !cal.currentTerm) skip('⑥ 择日区间截断', '没有当期期次');
  else {
    const endStr = String(cal.currentTerm.end);
    const last = day(endStr);
    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')].join('-');
    // 与页面 loadRange() 同一套口径
    const d0 = new Date(last + 'T12:00:00+08:00'); d0.setDate(d0.getDate() - 1);
    const prev = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(d0);
    let to = last;
    if (last > today && hm(endStr) < '23:00') to = prev;
    if (to < today) to = today;

    rec(to <= last, '⑥ 择日区间不越过关池日', `to=${to} ≤ ${last}`);
    rec(hm(endStr) >= '23:00' || to < last, '⑥ 关池时刻早于 23:00 时，到期当天不排（只开到凌晨）',
      `关 ${endStr} → to=${to}`);
    rec(to >= today, '⑥ 择日区间从今天起算', `${today} … ${to}`);

    const rg = Z.range(today, to);
    rec(rg.n > 0, '⑦ 择日榜有内容', rg.n + ' 天');
    const dates = rg.days.map(x => x.date);
    rec(dates.length === new Set(dates).size, '⑦ 日期无重复');
    let cont = true;
    for (let i = 1; i < dates.length; i++) if (dates[i] !== B.addDays(dates[i - 1], 1)) cont = false;
    rec(cont, '⑦ 日期连续（中间不缺天）', dates[0] + ' → ' + dates[dates.length - 1]);
    rec(rg.days.every(x => x.bestHour && x.bestHour.zhi && x.bestHour.range),
      '⑦ 每天都有最佳时辰', rg.days.map(x => x.date.slice(5) + ':' + (x.bestHour || {}).zhi).join(' '));
    rec(rg.days.every(x => ['d1', 'd2', 'd0', 'dx'].indexOf(x.level) >= 0), '⑦ 日家档位合法',
      [...new Set(rg.days.map(x => x.level))].join('/'));
    let mono = true;
    for (let i = 1; i < rg.ranked.length; i++) if (rg.ranked[i - 1].total < rg.ranked[i].total) mono = false;
    rec(mono, '⑦ 榜首榜按综合分单调不增');
    rec(rg.ranked.every((x, i) => x.rank === i + 1), '⑦ 名次从 1 连续编号',
      rg.ranked.map(x => x.rank).join(','));
    const badDays = rg.days.filter(x => x.level === 'dx').length;
    rec(badDays < rg.n * 0.6, '⑦「不宜」的日子不过半（阈值没退化）', badDays + ' / ' + rg.n);
  }

  // ── ⑧ 日家档位分布（400 天抽样）─────────────────────────────────────────
  try {
    const a = Z.assertZeriRange();
    rec(a.failed === 0, '⑧ 日家择吉自检', (a.all - a.failed) + '/' + a.all);
    const lv = Object.keys(a.dist || {}).filter(k => a.dist[k] > 0);
    rec(lv.length >= 4, '⑧ 四档（上吉/吉/平/不宜）抽样里都出现过', JSON.stringify(a.dist));
  } catch (e) { rec(false, '⑧ 日家择吉自检', e.message); }

  // ── ⑨ 离线降级（断网是常态：本机有代理、源也可能挂）────────────────────────
  // 这一组把 https.get 换成「必定失败」的桩，验证两条降级路径。
  // ⚠️ 桩必须在 require 之前或之后都能生效 —— banner.js 里 `https` 是同一个模块对象，
  //    改 https.get 属性对所有调用点生效（不要去改 require 缓存）。
  // ⚠️ 跑完必须把缓存原样写回，否则后面真拉取会拿到被改老的 fetchedAt。
  {
    const https = require('https');
    const cachePath = B.CACHE_FILE;
    const backup = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : null;
    const realGet = https.get;
    try {
      https.get = function () {
        const { EventEmitter } = require('events');
        const req = new EventEmitter();
        req.setTimeout = () => {}; req.destroy = () => {};
        setImmediate(() => req.emit('error', new Error('验证桩：模拟断网')));
        return req;
      };

      // ⑨-A 无缓存 + 断网 → 内置兜底表
      try { fs.unlinkSync(cachePath); } catch (e) {}
      const a = await B.calendar({ records });
      rec(a.source === 'builtin' && a.stale === true, '⑨ 无缓存断网时降级到内置表',
        a.source + ' / stale=' + a.stale + ' / ' + (a.warn || ''));
      rec(a.ok === true && !!a.currentTerm && !!a.remain,
        '⑨ 内置表仍能给出当期期次与剩余时长',
        a.currentTerm ? ('v' + a.currentTerm.version + ' ' + a.currentTerm.half + ' · 剩 ' + a.remain.text) : '（无）');

      // ⑨-B 有缓存（且已过期）+ 断网 → 用缓存并标 stale
      if (backup) {
        const j = JSON.parse(backup.toString('utf8'));
        j.fetchedAt = Date.now() - 48 * 3600 * 1000;   // 改老，逼它去重拉
        fs.writeFileSync(cachePath, JSON.stringify(j, null, 1));
        const b = await B.calendar({ records });
        rec(b.source === 'cache' && b.stale === true, '⑨ 有缓存断网时用缓存并标 stale',
          b.source + ' / stale=' + b.stale);
      } else {
        skip('⑨ 缓存降级', '本机没有 banner-cache.json');
      }
    } catch (e) {
      rec(false, '⑨ 离线降级', e.message);
    } finally {
      https.get = realGet;
      if (backup) fs.writeFileSync(cachePath, backup);   // 原样还原
      rec(backup && fs.readFileSync(cachePath).equals(backup), '⑨ 验证后缓存已原样还原');
    }
  }

  // ── 输出 ─────────────────────────────────────────────────────────────────
  const counted = rows.filter(r => !r.note && !r.skip);
  const bad = counted.filter(r => !r.ok);
  const sk = rows.filter(r => r.skip);
  console.log('── 卡池日历 + 剩余期内择日 验证 ──');
  console.log('（数据源：' + ((cal && cal.source) || '?') + ' · ' + ((cal && cal.fetchedAt) || '?') +
    (cal && cal.stale ? ' · 缓存已过期' : '') + '）');
  rows.forEach(r => console.log((r.note ? '  ·· ' : r.skip ? '  -- ' : (r.ok ? '  OK ' : '  ✗✗ ')) +
    r.label + '\n        ' + r.got));
  console.log('\n合计 ' + (counted.length - bad.length) + '/' + counted.length +
    ' 通过' + (sk.length ? '（另有 ' + sk.length + ' 项跳过）' : '') + (bad.length ? ' —— 有失败' : ''));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('✗ 跑挂了：' + (e && e.message)); process.exit(1); });
