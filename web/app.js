// ─────────────────────────────────────────────────────────────────────────────
// 应用外壳：左侧功能栏 + 右侧内容区
// 左栏分四组：分析（抽卡分析 / 角色管理）· 数据（抓取与数据管理）· 帮助（解释说明）· 后续开发（占位）
// 跨页跳转用 app.provide('goto') 下发，页面内部用 inject:['goto'] 取（例如「详见解释说明」）。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const { createApp, ref, onMounted, onUnmounted } = Vue;

  const NAV = [
    { g: '分析', items: [
      { k: 'analysis', ic: '◎', name: '抽卡分析' },
      { k: 'roles', ic: '✦', name: '角色管理' },
      { k: 'divination', ic: '☯', name: '八卦占卜' },
    ] },
    { g: '数据', items: [
      { k: 'data', ic: '⇅', name: '抓取与数据管理' },
    ] },
    { g: '帮助', items: [
      { k: 'help', ic: 'ⓘ', name: '解释说明' },
    ] },
    { g: '后续开发', items: [
      { k: 'pools', ic: '◷', name: '卡池日历', todo: true },
      { k: 'teams', ic: '⚑', name: '配队与培养建议', todo: true },
      { k: 'settings', ic: '⚙', name: '设置', todo: true },
    ] },
  ];

  // 当前页（放在模块作用域，供 provide 出去的同页跳转使用）
  const page = ref('analysis');
  const goto = (k) => {
    page.value = k;
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  // ── 主题 ──────────────────────────────────────────────────────────────────
  // 四套主题的**配色定义全在 web/theme.css**（按 <html data-theme> 切），
  // 这里只负责「选哪一套」+ 持久化，不碰任何颜色值。
  // ⚠️ 首帧防闪烁靠 index.html <head> 里的内联脚本 —— 不能等 Vue 挂载再设，
  //    否则会先白闪一下再变深色。两边用的 key 必须一致。
  const THEME_KEY = 'sr.theme';
  const THEMES = [
    { k: 'vivid', n: '炫彩', tip: '取自 logo 的深空星云配色：电光蓝 → 紫 → 青，配车头暖光' },
    { k: 'light', n: '明亮', tip: '原来的浅色配色' },
    { k: 'dark', n: '暗黑', tip: '中性冷灰暗色，长时间看不刺眼' },
    { k: 'glass', n: '玻璃', tip: '流体玻璃：半透明面板 + 背景彩色光团' },
  ];
  const THEME_KEYS = THEMES.map(t => t.k);
  const readTheme = () => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return THEME_KEYS.indexOf(t) >= 0 ? t : 'vivid';
    } catch (e) { return 'vivid'; }
  };
  const theme = ref(readTheme());
  const setTheme = (k) => {
    if (THEME_KEYS.indexOf(k) < 0) return;
    theme.value = k;
    document.documentElement.setAttribute('data-theme', k);
    try { localStorage.setItem(THEME_KEY, k); } catch (e) { /* 隐私模式下写不进去，不影响切换 */ }
  };

  const App = {
    setup() {
      const a = ref(null);
      const loading = ref(true);
      const err = ref('');
      // 悬浮回顶按钮：只有滚下去一段才出现，免得静止时挡视线
      const showTop = ref(false);
      const onScroll = () => { showTop.value = window.scrollY > 320; };
      const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

      const load = async (force) => {
        loading.value = !a.value;
        try {
          const r = await fetch('/api/analysis' + (force ? '?fresh=1' : ''));
          const j = await r.json();
          if (j.error) throw new Error(j.error);
          a.value = j;
          err.value = '';
        } catch (e) {
          err.value = W.I18N.t('读分析结果失败：') + e.message;
        } finally { loading.value = false; }
      };

      onMounted(() => {
        load(); onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        // 内联脚本已设过一次；这里再对齐一回，防止 <html> 上的值与内存状态不一致
        document.documentElement.setAttribute('data-theme', theme.value);
        W.I18N.setLang(W.I18N.lang.value);
      });
      onUnmounted(() => window.removeEventListener('scroll', onScroll));
      return { NAV, page, goto, a, loading, err, load, showTop, toTop, theme, THEMES, setTheme, lang: W.I18N.lang, setLang: W.I18N.setLang };
    },
    template: `
    <div class="app">
      <aside class="side">
        <div class="brand">
          <img class="logo" src="/assets/logo.png" :alt="t('崩铁抽卡分析')" width="34" height="34">
          <div><div class="bt">{{ t('崩铁抽卡分析') }}</div><div class="bs">{{ t('本地工作台') }}</div></div>
        </div>
        <template v-for="grp in NAV" :key="grp.g">
          <div class="grp">{{ t(grp.g) }}</div>
          <button v-for="it in grp.items" :key="it.k" class="navi"
                  :class="{ on: page === it.k }" :disabled="it.todo"
                  @click="goto(it.k)">
            <span class="ic">{{ it.ic }}</span>{{ t(it.name) }}
            <span class="tag" v-if="it.todo">{{ t('待开发') }}</span>
          </button>
        </template>
        <div class="sfoot">
          <!-- 主题切换：四套配色定义在 web/theme.css，这里只切 <html data-theme> -->
          <div class="thm">
            <span class="thm-h">{{ t('主题') }}</span>
            <div class="thm-g">
              <button v-for="th in THEMES" :key="th.k" type="button"
                      class="thm-b" :class="[{ on: theme === th.k }, 'sw-' + th.k]"
                      :title="t(th.tip)" :aria-pressed="theme === th.k" @click="setTheme(th.k)">
                <i class="thm-sw"></i><span>{{ t(th.n) }}</span>
              </button>
            </div>
          </div>
          <div class="thm">
            <span class="thm-h">{{ t('语言') }}</span>
            <div class="thm-g">
              <button v-for="lg in ['zh','en']" :key="lg" type="button"
                      class="thm-b thm-lg" :class="{ on: lang === lg }"
                      :aria-pressed="lang === lg" @click="setLang(lg)">
                <span class="lg-native">{{ lg === 'zh' ? '中文' : 'English' }}</span>
              </button>
            </div>
          </div>
          UID <b>{{ a ? a.uid : '—' }}</b><br>
          {{ t('数据只存本机') }} <code>data/</code><br>
          {{ t('除下方一处外，界面与算法全部离线') }}<br>
          <span class="sfoot-net" :title="t('只有卡池日历一项会联网，且失败自动降级到本地缓存 / 内置表')">{{ t('唯一联网点：卡池日历') }}</span>
        </div>
      </aside>

      <main class="main">
        <div v-if="loading" class="wrap"><div class="note">{{ t('正在读取本地抽卡数据…') }}</div></div>
        <div v-else-if="err" class="wrap"><div class="note badge-bad">{{ err }}</div></div>
        <div v-else-if="!a || a.empty" class="wrap">
          <w-empty :msg="t('本地还没有抽卡记录')" :hint="t('去左侧的「抓取与数据管理」粘贴一条抽卡链接，抓一次就有了。')"></w-empty>
        </div>
        <template v-else>
          <w-analysis-page v-if="page === 'analysis'" :a="a"></w-analysis-page>
          <w-role-page v-else-if="page === 'roles'" :a="a"></w-role-page>
          <w-divination-page v-else-if="page === 'divination'" :a="a"></w-divination-page>
          <w-help-page v-else-if="page === 'help'" :a="a"></w-help-page>
          <w-data-manage v-else-if="page === 'data'" :a="a"
                         @refetch="load(true)" @refresh-icon="load(true)"></w-data-manage>
        </template>
      </main>

      <button type="button" class="fab" :class="{ show: showTop }" :tabindex="showTop ? 0 : -1"
              :aria-label="t('回到顶部')" :title="t('回到顶部')" @click="toTop">
        <svg class="fab-svg" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M2.5 26.6c5.4 0 7.2-3.1 13.5-3.1s8.1 3.1 13.5 3.1" fill="none"
                stroke="#5b4318" stroke-opacity=".38" stroke-width="1.5" stroke-linecap="round"/>
          <rect x="4.6" y="12.6" width="22.8" height="9.4" rx="3.4" fill="#5b4318"/>
          <rect x="8.2" y="7.2" width="5.2" height="6.2" rx="1.7" fill="#5b4318"/>
          <circle cx="8.8" cy="4.6" r="1.55" fill="#5b4318" fill-opacity=".5"/>
          <circle cx="13.4" cy="2.9" r="1.95" fill="#5b4318" fill-opacity=".3"/>
          <circle cx="22.4" cy="17.3" r="3.15" fill="#fdf4e2"/>
          <path d="M22.4 15.05l.8 1.72 1.88.22-1.4 1.29.39 1.87-1.67-.97-1.67.97.39-1.87-1.4-1.29 1.88-.22z"
                fill="#5b4318"/>
          <circle cx="10.4" cy="23.2" r="2.15" fill="#5b4318"/>
          <circle cx="20.6" cy="23.2" r="2.15" fill="#5b4318"/>
        </svg>
      </button>
    </div>`,
  };

  const app = createApp(App);
  app.provide('goto', goto);
  // 全局混入：所有组件模板里可直接用 t() / n() / L() / guaEn()
  // （t/n 内部读 W.I18N.lang 这个 reactive ref → 切语言时所有用到它们的模板自动重渲染）
  const I = W.I18N;
  app.mixin({
    methods: {
      t: I.t, n: I.n, L: I.L, guaEn: I.guaEn,
      // 数据来源文案：引擎给的是 srcKeys（win/hist/ext），按语言拼
      srcTx(keys) {
        const zh = { win: '接口窗口', hist: '截图补录', ext: '外部统计' };
        const en = { win: 'API window', hist: 'Screenshot backfill', ext: 'External stats' };
        const m = I.lang.value === 'en' ? en : zh;
        return (keys && keys.length ? keys.map(k => m[k] || k) : [m.hist]).join(' + ');
      },
    },
  });
  app.component('w-pull-tag', W.PullTag);
  app.component('w-alm-badge', W.AlmBadge);
  app.component('w-item-card', W.ItemCard);
  app.component('w-stat-card', W.StatCard);
  app.component('w-empty', W.Empty);
  app.component('w-legend', W.Legend);
  app.component('w-overview', W.Overview);
  app.component('w-pool-bounds', W.PoolBounds);
  app.component('w-pool-detail', W.PoolDetail);
  app.component('w-banner-tabs', W.BannerTabs);
  app.component('w-pair-grid', W.PairGrid);
  app.component('w-cone-grid', W.ConeGrid);
  // 外部统计补录（上传截图 → 本地图标匹配 → 人工确认），嵌在数据管理页第 ⑤ 张卡里
  app.component('w-shot-import', W.ShotImport);
  // 注：w-audit（数据校验：与工坊对账）已按需求 1.2-4 下线
  app.component('w-analysis-page', W.AnalysisPage);
  app.component('w-role-page', W.RolePage);
  app.component('w-divination-page', W.DivinationPage);
  app.component('w-help-page', W.HelpPage);
  app.component('w-data-manage', W.DataManage);
  app.mount('#app');
})();
