// ─────────────────────────────────────────────────────────────────────────────
// 生成 core/gua-data.js —— 《周易》六十四卦文本数据
//
// 为什么要有这个脚本：384 条爻辞绝不能手打（必然出错），也不能只信一份数据源
// （我实测三份源各有错字）。所以从三个**互相独立**的开源数据集取文，做归一化后
// **多数票定稿**，个别依通行本人工定夺，并把所有异文留档供页面标注。
//
// 用法：node tools/build-gua-data.js           （首次会联网下载数据源）
//      node tools/build-gua-data.js --offline （只用缓存，不联网）
//
// 数据源（均为公开开源，周易原文属公有领域）：
//   A  shaoyu12138/CodeLabyrinth  assets/64_Gua_Data.json     人工校对版
//   B  Jason-W507/I_Ching_Divination web/src/data/gua_yao_ci.json
//   C  john-walks-slow/open-iching     iching/iching.json
//   +  BYVoid/OpenCC TSCharacters.txt （繁→简单字表，Apache-2.0，仅用于比对）
//
// ⚠️ 三份源的六位二进制方向不一致：A、B 是「上→初」写的，C 是「初→上」。
//    不统一方向会得到「56/64 卦辞不一致」的假结论。本脚本统一为 初→上、阳=1。
// ⚠️ A、B 的爻辞带「初九：」这类爻名前缀，不去掉会得到「384 条全不一致」的假结论。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache-yi');
const OFFLINE = process.argv.includes('--offline');

const SRC = {
  A: ['https://raw.githubusercontent.com/shaoyu12138/CodeLabyrinth/main/assets/64_Gua_Data.json', 'A.json'],
  B: ['https://raw.githubusercontent.com/Jason-W507/I_Ching_Divination/main/web/src/data/gua_yao_ci.json', 'B.json'],
  C: ['https://raw.githubusercontent.com/john-walks-slow/open-iching/main/iching/iching.json', 'C.json'],
  // 小象传（逐爻解释爻辞）+ 大象传，键形如 iching__<卦序> 与 iching__<卦序>_<爻位>
  X: ['https://raw.githubusercontent.com/Mazeye/open-iching/main/ichuan/xiang.json', 'X.json'],
  // 384 爻吉/中/凶标签（判词关键词机械抽取，非预测 —— 见 Labels 段说明）
  LB: ['https://raw.githubusercontent.com/muyen/decoding-iching/main/data/analysis/corrected_yaoci_labels.json', 'LB.json'],
  TS: ['https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt', 'TS.txt'],
};

fs.mkdirSync(CACHE, { recursive: true });
for (const [id, [url, file]] of Object.entries(SRC)) {
  const dst = path.join(CACHE, file);
  if (fs.existsSync(dst) && fs.statSync(dst).size > 100) continue;
  if (OFFLINE) { console.error(`✗ --offline 但缓存缺 ${file}`); process.exit(1); }
  console.log(`· 下载 ${id} …`);
  // 本机 git/curl 都被全局 socks5 代理影响，用 node 直连并显式禁用代理
  const code = [
    "const https=require('https'),fs=require('fs');",
    `const url=${JSON.stringify(url)},dst=${JSON.stringify(dst)};`,
    "const f=fs.createWriteStream(dst);",
    "https.get(url,{headers:{'User-Agent':'node'}},r=>{",
    "  if(r.statusCode!==200){console.error('HTTP '+r.statusCode);process.exit(1);}",
    "  r.pipe(f);f.on('finish',()=>f.close(()=>process.exit(0)));",
    "}).on('error',e=>{console.error(e.message);process.exit(1);});",
  ].join('');
  try { execFileSync(process.execPath, ['-e', code], { stdio: 'inherit', env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '*' } }); }
  catch (e) { console.error(`✗ ${id} 下载失败（需联网一次）`); process.exit(1); }
}

const rd = f => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
const A = rd('A.json'), B = rd('B.json'), C = rd('C.json');

// ── 繁→简单字表（仅用于比对，不参与定稿选文）──────────────────────────────
const TS = new Map();
fs.readFileSync(path.join(CACHE, 'TS.txt'), 'utf8').split('\n').forEach(l => {
  if (!l || l[0] === '#') return;
  const [k, v] = l.split('\t');
  if (k && v) TS.set(k, v.trim().split(/\s+/)[0]);
});

const rev = s => [...s].reverse().join('');
const YAO_PREFIX = /^[初上九六用][九六二三四五][，,：:]\s*/;
const GUA_PREFIX = /^[\u4e00-\u9fa5]{1,4}[：:]\s*/;
const PUNC = /[\s，。：；、！？（）()「」『』《》〈〉·・—–\-－,.:;!?"'“”‘’〜~…]/g;
const toSC = s => [...s].map(c => TS.get(c) || c).join('');
const norm = (s, isGua) => toSC(String(s == null ? '' : s)
  .replace(isGua ? GUA_PREFIX : YAO_PREFIX, '')
  .replace(PUNC, '')
  .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)));

// ── 三份源统一成 初→上 / 阳=1 的 key ───────────────────────────────────────
const maps = { A: new Map(), B: new Map(), C: new Map() };
A.forEach(g => maps.A.set([...rev(g['6_BIT'])].map(b => (b === '0' ? '1' : '0')).join(''),
  { full: g['六十四卦名'], ci: g['卦辞'], yao: (g['爻辞'] || []).slice(0, 6), yong: (g['爻辞'] || [])[6] || null,
    tuan: g['彖传'], xiang: g['大象'], shang: g['上卦'], xia: g['下卦'],
    xiaoxiang: (g['小象'] || []).slice(0, 6), xiaoxiangYong: (g['小象'] || [])[6] || null,
    za: g['杂卦'] || null, no: g['ID'] + 1 }));
Object.entries(B).forEach(([k, v]) => maps.B.set(rev(k),
  { full: v.name_cn, ci: v.gua_ci, yao: (v.yao_ci || []).slice(0, 6), yong: (v.yao_ci || [])[6] || null,
    tuan: v.tuan_ci, xiang: v.da_xiang_ci, shang: null, xia: null }));
C.forEach(g => maps.C.set(g.array.join(''),
  { full: g.name, ci: g.scripture, yao: g.lines.map(l => l.scripture), yong: null,
    tuan: null, xiang: null, shang: g.combination[1], xia: g.combination[0], no: g.id }));

// ── 小象传 · 大象传（源 X）──────────────────────────────────────────────────
// 键形如：iching__<卦序> = 大象；iching__<卦序>_<爻位 1..6> = 小象（1 = 初爻）。
const XRAW = rd('X.json');
const XX = {};                 // no → [初..上] 六条小象
let xxCount = 0, dxCount = 0;
Object.keys(XRAW).forEach(k => {
  const m = /^iching__(\d+)_(\d+)$/.exec(k);
  if (m) {
    const no = +m[1], pos = +m[2];
    if (pos >= 1 && pos <= 6) { (XX[no] = XX[no] || [])[pos - 1] = XRAW[k]; xxCount++; }
    return;
  }
  const m2 = /^iching__(\d+)$/.exec(k);
  if (m2) dxCount++;
});

// ── 384 爻吉/中/凶标签（源 LB）─────────────────────────────────────────────
// ⚠️ 该字段是**从爻辞判词机械抽取**出来的（label 1 吉 / 0 中 / −1 凶），
//    抽取方自己在 README 里注明「用判词预测标签就是循环论证」。
//    所以本平台**只把它当阅读提示**，绝不参与概率、绝不参与任何预测 —— 页面会写明。
// ⚠️ 源是繁体，比对前必须过 toSC。
const LBL = {};                // `<no>:<pos>` → {label, ji, xiong, kw}
let lbCount = 0;
const LBARR = rd('LB.json');
LBARR.forEach(x => {
  LBL[x.hex_num + ':' + x.position] = {
    label: x.label,
    ji: x.ji_score || 0,
    xiong: x.xiong_score || 0,
    kw: [].concat(x.ji_keywords || [], x.xiong_keywords || []).map(toSC),
  };
  lbCount++;
});

// ── 八卦（三爻，自下而上）：用于反推上下卦名 + 做构建期断言 ──────────────────
const TRI = { '111': '乾', '110': '兑', '101': '离', '100': '震', '011': '巽', '010': '坎', '001': '艮', '000': '坤' };
const TRI_IMG = { 乾: '天', 兑: '泽', 离: '火', 震: '雷', 巽: '风', 坎: '水', 艮: '山', 坤: '地' };
const YAO_POS = ['初', '二', '三', '四', '五', '上'];
const yaoName = (yang, i) => (i === 0 || i === 5)
  ? YAO_POS[i] + (yang ? '九' : '六')
  : (yang ? '九' : '六') + YAO_POS[i];

// ── 个别依通行本人工定夺（多数票会跟着两份源一起错的地方）───────────────────
// 键 = `<key>:<字段>`；字段 ci = 卦辞，y0..y5 = 对应爻。仅在下列已知处生效。
// ⚠️ 这里是最容易把「改哪个卦」写错的地方 —— 曾把大有上九的 key 写成 101111（同人），
//    于是同人上九的爻辞被替成了「自天祐之，吉无不利」（三源原文本来是「同人于郊，无悔」）。
//    这种错不会让任何别的断言失败（文本照样有值、照样通顺），只能靠构建期的
//    OVERRIDE 对位断言拦住，见下方 `assertOverride` 段。
const OVERRIDE = {
  '111101:y5': ['自天祐之，吉无不利。', '通行本作「祐」（两份源作「佑」）'],
  '101111:y4': ['同人，先号咷而后笑，大师克相遇。', '通行本作「咷」（两份源作「啕」）—— 这一条是**同人九五**'],
  '100000:y0': ['不远复，无祗悔，元吉。', '通行本作「祗」（三源互异：祇/袛/祗）'],
  '011111:y0': ['系于金柅，贞吉。有攸往，见凶。羸豕孚蹢躅。', '三源互异：蹢躅/踟躅/踯躅，取通行本「蹢躅」'],
  '101100:y2': ['丰其沛，日中见沫。折其右肱，无咎。', '三源互异：沫/昧/沬，取通行本「沫」'],
  '111110:ci': ['扬于王庭，孚号有厉。告自邑，不利即戎，利有攸往。', 'A 多一「吉」字，从 B/C'],
  '101110:ci': ['己日乃孚，元亨利贞，悔亡。', '「己/巳」之争，通行本作「己」'],
};

// ── 多数票定稿 ─────────────────────────────────────────────────────────────
// 优先级仅用于「已属多数派」的几份源之间挑原始文本（保留标点）：C > A > B
const PRIORITY = ['C', 'A', 'B'];
function vote(field, getter, isGua) {
  const items = PRIORITY.map(id => {
    const o = getter(maps[id].get(K));
    return { id, orig: o == null ? '' : String(o), n: o == null ? null : norm(o, isGua) };
  }).filter(x => x.n);
  if (!items.length) return null;
  const groups = new Map();
  items.forEach(s => { const g = groups.get(s.n) || []; g.push(s); groups.set(s.n, g); });
  let best = null;
  for (const g of groups.values()) if (!best || g.length > best.length) best = g;
  // 剥掉爻名/卦名前缀，保留标点
  const raw = best[0].orig.replace(isGua ? GUA_PREFIX : YAO_PREFIX, '').trim();
  return {
    text: raw,
    unanimous: groups.size === 1,
    distinct: groups.size,
    variants: groups.size > 1 ? items.map(s => `${s.id}: ${String(s.orig).replace(isGua ? GUA_PREFIX : YAO_PREFIX, '').trim()}`) : null,
  };
}

let K = null;
const stats = {
  ciAll: 0, ciSome: 0, yaoAll: 0, yaoSome: 0, yaoThree: 0, override: 0,
  xxOk: 0, xxDiff: 0, xxDiffList: [], lbOk: 0, lbMiss: [], xxFrom: { X: 0, A: 0 },
  dxDiff: 0, dxDiffList: [], ovTrace: [],
  warn: [],
};
// 剥掉《象传》文本里的引号。
// 源 X 把「被解释的那句爻辞」用引号括起来（`“潜龙，勿用”，阳在下也。`），
// 但有的条目只写了开引号 —— 只剥首尾会留下半截引号（`勿用”，阳在下也`），
// 所以先试剥成对的最外层，再清掉任何落单引号。
const stripQ = s => String(s).trim()
  .replace(/^[“"「]([\s\S]*)[”"」]$/, '$1')
  .replace(/[“"「”"」]/g, '')
  .trim();
const GUA = [...maps.C.keys()].map(k => {
  K = k;
  const c = maps.C.get(k), a = maps.A.get(k);
  const xia = TRI[k.slice(0, 3)], shang = TRI[k.slice(3)];
  if (!xia || !shang) stats.warn.push(`key ${k} 八卦解析失败`);
  // 别名：纯卦作「乾为天」，其余作「上卦象+下卦象+单字名」（如 上坎下震 → 水雷屯）
  const full = xia === shang ? `${xia}为${TRI_IMG[xia]}` : `${TRI_IMG[shang]}${TRI_IMG[xia]}${c.full}`;
  const aFull = a ? a.full : '';
  if (aFull && aFull !== full) stats.warn.push(`第${c.no}卦 别名不符：本脚本「${full}」 vs A「${aFull}」`);

  const vCi = vote('ci', m => m.ci, true);
  let ci = vCi ? vCi.text : '';
  if (vCi && vCi.unanimous) stats.ciAll++; else stats.ciSome++;

  const yao = [];
  for (let i = 0; i < 6; i++) {
    const v = vote('y' + i, m => m.yao[i], false);
    const yang = k[i] === '1';
    const name = yaoName(yang, i);
    let text = v ? v.text : '';
    if (v && v.unanimous) stats.yaoAll++;
    else { stats.yaoSome++; if (v && v.distinct === 3) stats.yaoThree++; }
    // 构建期断言：算出来的爻名应与 A 自带的爻名一致（A 是带前缀的）
    const aRaw = a && a.yao[i] ? String(a.yao[i]) : '';
    const aName = (aRaw.match(/^[初上九六用][九六二三四五]/) || [''])[0];
    if (aName && aName !== name) stats.warn.push(`第${c.no}卦 ${name} 爻名不符：A 作「${aName}」`);
    const ov = OVERRIDE[`${k}:y${i}`];
    const item = { name, ci: text };
    if (ov) {
      stats.ovTrace.push({ key: k, field: 'y' + i, no: c.no, name: c.full, yao: name, before: text, after: ov[0] });
      item.ci = ov[0]; item.note = ov[1]; stats.override++;
    }
    if (v && v.variants) { item.variants = v.variants; item.distinct = v.distinct; }

    // —— 小象传：解释这一爻爻辞的原典（源 X 优先，源 A 兜底）——
    // 两源都有又不一致时**不判谁对**，把两条都留下，页面上标出来（与卦辞/爻辞同一套诚实口径）
    const xxX = (XX[c.no] || [])[i] || null;
    const xxA = (a && a.xiaoxiang) ? a.xiaoxiang[i] : null;
    if (xxX) { item.xiang = stripQ(xxX); stats.xxFrom.X++; }
    else if (xxA) { item.xiang = stripQ(xxA); stats.xxFrom.A++; }
    if (xxX) stats.xxOk++;
    if (xxX && xxA && norm(xxX) !== norm(xxA)) {
      stats.xxDiff++;
      item.xiangVariants = ['X: ' + stripQ(xxX), 'A: ' + stripQ(xxA)];
    }

    // —— 吉/中/凶标签：**阅读提示**，不参与概率（见文件头 LB 段说明）——
    const lb = LBL[c.no + ':' + (i + 1)];
    if (lb) { item.luck = lb; stats.lbOk++; } else stats.lbMiss.push(c.no + ':' + (i + 1));

    yao.push(item);
  }
  const ovCi = OVERRIDE[`${k}:ci`];
  if (ovCi) {
    stats.ovTrace.push({ key: k, field: 'ci', no: c.no, name: c.full, yao: '卦辞', before: ci, after: ovCi[0] });
    ci = ovCi[0];
    stats.override++;
  }

  // 用九 / 用六（仅乾坤）
  let yong = null;
  if (a && a.yong) {
    const t = String(a.yong).replace(YAO_PREFIX, '').trim();
    const nm = (String(a.yong).match(/^用[九六]/) || [''])[0];
    if (t) {
      yong = { name: nm, ci: t };
      if (a.xiaoxiangYong) yong.xiang = stripQ(a.xiaoxiangYong);
    }
  }

  // 大象传交叉核对：源 A 的「大象」与源 X 的 iching__<卦序> 应逐字一致。
  // 不一致不判谁对，两条都留档（页面上标出来）。
  const dxX = XRAW['iching__' + c.no] || null;
  const dxA = a ? a.xiang : null;
  const dxDiff = !!(dxX && dxA && norm(dxX) !== norm(dxA));
  if (dxDiff) { stats.dxDiff++; stats.dxDiffList.push({ no: c.no, full, X: dxX, A: dxA }); }

  return {
    no: c.no, key: k, name: c.full, xia, shang, full,
    ci, tuan: a ? a.tuan : null,
    xiang: dxA || dxX || null,
    xiangFrom: dxA ? 'A' : (dxX ? 'X' : null),
    xiangDiff: dxDiff ? { X: dxX, A: dxA } : undefined,
    za: a && a.za ? String(a.za).trim() : null,   // 杂卦传：一卦一辞的提要
    yao, yong,
  };
});

// ── 断言：数据完整性 ───────────────────────────────────────────────────────
const errs = [];
if (GUA.length !== 64) errs.push(`卦数 ${GUA.length} ≠ 64`);
if (new Set(GUA.map(g => g.key)).size !== 64) errs.push('key 有重复');
GUA.forEach(g => {
  if (g.yao.length !== 6) errs.push(`第${g.no}卦 爻数 ${g.yao.length} ≠ 6`);
  if (!g.ci) errs.push(`第${g.no}卦 缺卦辞`);
  g.yao.forEach((y, i) => { if (!y.ci) errs.push(`第${g.no}卦 第${i + 1}爻 缺爻辞`); });
});
const nos = GUA.map(g => g.no).sort((x, y) => x - y);
if (nos.join() !== [...Array(64)].map((_, i) => i + 1).join()) errs.push('卦序不是 1..64');

// —— 新增数据的完整性（缺一处就整段渲染不出来，宁可构建失败）——
let xxMiss = 0, lbMissN = 0;
GUA.forEach(g => {
  if (!g.xiang) errs.push(`第${g.no}卦 缺大象传`);
  g.yao.forEach((y, i) => {
    if (!y.xiang) { xxMiss++; errs.push(`第${g.no}卦 第${i + 1}爻 缺小象传`); }
    if (!y.luck) { lbMissN++; errs.push(`第${g.no}卦 第${i + 1}爻 缺吉凶标签`); }
  });
});
// ⚠️ 标签源的卦象位序必须与本表一致（初→上、阳=1）——
//    方向若反过来，整表会「看着有数据但全错位」，这是最隐蔽的一种错。
LBARR.forEach(x => {
  const g = GUA.find(y => y.no === x.hex_num);
  if (g && g.key !== x.binary) errs.push(`第${x.hex_num}卦 标签源 binary=${x.binary} ≠ 本表 key=${g.key}`);
});
if (XX.length && xxCount !== 384) errs.push(`小象传条数 ${xxCount} ≠ 384`);
if (lbCount !== 384) errs.push(`吉凶标签条数 ${lbCount} ≠ 384`);
if (dxCount !== 64) errs.push(`大象传条数 ${dxCount} ≠ 64`);

// —— OVERRIDE 对位断言 ——
// ⚠️ 这是本项目最隐蔽的一类错：OVERRIDE 的 key 敲错一个字，就会把**另一个卦**的文本
//    替掉，而文本照样通顺、其他断言照样全过。曾经把大有上九的 key 写成 101111（同人），
//    于是同人上九从「同人于郊，无悔」变成了「自天祐之，吉无不利」，一直没人发现。
//    判据：改前与改后必须共享足够多的汉字 —— 异文修订只可能替换个别字，
//    整句换掉说明 key 贴错了。
stats.ovTrace.forEach(t => {
  const share = new Set([...t.before].filter(c => /[\u4e00-\u9fa5]/.test(c) && t.after.indexOf(c) >= 0)).size;
  if (share < 3) {
    errs.push(`OVERRIDE「${t.key}:${t.field}」（第${t.no}卦 ${t.name} ${t.yao}）疑似贴错位置：\n`
      + `        改前：${t.before}\n        改后：${t.after}\n        只有 ${share} 个汉字重叠`);
  }
});
Object.keys(OVERRIDE).forEach(k => {
  if (!GUA.some(g => g.key === k.split(':')[0])) errs.push(`OVERRIDE「${k}」的 key 在 64 卦里找不到`);
  if (!stats.ovTrace.some(t => t.key + ':' + t.field === k)) errs.push(`OVERRIDE「${k}」没有生效（key 或字段名写错）`);
});

if (errs.length) { console.error('✗ 构建期断言失败：'); errs.forEach(e => console.error('  - ' + e)); process.exit(1); }

// ── 输出 ───────────────────────────────────────────────────────────────────
const OUT = `// ─────────────────────────────────────────────────────────────────────────────
// 《周易》六十四卦文本数据 —— **本文件由 tools/build-gua-data.js 自动生成，请勿手改**
//
// 定稿方法：从三个互相独立的开源数据集取文，统一爻序与繁简后**多数票定稿**，
// 个别依通行本人工定夺，全部异文随条目留档（variants 字段）。
//
//   卦辞：${stats.ciAll}/64 三源逐字一致
//   爻辞：${stats.yaoAll}/384 三源逐字一致（有异文 ${stats.yaoSome} 条，其中三源互异 ${stats.yaoThree} 条）
//   人工定夺 ${stats.override} 处（见构建脚本 OVERRIDE 表，每处都有理由）
//
// 解释层（本次新增，用来回答「卦辞是什么意思」）：
//   彖传 tuan    —— 原典里解释**卦辞**的那一段
//   大象传 xiang —— 原典里解释**卦象**的那一段（源 A / 源 X 双源核对，不一致留档 xiangDiff）
//   小象传 yao[].xiang —— 原典里解释**每条爻辞**的那一段（${stats.xxOk}/384，源 X 为主、源 A 兜底）
//   杂卦传 za     —— 一卦一辞的提要（如「乾刚」）
//   吉凶标签 yao[].luck —— 1 吉 / 0 中 / −1 凶，**由爻辞判词机械抽取**（源 muyen/decoding-iching）。
//                        ⚠️ 抽取方自己注明「用判词推标签即循环论证」，所以本平台**只当阅读提示**，
//                        绝不参与概率、绝不参与任何预测。
//
// key  = 六爻**自下而上**（初→上），阳=1、阴=0；xia/shang = 下卦/上卦名。
// 数据源：shaoyu12138/CodeLabyrinth · Jason-W507/I_Ching_Divination · john-walks-slow/open-iching
//        Mazeye/open-iching（象传）· muyen/decoding-iching（爻吉凶标签）
//        （繁简单字表 BYVoid/OpenCC，Apache-2.0；《周易》原文属公有领域）
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const GUA = ${JSON.stringify(GUA, null, 1)};

const BY_KEY = {};
const BY_NO = {};
const BY_NAME = {};
GUA.forEach(g => { BY_KEY[g.key] = g; BY_NO[g.no] = g; BY_NAME[g.name] = g; });

const META = {
  卦辞三源一致: ${stats.ciAll}, 爻辞三源一致: ${stats.yaoAll},
  爻辞有异文: ${stats.yaoSome}, 人工定夺: ${stats.override},
  小象传: ${stats.xxOk}, 小象两源不一致: ${stats.xxDiff},
  吉凶标签: ${stats.lbOk}, 大象两源不一致: ${stats.dxDiff},
  杂卦传: GUA.filter(g => g.za).length,
  爻吉凶分布: GUA.reduce((o, g) => { g.yao.forEach(y => { const k = String(y.luck ? y.luck.label : '?'); o[k] = (o[k] || 0) + 1; }); return o; }, {}),
};

module.exports = { GUA, BY_KEY, BY_NO, BY_NAME, META };
`;

fs.writeFileSync(path.join(ROOT, 'core', 'gua-data.js'), OUT);
console.log('✔ 已写入 core/gua-data.js');
console.log(`  卦辞 三源一致 ${stats.ciAll}/64`);
console.log(`  爻辞 三源一致 ${stats.yaoAll}/384 · 有异文 ${stats.yaoSome}（三源互异 ${stats.yaoThree}）`);
console.log(`  人工定夺 ${stats.override} 处`);
console.log(`  小象传 ${stats.xxOk}/384（源 X ${stats.xxFrom.X} · 源 A 兜底 ${stats.xxFrom.A} · 两源不一致 ${stats.xxDiff}）`);
console.log(`  吉凶标签 ${stats.lbOk}/384（分布 ${JSON.stringify(GUA.reduce((o, g) => { g.yao.forEach(y => { const k = String(y.luck ? y.luck.label : '?'); o[k] = (o[k] || 0) + 1; }); return o; }, {}))}）`);
console.log(`  大象传 64/64 · 两源不一致 ${stats.dxDiff} · 杂卦传 ${GUA.filter(g => g.za).length}/64`);
console.log(`  体积 ${(fs.statSync(path.join(ROOT, 'core', 'gua-data.js')).size / 1024).toFixed(1)} KB`);

console.log(`\n=== 人工定夺明细（${stats.ovTrace.length} 处）===`);
stats.ovTrace.forEach(t => console.log(
  `  ${t.name}(第${t.no}卦) ${t.yao}　key=${t.key}:${t.field}\n     改前：${t.before}\n     改后：${t.after}`));
if (stats.dxDiffList.length) {
  console.log(`\n=== 大象传两源不一致（${stats.dxDiffList.length} 条，页面会标出来）===`);
  stats.dxDiffList.forEach(d => console.log(`  第${d.no}卦 ${d.full}\n     A：${d.A}\n     X：${d.X}`));
}
if (stats.xxDiff) console.log(`\n小象传两源不一致 ${stats.xxDiff} 条（已随条目留档 xiangVariants）`);

// 列出全部异文，便于人工复核
const disp = [];
GUA.forEach(g => {
  if (g.yao) g.yao.forEach((y, i) => { if (y.variants) disp.push({ 卦: `${g.full}(第${g.no}卦)`, 爻: y.name, v: y.variants, distinct: y.distinct, note: y.note }); });
});
console.log(`\n=== 异文明细（${disp.length} 条）===`);
disp.forEach(d => {
  const tag = d.distinct >= 3 ? '【三源互异·人工定夺】' : '【两源一致】';
  console.log(`  ${d.卦} ${d.爻}  ${tag}${d.note ? ' ← ' + d.note : ''}`);
  d.v.forEach(x => console.log('      ' + x));
});
if (stats.warn.length) { console.log('\n⚠ 警告：'); stats.warn.forEach(w => console.log('  - ' + w)); }
