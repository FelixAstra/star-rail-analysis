// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 本地服务
//
// 为什么需要它（纯静态页做不到的两件事）：
//   ① 官方抽卡接口不带 CORS 头，浏览器里直接 fetch 会被拦 → 抓取必须走服务端代理
//   ② 浏览器写不了本地磁盘 → 数据累积、图标落盘都得服务端做
//
// 只依赖 Node 标准库，零 npm 依赖。
// ─────────────────────────────────────────────────────────────────────────────
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { analyze, loadIndex } = require('../core/analyze.js');
const store = require('./store.js');
const icons = require('./icons.js');
const external = require('../core/external.js');
const divination = require('../core/divination.js');
const zeri = require('../core/zeri.js');
const banner = require('../core/banner.js');
const { fetchAll } = require('./fetch.js');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const PORT_START = 8799;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};
const sendJSON = (res, obj, code) => send(res, code || 200, JSON.stringify(obj));

// ⚠️ 必须**先攒 Buffer、最后一次性 utf8 解码**。
//    写成 `let b=''; req.on('data', d => b += d)` 是错的：`b += d` 会把每个 chunk 各自 toString('utf8')，
//    一个中文字被 TCP 分块切开时两半都解不出来 → 变成「本地索引里没有这个名字」这种看不懂的报错。
//    之前一直没暴露，是因为走这个函数的字段（抽卡链接、totls/gold）全是 ASCII —— 只有中文名字才会踩。
const readBody = req => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', d => { n += d.length; if (n > 4e6) { req.destroy(); return reject(new Error('请求体超过 4MB')); } chunks.push(d); });
  req.on('end', () => {
    const b = Buffer.concat(chunks).toString('utf8');
    try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
  });
  req.on('error', reject);
});

// 截图上传走**原始字节**（不做 multipart/base64）：前端直接 fetch(url, {body: file}) 把 File 当 body 发。
// 为什么不用 base64 JSON：一张 1440p 截图 base64 后会膨胀 33%，且会撞上面 4MB 的 JSON 上限。
// ⚠️ 上限必须放宽 —— 手机截图单张常到 3~8MB。
const SHOT_MAX = 24 * 1024 * 1024;
const readRaw = req => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', d => { n += d.length; if (n > SHOT_MAX) { req.destroy(); return reject(new Error('图片太大（上限 ' + Math.round(SHOT_MAX / 1048576) + 'MB）')); } chunks.push(d); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// 上传的图片扩展名：按真实文件头判定，不信 Content-Type（浏览器给的常不准）
const sniffExt = buf => {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
};

// ── 抓取任务（单例：一次只跑一个，避免把 IP 打到限流）──────────────────────
let job = null;
const newJob = () => ({ id: Date.now().toString(36), running: true, logs: [], startedAt: new Date().toISOString(), result: null, error: null, phase: 'init' });
const pushLog = (j, o) => { j.logs.push(Object.assign({ t: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }, o)); if (j.logs.length > 400) j.logs.splice(0, 200); };

// ── 分析结果缓存 ────────────────────────────────────────────────────────────
// ⚠️ key 里**必须带 external.json 的 mtime**：外部统计（第三源）会改星魂/叠影，
//    只盯 records.json 的话，上传确认完截图页面不会变，看起来像「没保存成功」。
let cache = null, cacheKey = '';
const statKey = f => { try { const s = fs.statSync(path.join(ROOT, f)); return s.mtimeMs + ':' + s.size; } catch (e) { return 'none'; } };
const dataKey = () => statKey('data/records.json') + '|' + statKey('data/external.json') + '|' + statKey('data/meta.json');
function getAnalysis(force) {
  const k = dataKey();
  if (force || !cache || cacheKey !== k) { cache = analyze(); cacheKey = k; }
  return cache;
}

const ROUTES = {
  'GET /api/analysis': (req, res) => {
    const a = getAnalysis(url.parse(req.url, true).query.fresh === '1');
    sendJSON(res, a);
  },
  'GET /api/status': (req, res) => {
    const s = store.readStore();
    const meta = store.readMeta();
    const ext = store.readExternalRaw();
    sendJSON(res, {
      uid: s.uid || meta.uid || '',
      records: (s.records || []).length,
      from: (s.records || [])[0] ? s.records[0].time : '',
      to: (s.records || [])[s.records.length - 1] ? s.records[s.records.length - 1].time : '',
      updatedAt: s.updatedAt || '',
      sources: store.normSources(s.sources).slice(-8),
      meta,
      // 外部统计（第三源）的现状：页面要显示「已录入 N 条 / 上传过 N 张截图 / 最后更新时间」
      external: { items: (ext.items || []).length, shots: (ext.shots || []).length, updatedAt: ext.updatedAt || '' },
      icons: icons.iconStats(),
      node: process.version,
      job: job ? { id: job.id, running: job.running, phase: job.phase } : null,
    });
  },
  // 八卦占卜：走的是同一份分析结果（已垫抽数从 poolBounds 里取），所以口径与「抽卡分析」页永远一致
  'GET /api/divination': (req, res) => {
    const q = url.parse(req.url, true).query;
    const a = getAnalysis(q.fresh === '1');
    const gt = String(q.gt || '11');
    const cur = (q.cur === undefined || q.cur === '') ? undefined : Number(q.cur);
    const lines = (q.lines && /^[6789](,[6789]){5}$/.test(q.lines)) ? q.lines.split(',').map(Number) : undefined;
    // method：起卦法（coin 三枚铜钱 / yarrow 大衍揲蓍）—— 白名单校验，不接受任意字符串
    // upMode：保底状态（small 小保底 / big 大保底）—— 决定「出金即 UP」的概率
    const method = divination.METHODS[q.method] ? q.method : 'coin';
    const upMode = q.upMode === 'big' ? 'big' : 'small';
    try {
      sendJSON(res, divination.cast({ gt, analysis: a, cur, lines, method, upMode }));
    } catch (e) {
      sendJSON(res, { ok: false, error: String(e && e.message || e) });
    }
  },
  // 择时（吉时）：与摇卦无关，页面一进来就要能看到，所以单独一路
  // ?date=YYYY-MM-DD 可选，缺省当天；?server=1 附上本机时间（页面显示「此刻」在哪一档）
  'GET /api/zeri': (req, res) => {
    const q = url.parse(req.url, true).query;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || '')) ? String(q.date) : null;
    const now = new Date();
    const day = d || [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')].join('-');
    try {
      const r = zeri.zeri(day);
      const hh = now.getHours();
      // 此刻落在哪个时辰：0 点与 23 点都算子时，见 core/zeri.js 的口径说明
      const curZhi = zeri.HOURS[hh === 23 ? 0 : Math.floor((hh + 1) / 2)][0];
      sendJSON(res, Object.assign({ ok: true }, r, {
        now: d ? null : { at: now.toISOString(), hh, zhi: curZhi },
      }));
    } catch (e) {
      sendJSON(res, { ok: false, error: String(e && e.message || e) });
    }
  },
  'GET /api/meta': (req, res) => sendJSON(res, store.readMeta()),  'POST /api/meta': async (req, res) => {
    const body = await readBody(req);
    const next = store.writeMeta(body);
    // 补填值变了要立刻重建分析结果：缓存 key 虽然带了 meta.json 的 mtime，
    // 但同一毫秒内连续两次写会撞 key，显式 invalidate 更稳（页面点「保存并更新」必须马上看到新数）。
    getAnalysis(true);
    sendJSON(res, next);
  },
  'POST /api/fetch': async (req, res) => {
    const body = await readBody(req);
    if (job && job.running) return sendJSON(res, { error: '已有抓取任务在跑，请等它结束' }, 409);
    if (!body.link) return sendJSON(res, { error: '缺少 link 参数' }, 400);
    job = newJob();
    const j = job;
    pushLog(j, { phase: 'start', msg: '收到链接，开始抓取' });
    (async () => {
      try {
        j.phase = 'fetch';
        const r = await fetchAll(body.link, o => pushLog(j, o));
        j.phase = 'merge';
        pushLog(j, { phase: 'merge', msg: '合并进本地仓（按 id 去重，取并集不覆盖）…' });
        const merged = store.mergeRecords(r.records, { endpoint: 'getGachaLog + getLdGachaLog' });
        pushLog(j, { phase: 'merge', msg: '本次抓到 ' + r.records.length + ' 条，新增 ' + merged.added + ' 条，已有 ' + merged.dup + ' 条；本地仓合计 ' + merged.total + ' 条' });
        j.phase = 'icons';
        const meta = store.readMeta();
        let ic = { checked: 0, downloaded: [], failed: [], skipped: 0 };
        let idx = [];
        if (meta.autoFetchIcons !== false) {
          pushLog(j, { phase: 'icons', msg: '检查/更新角色与光锥图标…' });
          idx = await icons.refreshIndex(m => pushLog(j, { phase: 'icons', msg: m }));
          ic = await icons.ensureIcons(store.readStore().records, m => pushLog(j, { phase: 'icons', msg: m }));
          pushLog(j, { phase: 'icons', msg: '图标检查 ' + ic.checked + ' 项：新增 ' + ic.downloaded.length + '、已存在 ' + ic.skipped + '、失败 ' + ic.failed.length });
        } else {
          pushLog(j, { phase: 'icons', msg: '按设置跳过了图标自动更新' });
        }
        getAnalysis(true);
        j.result = { fetch: r.report, endpoints: r.endpoints, merged, icons: { checked: ic.checked, downloaded: ic.downloaded.length, failed: ic.failed, skipped: ic.skipped, index: idx } };
        j.phase = 'done';
        pushLog(j, { phase: 'done', msg: '全部完成，页面已刷新分析结果' });
      } catch (e) {
        j.error = e.message;
        j.phase = 'error';
        pushLog(j, { phase: 'error', msg: '抓取失败：' + e.message });
      } finally {
        j.running = false;
      }
    })();
    sendJSON(res, { jobId: j.id });
  },
  'GET /api/fetch/status': (req, res) => {
    const q = url.parse(req.url, true).query;
    if (!job || (q.id && q.id !== job.id)) return sendJSON(res, { idle: true });
    sendJSON(res, { id: job.id, running: job.running, phase: job.phase, logs: job.logs, result: job.result, error: job.error });
  },
  'POST /api/icons/refresh': async (req, res) => {
    const idx = await icons.refreshIndex(m => console.log(m));
    const ic = await icons.ensureIcons(store.readStore().records, m => console.log(m));
    sendJSON(res, { index: idx, icons: { checked: ic.checked, downloaded: ic.downloaded, failed: ic.failed, skipped: ic.skipped } });
  },

  // ── 外部统计（第三源）────────────────────────────────────────────────────
  // 截图上传：原始字节落盘留档，识别在**浏览器里**做（用本机图标库做模板匹配，不联网、不上传）。
  'POST /api/shots': async (req, res) => {
    const buf = await readRaw(req);
    if (!buf.length) return sendJSON(res, { error: '没收到图片数据' }, 400);
    const ext = sniffExt(buf);
    if (!ext) return sendJSON(res, { error: '这不是 PNG / JPG / WebP 图片（按文件头判定的）' }, 400);
    const shot = store.saveShot(buf, ext);
    // 留档清单写进 external.json 的 shots（不覆盖 items）
    const cur = store.readExternalRaw();
    store.writeExternal({ shots: (cur.shots || []).concat([{ file: shot.file, bytes: shot.bytes, at: new Date().toISOString() }]).slice(-40), items: cur.items || [] });
    sendJSON(res, { ok: true, file: shot.file, bytes: shot.bytes, url: '/data/uploads/' + shot.file });
  },
  'GET /api/shots': (req, res) => sendJSON(res, { shots: store.listShots() }),

  // 图标库清单：浏览器端做模板匹配要用它挨个加载本地图标。
  // 只列**本地真有有效 PNG** 的条目（匹配器拿不到图就没意义），并带上索引里的名称/命途/稀有度。
  'GET /api/iconlib': (req, res) => {
    const { CH_IDX, LC_IDX } = loadIndex();
    const pick = (idx, dir, kind) => Object.values(idx)
      .filter(v => icons.hasValidIcon(dir, v.id))
      .map(v => ({ kind, id: v.id, name: v.name, path: v.path, rarity: v.rarity, dir }))
      .sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || a.name.localeCompare(b.name));
    sendJSON(res, { ch: pick(CH_IDX, 'avatar', 'ch'), lc: pick(LC_IDX, 'light_cone', 'lc') });
  },

  'GET /api/external': (req, res) => {
    const { CH_IDX, LC_IDX } = loadIndex();
    const raw = external.readExternal();
    const { map, bad } = external.resolveExternal(CH_IDX, LC_IDX, raw);
    sendJSON(res, {
      updatedAt: raw.updatedAt || '',
      items: [...map.values()],
      bad,
      shots: raw.shots || [],
      files: store.listShots(),
    });
  },
  'POST /api/external': async (req, res) => {
    const body = await readBody(req);
    const { CH_IDX, LC_IDX } = loadIndex();
    const r = external.normalizeForWrite(body.items || [], CH_IDX, LC_IDX);
    // 有任何一行不合格就整体拒绝：半截写入会让「真值快照」变得不可信
    if (!r.ok) return sendJSON(res, { error: '有 ' + r.bad.length + ' 行没通过校验，没有写入', bad: r.bad }, 400);
    const cur = store.readExternalRaw();
    const written = store.writeExternal({ items: r.items, shots: (body.shots || cur.shots || []) });
    // 外部条目可能是「抽卡记录里根本没有」的角色/光锥 → 用显式条目补图标（ensureIcons 只认 records）
    let ic = { checked: 0, downloaded: [], failed: [], skipped: 0 };
    try { ic = await icons.ensureIconsFor(r.items, m => console.log(m)); } catch (e) { /* 图标补不上不算致命 */ }
    getAnalysis(true);   // 外部数据换了 → 立刻重建分析结果，别等缓存过期
    sendJSON(res, {
      ok: true, updatedAt: written.updatedAt, items: written.items,
      icons: { checked: ic.checked, downloaded: ic.downloaded.length, failed: ic.failed, skipped: ic.skipped },
    });
  },

  // ── 卡池日历 & 剩余期内择日 ──────────────────────────────────────────────
  // ⚠️ 卡池日历是**全平台唯一的联网点**（第三方源，非官方接口），页面其余部分完全离线。
  //    ?force=1 绕过本地缓存重拉；取不到时 core/banner.js 自动降级到内置表。
  'GET /api/banner': async (req, res) => {
    const q = url.parse(req.url, true).query;
    try {
      const recs = store.readStore().records || [];
      const r = await banner.calendar({ records: recs, force: q.force === '1' });
      // 顺带给出 gacha_id → 期次（含当期 UP 名单）的映射 —— 这是 memory 里记的
      // 「UP 推定是循环论证」那个待决项的正解：按时间区间把每个 gid 落到具体一期上，
      // 不再靠「抽到的东西」反推 UP，再用 UP 判有没有歪。
      // ⚠️ 必须传合并后的 terms，不能传 list —— 数据源把角色池与光锥池拆成两条并列 banner，
      //    用 list 匹配只会命中第一条，UP 光锥会恒为空（踩过）。
      const map = banner.mapGachaIds(r.terms, recs);
      sendJSON(res, Object.assign({ ok: true }, r, { map }));
    } catch (e) {
      sendJSON(res, { ok: false, error: String(e && e.message || e) });
    }
  },

  // 剩余卡池期内的择日榜（日家择吉）。?from=&to=YYYY-MM-DD，缺省 from = 今天。
  // 页面只传 to（= 当期卡池结束那天），保证不会越界去推荐下一期。
  'GET /api/zeri/range': (req, res) => {
    const q = url.parse(req.url, true).query;
    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')].join('-');
    const isD = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isD(q.from) ? String(q.from) : today;
    const to = isD(q.to) ? String(q.to) : from;
    try {
      sendJSON(res, Object.assign({ ok: true, today }, zeri.range(from, to)));
    } catch (e) {
      sendJSON(res, { ok: false, error: String(e && e.message || e) });
    }
  },
};

// ── 静态文件 ────────────────────────────────────────────────────────────────
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // web/ 优先（前端），其次根目录（assets/ data/）
  let file = path.join(WEB, rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, rel);
  // 防目录穿越
  if (!file.startsWith(WEB) && !file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // 前端是单页应用：未知路径回落到 index.html
    if (!path.extname(rel)) return send(res, 200, fs.readFileSync(path.join(WEB, 'index.html')), MIME['.html']);
    return send(res, 404, 'not found', 'text/plain');
  }
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.png' ? 'max-age=86400' : 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const pathname = url.parse(req.url).pathname;
  const key = req.method + ' ' + pathname;
  if (ROUTES[key]) {
    try { await ROUTES[key](req, res); }
    catch (e) { sendJSON(res, { error: e.message }, 500); }
    return;
  }
  if (pathname.startsWith('/api/')) return sendJSON(res, { error: 'no such api: ' + key }, 404);
  serveStatic(req, res, pathname);
});

function listen(port, tries) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && tries > 0) { listen(port + 1, tries - 1); }
    else { console.error('启动失败：' + e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const u = 'http://127.0.0.1:' + port + '/';
    console.log('READY ' + u);
    fs.writeFileSync(path.join(ROOT, '.port'), String(port));
  });
}

// ── 兜底：单个请求出错不该把整个服务带走 ────────────────────────────────────
// ⚠️ 这是个常驻的本地服务，Node ≥15 里**未处理的 Promise rejection 会直接 FATAL 进程**
//    （踩过：一个后台预热任务写错，/api/status 一访问整个 server 就没了，
//     浏览器侧表现成「刷新后白屏、所有资源都加载不出来」）。这里只记日志、不退出。
process.on('uncaughtException', e => console.error('[未捕获异常] 服务继续运行：' + (e && e.stack || e)));
process.on('unhandledRejection', e => console.error('[未处理 rejection] 服务继续运行：' + (e && e.stack || e)));

listen(PORT_START, 12);
