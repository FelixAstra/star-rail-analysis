// ─────────────────────────────────────────────────────────────────────────────
// 本地数据仓 —— 持续累积同步
//
// 核心口径：**取并集，不覆盖**。
// 官方接口只保留约 1 年的**滑动窗口**，每重新抓一次都会「进来新的一批、挤掉最老的一批」，
// 只留最新那份会把窗口左端那几天丢掉 —— 所以每次抓取都按 id 去重合并进 records.json，
// 原始快照另存到 data/snapshots/，方便回溯「这条是哪次抓来的」。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const RECORDS = path.join(DATA, 'records.json');
const SNAPS = path.join(DATA, 'snapshots');
const KEEP = ['id', 'uid', 'gacha_type', 'item_id', 'count', 'time', 'name', 'lang', 'item_type', 'rank_type', 'gacha_id'];

const ensureDirs = () => {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(SNAPS)) fs.mkdirSync(SNAPS, { recursive: true });
};

function readStore() {
  try { return JSON.parse(fs.readFileSync(RECORDS, 'utf8')); }
  catch (e) { return { uid: '', updatedAt: '', sources: [], records: [] }; }
}

/**
 * 把 sources 统一成规范形状 { at, endpoint, incoming, added }。
 * ⚠️ 兼容早期手工导入的数据（那时用的是 { file, n, from, to }）——
 *    前端表格直接读 s.at.slice()，字段缺一个就是整页渲染报错，所以在这里收口。
 */
function normSources(arr) {
  return (arr || []).map(s => ({
    at: s.at || s.importedAt || '',
    endpoint: s.endpoint || s.file || 'import',
    incoming: s.incoming != null ? s.incoming : (s.n != null ? s.n : 0),
    added: s.added != null ? s.added : 0,
    from: s.from || '', to: s.to || '',
  }));
}

const norm = r => {
  const o = {};
  KEEP.forEach(k => { if (r[k] !== undefined && r[k] !== null) o[k] = String(r[k]); });
  return o;
};

/**
 * 把新抓到的记录合并进本地仓（按 id 去重），返回统计。
 * @param {Array} incoming 新记录（原始接口字段）
 * @param {{endpoint?:string, label?:string}} info
 */
function mergeRecords(incoming, info) {
  ensureDirs();
  const store = readStore();
  const seen = new Set((store.records || []).map(r => String(r.id)));
  const added = [];
  for (const r of incoming) {
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    added.push(norm(r));
  }
  const records = (store.records || []).concat(added).sort((a, b) => a.time.localeCompare(b.time));
  const out = {
    uid: (added[0] && added[0].uid) || store.uid || '',
    updatedAt: new Date().toISOString(),
    sources: (store.sources || []).concat([{
      at: new Date().toISOString(), endpoint: (info && info.endpoint) || 'getGachaLog',
      incoming: incoming.length, added: added.length,
    }]).slice(-40),
    records,
  };
  fs.writeFileSync(RECORDS, JSON.stringify(out));

  // 原始快照留档（按时间排序，便于事后核对「这条是哪次抓的」）
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(SNAPS, 'snap-' + stamp + '.json'), JSON.stringify({
    at: new Date().toISOString(), endpoint: (info && info.endpoint) || '', records: incoming,
  }));

  return { total: records.length, added: added.length, dup: incoming.length - added.length,
           from: records.length ? records[0].time : '', to: records.length ? records[records.length - 1].time : '' };
}

function readMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8')); } catch (e) { return {}; }
}
function writeMeta(patch) {
  const cur = readMeta();
  const next = Object.assign({}, cur, patch);
  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(next, null, 2) + '\n');
  return next;
}

// ── 外部统计（第三源）与截图留档 ─────────────────────────────────────────────
// 结构与读取规则统一收在 core/external.js，这里只管落盘。
const UPLOADS = path.join(DATA, 'uploads');
const EXT = path.join(DATA, 'external.json');

function readExternalRaw() {
  try { return JSON.parse(fs.readFileSync(EXT, 'utf8')); } catch (e) { return { shots: [], items: [] }; }
}

/**
 * 覆盖写外部统计。
 * ⚠️ 是**整体覆盖**不是追加：这份数据代表「账号当前真实持有状态」的一份快照，
 *    重传一张更全的截图就应该把旧的顶掉，否则会残留已经不对的命数。
 * @param {{items:Array, shots:Array}} next
 */
function writeExternal(next) {
  ensureDirs();
  const prev = readExternalRaw();
  const out = {};
  // 把 _说明* 之类的注释键原样带过去，别把给下次动手看的说明洗掉
  Object.keys(prev).forEach(k => { if (/^_/.test(k)) out[k] = prev[k]; });
  out.updatedAt = new Date().toISOString();
  out.shots = Array.isArray(next.shots) ? next.shots : [];
  out.items = Array.isArray(next.items) ? next.items : [];
  fs.writeFileSync(EXT, JSON.stringify(out, null, 2) + '\n');
  return out;
}

/** 把上传的截图原图落盘留档，返回 { file, bytes }。文件名带时间戳 + 随机后缀，避免覆盖。 */
function saveShot(buf, ext) {
  if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  const file = stamp + '-' + rand + (ext || '.png');
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return { file, bytes: buf.length };
}

/** 上传过哪些截图（按时间倒序） */
function listShots() {
  if (!fs.existsSync(UPLOADS)) return [];
  return fs.readdirSync(UPLOADS)
    .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
    .map(f => { const s = fs.statSync(path.join(UPLOADS, f)); return { file: f, bytes: s.size, at: new Date(s.mtimeMs).toISOString() }; })
    .sort((a, b) => b.file.localeCompare(a.file));
}

module.exports = { readStore, mergeRecords, readMeta, writeMeta, normSources, readExternalRaw, writeExternal, saveShot, listShots, ROOT, DATA, UPLOADS };

