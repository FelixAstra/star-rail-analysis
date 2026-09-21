// ─────────────────────────────────────────────────────────────────────────────
// 抽卡链接抓取 —— 6 类跃迁池全覆盖
//
// ⚠️ 三个必须记住的前提（都是实测出来的）：
//   ① 联动池（gacha_type 21/22）走的是**另一个端点 getLdGachaLog**，
//      普通 getGachaLog 对它永远返回 0 条 —— 只抓一个端点会静默漏掉整个联动池。
//   ② 官方对「超出保留期」**不报错**（retcode=0 / message=OK），只是静默返回空列表，
//      所以不能拿「list.length < size」判定到底，连续空页要退避重试再确认。
//   ③ 全量 6 池抓取 ≈200+ 请求后本机 IP 会被临时限流（表现为连接直接失败/超时，
//      而其他米哈游域名仍正常）—— 不是 authkey 失效、也不是断网，退避到 45s 量级重试即可恢复。
// ─────────────────────────────────────────────────────────────────────────────
const https = require('https');
const { POOL, LD_TYPES, NORMAL_TYPES } = require('../core/pools.js');

const PAGE_SIZE = 20;        // 官方客户端默认 20
const BASE_DELAY = 300;      // 基础翻页间隔
const MAX_PAGES = 400;
const EMPTY_LIMIT = 3;       // 连续空页达到此数才判定到底

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(url, tries = 4) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const req = https.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://webstatic.mihoyo.com/' },
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) {
            if (n < tries) setTimeout(() => attempt(n + 1), 1500 * n);
            else reject(new Error('返回内容不是 JSON（可能被风控限流）：' + buf.slice(0, 120)));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', e => {
        if (n < tries) setTimeout(() => attempt(n + 1), 1500 * n);
        else reject(e);
      });
    };
    attempt(1);
  });
}

/** 把用户链接里的抽卡端点换成对应的那个（normal → getGachaLog / ld → getLdGachaLog） */
function endpointOf(pathname, ld) {
  const target = ld ? 'getLdGachaLog' : 'getGachaLog';
  // ⚠️ 正则必须写成 get(?:Ld)?GachaLog —— 之前写成 getLd?GachaLog，
  //    那个 L 是**必需**的，于是 "getGachaLog" 根本匹配不上，
  //    联动池会被静默地按普通端点去请求（永远 0 条），而且不报错。
  if (/get(?:Ld)?GachaLog/.test(pathname)) return pathname.replace(/get(?:Ld)?GachaLog/, target);
  return pathname.replace(/\/[^/]*$/, '/' + target);
}

/** 解析用户粘贴的链接 → 公共 query（去掉游标参数，避免链接里的 end_id 把结果限制住） */
function parseLink(link) {
  const U = new URL(String(link).trim());
  const q = new URLSearchParams(U.search);
  q.delete('page'); q.delete('size'); q.delete('end_id'); q.delete('gacha_type');
  const qs = q.toString();
  return { host: U.host, pathname: U.pathname, queryBase: qs, hasAuthkey: !!q.get('authkey') };
}

/**
 * 拉一个池的全部记录（从最新一页往回翻）。
 * @param {(msg:string)=>void} log 进度回调
 */
async function fetchPool(ctx, type, log) {
  const ld = LD_TYPES.includes(type);
  const pathname = endpointOf(ctx.pathname, ld);
  const collected = [], seen = new Set();
  let endId = '0', emptyStreak = 0, pages = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const p = new URLSearchParams(ctx.queryBase);
    p.set('gacha_type', type); p.set('size', String(PAGE_SIZE));
    p.set('end_id', endId); p.set('page', '1');
    const url = 'https://' + ctx.host + pathname + '?' + p.toString();

    let res;
    try {
      res = await getJSON(url);
    } catch (e) {
      // 限流特征：连接级失败。退避到 45s 量级再试（前面几百个请求把 IP 打限流了）
      log && log({ pool: type, msg: '连接失败，疑似被限流，等待 45s 重试 —— ' + e.message });
      await sleep(45000);
      res = await getJSON(url, 2);
    }

    if (res.retcode !== 0) {
      const m = String(res.message || '');
      if (/authkey|login|expired/i.test(m) || [-101, -110, -111].includes(res.retcode)) {
        throw new Error('authkey 失效或已过期（' + res.retcode + ' ' + m + '），请重新获取抽卡链接');
      }
      throw new Error('官方接口返回 ' + res.retcode + '：' + m);
    }

    const list = (res.data && res.data.list) || [];
    pages++;
    let added = 0;
    for (const r of list) { const id = String(r.id); if (seen.has(id)) continue; seen.add(id); collected.push(r); added++; }

    if (list.length === 0) {
      if (endId === '0') break;                 // 首屏就空 → 该池确实没有记录
      if (++emptyStreak >= EMPTY_LIMIT) break;  // 连续空页 → 到底（或历史被服务端清了）
      await sleep(BASE_DELAY * Math.pow(2, emptyStreak));
      continue;
    }
    emptyStreak = 0;
    const newEnd = String(list[list.length - 1].id);
    if (newEnd === endId) break;                // 防死循环
    endId = newEnd;
    if (log && pages % 10 === 0) log({ pool: type, msg: '第 ' + pages + ' 页，累计 ' + collected.length + ' 条' });
    await sleep(BASE_DELAY);
  }

  collected.sort((a, b) => a.time.localeCompare(b.time));
  return { list: collected, pages };
}

/**
 * 抓全部 6 池。
 * @returns {Promise<{records:Array, uid:string, report:Array, endpoint:string}>}
 */
async function fetchAll(link, onProgress) {
  const ctx = parseLink(link);
  if (!ctx.hasAuthkey) throw new Error('链接里没有 authkey 参数，请重新从游戏里获取抽卡链接');
  const log = o => onProgress && onProgress(o);
  log({ phase: 'start', msg: '开始抓取 6 类跃迁池（记录多时约 1~3 分钟）' });

  const report = [], all = [];
  let normalOk = 0, ldOk = 0;

  for (const type of NORMAL_TYPES.concat(LD_TYPES)) {
    const ld = LD_TYPES.includes(type);
    log({ phase: 'pool', pool: type, name: POOL[type], msg: '正在抓 ' + POOL[type] + (ld ? '（另一个端点 getLdGachaLog）' : '') + ' …' });
    const { list, pages } = await fetchPool(ctx, type, log);
    all.push(...list);
    if (list.length) { if (ld) ldOk++; else normalOk++; }
    report.push({
      type, name: POOL[type], endpoint: ld ? 'getLdGachaLog' : 'getGachaLog',
      n: list.length, pages,
      from: list.length ? list[0].time : '', to: list.length ? list[list.length - 1].time : '',
    });
    log({ phase: 'pool-done', pool: type, name: POOL[type], n: list.length, msg: POOL[type] + ' → ' + list.length + ' 条' });
  }

  const seen = new Set(), records = [];
  for (const r of all) { const id = String(r.id); if (!seen.has(id)) { seen.add(id); records.push(r); } }
  records.sort((a, b) => a.time.localeCompare(b.time));

  const uid = (all[0] && all[0].uid) || '';
  log({ phase: 'done', msg: '抓取完成：6 池合计 ' + records.length + ' 条（普通端点 ' + normalOk + ' 池有数据 / 联动端点 ' + ldOk + ' 池有数据）' });
  return { records, uid, report, endpoints: { getGachaLog: normalOk, getLdGachaLog: ldOk } };
}

module.exports = { fetchAll, fetchPool, parseLink, endpointOf, PAGE_SIZE };
