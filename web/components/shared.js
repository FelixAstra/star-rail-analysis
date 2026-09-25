// ─────────────────────────────────────────────────────────────────────────────
// 共用小组件 —— 平台里所有页面都可以用（无构建，直接挂到 window.W 上）
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};
  const { h } = Vue;

  // 抽数标签：接口的彩底（UP 绿 / 歪 红 / 常驻 灰）、联动紫、截图段虚线框
  // ⚠️ prop 名用 pt（不用 t）：t 已被全局混入占用（i18n 的 t()），同名会把它遮住。
  W.PullTag = {
    props: { pt: Object },
    template: '<span class="pl" :class="pt.cls" :title="L(pt.title, pt.titleEn)">{{ pt.num }}{{ t(\'抽\') }}<b v-if="pt.tag">{{ t(pt.tag) }}</b></span>',
  };

  // 吉凶徽章（万年历内容，按既定口径不翻译）
  W.AlmBadge = {
    props: { alm: Object },
    template: '<span class="jx"><span class="jxb" :class="alm.level" :title="alm.detail">{{ alm.label }}</span>'
      + '<span class="jxt">{{ alm.short }}</span></span>',
  };

  // 稀有度圆环卡（四星 / 三星通用）
  W.ItemCard = {
    props: { it: Object, showPulls: { type: Boolean, default: true } },
    computed: {
      ring() { return { '5': 'var(--ring-c5)', '4': 'var(--ring-c4)', '3': 'var(--ring-c3)' }[this.it.rank]; },
    },
    template: `
      <div class="c" :class="'ar' + it.rank">
        <div class="cw" :style="{ '--ring': ring }">
          <img loading="lazy" :src="'assets/' + it.dir + '/' + it.id + '.png'" :alt="n(it.name)">
          <span class="ck">★{{ it.rank }}</span>
        </div>
        <div class="cn" :title="n(it.name)">{{ n(it.name) }}</div>
        <div class="cm"><template v-if="it.count > 1">×{{ it.count }}</template><template v-else>&nbsp;</template></div>
        <div class="cpl" v-if="showPulls && it.pulls.length">
          <w-pull-tag v-for="(p, i) in it.pulls" :key="i" :pt="p"></w-pull-tag>
        </div>
      </div>`,
  };

  // 数据总貌的一张统计卡（key / value / sub 由引擎成对产出，按语言二选一）
  // ⚠️ value 也必须成对：抽数值里嵌着「 抽」这种中文单位（<span class="u"> 抽</span>），
  //    只翻 key/sub 会让英文态的数字后面挂着中文单位。
  W.StatCard = {
    props: { s: Object },
    template: `<div class="st" :class="s.cls"><div class="sk">{{ L(s.key, s.keyEn) }}</div>`
      + `<div class="sv" v-html="L(s.value, s.valueEn)"></div><div class="ss" v-html="L(s.sub, s.subEn)"></div></div>`,
  };

  // 空状态
  W.Empty = {
    props: { msg: String, hint: String },
    template: `<div class="note" style="text-align:center;padding:34px 18px">
      <div style="font-size:15px;color:var(--tx)">{{ msg }}</div>
      <div v-if="hint" style="font-size:12.5px;color:var(--tx3);margin-top:6px" v-html="hint"></div></div>`,
  };
})();
