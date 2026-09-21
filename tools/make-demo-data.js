#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 生成一套**完全合成**的演示数据，写进 data/
//
// 用途：
//   ① 让克隆本仓库的人先看看界面长什么样（不需要自己的抽卡记录）
//   ② 重拍「解释说明」页配图时用它 —— 避免把真实账号的抽卡史拍进截图
//
// 用法：
//   node tools/make-demo-data.js            # data/records.json 已存在时会拒绝
//   node tools/make-demo-data.js --force    # 覆盖（原文件先挪到 data/_demo-backup-<时间>/）
//
// ⚠️ 生成的是**假数据**：UID 100000000、昵称「演示账号」、抽卡全是编的。
//    它不是从任何真实账号推导出来的，也不能拿来对账。
//
// 前提：assets/index/cn_characters.json + cn_light_cones.json
//      仓库里不带它们（版权 + 体积），本脚本**会自己下载**；下载失败才需要手动
//      先跑一次 node server/server.js 等它拉完。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const FORCE = process.argv.includes('--force');

const UID = '100000000';
const NICKNAME = '演示账号';
const SERVER = '国服';

// ── 固定种子 PRNG：每次生成的数据完全一致，截图可复现 ────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(20260921);
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = a => a[Math.floor(R() * a.length)];

// ── 索引（真实的名字 / 星级 / 命途 —— 这些是游戏数据，不是账号数据）──────────
// 仓库里不带 assets/index（版权 + 体积），所以缺了就现下 —— 复用服务端那份下载逻辑。
// ⚠️ 这里必须在**顶层同步地**把索引备好：下面的 events / records 全是顶层同步代码，
//    一旦引入 await 就得把整份脚本包进 async main，改动面太大。
//    所以用 child_process 起个子进程跑异步下载，父进程 execFileSync 等它结束。
const IDX_FILES = ['cn_characters.json', 'cn_light_cones.json'];
const ICONS_JS = path.join(ROOT, 'server/icons.js');
const ANALYZE_JS = path.join(ROOT, 'core/analyze.js');

/** 在子进程里跑一段异步代码 —— 父进程全是顶层同步代码，没法 await */
function child(code) {
  try { execFileSync(process.execPath, ['-e', code], { stdio: 'inherit' }); return true; }
  catch (e) { return false; }
}

function ensureIndex() {
  const miss = IDX_FILES.filter(f => !fs.existsSync(path.join(ROOT, 'assets/index', f)));
  if (!miss.length) return;
  console.log('· 本地缺名称索引（' + miss.join(' / ') + '），先下载 …');
  const ok = child([
    'const icons = require(' + JSON.stringify(ICONS_JS) + ');',
    'icons.refreshIndex(m => console.log("  " + m))',
    '  .then(r => process.exit(r.every(x => x.ok) ? 0 : 1))',
    '  .catch(e => { console.error("  " + e.message); process.exit(1); });',
  ].join('\n'));
  if (!ok) {
    console.error('✗ 索引下载失败（这一步需要联网）。');
    console.error('  也可以先跑一次 node server/server.js 让它自动下载，再回来跑本脚本。');
    process.exit(1);
  }
}

function readIdx(f) {
  const p = path.join(ROOT, 'assets/index', f);
  if (!fs.existsSync(p)) {
    console.error('✗ 仍然找不到 assets/index/' + f + '，索引没下下来。');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

ensureIndex();
const CH = readIdx('cn_characters.json');
const LC = readIdx('cn_light_cones.json');
const byR = (idx, r, t) => Object.values(idx).filter(v => v.rarity === r)
  .map(v => ({ id: v.id, name: v.name, item_type: t }));
const CH4 = byR(CH, 4, '角色');                    // 角色只有 4★/5★
const LC3 = byR(LC, 3, '光锥'), LC4 = byR(LC, 4, '光锥');   // 三星只在光锥里
const findItem = (name, idx, t) => {
  const v = Object.values(idx).find(x => x.name === name);
  if (!v) { console.error('✗ 索引里没有「' + name + '」'); process.exit(1); }
  return { id: v.id, name: v.name, item_type: t };
};

// ── 事件流：先排逻辑顺序，最后统一打时间戳 ──────────────────────────────────
const events = [];
const ev = (gt, gid, item, rank) => events.push({ gt, gid, item, rank });
function fillEv(gt, gid, n) {
  for (let i = 0; i < n; i++) {
    // ⚠️ 崩铁**没有三星角色** —— 三星池全是光锥（索引里角色只有 4★/5★，共 97 个）。
    //    这里写成「三星从 CH3 里取」会拿到 undefined（CH3 是空数组），直接崩。
    //    四星则角色/光锥都可能出（实测 gt=11/12/21/1 都同时出现过两种）。
    const r4 = R() < 0.13;
    ev(gt, gid, pick(r4 ? (R() < 0.5 ? CH4 : LC4) : LC3), r4 ? 4 : 3);
  }
}
// 一期：每金之前垫 pity−1 抽，最后可选一段无金的尾巴（= 当前已垫）
function bannerEv(gt, gid, golds, tail) {
  golds.forEach(g => { fillEv(gt, gid, g.pity - 1); ev(gt, gid, g.item, 5); });
  if (tail) fillEv(gt, gid, tail);
}

// ① 常驻（gt=1，gacha_id 1001）：三金 + 尾巴。顺序 = 时间顺序，不能乱。
const GQ_GOLDS = [
  { name: '如泥酣眠',       idx: LC, t: '光锥', inWin: 34 },  // 窗口内只看到 34 抽，真实保底 62（跨边界）
  { name: '布洛妮娅',       idx: CH, t: '角色', inWin: 69 },
  { name: '但战斗还未结束', idx: LC, t: '光锥', inWin: 79 },
];
const GQ_TAIL = 8;
const gqQueue = [];
GQ_GOLDS.forEach(g => {
  for (let i = 0; i < g.inWin - 1; i++) gqQueue.push(null);
  gqQueue.push({ item: findItem(g.name, g.idx, g.t) });
});
for (let i = 0; i < GQ_TAIL; i++) gqQueue.push(null);
const gqTake = n => {
  for (let i = 0; i < n && gqQueue.length; i++) {
    const q = gqQueue.shift();
    if (q) ev('1', '1001', q.item, 5); else fillEv('1', '1001', 1);
  }
};

// ② 联动两池（走另一个端点，保留期更长）—— 放在时间轴最前面
const LD_CH = { id: '1014', name: 'Saber', item_type: '角色' };
const LD_LC = { id: '23045', name: '没有回报的加冕', item_type: '光锥' };
bannerEv('21', '5001', [{ item: LD_CH, pity: 44 }], 6);
bannerEv('22', '6003', [{ item: LD_LC, pity: 8 }], 2);

// ③ 八期活动池：角色池与光锥池 gacha_id 同尾（2124↔3124 …）
const PAIRS = [
  { ch: '1307', chName: '黑天鹅', lc: '23022', lcName: '重塑时光之忆' },
  { ch: '1306', chName: '花火',   lc: '23021', lcName: '游戏尘寰' },
  { ch: '1304', chName: '砂金',   lc: '23023', lcName: '命运从未公平' },
  { ch: '1309', chName: '知更鸟', lc: '23026', lcName: '夜色流光溢彩' },
  { ch: '1310', chName: '流萤',   lc: '23025', lcName: '梦应归于何处' },
  { ch: '1401', chName: '大黑塔', lc: '23037', lcName: '向着不可追问处', cross: true },
  { ch: '1313', chName: '星期日', lc: '23034', lcName: '回到大地的飞行' },
  { ch: '1413', chName: '长夜月', lc: '23049', lcName: '致长夜的星光' },
];
const CROSS = { gid: '2129', char: '大黑塔', inWin: 18, full: 76 };   // 第 6 期：保底跨接口窗口边界
const STD_CH = ['姬子', '瓦尔特', '布洛妮娅', '杰帕德', '克拉拉', '彦卿', '白露', '希儿', '刃', '符玄', '云璃', '银枝', '银狼'];
const STD_LC = ['银河铁道之夜', '以世界之名', '但战斗还未结束', '制胜的瞬间', '无可取代的东西', '如泥酣眠', '时节不居'];

PAIRS.forEach((p, i) => {
  const gidCh = String(2124 + i * 2), gidLc = String(3124 + i * 2);
  // 角色池：约一半期次先歪一个常驻角色，再出 UP
  const chGolds = [];
  if (!p.cross && R() < 0.5) chGolds.push({ item: findItem(pick(STD_CH), CH, '角色'), pity: ri(44, 60) });
  chGolds.push({ item: { id: p.ch, name: p.chName, item_type: '角色' }, pity: p.cross ? CROSS.inWin : ri(45, 62) });
  bannerEv('11', gidCh, chGolds, 0);
  // 光锥池：约三分之一期次先歪一张常驻光锥
  const lcGolds = [];
  if (R() < 0.35) lcGolds.push({ item: findItem(pick(STD_LC), LC, '光锥'), pity: ri(36, 52) });
  lcGolds.push({ item: { id: p.lc, name: p.lcName, item_type: '光锥' }, pity: ri(40, 56) });
  bannerEv('12', gidLc, lcGolds, i === PAIRS.length - 1 ? 12 : 0);
  gqTake(22);                                  // 常驻分摊到每一期
});
gqTake(gqQueue.length);                        // 剩下的常驻收尾
// ⚠️ 新手池（gt=2）**一条记录都不生成**：真实情况就是「50 抽早抽完、接口返回空」，
//    而引擎的「逐池合计 = 总抽数」恒等式要求 n2 = 0（新手池总量只从截图补录来）。

// ── 打时间戳（UTC 构造 / getUTC* 输出 = 北京时间字面量，不依赖本机时区）──────
const pad = n => String(n).padStart(2, '0');
let cursor = Date.UTC(2026, 1, 1, 4, 0, 0);    // 2026-02-01 12:00（+08）
let burst = 0;                                  // 本场已经抽了几发
const nextGapMin = () => {
  // 真实玩家的节奏是「一场里连着抽十几发、然后隔几小时到几天再来一场」。
  // 均匀分布会让整段时间轴被压成几天，跟「跨度」有关的展示就失去意义了。
  if (++burst >= ri(8, 16)) { burst = 0; return ri(6, 48) * 60; }
  return ri(1, 5);
};
const records = events.map((e, i) => {
  cursor += nextGapMin() * 60000;
  const d = new Date(cursor);
  return {
    id: '9' + String(i + 1).padStart(18, '0'),
    uid: UID,
    gacha_type: e.gt,
    item_id: e.item.id,
    count: '1',
    time: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
          pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()),
    name: e.item.name,
    lang: 'zh-cn',
    item_type: e.item.item_type,
    rank_type: String(e.rank),
    gacha_id: e.gid,
  };
});

// ── 导入记录（sources）—— 分三批，与真实的三次导入同构 ──────────────────────
const byTime = records.slice().sort((a, b) => a.time.localeCompare(b.time));
const iso = (t, plusMin) => new Date(Date.parse(t.replace(' ', 'T') + '+08:00') + plusMin * 60000).toISOString();
const span = arr => ({ from: arr[0].time, to: arr[arr.length - 1].time });
const ldRecs = byTime.filter(r => r.gacha_type === '21' || r.gacha_type === '22');
const restRecs = byTime.filter(r => r.gacha_type !== '21' && r.gacha_type !== '22');
const batch3 = ldRecs, batch2 = restRecs.slice(-12), batch1 = restRecs.slice(0, -12);
const lastT = byTime[byTime.length - 1].time;
// 补填时刻取倒数第 40 条记录的时刻 —— 之后那 40 抽就是「补填之后新同步的」，
// 用来演示「总抽数 = 补填基准 + 增量」里的增量部分。
const AT = byTime[Math.max(0, byTime.length - 40)].time;
const INC_P = byTime.filter(r => r.time > AT).length;
const INC_G = byTime.filter(r => r.time > AT && r.rank_type === '5').length;
const sources = [
  { at: iso(batch1[batch1.length - 1].time, 20), endpoint: 'getGachaLog',   incoming: batch1.length, added: batch1.length, ...span(batch1) },
  { at: iso(lastT, 30),                          endpoint: 'getGachaLog',   incoming: batch2.length + 6, added: batch2.length, ...span(batch2) },
  { at: iso(lastT, 45),                          endpoint: 'getLdGachaLog', incoming: batch3.length, added: batch3.length, ...span(batch3) },
];

// ── 截图补录（account.json）─────────────────────────────────────────────────
// ⚠️ 与接口窗口重叠的五星**不能录**（会算两遍）。大黑塔是唯一例外：它窗口内那条是残缺值，
//    整条由截图段代表，所以必须列在这里，并在 crossGold 里登记。
const histRows = [
  ['ch', '大黑塔', CROSS.full, 0, '截图①·第1行'],
  ['ch', '卡芙卡', 75, 0, '截图①·第2行'],
  ['ch', '银狼',   77, 1, '截图①·第3行'],
  ['ch', '景元',   68, 0, '截图①·第4行'],
  ['ch', '罗刹',   74, 1, '截图①·第5行'],
  ['ch', '镜流',   71, 0, '截图②·第1行'],
  ['ch', '藿藿',   55, 0, '截图②·第2行'],
  ['ch', '飞霄',   49, 0, '截图②·第3行'],
  ['ch', '云璃',   82, 1, '截图③·第1行'],
  ['lc', '只需等待',     46, 0, '截图④·第1行'],
  ['lc', '拂晓之前',     70, 0, '截图④·第2行'],
  ['lc', '棺的回响',     33, 0, '截图④·第3行'],
  ['lc', '此身为剑',     71, 0, '截图④·第4行'],
  ['lc', '海洋为何而歌', 19, 0, '截图④·第5行'],
];
const oth = [
  { key: 'gq', gt: '1', tab: '常驻跃迁', short: '常驻', full: '群星跃迁（常驻保底池）', cur: GQ_TAIL,
    rows: [
      ['但战斗还未结束', GQ_GOLDS[2].inWin, 'lc', 'win'],
      ['布洛妮娅',       GQ_GOLDS[1].inWin, 'ch', 'win'],
      ['如泥酣眠',       GQ_GOLDS[0].inWin + 28, 'lc', 'cross'],   // 34（窗口内）+ 28（窗口外）= 62
      ['时节不居', 62, 'lc', 'hist'],
      ['瓦尔特',   77, 'ch', 'hist'],
      ['姬子',     78, 'ch', 'hist'],
    ] },
  { key: 'xs', gt: '2', tab: '新手池', short: '新手', full: '始发跃迁（新手池 · 50 抽封顶，早抽完）', cur: 40,
    rows: [['姬子', 10, 'ch', 'hist']] },
];

// ── 写入 ────────────────────────────────────────────────────────────────────
if (fs.existsSync(path.join(DATA, 'records.json')) && !FORCE) {
  console.error('✗ data/records.json 已存在。加 --force 才会覆盖（原文件会先备份到 data/_demo-backup-<时间>/）');
  process.exit(1);
}
fs.mkdirSync(DATA, { recursive: true });
if (FORCE && fs.existsSync(path.join(DATA, 'records.json'))) {
  const bak = path.join(DATA, '_demo-backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(bak, { recursive: true });
  for (const f of ['records.json', 'meta.json', 'account.json', 'external.json']) {
    const src = path.join(DATA, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bak, f));
  }
  console.log('· 原数据已备份到 ' + path.relative(ROOT, bak));
}

const W = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 2) + '\n');
W('records.json', { uid: UID, updatedAt: new Date().toISOString(), sources, records });
W('account.json', {
  _说明: '⚠️ 演示数据（由 tools/make-demo-data.js 生成）—— 假 UID、假抽卡，不能用于对账。',
  crossGold: { [CROSS.gid]: CROSS.char },
  histCross: { [CROSS.char]: CROSS.full },
  histRows, oth,
  wsBase: null,
});
W('external.json', { _说明: '演示数据：外部统计补录为空。', updatedAt: '', shots: [], items: [] });
W('meta.json', {
  uid: UID, nickname: NICKNAME, server: SERVER,
  _说明: '⚠️ 演示数据（由 tools/make-demo-data.js 生成）。',
  wsBase: { pulls: 0, gold: 0, at: AT },        // 第二遍回填 pulls / gold
  fillLog: [], almanacEnabled: true, autoFetchIcons: true,
});

// ── 第二遍：回填「数据补填」的总量基准 ──────────────────────────────────────
// 引擎的口径是：总量 = 补填值 + 「补填时刻之后新导入的条数(INC)」。
// 所以补填值必须是「**补填那一刻**的总量」= 逐池合计 − INC，而不是逐池合计本身。
// ⚠️ 写成 TOTAL_P 会让这 40 条新记录被算两遍（总量会比逐池合计多 40 抽），
//    这是个很隐蔽的错 —— 因为对账那一行比的恰好是 pulls 本身，它会显示「完全一致」，
//    把重复计数盖过去。所以下面的复核改成断言「总量 === 逐池合计」。
const { analyze } = require(path.join(ROOT, 'core/analyze.js'));
const lead = s => parseInt(String(s).replace(/[^\d].*$/, ''), 10);
// 引擎把「逐池合计」放在 audit.rows[0].ours 的开头（"5588（窗口内 …）"），
// 直接取它当目标值 —— 不在这里重抄一遍引擎的求和逻辑，免得两边漂移。
const A1 = analyze();
const TOTAL_P = lead(A1.audit.rows[0].ours), TOTAL_G = lead(A1.audit.rows[1].ours);
const PULLS = TOTAL_P - INC_P, GOLD = TOTAL_G - INC_G;

W('meta.json', {
  uid: UID, nickname: NICKNAME, server: SERVER,
  _说明: '⚠️ 演示数据（由 tools/make-demo-data.js 生成）。wsBase 是「补填那一刻」的总量，'
       + '补填之后又抽的那些由引擎按时间戳自动加上去。',
  wsBase: { pulls: PULLS, gold: GOLD, at: AT },
  fillLog: [
    { at: iso(AT, 0), pulls: PULLS, gold: GOLD, snapDay: AT.slice(0, 10) },
  ],
  almanacEnabled: true, autoFetchIcons: true,
});

// ── 复核：引擎必须自洽 ──────────────────────────────────────────────────────
const A2 = analyze();
const gtCount = records.reduce((m, r) => (m[r.gacha_type] = (m[r.gacha_type] || 0) + 1, m), {});
const TOT2_P = lead(A2.overview.tot.p), TOT2_G = lead(A2.overview.tot.g);
const okP = TOT2_P === TOTAL_P, okG = TOT2_G === TOTAL_G;
console.log('✔ 演示数据已写入 data/');
console.log('  记录 ' + records.length + ' 条 · 逐池 ' + JSON.stringify(gtCount));
console.log('  时间 ' + byTime[0].time + ' → ' + lastT);
console.log('  导入 ' + sources.length + ' 次（新增 ' + sources.map(s => s.added).join(' / ') + '）');
console.log('  补录 活动池 ' + histRows.length + ' 行 · 常驻 ' + oth[0].rows.length + ' 行 · 新手 ' + oth[1].rows.length + ' 行');
console.log('  补填 at=' + AT + ' → 基准 ' + PULLS + ' ＋ 补填后新增 ' + INC_P + ' = 总量 ' + TOT2_P);
console.log('  近期总抽数 ' + A2.overview.recent.p + '（起点 ' + A2.overview.recent.from + '）');
console.log('  复核 总量 === 逐池合计：总抽数 ' + (okP ? '✓ ' + TOT2_P : '✗ ' + TOT2_P + ' vs ' + TOTAL_P)
          + ' · 五星数 ' + (okG ? '✓ ' + TOT2_G : '✗ ' + TOT2_G + ' vs ' + TOTAL_G));
console.log('  复核 引擎断言：' + ((A2.asserts || []).filter(a => !a.ok).length === 0 ? '✓ 全绿' : '✗ 有失败'));
if (!okP || !okG) process.exitCode = 1;

// ── 顺手把图标补齐 ──────────────────────────────────────────────────────────
// 真实使用流程里图标是「导入抽卡记录」时由 ensureIcons 补的；
// 演示数据是直接写进 data/ 的、没经过导入，不补的话界面上一堆空白格
// （角色管理页、出金明细全空）。图标是尽力而为：下不下来不影响数据本身，所以失败只提示不退出。
console.log('· 补齐图标（角色头像 / 光锥，首次约 1~3 分钟）…');
if (!child([
  'const icons = require(' + JSON.stringify(ICONS_JS) + ');',
  'const { loadRecords } = require(' + JSON.stringify(ANALYZE_JS) + ');',
  'icons.ensureIcons(loadRecords().list, m => { if (/失败/.test(m)) console.log("  " + m); })',
  '  .then(r => {',
  '    console.log("  图标 新下载 " + r.downloaded.length + " · 本地已有 " + r.skipped + " · 失败 " + r.failed.length);',
  '    process.exit(0);',
  '  })',
  '  .catch(e => { console.error("  " + e.message); process.exit(0); });',
].join('\n'))) {
  console.error('  ⚠️ 图标没补齐（多半是网络问题）。不影响数据；平台运行时也会自己补。');
}
console.log('✔ 全部完成。现在双击 start.command 就能看到完整界面了。');
