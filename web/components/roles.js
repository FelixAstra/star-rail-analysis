// ─────────────────────────────────────────────────────────────────────────────
// 「角色管理」页 —— 五星角色 × 专属光锥 / 五星光锥全览
// 两块内容与「抽卡分析」页共用组件（w-pair-grid / w-cone-grid），这里只负责页头与页内图例；
// 详细口径（星魂/叠影怎么算、三源怎么合并、虚线框什么意思）统一收在「解释说明」页。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  W.RolePage = {
    props: { a: Object },
    inject: ['goto'],
    computed: {
      c() { return this.a.u5c; },
      l() { return this.a.u5l; },
      miss() { return this.a.missCone; },
      limited() { return this.a.u5l.filter(x => !x.isStd).length; },
      std() { return this.a.u5l.filter(x => x.isStd).length; },
      // 第三源（外部统计补录）当前生效多少条 —— 没上传过就为 0，文案要跟着变
      extN() { return (this.a.external && this.a.external.items) ? this.a.external.items.length : 0; },
      extAt() { const t = this.a.external && this.a.external.updatedAt; return t ? String(t).slice(0, 16).replace('T', ' ') : ''; },
    },
    template: `
    <div class="wrap">
      <div class="pagehead">
        <div>
          <h1>角色管理</h1>
          <div class="sub">五星角色 <b>{{ c.length }}</b> 位（已持有专属光锥 <b>{{ c.length - miss }}</b> 位）·
            五星光锥 <b>{{ l.length }}</b> 张（限定 <b>{{ limited }}</b> ＋ 常驻 <b>{{ std }}</b>）·
            三个来源合并后的结果</div>
        </div>
        <div class="pg-actions">
          <button class="btn" @click="goto('help')">ⓘ 逐项口径看「解释说明」</button>
        </div>
      </div>

      <w-legend></w-legend>

      <w-pair-grid :a="a"></w-pair-grid>
      <w-cone-grid :a="a"></w-cone-grid>

      <div class="slim-hint">
        <b>星魂 / 叠影</b>是「接口窗口 ＋ 工坊截图补录 ＋ 外部统计」<b>三源合计</b>（星魂 = 总金数 − 1、上限 6；叠影 = 总张数、上限 5）。
        前两源是<b>从抽卡记录算</b>的；第三源（<b>外部统计补录</b>）是你在「抓取与数据管理 → ⑤」上传截图后人工确认的<b>真实持有状态</b>，
        按<b>真值快照</b>处理 —— 与抽卡推算不一致时<b>以外部为准</b>，并在行内标出冲突。
        <template v-if="extN"> 目前外部统计生效 <b>{{ extN }}</b> 条（{{ extAt }}）。</template>
        <template v-else> 目前还没有外部统计，读数与「两源合并」时一致。</template>
        <br>小字那行是「命途 · 数据来源」；底部一行是该角色的专属光锥，<b>灰色「未获得」</b>即对应虚线圆圈。
        <span class="rd-more" @click="goto('help')">三源怎么合并 · 为什么可能缺 · 光锥归属怎么分 →</span>
      </div>

      <div class="foot">
        头像与名称资源：本地 <code>assets/</code>（抓取时自动补齐缺失图标）<br>
        本页全部离线渲染，数据只存在本机 <code>data/</code>
      </div>
    </div>`,
  };
})();
