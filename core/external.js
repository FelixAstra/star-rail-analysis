// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 外部统计（第三源）
//
// 「外部统计渠道」= 除官方抽卡接口之外的、能反映账号**当前真实持有状态**的来源：
//   · 游戏内「角色 / 光锥」列表截图
//   · 星穹工坊的角色 / 光锥统计页
//   · 米游社 / HoyoLab 的抽卡统计
// 这些来源**不给抽数**，只给「有哪些角色 / 光锥、各自几命 / 叠影几」。
//
// 语义（用户 2026-09-17 确认）：**真值快照，覆盖旧值**。
//   外部统计说的是账号此刻的真实状态，比「用抽卡记录反推」更可信 → 冲突时以外部为准，
//   但要把冲突**显式报出来**（页面提示 + conflicts 输出），不能悄悄改数。
//
// ⚠️ 三条硬约束：
//   ① **绝不参与任何抽数 / 比率口径**（总抽数、出金率、每 UP、小保底不歪）。
//      它只有「命数」，没有「抽数」，掺进比率会让分母失去意义。
//   ② `v` 的语义按类型分：角色 = **星魂等级**（0~6），光锥 = **叠影等级**（1~5，1 表示只有 1 张）。
//      所以合并时角色是 `rank = v`，光锥是 `sup = v` —— 两种单位的换算别搞混。
//   ③ 名字必须能解析成 id 才生效；解析不出来的行会被 `bad` 列出来，绝不静默丢掉。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data/external.json');

const RANK_MAX = 6, SUP_MAX = 5, SUP_MIN = 1;

const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };

/** 空结构（文件不存在 / 解析失败时用，保证调用方永远拿到同一形状） */
const EMPTY = () => ({ _说明: '', updatedAt: '', shots: [], items: [] });

function readExternal() {
  const d = readJSON(FILE, null);
  if (!d || typeof d !== 'object') return EMPTY();
  return {
    _说明: d._说明 || '',
    updatedAt: d.updatedAt || '',
    shots: Array.isArray(d.shots) ? d.shots : [],
    items: Array.isArray(d.items) ? d.items : [],
  };
}

/**
 * 把 external.json 的 items 解析成「按 kind:id 索引、已校验」的一张表。
 * @param {object} CH_IDX 角色索引（id → {name, path, ...}）
 * @param {object} LC_IDX 光锥索引
 * @returns {{map: Map<string, object>, bad: Array, files: string[]}}
 *          map 的 key = `ch:1401` / `lc:23037`，value = {kind, id, name, v, at, src, score}
 */
function resolveExternal(CH_IDX, LC_IDX, raw) {
  const src = raw || readExternal();
  const byName = {
    ch: new Map(Object.values(CH_IDX || {}).map(v => [v.name, v.id])),
    lc: new Map(Object.values(LC_IDX || {}).map(v => [v.name, v.id])),
  };
  const map = new Map(), bad = [];
  for (const it of src.items) {
    const kind = it.kind === 'lc' ? 'lc' : (it.kind === 'ch' ? 'ch' : '');
    if (!kind) { bad.push({ name: it.name || '', why: 'kind 必须是 ch 或 lc' }); continue; }
    // id 优先（上传时已解析过）；没有 id 就用名字现查一次（手工编辑 external.json 的场景）
    const id = String(it.id || '') || byName[kind].get(String(it.name || '')) || '';
    const idx = kind === 'ch' ? (CH_IDX || {})[id] : (LC_IDX || {})[id];
    if (!id || !idx) { bad.push({ name: it.name || '', kind, why: '名字不在本地索引里，无法解析成 id' }); continue; }
    let v = Number(it.v);
    const lo = kind === 'ch' ? 0 : SUP_MIN, hi = kind === 'ch' ? RANK_MAX : SUP_MAX;
    if (!Number.isFinite(v)) { bad.push({ name: idx.name, kind, why: 'v 不是数字' }); continue; }
    v = Math.max(lo, Math.min(hi, Math.round(v)));
    const key = kind + ':' + id;
    // 同一 (kind,id) 出现两次时后写的赢（用户重传截图会整体覆盖，这里只是兜底）
    map.set(key, { kind, id, name: idx.name, v, at: it.at || src.updatedAt || '', src: it.src || '', score: it.score });
  }
  return { map, bad, files: src.shots.map(s => s.file).filter(Boolean), updatedAt: src.updatedAt || '', raw: src };
}

/** 供服务端写入前校验：返回 {ok, items, bad}，items 已补上解析出来的 id 与规范过的 v */
function normalizeForWrite(rows, CH_IDX, LC_IDX) {
  const byName = {
    ch: new Map(Object.values(CH_IDX || {}).map(v => [v.name, v.id])),
    lc: new Map(Object.values(LC_IDX || {}).map(v => [v.name, v.id])),
  };
  const items = [], bad = [];
  for (const r of (rows || [])) {
    const kind = r.kind === 'lc' ? 'lc' : (r.kind === 'ch' ? 'ch' : '');
    const name = String(r.name || '').trim();
    if (!kind) { bad.push({ name, why: '没选类型（角色 / 光锥）' }); continue; }
    if (!name) { bad.push({ name: '(空)', why: '名字是空的' }); continue; }
    const id = String(r.id || '') || byName[kind].get(name) || '';
    const idx = kind === 'ch' ? (CH_IDX || {})[id] : (LC_IDX || {})[id];
    if (!id || !idx) { bad.push({ name, why: '本地索引里没有这个名字（检查错别字 / 是不是还没更新索引）' }); continue; }
    let v = Number(r.v);
    if (!Number.isFinite(v)) { bad.push({ name, why: '命数 / 叠影要填数字' }); continue; }
    const lo = kind === 'ch' ? 0 : SUP_MIN, hi = kind === 'ch' ? RANK_MAX : SUP_MAX;
    if (v < lo || v > hi) { bad.push({ name, why: (kind === 'ch' ? '星魂' : '叠影') + '要在 ' + lo + '~' + hi + ' 之间' }); continue; }
    items.push({ kind, id, name: idx.name, v: Math.round(v), at: r.at || '', src: r.src || '', score: r.score });
  }
  return { ok: bad.length === 0, items, bad };
}

module.exports = { FILE, readExternal, resolveExternal, normalizeForWrite, EMPTY, RANK_MAX, SUP_MAX, SUP_MIN };
