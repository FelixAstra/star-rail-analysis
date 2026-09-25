// ─────────────────────────────────────────────────────────────────────────────
// 卡池日历 —— 自动获取当期卡池的起止时间与 UP 名单
//
// 为什么必须有这个文件：抽卡记录里**没有卡池起止时间**。`gacha_id` 只是「哪一池」
// 的身份编号，不带时间语义（见 core/pools.js 的告诫）。所以「本期还剩几天」这件事，
// 靠本地记录永远算不出来 —— 只能从外部日历拿，再用本地记录去校准。
//
// 数据源：api.ennead.cc/mihoyo/starrail/calendar（第三方聚合，**非官方**）
//   返回 banners[]，每期带 version / start_time / end_time / UP 角色 / UP 光锥。
//   ⚠️ 这是本平台**除了抓抽卡记录之外的唯一联网点**，所以页面口径要相应改。
//
// ⚠️ 已实测的数据源偏差（源的问题，别当 bug 修）：
//   ennead 的 start_time 比实际开池**晚 7 小时** —— 4.5 下半本地首抽时间戳是
//   09-12 12:01:13（开池后 1 分钟），而该源给 09-12 19:00。end_time 与公开资料一致。
//   → start 一律优先用本地抽卡记录校准；end 保留源值。
//
// ⚠️ 所有时间戳按 Asia/Hong_Kong 渲染（崩铁国服口径：开池中午、结束凌晨 03:59 量级）。
//
// 顺带解决的老问题：`gacha_id → 当期 UP 是谁` 以前只能靠循环论证猜，
//   现在日历直接给 UP 名单，按时间区间就能把 gacha_id 映射上去（见 mapGachaIds）。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const URL_CAL = 'https://api.ennead.cc/mihoyo/starrail/calendar?lang=zh-cn';
const CACHE_FILE = path.join(__dirname, '..', 'data', 'banner-cache.json');
const CACHE_TTL = 6 * 3600 * 1000;   // 6 小时
const TZ = 'Asia/Hong_Kong';

// ── 内置兜底表 ───────────────────────────────────────────────────────────────
// 只在「从未成功联网过 + 无缓存」时用。日期由 tools/build-banner-table.js 从
// 日历接口固化，也可以手改 —— 手改时**必须**写清来源，别让数字变成无源之水。
const BUILTIN = {
  note: '内置兜底表（离线时使用，可能过期；以游戏内公告为准）',
  noteEn: 'Built-in fallback table (used offline and possibly out of date; the in-game notice wins)',
  banners: [
    { version: '4.5', half: '下半', start: '2026-09-12 12:00', end: '2026-09-28 03:59',
      upChars: ['砂金•戏浪', '不死途'], upCones: ['向浪花掷下盛夏', '一场谎言的终幕'] },
    { version: '4.6', half: '上半', start: '2026-09-28 03:00', end: '2026-10-21 11:59',
      upChars: ['绯英'], upCones: ['邂逅于下一个花季'] },
    { version: '4.6', half: '下半', start: '2026-10-21 12:00', end: '2026-11-10 15:00',
      upChars: ['千冶•刃'], upCones: ['灼尽炼狱的新骸'] },
  ],
};

// ── 时间工具 ─────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');

/** 时间戳(秒) → 'YYYY-MM-DD HH:mm'（香港时区） */
function fmt(sec) {
  const d = new Date(sec * 1000);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return p.year + '-' + p.month + '-' + p.day + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
}
/** 'YYYY-MM-DD HH:mm' → Date（按香港 +08:00 解释） */
function parse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s));
  if (!m) return null;
  return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + (m[4] || '00') + ':' + (m[5] || '00') + ':00+08:00');
}
/** 现在（香港）→ 'YYYY-MM-DD HH:mm' */
const nowStr = () => fmt(Math.floor(Date.now() / 1000));

// ── 网络 ─────────────────────────────────────────────────────────────────────
function getJSON(url, tries) {
  tries = tries || 3;
  return new Promise(function (resolve, reject) {
    const attempt = n => {
      const req = https.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Accept': 'application/json' },
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            if (n < tries) return setTimeout(() => attempt(n + 1), 800 * n);
            return reject(new Error('HTTP ' + res.statusCode));
          }
          try { resolve(JSON.parse(buf)); }
          catch (e) {
            if (n < tries) return setTimeout(() => attempt(n + 1), 800 * n);
            reject(new Error('返回不是 JSON：' + buf.slice(0, 120)));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', e => {
        if (n < tries) setTimeout(() => attempt(n + 1), 800 * n);
        else reject(e);
      });
    };
    attempt(1);
  });
}

// ── 缓存 ─────────────────────────────────────────────────────────────────────
function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { return null; }
}
function writeCache(obj) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 1));
  } catch (e) { /* 缓存写不进去不影响主流程 */ }
}

// ── 解析日历 ─────────────────────────────────────────────────────────────────
/** ennead 的 banners[] → 归一化后的期次列表（按开始时间升序） */
function normalize(raw) {
  const list = (raw && raw.banners) || [];
  const out = list.map(b => ({
    id: b.id,
    version: String(b.version || ''),
    start: fmt(b.start_time),
    end: fmt(b.end_time),
    startSec: b.start_time,
    endSec: b.end_time,
    upChars: (b.characters || []).filter(c => c.rarity === 5).map(c => c.name),
    upCones: (b.light_cones || []).filter(c => c.rarity === 5).map(c => c.name),
    allChars: (b.characters || []).map(c => ({ name: c.name, rarity: c.rarity })),
  })).sort((a, b) => a.startSec - b.startSec);

  // 版本内的期序号：同 version 按 start 去重后排序 → 第 1 期=上半、第 2 期=下半。
  // ⚠️ 滚动窗口会把老期次挤掉，所以「4.5 只剩一条」时判不出上下半 —— 那就**不标**，
  //    宁可少写一个字，也不编一个可能是错的「上半/下半」。
  const byVer = {};
  out.forEach(b => {
    const key = b.version + '|' + b.start;
    if (!byVer[b.version]) byVer[b.version] = [];
    if (!byVer[b.version].includes(key)) byVer[b.version].push(key);
  });
  out.forEach(b => {
    const slots = byVer[b.version];
    b.half = slots.length >= 2
      ? (slots.indexOf(b.version + '|' + b.start) === 0 ? '上半' : '下半')
      : '';
  });
  return out;
}

/**
 * 补齐「上半/下半」标注。
 * ⚠️ 必须在**拿到最终 list 之后**统一调用一次，不能只在 normalize 里做 ——
 *    走缓存路径时 list 已经是 normalize 过的，不会再过一遍 normalize
 *    （踩过：缓存命中时 4.5 的「下半」永远补不上）。
 */
function fillHalf(list) {
  (list || []).forEach(b => {
    // 滚动窗口把老期次挤掉后（同版本只剩一条）判不出上半/下半。
    // 这时去内置表按「同版本 + 同开始日」补 —— 内置表那一栏是有公开资料支撑的，
    // 比自己按天数猜可靠。补不到就留空，宁可少写一个字。
    if (b.half) return;
    const local = (BUILTIN.banners || []).find(x => x.version === b.version && x.start.slice(0, 10) === b.start.slice(0, 10));
    if (local && local.half) { b.half = local.half; b.halfFrom = 'builtin'; }
  });
  return list;
}

/** 把「同版本 + 同区间」的角色池与光锥池合并成一条，便于页面按期展示 */
function mergeTerms(list) {
  const map = {};
  (list || []).forEach(b => {
    const k = b.version + '|' + b.start + '|' + b.end;
    if (!map[k]) map[k] = { version: b.version, half: b.half, start: b.start, end: b.end,
      startSec: b.startSec, endSec: b.endSec, startFrom: b.startFrom, originStart: b.originStart,
      startEvidence: b.startEvidence, upChars: [], upCones: [], parts: [] };
    const m = map[k];
    m.parts.push(b);
    b.upChars.forEach(n => { if (m.upChars.indexOf(n) < 0) m.upChars.push(n); });
    b.upCones.forEach(n => { if (m.upCones.indexOf(n) < 0) m.upCones.push(n); });
    if (b.startFrom === 'local') { m.startFrom = 'local'; m.originStart = b.originStart; m.startEvidence = b.startEvidence; }
  });
  return Object.values(map).sort((a, b) => a.startSec - b.startSec);
}

/** 内置表 → 同结构 */
function fromBuiltin() {
  return BUILTIN.banners.map((b, i) => ({
    id: 'builtin-' + i, version: b.version, half: b.half || '',
    start: b.start, end: b.end,
    startSec: Math.floor((parse(b.start) || new Date()).getTime() / 1000),
    endSec: Math.floor((parse(b.end) || new Date()).getTime() / 1000),
    upChars: b.upChars || [], upCones: b.upCones || [], allChars: [],
  }));
}

// ── 本地记录校准 ─────────────────────────────────────────────────────────────
/**
 * 用本地抽卡记录把 banner.start 拉回到真实开池时刻。
 *
 * 依据：本地记录的**首抽时间**证明「开池不晚于此刻」。而崩铁国服开池固定在**中午 12:00**，
 * 所以若本地首抽当天的 12:00 早于日历给的 start，就认定日历的 start 偏晚，改用 12:00。
 * 这是唯一一处「推断」，且每一步都能被记录本身复核 —— 页面上会标 `startFrom:'local'`。
 *
 * @param {Array} list  归一化后的期次
 * @param {Array} records 本地抽卡记录（需含 gacha_id / time）
 */
function calibrateByRecords(list, records) {
  if (!Array.isArray(records) || !records.length) return list;
  // gacha_id → 首抽时间 的「YYYY-MM-DD」
  const firstDay = {};
  records.forEach(r => {
    const g = String(r.gacha_id);
    const d = String(r.time).slice(0, 10);
    if (!firstDay[g] || d < firstDay[g]) firstDay[g] = d;
  });
  const days = Object.values(firstDay).sort();

  list.forEach(b => {
    const startDay = b.start.slice(0, 10);
    const endDay = b.end.slice(0, 10);
    // 落在本期内（或紧邻 1 天）的首抽日 → 说明本期确实开在这天或更早
    const hit = days.find(d => d >= addDays(startDay, -1) && d <= endDay);
    if (!hit) return;
    const noon = hit + ' 12:00';
    const noonD = parse(noon);
    if (noonD && noonD < parse(b.start)) {
      b.originStart = b.start;
      b.start = noon;
      // ⚠️ 时间戳必须同步改 —— 只改字符串会让「当前期」的判定仍按旧值算
      b.startSec = Math.floor(noonD.getTime() / 1000);
      b.startFrom = 'local';
      b.startEvidence = '本地记录首抽 ' + hit + ' —— 开池不晚于当日中午';
    }
  });
  return list;
}
function addDays(day, n) {
  const d = parse(day + ' 12:00');
  d.setDate(d.getDate() + n);
  return fmt(Math.floor(d.getTime() / 1000)).slice(0, 10);
}

// ── 对外：取当前 + 后续期次 ──────────────────────────────────────────────────
/**
 * @param {{records?:Array, force?:boolean, now?:string}} o
 * @returns {Promise<{ok, source, fetchedAt, stale, list, current, next, remain, note}>}
 */
async function calendar(o) {
  o = o || {};
  const nowSec = Math.floor((o.now ? parse(o.now).getTime() : Date.now()) / 1000);
  const cache = readCache();
  let list = null, source = '', fetchedAt = '', stale = false, warn = '';

  if (!o.force && cache && cache.fetchedAt && Date.now() - cache.fetchedAt < CACHE_TTL && Array.isArray(cache.banners)) {
    list = cache.banners; source = 'cache'; fetchedAt = fmt(Math.floor(cache.fetchedAt / 1000));
  } else {
    try {
      const raw = await getJSON(URL_CAL);
      list = normalize(raw);
      if (!list.length) throw new Error('日历里没有卡池数据');
      source = 'ennead'; fetchedAt = nowStr();
      writeCache({ fetchedAt: Date.now(), banners: list });
    } catch (e) {
      warn = '拉取卡池日历失败（' + e.message + '），已降级';
      if (cache && Array.isArray(cache.banners) && cache.banners.length) {
        list = cache.banners; source = 'cache'; stale = true; fetchedAt = fmt(Math.floor((cache.fetchedAt || 0) / 1000));
      } else {
        list = fromBuiltin(); source = 'builtin'; stale = true; fetchedAt = '';
      }
    }
  }

  list = fillHalf(calibrateByRecords(list.map(b => Object.assign({}, b)), o.records));

  const terms = mergeTerms(list);
  const current = list.filter(b => b.startSec <= nowSec && nowSec <= b.endSec)
    .sort((a, b) => b.endSec - a.endSec);
  const currentTerm = terms.filter(t => t.startSec <= nowSec && nowSec <= t.endSec)
    .sort((a, b) => b.endSec - a.endSec)[0] || null;
  const next = terms.filter(t => t.startSec > nowSec).sort((a, b) => a.startSec - b.startSec)[0] || null;
  const cur = currentTerm || null;

  let remain = null;
  if (cur) {
    const ms = parse(cur.end).getTime() - (o.now ? parse(o.now).getTime() : Date.now());
    remain = {
      ms: Math.max(0, ms),
      days: Math.floor(Math.max(0, ms) / 86400000),
      hours: Math.floor((Math.max(0, ms) % 86400000) / 3600000),
      text: (Math.floor(ms / 86400000) >= 0 ? Math.floor(ms / 86400000) + ' 天 ' : '') +
            Math.floor((ms % 86400000) / 3600000) + ' 小时',
      expired: ms <= 0,
    };
  }

  return {
    ok: !!cur,
    source, fetchedAt, stale, warn,
    list, terms, current, currentTerm, next, remain,
    // ⚠️ 这里**不要**写「已用本地记录校准」——校不校准由调用方（组件）按
    //    bnCalibrated 判断后自己追一句。写在这里会在同一张卡上出现两遍。
    note: '卡池起止来自第三方日历（ennead.cc），非官方接口。开池固定在中午 12:00，' +
          '结束多在凌晨 03:59。如与游戏内公告不符，以游戏内为准。',
    noteEn: 'Banner start and end come from a third-party calendar (ennead.cc), not an official endpoint. '
          + 'Banners open at 12:00 noon and mostly close at 03:59; if this disagrees with the in-game notice, the game wins.',
    origin: '数据源：api.ennead.cc/mihoyo/starrail/calendar',
  };
}

/**
 * 把本地抽卡记录的每个 gacha_id 映射到它所属的**期次** —— 顺带拿到「当期 UP 是谁」。
 * ⚠️ 这一步以前只能靠循环论证（用抽到的东西推 UP，再用 UP 判是不是歪），
 *    现在有日历直接给名单，按时间区间对齐即可。
 *
 * ⚠️ 传进来的必须是 **mergeTerms() 合并后的期次**，不能是原始 banner 列表：
 *    数据源把「角色池」和「光锥池」拆成两条并列的 banner（如 4.5 下半的 id93 只有角色、
 *    id94 只有光锥），拿 list 去 find 只会命中第一条，**UP 光锥会永远是空的**（踩过）。
 *    合并后的期次才同时带 upChars 与 upCones。
 *
 * ⚠️ 一期里可能有两组 UP（如 4.5 下半：砂金•戏浪 / 不死途），而它们起止完全相同，
 *    靠时间无法区分是哪一组 —— 但判「歪没歪」只需要「本期 UP 集合」，
 *    所以映射到**期次**而不是单条 banner 是正确的粒度。
 * @returns {Object} { gid: {version, half, start, end, upChars, upCones, first, last, n, gt, matched} }
 */
function mapGachaIds(terms, records) {
  const byGid = {};
  (records || []).forEach(r => {
    const g = String(r.gacha_id);
    if (!byGid[g]) byGid[g] = { n: 0, first: r.time, last: r.time, gt: String(r.gacha_type) };
    const b = byGid[g];
    b.n++;
    if (r.time < b.first) b.first = r.time;
    if (r.time > b.last) b.last = r.time;
  });

  const out = {};
  Object.keys(byGid).forEach(g => {
    const rec = byGid[g];
    // 活动池（11/12/21/22）才有「哪一期」的概念，常驻/新手池不参与
    const isEvent = ['11', '12', '21', '22'].indexOf(rec.gt) >= 0;
    let hit = null;
    if (isEvent && Array.isArray(terms)) {
      // ⚠️ 判据必须是**首抽日**落在期次区间内，不能写成「记录区间与期次区间有交集」——
      //    后者会把跨期的长记录错配到相邻期（踩过：4.5 上半的 2135 被下半的 banner 吃掉）。
      //    先精确匹配，落空再放宽 ±1 天（数据源的 start 可能比真实开池晚，见文件头）。
      const d = rec.first.slice(0, 10);
      const day = s => String(s).slice(0, 10);
      hit = terms.find(b => d >= day(b.start) && d <= day(b.end))
        || terms.find(b => d >= addDays(day(b.start), -1) && d <= addDays(day(b.end), 1))
        || null;
    }
    out[g] = {
      gid: g, gt: rec.gt, n: rec.n, first: rec.first, last: rec.last,
      version: hit ? hit.version : null,
      half: hit ? hit.half : null,
      label: hit ? (hit.version + (hit.half ? ' ' + hit.half : '')) : null,
      start: hit ? hit.start : null,
      end: hit ? hit.end : null,
      upChars: hit ? (hit.upChars || []) : [],
      upCones: hit ? (hit.upCones || []) : [],
      matched: !!hit,
    };
  });
  return out;
}

module.exports = { calendar, mapGachaIds, normalize, mergeTerms, calibrateByRecords, fromBuiltin, fmt, parse, addDays, CACHE_FILE, URL_CAL, BUILTIN };
