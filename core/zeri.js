// ─────────────────────────────────────────────────────────────────────────────
// 时家择吉 —— 从十二个时辰里挑出「吉时」
//
// 为什么单独一个文件：core/huangli.js 只给「日家 + 时家黄黑道」两档信息，
// 换句话说它只回答「这个时辰是不是黄道」。真要做择时，黄道黑道只是**其中一个维度**，
// 而且不是权重最大的那个 —— 时辰与日辰的刑冲合害、日干所带的贵人禄马，
// 以及时辰是否落空亡，都会反过来把黄道时压下去、把黑道时抬起来。
// （实例：己亥日旬空在辰巳，辰时虽是「司命黄道」，落空亡后并不是好时辰。）
//
// 评分维度（全部可复核，没有任何一项来自「本平台自创」）：
//   D1 时家十二天神黄黑道     黄道 +2.0 ／ 黑道 −2.0
//   D2 日支 ↔ 时支 关系       六冲 −2.5 · 六合 +2.0 · 三会 +1.8 · 半合 +1.5
//                             相刑 −1.0 · 自刑 −0.8 · 相害 −0.5
//   D3 日干所带贵神           天乙贵人 +1.5 · 日禄 +1.5 · 文昌 +0.8 · 驿马 +0.6
//   D4 旬空                   时支落当日旬空 −1.5
//
// 档位阈值不手拍，按 400 天 × 12 时辰 = 4800 个样本的分数分位数定（见 assertZeri）。
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const { Solar } = require(path.join(__dirname, 'lunar.js'));

// ── 时辰 ───────────────────────────────────────────────────────────────────
// 子时用「早子」（00:00–01:00）那一刻取时家天神。
// ⚠️ 子时跨日：23:00–24:00 的晚子时属**次日**子时，干支与天神都与早子不同
//    （lunar-javascript 的 getTimes() 返回 13 条正是为此）。
//    本站统一取早子，并在页面上标注，避免「同一时辰两个答案」。
const HOURS = [['子', 0], ['丑', 2], ['寅', 4], ['卯', 6], ['辰', 8], ['巳', 10],
  ['午', 12], ['未', 14], ['申', 16], ['酉', 18], ['戌', 20], ['亥', 22]];
const RANGE = { 子: '23–01', 丑: '01–03', 寅: '03–05', 卯: '05–07', 辰: '07–09', 巳: '09–11', 午: '11–13', 未: '13–15', 申: '15–17', 酉: '17–19', 戌: '19–21', 亥: '21–23' };

// ── 地支关系表 ─────────────────────────────────────────────────────────────
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const LIUHE = { 子: '丑', 丑: '子', 寅: '亥', 亥: '寅', 卯: '戌', 戌: '卯', 辰: '酉', 酉: '辰', 巳: '申', 申: '巳', 午: '未', 未: '午' };
const CHONG = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅', 卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' };
const HAI = { 子: '未', 未: '子', 丑: '午', 午: '丑', 寅: '巳', 巳: '寅', 卯: '辰', 辰: '卯', 申: '亥', 亥: '申', 酉: '戌', 戌: '酉' };
const SANHE = [['申', '子', '辰'], ['亥', '卯', '未'], ['寅', '午', '戌'], ['巳', '酉', '丑']];
const SANHUI = [['寅', '卯', '辰'], ['巳', '午', '未'], ['申', '酉', '戌'], ['亥', '子', '丑']];
// 相刑（有向）：子刑卯 · 卯刑子 · 寅刑巳 · 巳刑申 · 申刑寅 · 丑刑戌 · 戌刑未 · 未刑丑
const XING = [['子', '卯'], ['卯', '子'], ['寅', '巳'], ['巳', '申'], ['申', '寅'], ['丑', '戌'], ['戌', '未'], ['未', '丑']];
const ZIXING = ['辰', '午', '酉', '亥'];   // 辰午酉亥 自刑

// ── 日干 → 贵神 ────────────────────────────────────────────────────────────
// 天乙贵人：甲戊庚牛羊 · 乙己鼠猴乡 · 丙丁猪鸡位 · 壬癸兔蛇藏 · 六辛逢马虎
const TIANYI = { 甲: '丑未', 戊: '丑未', 庚: '丑未', 乙: '子申', 己: '子申', 丙: '亥酉', 丁: '亥酉', 壬: '卯巳', 癸: '卯巳', 辛: '寅午' };
// 十干禄：甲禄在寅 · 乙禄在卯 · 丙戊禄在巳 · 丁己禄在午 · 庚禄在申 · 辛禄在酉 · 壬禄在亥 · 癸禄在子
const LU = { 甲: '寅', 乙: '卯', 丙: '巳', 戊: '巳', 丁: '午', 己: '午', 庚: '申', 辛: '酉', 壬: '亥', 癸: '子' };
// 文昌：甲巳乙午丙戊申 · 丁己酉庚亥辛子 · 壬寅癸卯
const WENCHANG = { 甲: '巳', 乙: '午', 丙: '申', 戊: '申', 丁: '酉', 己: '酉', 庚: '亥', 辛: '子', 壬: '寅', 癸: '卯' };
// 驿马（按日支三合局）：申子辰马居寅 · 寅午戌马居申 · 巳酉丑马居亥 · 亥卯未马居巳
const YIMA = { 申: '寅', 子: '寅', 辰: '寅', 寅: '申', 午: '申', 戌: '申', 巳: '亥', 酉: '亥', 丑: '亥', 亥: '巳', 卯: '巳', 未: '巳' };

// ── 权重 ───────────────────────────────────────────────────────────────────
const W = {
  huangdao: 2.0, heidao: -2.0,
  chong: -2.5, liuhe: 2.0, sanhui: 1.8, banhe: 1.5, xing: -1.0, zixing: -0.8, hai: -0.5,
  tianyi: 1.5, lu: 1.5, wenchang: 0.8, yima: 0.6,
  xunkong: -1.5,
};
// 档位阈值（按 400 天 × 12 时辰 = 4800 样本的分位数标定 —— 见 assertZeri）
// 隐含的两条「升/降档」规则正是多维度评分存在的意义：
//   黄道时若落空亡或与日相刑害 → 从吉时降到次吉甚至平常（例：司命黄道 + 旬空 = 平常）
//   黑道时若得六合/天乙贵人     → 也能抬到次吉区间（例：白虎黑道 + 会方 + 天乙 = 平常偏上）
const LEVEL = [[3.5, 's1', '吉时'], [1.8, 's2', '次吉'], [-2.0, 's0', '平常'], [-99, 'sx', '凶时']];
const lvOf = s => { for (const t of LEVEL) if (s >= t[0]) return { level: t[1], label: t[2] }; return { level: 'sx', label: '凶时' }; };

// 日支 ↔ 时支：优先判「冲」再判「合」，最后才落到刑害。
// 因为寅申、卯辰这类组合会同时命中两条（寅申既是六冲又在无恩之刑里），
// 全算会重复扣分，所以按 冲 > 六合 > 三会 > 半合 > 相刑 > 相害 取第一条命中的。
function relOf(dayZhi, hourZhi) {
  if (dayZhi === hourZhi) {
    return ZIXING.indexOf(dayZhi) >= 0 ? { tag: '自刑', d: W.zixing } : null;
  }
  if (CHONG[dayZhi] === hourZhi) return { tag: '时冲日', d: W.chong };
  if (LIUHE[dayZhi] === hourZhi) return { tag: '日时六合', d: W.liuhe };
  if (SANHUI.some(g => g.indexOf(dayZhi) >= 0 && g.indexOf(hourZhi) >= 0)) return { tag: '日时会方', d: W.sanhui };
  if (SANHE.some(g => g.indexOf(dayZhi) >= 0 && g.indexOf(hourZhi) >= 0)) return { tag: '日时半合', d: W.banhe };
  if (XING.some(p => p[0] === dayZhi && p[1] === hourZhi)) return { tag: '日时相刑', d: W.xing };
  if (HAI[dayZhi] === hourZhi) return { tag: '日时相害', d: W.hai };
  return null;
}

/**
 * 给某一天的十二个时辰打分、排序。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{light?:boolean}} o  light=true 只算分数、不取农历（批量标定时用，快很多）
 * @returns {{date, day, hours, best, spots, doc}}
 */
function zeri(dateStr, o) {
  o = o || {};
  const [Y, M, D] = String(dateStr).split('-').map(Number);
  const base = Solar.fromYmdHms(Y, M, D, 0, 0, 0).getLunar();

  const dayGan = base.getDayGan(), dayZhi = base.getDayZhi();
  const xunKong = (base.getDayXunKong ? base.getDayXunKong() : '').split('');   // 如 辰巳
  const gui = (TIANYI[dayGan] || '').split('');
  const lu = LU[dayGan], wc = WENCHANG[dayGan], ma = YIMA[dayZhi];

  const hours = HOURS.map(function (h) {
    const zhi = h[0], hh = h[1];
    const marks = [];
    let score = 0;

    // D1 时家十二天神
    const t = Solar.fromYmdHms(Y, M, D, hh, 0, 0).getLunar().getTimes()[
      hh === 23 ? 12 : Math.floor((hh + 1) / 2)];
    const huang = t.getTianShenType() === '黄道';
    score += huang ? W.huangdao : W.heidao;
    marks.push({ tag: t.getTianShen() + (huang ? '·黄道' : '·黑道'), d: huang ? W.huangdao : W.heidao, dim: '时家天神' });

    // D2 日支 ↔ 时支
    const rel = relOf(dayZhi, zhi);
    if (rel) { score += rel.d; marks.push({ tag: rel.tag, d: rel.d, dim: '日时关系' }); }

    // D3 日干贵神
    if (gui.indexOf(zhi) >= 0) { score += W.tianyi; marks.push({ tag: '天乙贵人', d: W.tianyi, dim: '贵神' }); }
    if (lu === zhi) { score += W.lu; marks.push({ tag: '日禄', d: W.lu, dim: '贵神' }); }
    if (wc === zhi) { score += W.wenchang; marks.push({ tag: '文昌', d: W.wenchang, dim: '贵神' }); }
    if (ma === zhi) { score += W.yima; marks.push({ tag: '驿马', d: W.yima, dim: '贵神' }); }

    // D4 旬空
    const kong = xunKong.indexOf(zhi) >= 0;
    if (kong) { score += W.xunkong; marks.push({ tag: '旬空', d: W.xunkong, dim: '空亡' }); }

    score = Math.round(score * 10) / 10;
    const lv = lvOf(score);
    return {
      zhi, range: RANGE[zhi], gz: t.getGanZhi(),
      tianShen: t.getTianShen(), type: t.getTianShenType(),
      xunKong: kong,
      score, level: lv.level, label: lv.label,
      marks, good: lv.level === 's1' || lv.level === 's2',
    };
  });

  // 排序：分数降序；同分按十二时辰自然序（早的在前）
  const ranked = hours.slice().sort((x, y) => (y.score - x.score) || (ZHI.indexOf(x.zhi) - ZHI.indexOf(y.zhi)));
  ranked.forEach((h, i) => { h.rank = i + 1; });

  const day = {
    gz: base.getDayInGanZhi(), gan: dayGan, zhi: dayZhi,
    lunar: base.getMonthInChinese() + '月' + base.getDayInChinese(),
    zhiXing: base.getZhiXing(),
    xiu: base.getXiu() + base.getAnimal(),
    tianShen: base.getDayTianShen(),
    type: base.getDayTianShenType(),
    xun: base.getDayXun ? base.getDayXun() : '',
    xunKong: xunKong.join(''),
    jiShen: base.getDayJiShen() || [],
    xiongSha: base.getDayXiongSha() || [],
    // 方位神煞（日级，随日干走）：抽卡场景里「财神方位」是个有说头的落点
    cai: base.getDayPositionCaiDesc ? base.getDayPositionCaiDesc() : '',
    xi: base.getDayPositionXiDesc ? base.getDayPositionXiDesc() : '',
    fu: base.getDayPositionFuDesc ? base.getDayPositionFuDesc() : '',
  };
  if (!o.light) {
    day.yi = base.getDayYi() || [];
    day.ji = base.getDayJi() || [];
  }

  return {
    date: dateStr,
    day,
    hours: ranked,
    best: ranked[0],
    spots: ranked.slice(0, 3),
    doc: DOC,
  };
}

const DOC = {
  dims: [
    { k: '时家天神', v: '黄道六神（青龙·明堂·金匮·天德·玉堂·司命）＋2.0，黑道六神（天刑·朱雀·白虎·天牢·玄武·勾陈）−2.0' },
    { k: '日时关系', v: '时冲日 −2.5 · 日时六合 +2.0 · 日时会方 +1.8 · 日时半合 +1.5 · 日时相刑 −1.0 · 自刑 −0.8 · 日时相害 −0.5（取第一条命中，不重复计）' },
    { k: '贵神禄马', v: '日干天乙贵人 +1.5 · 日禄 +1.5 · 文昌 +0.8 · 日支驿马 +0.6' },
    { k: '旬空', v: '时支落当日旬空 −1.5（空则事多落空）' },
  ],
  levels: '吉时 ≥ 3.5 · 次吉 ≥ 1.8 · 平常 ≥ −2.0 · 凶时 < −2.0（阈值取 400 天 × 12 时辰共 4800 个样本的分位数，实测占比约 21% / 19% / 52% / 8%）',
  upgrade: '单纯「黑道时」只算平常（黑道只说明不宜大动，不等于犯忌）；「凶时」要求黑道之外另有刑冲害或空亡加身。反过来，黄道时落空亡或与日相刑害会降档 —— 这一升一降才是本页比「只看黄道」多出来的部分。',
  note: '子时取早子（00:00–01:00）定天神；23:00 之后的晚子属次日子时。',
  duty: '吉时是传统择时口径，与抽卡概率无关 —— 本页的抽数区间一律由官方保底模型给出，不因吉时而变。',
};

// ─────────────────────────────────────────────────────────────────────────────
// 日家择吉 —— 在「卡池剩余期」这种跨天区间里挑出适宜的日子
//
// 为什么需要日家这一层：上面 zeri() 只管**一天之内**挑时辰。但「这期还剩 5 天，
// 该哪天抽」这个问题，先要选**日子**，再选时辰 —— 日子不吉，时辰再好也没用。
//
// ⚠️ 一条必须写在页面上的口径：**黄历里没有「宜抽卡」这一项**。
//    这里把抽卡映射到最接近的「求财」类事项（开市 / 交易 / 立券 / 纳财 / 出货财 / 置产），
//    这个映射是**本平台定的**，不是古法。古人不会告诉你今天适合抽卡。
//
// 评分维度（全部取自 lunar.js 的《协纪辨方书》体系，没有一项自创）：
//   D1 日家十二天神黄黑道   黄道 +2.0 ／ 黑道 −2.0
//   D2 建除十二神           除危定执成开（吉神）+1.5 ／ 建满平收破闭（凶神）−1.5
//   D3 二十八宿             取 lunar.js 自带的 getXiuLuck()，吉 +1.0 ／ 凶 −1.0
//   D4 宜忌（求财类）       宜中含求财 +2.5 ／ 忌中含求财 −2.5 ／「诸事不宜」−3.0
//   D5 吉神（分档，封顶）   一封顶 +3.0
//   D6 凶煞（分档，封顶）   一封顶 −3.5
//
// ⚠️ 凶煞每天都有 5~8 个（实测 82 种轮转），所以**不能按「有没有凶煞」扣分**，
//    必须按严重程度分档并封顶，否则每天都是负分、整个择吉失去分辨力。
// ─────────────────────────────────────────────────────────────────────────────
const ZHI_XING_GOOD = ['除', '危', '定', '执', '成', '开'];   // 建除十二神里的吉神

// 求财类事项 —— 抽卡的映射对象（页面必须注明这是我们定的映射）
const FAVOR = ['开市', '交易', '立券', '纳财', '出货财', '置产'];

// 吉神分档：一等是「德」「赦」「合」「富」这一类决定性吉神
const JI_T1 = ['天德', '月德', '天德合', '月德合', '天赦', '三合', '六合', '天愿', '五富', '天仓', '母仓'];
const JI_T2 = ['金匮', '宝光', '福德', '福生', '益后', '续世', '天喜', '天医', '生气', '时德', '阳德',
  '阴德', '普护', '圣心', '解神', '月恩', '四相', '时阳', '要安', '敬安', '玉宇', '金堂', '民日',
  '王日', '官日', '守日', '相日', '临日', '五合', '五合', '月空', '天恩'];
// 凶煞分档：一等是「破」「废」「亡」「离」「绝」这类一票否决
const XIONG_T1 = ['月破', '四废', '往亡', '四离', '四绝', '阴阳错', '阳错', '阴错', '四忌', '四穷',
  '阴阳击冲', '阳破阴冲', '大会', '小会'];
const XIONG_T2 = ['大耗', '大败', '大煞', '灾煞', '劫煞', '天贼', '月刑', '月害', '月厌', '五离',
  '五虚', '五墓', '河魁', '死神', '死气', '土府', '天火', '地火', '九坎', '九空', '大时', '小时',
  '月建', '重日', '复日', '咸池', '三丧', '鬼哭', '归忌', '血忌', '血支', '天罡', '土符', '月煞',
  '月虚', '厌对', '招摇', '触水龙', '地囊', '八专', '孤辰', '单阴', '纯阴', '绝阳'];

const DAY_W = {
  huangdao: 2.0, heidao: -2.0,
  zhiXingGood: 1.5, zhiXingBad: -1.5,
  xiuGood: 1.0, xiuBad: -1.0,
  yiFavor: 2.5, jiFavor: -2.5, nothing: -3.0,
  jiT1: 1.5, jiT2: 0.6, jiT3: 0.2, jiCap: 3.0,
  xiT1: -3.5, xiT2: -1.0, xiT3: -0.3, xiCap: -3.5,
};

// 档位阈值：**先跑 800 天算分布，再按分位数切**（见 assertZeriRange 的标定输出）。
// ⚠️ 手挑阈值会得到「满屏吉日」或「一个吉日都没有」，两种都让这个功能没用。
// 实测分位（800 天，2026-01-01 起）：p95=5.7 · p90=4.5 · p65≈1.5 · p50=−0.5 · p25=−3.5 · p5=−6.8
//   → 上吉 10% ／ 吉 25% ／ 平 40% ／ 不宜 25%
const DAY_LEVEL = [[4.5, 'd1', '上吉'], [1.5, 'd2', '吉'], [-3.5, 'd0', '平'], [-99, 'dx', '不宜']];
const dayLvOf = s => { for (const t of DAY_LEVEL) if (s >= t[0]) return { level: t[1], label: t[2] }; return { level: 'dx', label: '不宜' }; };

/**
 * 给一天打「日家」分数。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {{date, day, score, level, label, marks, favor, against, warnKlass}}
 */
function dayScore(dateStr) {
  const [Y, M, D] = String(dateStr).split('-').map(Number);
  const L = Solar.fromYmdHms(Y, M, D, 12, 0, 0).getLunar();
  const marks = [];
  let score = 0;
  const add = (tag, d, dim) => { score += d; marks.push({ tag, d, dim }); };

  // D1 日家十二天神
  const tsType = L.getDayTianShenType();
  const huang = tsType === '黄道';
  add(L.getDayTianShen() + (huang ? '·黄道' : '·黑道'), huang ? DAY_W.huangdao : DAY_W.heidao, '日家天神');

  // D2 建除十二神
  const zx = L.getZhiXing();
  const zxGood = ZHI_XING_GOOD.indexOf(zx) >= 0;
  add(zx + '日·' + (zxGood ? '吉' : '凶'), zxGood ? DAY_W.zhiXingGood : DAY_W.zhiXingBad, '建除十二神');

  // D3 二十八宿
  const xiu = L.getXiu();
  const xiuGood = (L.getXiuLuck ? L.getXiuLuck() : '') === '吉';
  add(xiu + L.getAnimal() + '·' + (xiuGood ? '吉宿' : '凶宿'), xiuGood ? DAY_W.xiuGood : DAY_W.xiuBad, '二十八宿');

  // D4 宜忌（求财类）
  const yi = L.getDayYi() || [], ji = L.getDayJi() || [];
  const yiHit = FAVOR.filter(k => yi.indexOf(k) >= 0);
  const jiHit = FAVOR.filter(k => ji.indexOf(k) >= 0);
  if (yiHit.length) add('宜' + yiHit.join('·'), DAY_W.yiFavor, '宜忌·求财');
  if (jiHit.length) add('忌' + jiHit.join('·'), DAY_W.jiFavor, '宜忌·求财');
  const nothing = yi.indexOf('诸事不宜') >= 0 || ji.indexOf('诸事不宜') >= 0;
  if (nothing) add('诸事不宜', DAY_W.nothing, '宜忌·求财');

  // D5 吉神（分档累加后封顶）
  const jsList = (L.getDayJiShen() || []).filter(x => x && x !== '无');
  let js = 0;
  const jsTags = [];
  jsList.forEach(x => {
    if (JI_T1.indexOf(x) >= 0) { js += DAY_W.jiT1; jsTags.push(x + '(一)'); }
    else if (JI_T2.indexOf(x) >= 0) { js += DAY_W.jiT2; jsTags.push(x); }
    else { js += DAY_W.jiT3; jsTags.push(x); }
  });
  if (js > DAY_W.jiCap) js = DAY_W.jiCap;
  if (js > 0) add('吉神 ' + jsTags.length + '：' + jsTags.slice(0, 5).join('·') + (jsTags.length > 5 ? '…' : ''), Math.round(js * 10) / 10, '吉神');

  // D6 凶煞（分档累加后封顶）
  const xsList = (L.getDayXiongSha() || []).filter(x => x && x !== '无');
  let xs = 0;
  const xsTags = [];
  xsList.forEach(x => {
    if (XIONG_T1.indexOf(x) >= 0) { xs += DAY_W.xiT1; xsTags.push(x + '(一)'); }
    else if (XIONG_T2.indexOf(x) >= 0) { xs += DAY_W.xiT2; xsTags.push(x); }
    else { xs += DAY_W.xiT3; xsTags.push(x); }
  });
  if (xs < DAY_W.xiCap) xs = DAY_W.xiCap;
  if (xs < 0) add('凶煞 ' + xsTags.length + '：' + xsTags.slice(0, 5).join('·') + (xsTags.length > 5 ? '…' : ''), Math.round(xs * 10) / 10, '凶煞');

  score = Math.round(score * 10) / 10;
  const lv = dayLvOf(score);

  return {
    date: dateStr,
    day: {
      gz: L.getDayInGanZhi(), gan: L.getDayGan(), zhi: L.getDayZhi(),
      lunar: L.getMonthInChinese() + '月' + L.getDayInChinese(),
      xiu: xiu + L.getAnimal(), xiuLuck: xiuGood ? '吉' : '凶',
      zhiXing: zx, tianShen: L.getDayTianShen(), type: tsType,
      xunKong: L.getDayXunKong ? L.getDayXunKong() : '',
      cai: L.getDayPositionCaiDesc ? L.getDayPositionCaiDesc() : '',
      yi: yi, ji: ji,
    },
    score, level: lv.level, label: lv.label,
    marks,
    favor: yiHit,                       // 命中的「宜·求财」
    against: jiHit.concat(nothing ? ['诸事不宜'] : []),
    good: lv.level === 'd1' || lv.level === 'd2',
  };
}

/**
 * 扫一个日期区间，输出每天的最佳时辰与排名。
 * @param {string} startStr 'YYYY-MM-DD'（含）
 * @param {string} endStr   'YYYY-MM-DD'（含）
 * @param {{topN?:number, now?:string}} o
 */
function range(startStr, endStr, o) {
  o = o || {};
  const topN = o.topN || 5;
  const days = [];
  const d0 = new Date(parseDay(startStr) + 'T00:00:00+08:00');
  const d1 = new Date(parseDay(endStr) + 'T00:00:00+08:00');
  if (isNaN(d0) || isNaN(d1) || d1 < d0) return { start: startStr, end: endStr, n: 0, days: [], ranked: [], top: [], doc: RANGE_DOC };
  const n = Math.min(120, Math.round((d1 - d0) / 86400000) + 1);   // 上限 120 天，防误传大区间把服务拖死

  for (let i = 0; i < n; i++) {
    const dt = new Date(d0.getTime() + i * 86400000);
    const s = dateOf(dt);
    const ds = dayScore(s);
    const z = zeri(s, { light: true });
    // 该日最佳时辰：优先取「吉时」，没有吉时就退求次吉（不是每天都有吉时 —— 实测约 3% 的日子一个都没有）
    const best = z.hours[0];
    const anyGood = z.hours.some(h => h.good);
    days.push({
      date: s, weekday: weekdayOf(dt),
      day: ds.day, score: ds.score, level: ds.level, label: ds.label, marks: ds.marks,
      favor: ds.favor, against: ds.against,
      bestHour: best, hoursGood: z.hours.filter(h => h.good).length, anyGood,
      // 综合分 = 日家分 + 最佳时辰分 × 0.8（时辰再吉也不能救一个坏日子）
      total: Math.round((ds.score + best.score * 0.8) * 10) / 10,
    });
  }

  const ranked = days.slice().sort((a, b) => (b.total - a.total) || (a.date < b.date ? -1 : 1));
  ranked.forEach((d, i) => { d.rank = i + 1; });
  const top = ranked.slice(0, topN);

  return {
    start: startStr, end: endStr, n: days.length,
    days, ranked, top,
    doc: RANGE_DOC,
  };
}
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : String(s);
}
function dateOf(dt) {
  // 用香港时区切片，避免 UTC 偏移把日期挪一天
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(dt).reduce((o, x) => (o[x.type] = x.value, o), {});
  return p.year + '-' + p.month + '-' + p.day;
}
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function weekdayOf(dt) {
  const w = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', weekday: 'short' }).format(dt);
  return '周' + WEEK[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w)];
}

const RANGE_DOC = {
  what: '在卡池剩余期内逐日打分，挑出适宜出手的日子与时辰。',
  map: '⚠️ 黄历里没有「宜抽卡」。本页把抽卡映射到最接近的「求财」类事项（开市 / 交易 / 立券 / 纳财 / 出货财 / 置产）—— **这个映射是本平台定的，不是古法**。',
  dims: [
    { k: '日家天神', v: '日家十二天神：黄道六神 +2.0 ／ 黑道六神 −2.0' },
    { k: '建除十二神', v: '除·危·定·执·成·开 为吉 +1.5 ／ 建·满·平·收·破·闭 为凶 −1.5' },
    { k: '二十八宿', v: '取 lunar.js 自带的宿吉凶，吉宿 +1.0 ／ 凶宿 −1.0' },
    { k: '宜忌（求财）', v: '当日「宜」含求财类 +2.5 ／「忌」含求财类 −2.5 ／「诸事不宜」−3.0' },
    { k: '吉神', v: '分三档累加后封顶 +3.0（天德·月德·天赦·三合·六合·五富 等为一等）' },
    { k: '凶煞', v: '分三档累加后封顶 −3.5（月破·四废·往亡·四离四绝 等为一等）' },
  ],
  combine: '排序分 = 日家分 + 当日最佳时辰分 × 0.8 —— 时辰再吉也救不了一个坏日子，所以日家分权重更高。',
  caveat: '凶煞每日都有 5~8 个轮转，所以按严重程度分档并封顶，不是「有凶煞就扣分」。' +
          '择吉是传统口径，**与抽卡概率无关** —— 抽多少抽、几成把握，一律由官方保底模型给出。',
};

/**
 * 日家择吉的自检。
 * 分位数标定不是「跑一次看着差不多就行」—— 阈值一旦被改动，
 * 「上吉」的占比就会失控（要么满屏吉日、要么一个都没有），这里把占比钉住。
 */
function assertZeriRange() {
  const out = [];
  const chk = (ok, label, got) => out.push({ ok, label, got });

  const N = 400;
  const cnt = { d1: 0, d2: 0, d0: 0, dx: 0 };
  let lo = 99, hi = -99;
  let withYiFavor = 0, withNothing = 0, maxMark = 0;
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < N; i++) {
    const s = new Date(base + i * 86400000).toISOString().slice(0, 10);
    const r = dayScore(s);
    cnt[r.level]++;
    if (r.score < lo) lo = r.score;
    if (r.score > hi) hi = r.score;
    if (!r.marks.length) chk(false, '某天没有任何评分项 ' + s, 0);
    if (r.marks.length > maxMark) maxMark = r.marks.length;
    if (r.favor.length) withYiFavor++;
    if (r.against.indexOf('诸事不宜') >= 0) withNothing++;
  }
  const pct = k => (cnt[k] / N * 100);
  chk(cnt.d1 + cnt.d2 + cnt.d0 + cnt.dx === N, '四个档位覆盖全部样本', N);
  // 占比必须落在标定区间内 —— 这是「阈值按分位数定，不手拍」的落地检查
  chk(pct('d1') >= 5 && pct('d1') <= 18, '「上吉」占比 5~18%', pct('d1').toFixed(1) + '%');
  chk(pct('d2') >= 15 && pct('d2') <= 34, '「吉」占比 15~34%', pct('d2').toFixed(1) + '%');
  chk(pct('d0') >= 28 && pct('d0') <= 52, '「平」占比 28~52%', pct('d0').toFixed(1) + '%');
  chk(pct('dx') >= 12 && pct('dx') <= 34, '「不宜」占比 12~34%', pct('dx').toFixed(1) + '%');
  chk(lo >= -12 && hi <= 12, '分数在权重表可解释区间内', lo + ' ~ ' + hi);
  chk(withYiFavor / N >= 0.3 && withYiFavor / N <= 0.9, '「宜·求财」命中率 30~90%', (withYiFavor / N * 100).toFixed(1) + '%');
  chk(withNothing / N <= 0.12, '「诸事不宜」占比 ≤12%', (withNothing / N * 100).toFixed(1) + '%');
  chk(maxMark <= 8, '单日评分项数 ≤8', maxMark);

  // range() 的结构正确性
  const r = range('2026-09-23', '2026-09-28');
  chk(r.n === 6, '区间天数正确（09-23~09-28 = 6 天）', r.n);
  chk(r.days.length === r.n, 'days 长度一致', r.days.length);
  let sorted = true;
  for (let i = 1; i < r.ranked.length; i++) if (r.ranked[i - 1].total < r.ranked[i].total) sorted = false;
  chk(sorted, '排名按综合分降序', sorted ? 'OK' : '乱序');
  chk(r.top.length === 5 && r.top[0] === r.ranked[0], 'top 就是排行榜前 5', r.top.length);
  let inDay = true;
  r.days.forEach(d => { if (d.bestHour.zhi !== zeri(d.date, { light: true }).hours[0].zhi) inDay = false; });
  chk(inDay, '每天的 bestHour 确实取自该日', inDay ? 'OK' : '不符');
  const dUp = range('2026-09-28', '2026-09-23');
  chk(dUp.n === 0, '起止颠倒返回空区间', dUp.n);
  const rBig = range('2026-01-01', '2027-12-31');
  chk(rBig.n === 120, '超长区间被截到 120 天上限', rBig.n);

  return { all: out.length, failed: out.filter(x => !x.ok).length, list: out, dist: cnt };
}

// ── 自检 ───────────────────────────────────────────────────────────────────
// 1) 关系表互斥性 2) 分数区间合法 3) 档位分布合理（不能「全是吉时」）
function assertZeri() {
  const out = [];
  const chk = (ok, label, got) => out.push({ ok, label, got });

  // 表自洽：六合/六冲/相害 都是双向且无自反
  let tbl = true;
  ZHI.forEach(z => {
    if (LIUHE[LIUHE[z]] !== z || LIUHE[z] === z) tbl = false;
    if (CHONG[CHONG[z]] !== z || CHONG[z] === z) tbl = false;
    if (HAI[HAI[z]] !== z || HAI[z] === z) tbl = false;
  });
  chk(tbl, '六合/六冲/相害表双向且无自反', tbl ? 'OK' : '有错');

  // 三合局 4 组、三会方 4 组，各 3 支且互不重复
  const flat = a => a.reduce((s, g) => s.concat(g), []);
  chk(SANHE.length === 4 && new Set(flat(SANHE)).size === 12, '三合局覆盖十二支不重不漏', flat(SANHE).length);
  chk(SANHUI.length === 4 && new Set(flat(SANHUI)).size === 12, '三会方覆盖十二支不重不漏', flat(SANHUI).length);

  // 天干贵人表：十天干全覆盖
  const ganOk = '甲乙丙丁戊己庚辛壬癸'.split('').every(g => TIANYI[g] && LU[g] && WENCHANG[g]);
  chk(ganOk, '十天干的天乙/禄/文昌都有值', ganOk ? 'OK' : '缺');
  // 禄与天乙不应落在同一支（否则两处都加分却只看一个理由）
  const dup = '甲乙丙丁戊己庚辛壬癸'.split('').filter(g => TIANYI[g].indexOf(LU[g]) >= 0);
  chk(dup.length === 0, '日禄与天乙贵人不同支', dup.join(',') || '无重叠');

  // 标定：抽 400 天，看档位分布与分数区间
  const cnt = { s1: 0, s2: 0, s0: 0, sx: 0 };
  let lo = 99, hi = -99, n = 0;
  const d0 = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 400; i++) {
    const d = new Date(d0.getTime() + i * 86400000);
    const s = d.toISOString().slice(0, 10);
    const r = zeri(s, { light: true });
    r.hours.forEach(h => { cnt[h.level]++; if (h.score < lo) lo = h.score; if (h.score > hi) hi = h.score; n++; });
  }
  chk(n === 4800, '标定样本数', n);
  chk(lo >= -6.1 && hi <= 7.1, '分数落在权重表可解释的区间内', lo + ' ~ ' + hi);
  // 「吉时」应当在 1~3 个时辰之间 —— 一个没有说明不合，满屏都是说明阈值失效
  const perDayS1 = cnt.s1 / 400;
  chk(perDayS1 >= 0.8 && perDayS1 <= 3.5, '平均每日吉时数在 0.8~3.5 之间', perDayS1.toFixed(2));
  chk(cnt.s1 > 0 && cnt.s2 > 0 && cnt.s0 > 0 && cnt.sx > 0, '四个档位都有样本', JSON.stringify(cnt));

  return { all: out.length, failed: out.filter(x => !x.ok).length, list: out, dist: cnt, range: [lo, hi] };
}

module.exports = {
  zeri, assertZeri, HOURS, RANGE, ZHI, W, LEVEL, relOf, DOC, TIANYI, LU, WENCHANG, YIMA,
  dayScore, range, assertZeriRange, DAY_W, DAY_LEVEL, ZHI_XING_GOOD, FAVOR, RANGE_DOC,
};

// 直接跑：node core/zeri.js [YYYY-MM-DD]
if (require.main === module) {
  const d = process.argv[2] || new Date().toISOString().slice(0, 10);
  const a = assertZeri();
  console.log('自检：' + (a.all - a.failed) + '/' + a.all + ' 通过　分数区间 ' + a.range.join(' ~ '));
  a.list.filter(x => !x.ok).forEach(x => console.log('  ✗ ' + x.label + ' → ' + x.got));
  console.log('档位分布(4800 样本)：' + JSON.stringify(a.dist));
  const r = zeri(d);
  console.log('\n' + d + '　' + r.day.gz + '日 · ' + r.day.lunar + ' · ' + r.day.type + '（' + r.day.tianShen + '）· 建除「' + r.day.zhiXing + '」· 旬空 ' + r.day.xunKong);
  console.log('财神 ' + r.day.cai + '　喜神 ' + r.day.xi + '　福神 ' + r.day.fu);
  r.hours.forEach(h => console.log(
    '  ' + String(h.rank).padStart(2) + '. ' + h.zhi + '时 ' + h.range + '  ' + h.gz + '  ' +
    h.tianShen + '(' + h.type + ')  ' + (h.score >= 0 ? '+' : '') + h.score + '  ' + h.label +
    '  ' + h.marks.map(m => m.tag).join(' ')));
}
