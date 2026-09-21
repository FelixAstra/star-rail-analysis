// ─────────────────────────────────────────────────────────────────────────────
// 万年历「吉凶」——给每一条确切时间的出金记录补一个评级
//
// 引擎：6tail 的 lunar-javascript（MIT），已内置在同目录 lunar.js，**离线可跑，不联网**。
// 它给出的是「万年历共有信息」：
//   日家：干支日 · 建除十二神 · 二十八宿 · 十二天神（黄道/黑道）· 当日宜忌
//   时家：时辰干支 · 十二天神（黄道/黑道）—— 这就是「同一天不同时刻吉凶不同」的来源
//
// 十二天神黄黑道顺序固定：
//   黄道 = 青龙 · 明堂 · 金匮 · 天德 · 玉堂 · 司命      （6 个）
//   黑道 = 天刑 · 朱雀 · 白虎 · 天牢 · 玄武 · 勾陈      （6 个）
//
// 评级规则（日为主、时为辅）：
//   日黄道 + 时黄道 → 大吉 ／ 日黄道 + 时黑道 → 吉 ／ 日黑道 + 时黄道 → 平 ／ 日黑道 + 时黑道 → 凶
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const { Solar } = require(path.join(__dirname, 'lunar.js'));

// 时辰序号：0=早子(00:00–00:59)、1=丑、2=寅 … 11=亥、12=晚子(23:00–23:59)
// ⚠️ lunar-javascript 的 getTimes() 正好返回 13 条（子时按早/晚拆开），
//    所以 23 点要落到第 12 条，不能写成 floor((23+1)/2)=12 —— 那样刚好也对，
//    但 floor((0+1)/2)=0 / floor((23+1)/2)=12 这条式子对 23 点是特判，写清楚更安全。
const hourIdx = h => (h === 23 ? 12 : Math.floor((h + 1) / 2));

const YI_MAX = 8;   // 宜/忌各最多列几条，太长会撑爆 tooltip
const cut = (arr, n) => {
  const a = arr || [];
  return a.length > n ? a.slice(0, n).concat(['…等 ' + a.length + ' 项']) : a;
};

/**
 * 算某条记录（"2026-03-02 14:31:07"）的吉凶
 * @returns {{date, day, hour, level:'j1'|'j2'|'p'|'x', label, short, detail}}
 */
function almanac(time) {
  const [d, t] = String(time).trim().split(' ');
  const [Y, M, D] = d.split('-').map(Number);
  const [h, mi] = (t || '00:00:00').split(':').map(Number);
  const l = Solar.fromYmdHms(Y, M, D, h, mi, 0).getLunar();
  const ht = l.getTimes()[hourIdx(h)];

  const day = {
    gz: l.getDayInGanZhi(),                                     // 干支日，如 庚午
    lunar: l.getMonthInChinese() + '月' + l.getDayInChinese(),  // 八月初四
    zhiXing: l.getZhiXing(),                                    // 建除十二神：建除满平定执破危成收开闭
    xiu: l.getXiu() + l.getAnimal(),                            // 二十八宿 + 禽：角蛟
    tianShen: l.getDayTianShen(),                               // 十二天神
    type: l.getDayTianShenType(),                               // 黄道 / 黑道
    luck: l.getDayTianShenLuck(),                               // 吉 / 凶
    yi: l.getDayYi() || [],
    ji: l.getDayJi() || [],
  };
  const hour = {
    zhi: ht.getZhi(), gz: ht.getGanZhi(),
    tianShen: ht.getTianShen(), type: ht.getTianShenType(), luck: ht.getTianShenLuck(),
  };

  const dGood = day.type === '黄道', hGood = hour.type === '黄道';
  const level = dGood && hGood ? 'j1' : (dGood ? 'j2' : (hGood ? 'p' : 'x'));
  const label = { j1: '大吉', j2: '吉', p: '平', x: '凶' }[level];

  const detail = [
    d + ' ' + (t || '').slice(0, 5) + '　农历' + day.lunar + '　' + day.gz + '日',
    '日家：' + day.type + '（' + day.tianShen + '）· 建除「' + day.zhiXing + '」· 星宿「' + day.xiu + '」',
    '时家：' + hour.zhi + '时 ' + hour.gz + '（' + hour.type + '·' + hour.tianShen + '）',
    '评级：' + label + '　＝ 日' + day.type + ' ＋ 时' + hour.type,
    '宜：' + (cut(day.yi, YI_MAX).join('、') || '无'),
    '忌：' + (cut(day.ji, YI_MAX).join('、') || '无'),
  ].join('\n');

  const short = label + ' · ' + day.zhiXing + '日 ' + hour.zhi + '时';
  return { date: d, day, hour, level, label, short, detail };
}

module.exports = { almanac, hourIdx };
