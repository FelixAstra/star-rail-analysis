// ─────────────────────────────────────────────────────────────────────────────
// 头像 / 光锥图标自动更新（需求 5：每次分析抽卡数据都会自动更新当期的角色头像和光锥）
//
// 资源来自公开的角色资源库 Mar-7th/StarRailRes（图片本身是米哈游的，这里只做本地缓存）：
//   · 索引 index_min/cn/{characters,light_cones}.json —— 名称 / 命途 / 稀有度
//   · 图标 icon/avatar/{id}.png        —— 角色头像（128px 圆）
//   · 图标 icon/light_cone/{id}.png    —— 光锥图标（方形，展示时圆角方，别硬裁圆）
//
// ⚠️ 校验图标必须读 **PNG 魔数 + 字节数下限**，
//    不能只数个数或按 *.png 过滤 —— 曾经因为「文件存在但内容是 404 页面」而假通过。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const BASE = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_BYTES = 512;   // 正常图标都远大于这个值；太小说明下到的是错误页

function download(url, tries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      https.get(url, { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return download(res.headers.location, tries).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return n < tries ? setTimeout(() => attempt(n + 1), 800 * n) : reject(new Error('HTTP ' + res.statusCode + ' ' + url));
        }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', e => (n < tries ? setTimeout(() => attempt(n + 1), 800 * n) : reject(e)));
    };
    attempt(1);
  });
}

/** 真正的 PNG 校验：魔数 + 字节数下限 */
function validPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= MIN_BYTES && buf.slice(0, 8).equals(PNG_MAGIC);
}

// ⚠️⚠️ 本机沙箱下 open() 极贵（实测 145 次 open+read8 = 7.5 秒），statSync/readdir 几乎免费（1ms）。
//      所以校验结果必须按 (mtime, size) 记在内存里，**绝不在每次接口调用时重新 open 一遍** ——
//      否则 /api/status 会卡十几秒，浏览器 6 条连接被占满，连刷新页面都会卡住。
const vCache = new Map();      // 绝对路径 -> { k:'mtime:size', ok:bool }

/** 单个文件是否有效 PNG（statSync 便宜 → 缓存命中就 0 I/O；未命中才读 8 字节魔数） */
function validPngFile(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile() || st.size < MIN_BYTES) return false;
  const k = st.mtimeMs + ':' + st.size;
  const hit = vCache.get(file);
  if (hit && hit.k === k) return hit.ok;
  let ok = false;
  try {
    const fd = fs.openSync(file, 'r');
    try { const h = Buffer.alloc(8); ok = fs.readSync(fd, h, 0, 8, 0) === 8 && h.equals(PNG_MAGIC); }
    finally { fs.closeSync(fd); }
  } catch (e) { ok = false; }
  vCache.set(file, { k, ok });
  return ok;
}

/** 本地已有的图标是否**有效**（不是只看文件在不在） */
function hasValidIcon(dir, id) {
  return validPngFile(path.join(ASSETS, dir, id + '.png'));
}

/** 更新名称/命途索引（新版本上线的新角色、新光锥靠它才能显示名字与命途） */
async function refreshIndex(onLog) {
  // ⚠️ 必须先建目录：仓库里不带 assets/（版权 + 体积），刚克隆下来 assets/index 是不存在的，
  //    直接 writeFileSync 会 ENOENT 被 catch 吞掉，表现成「索引更新失败」而其实是没目录。
  ensureAssetDirs();
  const out = [];
  for (const [remote, local] of [['index_min/cn/characters.json', 'cn_characters.json'],
                                 ['index_min/cn/light_cones.json', 'cn_light_cones.json']]) {
    try {
      const buf = await download(BASE + '/' + remote);
      const j = JSON.parse(buf.toString('utf8'));
      const n = Object.keys(j).length;
      fs.writeFileSync(path.join(ASSETS, 'index', local), JSON.stringify(j));
      out.push({ file: local, n, ok: true });
      onLog && onLog('索引已更新 ' + local + '（' + n + ' 条）');
    } catch (e) {
      out.push({ file: local, ok: false, err: e.message });
      onLog && onLog('索引更新失败 ' + local + '：' + e.message);
    }
  }
  return out;
}

function ensureAssetDirs() {
  for (const d of ['avatar', 'light_cone', 'index']) {
    const p = path.join(ASSETS, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

/** 把一批 { dir, id, name } 里缺的图标下下来（ensureIcons / ensureIconsFor 共用的干活部分） */
async function ensureWant(want, onLog) {
  const downloaded = [], failed = [];
  let skipped = 0;
  for (const { dir, id, name } of want.values()) {
    if (hasValidIcon(dir, id)) { skipped++; continue; }
    try {
      const buf = await download(BASE + '/icon/' + dir + '/' + id + '.png');
      if (!validPng(buf)) throw new Error('下到的不是有效 PNG（' + buf.length + ' 字节）');
      fs.writeFileSync(path.join(ASSETS, dir, id + '.png'), buf);
      downloaded.push({ dir, id, name, bytes: buf.length });
      onLog && onLog('已下载图标 ' + dir + '/' + id + '.png（' + name + '，' + buf.length + ' 字节）');
    } catch (e) {
      failed.push({ dir, id, name, err: e.message });
      onLog && onLog('图标下载失败 ' + dir + '/' + id + '（' + name + '）：' + e.message);
    }
  }
  return { checked: want.size, downloaded, failed, skipped };
}

/**
 * 确保这批记录里用到的图标都在本地；缺的立刻下载。
 * @param {Array} records 抽卡记录
 * @returns {Promise<{checked:number, downloaded:Array, failed:Array, skipped:number}>}
 */
async function ensureIcons(records, onLog) {
  ensureAssetDirs();
  // 先从记录里收集 (目录, id, 名字) —— 目录由记录自带的 item_type 决定，比按池判断更可靠
  const want = new Map();
  for (const r of records) {
    const dir = r.item_type === '光锥' ? 'light_cone' : 'avatar';
    if (r.item_id) want.set(dir + '/' + r.item_id, { dir, id: r.item_id, name: r.name });
  }
  return ensureWant(want, onLog);
}

/**
 * 给「外部统计」确认表里的一批条目补齐图标。
 * ⚠️ 这些条目**不在抽卡记录里**（正是「抽卡记录没有、外部统计才有」的那部分），
 *    所以不能走 ensureIcons（它只认 records 的 item_type/item_id），必须显式给目录 + id。
 * @param {Array<{kind:'ch'|'lc', id:string, name:string}>} entries
 */
async function ensureIconsFor(entries, onLog) {
  ensureAssetDirs();
  const want = new Map();
  for (const e of (entries || [])) {
    const dir = e.kind === 'lc' ? 'light_cone' : 'avatar';
    const id = String(e.id || '');
    if (id) want.set(dir + '/' + id, { dir, id, name: e.name });
  }
  return ensureWant(want, onLog);
}

/** 后台把「每个图标是否有效」补齐（异步，不阻塞事件循环）
 *  ⚠️⚠️ 这是**后台任务**，绝不能因为异常把整个服务带走：
 *      Node ≥15 里未处理的 Promise rejection 会直接 FATAL 掉进程
 *      （踩过：jobs 里推的是 Promise 不是函数 → 一调用就崩整个 server）。
 *      所以这里①推的是「函数」不是「已执行的 Promise」，②整体再包一层 catch。 */
let warmTask = null;
function warmValidity() {
  if (warmTask) return warmTask;
  warmTask = (async () => {
    const jobs = [];
    for (const d of ['avatar', 'light_cone']) {
      let files = [];
      try { files = fs.readdirSync(path.join(ASSETS, d)); } catch (e) { continue; }
      for (const f of files) {
        if (!f.endsWith('.png')) continue;
        const file = path.join(ASSETS, d, f);
        let st;
        try { st = fs.statSync(file); } catch (e) { continue; }
        const k = st.mtimeMs + ':' + st.size;
        if (st.size < MIN_BYTES) { vCache.set(file, { k, ok: false }); continue; }
        const hit = vCache.get(file);
        if (hit && hit.k === k) continue;
        jobs.push(async () => {
          let ok = false, fh = null;
          try {
            fh = await fs.promises.open(file, 'r');
            const h = Buffer.alloc(8);
            const r = await fh.read(h, 0, 8, 0);
            ok = r.bytesRead === 8 && h.equals(PNG_MAGIC);
          } catch (e) { ok = false; } finally { if (fh) await fh.close().catch(() => {}); }
          vCache.set(file, { k, ok });
        });
      }
    }
    // ⚠️ **串行 + 间隔**：本机沙箱的文件 I/O 会互相抢锁，并发预热会把同时到达的
    //    /api/status 拖到 5 秒以上（实测）。这里只求「后台慢慢补齐」，不抢请求的路。
    for (const job of jobs) {
      try { await job(); } catch (e) { /* 单个文件失败不影响整体 */ }
      await new Promise(r => setTimeout(r, 80));
    }
  })().catch(e => { console.log('图标校验预热失败（不影响功能）：' + (e && e.message)); });
  return warmTask;
}

/** 统计本地图标库现状（给「设置 / 数据管理」页显示）
 *  ⚠️ 这个接口会被页面频繁调用，所以**只能做便宜的 I/O**：readdir + statSync。
 *     没预热到的文件先按「字节数够大」计入有效，同时起异步预热；预热完再访问就是精确值。 */
const idxCache = new Map();    // index json -> { k:'mtime:size', n:int }
function iconStats() {
  warmValidity();
  const count = dir => {
    const p = path.join(ASSETS, dir);
    let files = [];
    try { files = fs.readdirSync(p).filter(f => f.endsWith('.png')); } catch (e) { return { files: 0, valid: 0 }; }
    let valid = 0;
    for (const f of files) {
      const file = path.join(p, f);
      let st;
      try { st = fs.statSync(file); } catch (e) { continue; }
      if (!st.isFile() || st.size < MIN_BYTES) continue;
      const k = st.mtimeMs + ':' + st.size;
      const hit = vCache.get(file);
      if (hit && hit.k === k) { if (hit.ok) valid++; }
      else valid++;                       // 还没预热到 → 先按大小计入，预热完就精确了
    }
    return { files: files.length, valid };
  };
  const idx = f => {
    const file = path.join(ASSETS, 'index', f);
    let st;
    try { st = fs.statSync(file); } catch (e) { return 0; }
    const k = st.mtimeMs + ':' + st.size;
    const hit = idxCache.get(file);
    if (hit && hit.k === k) return hit.n;
    let n = 0;
    try { n = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).length; } catch (e) { n = 0; }
    idxCache.set(file, { k, n });
    return n;
  };
  return { avatar: count('avatar'), light_cone: count('light_cone'),
           characters: idx('cn_characters.json'), light_cones: idx('cn_light_cones.json') };
}

module.exports = { ensureIcons, ensureIconsFor, refreshIndex, iconStats, hasValidIcon, validPng, BASE };
