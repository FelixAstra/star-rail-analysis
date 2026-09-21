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

/** 本地已有的图标是否**有效**（不是只看文件在不在） */
function hasValidIcon(dir, id) {
  const f = path.join(ASSETS, dir, id + '.png');
  try { return validPng(fs.readFileSync(f)); } catch (e) { return false; }
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

/** 统计本地图标库现状（给「设置 / 数据管理」页显示） */
function iconStats() {
  const count = dir => {
    const p = path.join(ASSETS, dir);
    if (!fs.existsSync(p)) return { files: 0, valid: 0 };
    const files = fs.readdirSync(p).filter(f => f.endsWith('.png'));
    return { files: files.length, valid: files.filter(f => hasValidIcon(dir, f.replace(/\.png$/, ''))).length };
  };
  const idx = f => {
    try { return Object.keys(JSON.parse(fs.readFileSync(path.join(ASSETS, 'index', f), 'utf8'))).length; } catch (e) { return 0; }
  };
  return { avatar: count('avatar'), light_cone: count('light_cone'),
           characters: idx('cn_characters.json'), light_cones: idx('cn_light_cones.json') };
}

module.exports = { ensureIcons, ensureIconsFor, refreshIndex, iconStats, hasValidIcon, validPng, BASE };
