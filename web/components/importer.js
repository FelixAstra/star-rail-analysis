// ─────────────────────────────────────────────────────────────────────────────
// 「外部统计补录」—— 上传其他统计渠道的截图 → 本地图标匹配 → 人工确认 → 写进第三源
//
// 流程：上传（原图留档）→ 浏览器里用本机图标库做模板匹配 → **人工确认表**（改错 / 增删）
//       → 保存 → 引擎按「真值快照、覆盖旧值」合并 → 角色管理页立刻更新 + 缺失图标自动补齐
//
// ⚠️ 识别只是「把表预填好」，不保证全对：截图分辨率、缩放、UI 皮肤都会影响命中率。
// ⚠️ 这块数据**只有命数、没有抽数**，绝不参与任何比率口径（引擎里也是这么接的）。
// 2026-09-25（多语言）：界面文案走 t()；**名字输入框保持中文**（数据侧的名字就是中文名），
//   展示处一律 n() 换成官方英文名。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};
  const { ref, computed, onMounted, onUnmounted, watch } = Vue;

  const pad = n => String(n).padStart(2, '0');
  const fmtNow = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
      + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  };
  const SNAP_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
  const scoreCls = s => (s >= 0.86 ? 'hi' : (s >= 0.72 ? 'mid' : 'lo'));

  W.ShotImport = {
    props: { a: Object },
    emits: ['refetch'],
    setup(props, { emit }) {
      const lib = ref(null);            // /api/iconlib
      const idxCh = ref({}), idxLc = ref({});
      const busy = ref(false);
      const err = ref('');
      const okMsg = ref(null);          // { n, ch, lc, ic } | null —— 存参数，模板里按语言拼
      const bad = ref([]);              // 服务端拒收的行
      const dups = ref([]);
      const prog = ref(null);           // { msg, pct }
      const rows = ref([]);             // 确认表
      const shots = ref([]);            // [{ file, url, w, h }]
      const saved = ref({ items: [], updatedAt: '', shots: [], files: [] });
      const drawBoxes = ref(true);
      const sensitivity = ref(1.0);
      const fivesOnly = ref(true);
      const snapAt = ref(fmtNow());
      const snapTouched = ref(false);
      let tick = null;

      const conf = computed(() => (props.a && props.a.external) || { items: 0, conflicts: [], bad: [], shots: 0, updatedAt: '' });
      const nameList = computed(() => kind => Object.values(kind === 'lc' ? idxLc.value : idxCh.value)
        .map(v => v.name).sort((a, b) => a.localeCompare(b, 'zh')));
      const rowsValid = computed(() => rows.value.filter(r => r.name && r.kind));

      const loadAll = async () => {
        try {
          lib.value = await (await fetch('/api/iconlib')).json();
          idxCh.value = await (await fetch('/assets/index/cn_characters.json')).json();
          idxLc.value = await (await fetch('/assets/index/cn_light_cones.json')).json();
          saved.value = await (await fetch('/api/external')).json();
        } catch (e) { err.value = W.I18N.t('读取图标库 / 外部统计失败：') + e.message; }
      };

      // ── 上传 + 识别 ────────────────────────────────────────────────────────
      const onPick = async (files) => {
        const list = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name));
        if (!list.length) { err.value = W.I18N.t('请选 PNG / JPG / WebP 图片'); return; }
        if (!lib.value) { err.value = W.I18N.t('图标库还没载入完，稍等一下再试'); return; }
        busy.value = true; err.value = ''; okMsg.value = null; bad.value = []; prog.value = { msg: W.I18N.t('准备…'), pct: 0 };
        try {
          for (const f of list) {
            // ① 原图留档（服务端只存不解析）
            prog.value = { msg: W.I18N.t('上传留档 {name}…', { name: f.name }), pct: 1 };
            const up = await (await fetch('/api/shots', { method: 'POST', body: f })).json();
            if (up.error) throw new Error(up.error);
            const url = '/data/uploads/' + up.file;
            const dim = await new Promise(res => {
              const im = new Image();
              im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
              im.onerror = () => res({ w: 0, h: 0 });
              im.src = url;
            });
            shots.value.unshift({ file: up.file, url, w: dim.w, h: dim.h, name: f.name });

            // ② 浏览器里做图标匹配
            const r = await W.Match.run(f, lib.value, {
              sensitivity: sensitivity.value, fivesOnly: fivesOnly.value,
              onProgress: (msg, pct) => { prog.value = { msg, pct: Math.max(1, Math.min(99, pct)) }; },
            });
            r.rows.forEach(x => rows.value.push({
              kind: x.kind, name: x.name, v: x.v, score: x.score,
              shot: up.file, x: x.x, y: x.y, size: x.size,
              auto: true,
            }));
            prog.value = { msg: W.I18N.t('识别完成：{n} 个区域（{ms}ms，工作尺寸 {work}）', { n: r.rows.length, ms: r.meta.ms, work: r.meta.work }), pct: 100 };
          }
          okMsg.value = { n: list.length };
          dedupe();
          emit('refetch');
        } catch (e) { err.value = W.I18N.t('处理失败：') + e.message; }
        finally { busy.value = false; setTimeout(() => { prog.value = null; }, 4000); }
      };

      const onDrop = e => { e.preventDefault(); onPick(e.dataTransfer.files); };
      const onFileInput = e => { onPick(e.target.files); e.target.value = ''; };

      // 同名同类型只留一条（后出现的覆盖前面的），避免写出一份自相矛盾的快照
      const dedupe = () => {
        const seen = new Map(), out = [];
        rows.value.forEach(r => {
          const k = r.kind + '|' + String(r.name || '').trim();
          if (r.name && seen.has(k)) {
            const i = out.findIndex(x => x.kind === r.kind && String(x.name || '').trim() === String(r.name || '').trim());
            if (i >= 0) out[i] = r;
            return;
          }
          if (r.name) seen.set(k, 1);
          out.push(r);
        });
        rows.value = out;
      };
      const addRow = () => rows.value.push({ kind: 'ch', name: '', v: 0, score: null, shot: '', shotIdx: 0, x: 0, y: 0, size: 0, auto: false });
      const delRow = i => rows.value.splice(i, 1);
      const clearRows = () => { rows.value = []; okMsg.value = null; err.value = ''; bad.value = []; };

      // ── 保存 ───────────────────────────────────────────────────────────────
      const save = async () => {
        err.value = ''; okMsg.value = null; bad.value = []; dups.value = [];
        if (!rowsValid.value.length) { err.value = W.I18N.t('确认表里还没有有效行（每行都要有类型和名字）'); return; }
        const at = String(snapAt.value || '').trim().replace('T', ' ') || fmtNow();
        if (!SNAP_RE.test(at)) { err.value = W.I18N.t('「快照时间」格式应为 2026-09-17 或 2026-09-17 09:07:12'); return; }
        busy.value = true;
        try {
          const items = rowsValid.value.map(r => ({
            kind: r.kind, name: String(r.name).trim(), v: Number(r.v),
            at, src: '外部统计截图', score: r.score,
          }));
          const r = await fetch('/api/external', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, shots: saved.value.shots || [] }),
          });
          const j = await r.json();
          if (j.error) { err.value = j.error; bad.value = j.bad || []; return; }
          saved.value = await (await fetch('/api/external')).json();
          const ic = j.icons || {};
          okMsg.value = { n: j.items.length, ch: j.items.filter(x => x.kind === 'ch').length, lc: j.items.filter(x => x.kind === 'lc').length, ic: ic.downloaded || 0 };
          rows.value = [];
          emit('refetch');
        } catch (e) { err.value = W.I18N.t('保存失败：') + e.message; }
        finally { busy.value = false; }
      };

      const clearAll = async () => {
        if (!confirm(W.I18N.t('清空全部外部统计？角色管理页会退回到「接口窗口 ＋ 截图补录」两源的推算值。'))) return;
        busy.value = true; err.value = '';
        try {
          const r = await fetch('/api/external', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [] }),
          });
          const j = await r.json();
          if (j.error) { err.value = j.error; return; }
          saved.value = await (await fetch('/api/external')).json();
          okMsg.value = { cleared: true };
          emit('refetch');
        } catch (e) { err.value = W.I18N.t('清空失败：') + e.message; }
        finally { busy.value = false; }
      };

      const followNow = () => { snapTouched.value = false; snapAt.value = fmtNow(); };
      const snapHint = computed(() => {
        if (!snapTouched.value) return W.I18N.t('正在实时跟随当前时间（精确到秒）');
        const v = String(snapAt.value || '').trim();
        return v.length <= 10 ? W.I18N.t('已手动填到「日」') : W.I18N.t('已手动填写，不再跟随');
      });

      onMounted(() => {
        loadAll();
        tick = setInterval(() => { if (!snapTouched.value) snapAt.value = fmtNow(); }, 1000);
      });
      onUnmounted(() => { if (tick) clearInterval(tick); });

      // 缩略图：用 CSS 背景从原图裁出识别到的那一块（按该行所属的那张截图来裁，多图时不串图）
      const thumbStyle = r => {
        if (!r.shot || !r.size) return {};
        const s = shots.value.find(x => x.file === r.shot);
        if (!s) return {};
        const k = 40 / r.size;   // 缩略图 40px，背景按比例放大
        return {
          backgroundImage: 'url(' + s.url + ')',
          backgroundSize: (s.w * k) + 'px ' + (s.h * k) + 'px',
          backgroundPosition: (-r.x * k) + 'px ' + (-r.y * k) + 'px',
        };
      };
      // 某张截图上识别到的所有框（画在预览上，方便判断「漏检 / 误检」）
      const boxesOf = file => {
        const s = shots.value.find(x => x.file === file);
        if (!s || !s.w) return [];
        return rows.value.filter(r => r.shot === file && r.size).map(r => ({
          left: (r.x / s.w * 100) + '%',
          top: (r.y / s.h * 100) + '%',
          width: (r.size / s.w * 100) + '%',
          cls: scoreCls(r.score == null ? 0 : r.score),
          title: (r.name ? W.I18N.n(r.name) : W.I18N.t('未识别')) + (r.score != null ? ' · ' + r.score.toFixed(3) : ''),
        }));
      };

      return {
        lib, busy, err, okMsg, bad, dups, prog, rows, shots, saved, conf,
        drawBoxes, sensitivity, fivesOnly, snapAt, snapTouched, snapHint, followNow,
        nameList, rowsValid, onPick, onDrop, onFileInput, addRow, delRow, clearRows,
        save, clearAll, scoreCls, thumbStyle, boxesOf,
      };
    },
    template: `
    <div class="imp">
      <div class="ch">
        <span v-html="t('除官方抽卡接口之外，你在<b>别处看到的总量/持有状态</b>也能录进来：游戏内「角色 / 光锥」列表、星穹工坊统计页、米游社等。上传截图 → 平台用<b>本机图标库</b>做模板匹配（<b>全程离线，图片不出本机</b>）→ 你在下面确认表里核对/改正 → 保存。<br>')"></span>
        <span v-html="t('它只提供<b>星魂 / 叠影</b>，所以<b>不参与任何抽数口径</b>（总抽数 / 出金率 / 每 UP / 小保底不歪都不受影响）；与抽卡记录推算不一致时<b>以这里为准</b>，但会明确提示冲突在哪。')"></span>
      </div>

      <div class="imp-drop" :class="{ busy }" @dragover.prevent @drop="onDrop"
           @click="$refs.fi.click()">
        <input ref="fi" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="onFileInput">
        <div class="di">⇪</div>
        <div class="dt" v-html="t('<b>把截图拖进来</b>，或点这里选择文件（可多选）')"></div>
        <div class="ds" v-html="t('支持 PNG / JPG / WebP · 单张上限 24MB · 原图会留档在 <code>data/uploads/</code>，方便事后回溯')"></div>
      </div>

      <div class="row imp-opt">
        <label class="imp-ck"><input type="checkbox" v-model="fivesOnly"> {{ t('只匹配五星（更快，角色管理页本来就只统计五星）') }}</label>
        <label class="imp-ck">{{ t('灵敏度') }}
          <input type="range" min="0.2" max="1.8" step="0.1" v-model.number="sensitivity">
          <b>{{ sensitivity.toFixed(1) }}</b>
        </label>
        <label class="imp-ck"><input type="checkbox" v-model="drawBoxes"> {{ t('在预览上画出识别框') }}</label>
      </div>

      <div v-if="prog" class="imp-prog">
        <div class="bar"><i :style="{ width: prog.pct + '%' }"></i></div>
        <div class="tx">{{ prog.msg }}</div>
      </div>
      <div v-if="err" class="badge-bad" style="font-size:12.5px">{{ err }}</div>
      <div v-if="okMsg" class="badge-ok" style="font-size:12.5px"
           v-html="okMsg.cleared ? t('已清空外部统计') : (okMsg.ic ? t('已保存 {n} 条（角色 {ch} / 光锥 {lc}），自动补齐了 {ic} 个图标 —— 角色管理页已更新', okMsg) : t('已保存 {n} 条（角色 {ch} / 光锥 {lc}）—— 角色管理页已更新', okMsg))"></div>

      <!-- ── 上传的截图预览 + 识别框 ────────────────────────────────────── -->
      <div v-if="shots.length" class="imp-shots">
        <div v-for="s in shots" :key="s.file" class="ishot">
          <div class="iimg">
            <img :src="s.url" :alt="s.name">
            <template v-if="drawBoxes">
              <i v-for="(b, i) in boxesOf(s.file)" :key="i" class="ibox" :class="b.cls"
                 :style="{ left: b.left, top: b.top, width: b.width, height: b.width }" :title="b.title"></i>
            </template>
          </div>
          <div class="icap">{{ s.name }}<br><span>{{ s.w }}×{{ s.h }} · {{ s.file.slice(0, 15) }}…</span></div>
        </div>
      </div>

      <!-- ── 人工确认表 ──────────────────────────────────────────────────── -->
      <h3 style="margin-top:18px">{{ t('确认表') }} <small v-if="rows.length" v-html="t('{n} 行 · 识别结果仅供参考，请逐行核对', { n: rows.length })"></small></h3>
      <div class="ch">
        <span v-html="t('带「<b>识别</b>」角标的行是自动填的，<b>分数</b>越接近 1 越可信（<b>≥0.86 较稳</b>、0.72~0.86 要留意、<b>&lt;0.72 建议手动改</b>）。角色填<b>星魂</b>（0~6），光锥填<b>叠影</b>（1~5，只抽到 1 张就填 1）。改完点最下面的「保存到角色管理」。')"></span>
      </div>
      <table class="tb imp-tb">
        <thead><tr>
          <th style="width:52px">{{ t('图') }}</th><th style="width:96px">{{ t('类型') }}</th><th>{{ t('名字') }}</th>
          <th class="hn" style="width:96px">{{ t('星魂/叠影') }}</th><th class="hn" style="width:76px">{{ t('分数') }}</th><th style="width:44px"></th>
        </tr></thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td><div class="thumb" :style="thumbStyle(r)"></div></td>
            <td>
              <select v-model="r.kind">
                <option value="ch">{{ t('角色') }}</option>
                <option value="lc">{{ t('光锥') }}</option>
              </select>
              <span v-if="r.auto" class="tag-auto">{{ t('识别') }}</span>
            </td>
            <td>
              <input :list="r.kind === 'lc' ? 'lc-names' : 'ch-names'" v-model="r.name" :placeholder="t('输入名字（可搜索）')">
            </td>
            <td class="num"><input type="number" class="vnum" v-model.number="r.v" :min="r.kind === 'lc' ? 1 : 0" :max="r.kind === 'lc' ? 5 : 6"></td>
            <td class="num"><span v-if="r.score != null" class="sc" :class="scoreCls(r.score)">{{ r.score.toFixed(3) }}</span><span v-else class="sc na">{{ t('手动') }}</span></td>
            <td><button class="btn xs" @click="delRow(i)" :title="t('删掉这一行')">✕</button></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" style="color:var(--tx3)">{{ t('还没有待确认的行 —— 上传截图，或点下面「＋ 手动加一行」。') }}</td></tr>
        </tbody>
      </table>
      <datalist id="ch-names"><option v-for="nm in nameList('ch')" :key="nm" :value="nm"></option></datalist>
      <datalist id="lc-names"><option v-for="nm in nameList('lc')" :key="nm" :value="nm"></option></datalist>

      <div class="row">
        <button class="btn" @click="addRow">{{ t('＋ 手动加一行') }}</button>
        <button class="btn" :disabled="!rows.length" @click="clearRows">{{ t('清空确认表') }}</button>
        <span class="sep"></span>
        <label class="fl2">{{ t('快照时间') }}</label>
        <input class="snap" type="text" v-model="snapAt" @input="snapTouched = true" placeholder="2026-09-17 09:07:12">
        <button v-if="snapTouched" class="lnk" type="button" @click="followNow">{{ t('↻ 跟随当前时间') }}</button>
        <span class="hint2">{{ snapHint }}</span>
      </div>
      <div class="row">
        <button class="btn pri" :disabled="busy || !rowsValid.length" @click="save">
          {{ busy ? t('处理中…') : t('保存到角色管理（{n} 条）', { n: rowsValid.length }) }}
        </button>
        <span class="hint2" v-html="t('保存会<b>整体覆盖</b>上一次的外部统计（这是一份「此刻状态」的快照，不是追加）')"></span>
      </div>
      <div v-if="bad.length" class="badge-bad" style="font-size:12.5px;display:block">
        <span v-html="t('有 {n} 行没通过校验，<b>没有写入</b>：', { n: bad.length })"></span>
        <div v-for="(b, i) in bad" :key="i">· {{ n(b.name) }} —— {{ b.why }}</div>
      </div>

      <!-- ── 已录入 ──────────────────────────────────────────────────────── -->
      <h3 style="margin-top:18px">{{ t('已录入的外部统计') }} <small v-if="conf.items" v-html="t('{n} 条 · 上传过 {m} 张图', { n: conf.items, m: conf.shots })"></small></h3>
      <div class="ch" v-html="t('这份数据代表账号<b>此刻的真实持有状态</b>，重传一张更全的截图会把它整体顶掉（所以是覆盖，不是累加）。')"></div>
      <table class="tb" v-if="saved.items && saved.items.length">
        <thead><tr><th style="width:52px">{{ t('图') }}</th><th style="width:60px">{{ t('类型') }}</th><th>{{ t('名字') }}</th><th class="hn" style="width:96px">{{ t('星魂/叠影') }}</th><th style="width:170px">{{ t('记录时刻') }}</th></tr></thead>
        <tbody>
          <tr v-for="x in saved.items" :key="x.kind + x.id">
            <td><img class="mini" loading="lazy" :src="'assets/' + (x.kind === 'lc' ? 'light_cone' : 'avatar') + '/' + x.id + '.png'" :alt="n(x.name)"></td>
            <td>{{ x.kind === 'lc' ? t('光锥') : t('角色') }}</td>
            <td>{{ n(x.name) }} <code v-if="x.score != null">{{ t('识别') }} {{ x.score.toFixed(3) }}</code></td>
            <td class="num">{{ x.v }}</td>
            <td class="mono">{{ String(x.at || '').slice(0, 19).replace('T', ' ') || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="hint2">{{ t('还没有录入任何外部统计 —— 角色管理页现在用的是「接口窗口 ＋ 截图补录」两源的推算值。') }}</div>
      <div class="row" v-if="saved.items && saved.items.length">
        <button class="btn" :disabled="busy" @click="clearAll">{{ t('清空全部外部统计') }}</button>
        <span class="hint2">{{ t('清空后角色管理页会退回两源推算值，截图留档不受影响。') }}</span>
      </div>

      <!-- ── 与抽卡记录的冲突 ───────────────────────────────────────────── -->
      <div v-if="conf.conflicts && conf.conflicts.length" class="imp-conf">
        <span v-html="t('<b>⚠️ 有 {n} 处「外部统计」与「抽卡记录推算」不一致</b>，已按外部统计生效：', { n: conf.conflicts.length })"></span>
        <div v-for="(c, i) in conf.conflicts" :key="i" class="cl">
          · <b>{{ n(c.name) }}</b>（{{ t(c.unit) }}）：<span v-html="t('外部说 <b>{ext}</b>，抽卡记录推算 <b>{calc}</b>', { ext: c.ext, calc: c.calc })"></span>
          <span class="d">{{ L(c.calcFrom, c.calcFromEn) }}</span>
        </div>
        <div class="d">{{ t('不一致不等于谁错了：抽卡推算依赖「截图补录」那段手抄数据，缺一笔就会偏低；以外部统计为准最稳。') }}</div>
      </div>
      <div v-if="conf.bad && conf.bad.length" class="badge-bad" style="font-size:12.5px;display:block">
        <span v-html="t('<b>data/external.json 里有 {n} 行解析不出来</b>（已忽略，不影响其它条目）：', { n: conf.bad.length })"></span>
        <div v-for="(b, i) in conf.bad" :key="i">· {{ n(b.name) }} —— {{ b.why }}</div>
      </div>
    </div>`,
  };
})();
