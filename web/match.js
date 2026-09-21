// ─────────────────────────────────────────────────────────────────────────────
// 崩铁抽卡分析平台 · 浏览器端图标检测 + 匹配
//
// 用途：把「外部统计渠道」的截图（游戏内角色列表 / 星穹工坊统计页 / 米游社等）
//       在**本机浏览器里**跑一遍，找出图上有哪些角色 / 光锥，供人工确认表预填。
//
// 为什么在浏览器里做、不用服务端 OCR：
//   · 平台是**纯本地离线**的，不能调云端大模型；
//   · 但本机已经有整套角色头像 / 光锥图标（assets/avatar、assets/light_cone），
//     而截图里的图标就是**同一套原图**渲染出来的 → 直接拿本地图标做模板匹配最准，且零依赖。
//
// 算法（全部用 canvas + TypedArray，无第三方库）：
//   ① 把上传图缩到工作尺寸（长边 ≤1600）并灰度化
//   ② 算「局部细节能量」图 = |gray − boxBlur(gray)|，用**积分图**把任意窗口的和做到 O(1)
//   ③ 对几档候选图标边长，在细节能量图上取窗口均值 → 阈值 → 连通域求紧包围盒 → 面积/长宽比过滤
//   ④ 每个候选框缩放到 24×24、零均值单位化，与库中每个图标（同样处理）做**归一化互相关 NCC**
//   ⑤ 框的松紧有不确定性，所以每个候选还会试几档窗口倍数，取全局最优
//
// ⚠️ 这不是「自动识别就完事」：截图分辨率、缩放、UI 皮肤都会影响命中率，
//    所以结果一律进**人工确认表**，识别只是把表预填好。宁可标「未识别」也不要猜错。
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const W = window.W = window.W || {};

  const GRAY_BG = 0x24;          // 透明像素合成用的中性底色（深灰，接近游戏 UI）
  const N = 24;                  // 特征图边长（N×N）
  const INSET = 0.12;            // 裁剪时四周内缩比例：避开圆形头像的圆角与方图圆角
  const WORK_LONG = 1600;        // 工作尺寸长边上限
  // 候选图标边长（工作尺寸像素）。跨度要够大：手机截图里的「角色列表」格子可以小到 40px，
  // 而 4K 截图放大后的方形立绘能到 200px 以上。
  const SIZES = [30, 38, 46, 56, 66, 78, 92, 108, 126, 148, 172, 200];
  // ⚠️ 必须**同时包含缩小与放大**两档。
  //    检测器给的边长总有误差（图标外套了卡框就会偏大），而 NCC 对「框比图标大」极其敏感
  //    （实测：精确框 6/6 全对且分数 0.98+；放大到 1.5 倍就 6/6 全错）。
  //    只能放大不能缩小的话，一旦检测偏大就永远救不回来。
  const WIN_MUL = [0.76, 0.85, 0.94, 1.04, 1.15, 1.3];
  // ⚠️ 上限保护：纹理很密的截图（细格子、重复花纹）会让「细节能量」处处超标，
  //    候选数一爆，后面「候选 × 图标库」就是乘法爆炸，页面直接卡死。
  //    宁可少给几个候选（用户还能手动加行），也不能把浏览器拖住。
  const MAX_BOXES = 200;
  const MAX_CAND = 120;

  // ── 基础图像工具 ──────────────────────────────────────────────────────────

  /** 把 image/canvas 画到指定尺寸的离屏 canvas，返回灰度 Uint8ClampedArray */
  function grayOf(src, w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    // 先铺中性底再画：头像 PNG 的圆形之外是透明像素，直接读会拿到 0（黑），
    // 和截图里「透明处显示的是 UI 背景色」对不上，会污染 NCC。
    ctx.fillStyle = 'rgb(' + GRAY_BG + ',' + GRAY_BG + ',' + GRAY_BG + ')';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Uint8ClampedArray(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    }
    return g;
  }

  /** 对矩形 src 区域算灰度（用于从原图裁一个候选框） */
  function grayOfRect(img, sx, sy, sw, sh, outN) {
    const cv = document.createElement('canvas');
    cv.width = outN; cv.height = outN;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'rgb(' + GRAY_BG + ',' + GRAY_BG + ',' + GRAY_BG + ')';
    ctx.fillRect(0, 0, outN, outN);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outN, outN);
    const d = ctx.getImageData(0, 0, outN, outN).data;
    const g = new Float64Array(outN * outN);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    }
    return g;
  }

  /** 分离式 box 均值模糊（半径 r）。Float32 足够，省一半内存（大图会跑几次） */
  function boxBlur(src, w, h, r, out) {
    const tmp = new Float32Array(w * h);
    out = out || new Float32Array(w * h);
    const win = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / win;
        const add = src[y * w + Math.min(w - 1, x + r + 1)];
        const sub = src[y * w + Math.max(0, x - r)];
        sum += add - sub;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
        const sub = tmp[Math.max(0, y - r) * w + x];
        sum += add - sub;
      }
    }
    return out;
  }

  /** 积分图：(w+1)×(h+1)，sum(x0..x1, y0..y1) 用四个角 O(1) 求 */
  function integral(src, w, h) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += src[y * w + x];
        I[(y + 1) * (w + 1) + (x + 1)] = I[y * (w + 1) + (x + 1)] + row;
      }
    }
    return I;
  }
  const rectSum = (I, w, x0, y0, x1, y1) =>
    I[(y1 + 1) * (w + 1) + (x1 + 1)] - I[y0 * (w + 1) + (x1 + 1)]
    - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];

  // ── 特征向量：零均值 + 单位长度（NCC 用） ──────────────────────────────────
  function toVector(g, ins) {
    const n = Math.round(Math.sqrt(g.length));
    const i0 = Math.floor(n * ins), i1 = n - i0;
    const v = new Float64Array((i1 - i0) * (i1 - i0));
    let sum = 0, k = 0;
    for (let y = i0; y < i1; y++) for (let x = i0; x < i1; x++) { const val = g[y * n + x]; v[k++] = val; sum += val; }
    const mean = sum / v.length;
    let norm = 0;
    for (let i = 0; i < v.length; i++) { v[i] -= mean; norm += v[i] * v[i]; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }
  const ncc = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  // ── 候选框检测 ────────────────────────────────────────────────────────────
  /** 在布尔掩码上做 4 邻域连通域标注，返回每个连通域的紧包围盒 */
  function components(mask, w, h, minArea) {
    const lab = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || lab[i]) continue;
      let sp = 0; stack[sp++] = i; lab[i] = 1;
      let x0 = w, x1 = -1, y0 = h, y1 = -1, area = 0;
      while (sp > 0) {
        const p = stack[--sp]; area++;
        const x = p % w, y = (p - x) / w;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = 1; stack[sp++] = p + w; }
      }
      if (area >= minArea) out.push({ x0, y0, x1, y1, area });
    }
    return out;
  }

  /**
   * 找图标位置与边长 —— 用「边缘连通域的紧包围盒」。
   *
   * ⚠️ 这里是最关键也最容易写错的一步，两个写坏过的版本都留在这里当反面教材：
   *    · v1「把细节能量超阈值的窗口中心打点→聚类→只留边长最大的」：
   *      「大窗口包住小图标」平均细节照样超阈值，于是边长几乎恒为最大档，
   *      裁出来是「小图标 + 一大圈背景」→ NCC 直接失效（实测 6 个图标全认错、且都指向同一个）。
   *    · v2「在平均细节 vs 边长的曲线上找平台期」：
   *      头像内部（脸/皮肤）本来就平滑，细节集中在发际与轮廓，平均细节随窗口增大单调下降，
   *      根本没有平台 → 边长系统性偏小，还因为局部纹理密而一个图标冒出好几个峰。
   *    · 现在这版（v3）：图标在截图里是一块**与背景不同的连通区域**（圆头像的整圈轮廓、
   *      方形光锥的四条边都会把区域闭合起来），所以「阈值 → 连通域 → 紧包围盒」才是它的正确形态。
   *      包围盒天然给出 中心 + 边长，不需要再猜。
   *      副作用：若图标外头还套了卡框（框的边也闭合），包围盒会略大于图标 → 由 WIN_MUL 的缩小档兜住。
   */
  function detectBoxes(gray, w, h, sens) {
    const r = 3;
    const blur = boxBlur(gray, w, h, r);
    const det = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < det.length; i++) { const d = Math.abs(gray[i] - blur[i]); det[i] = d; sum += d; }
    const meanDet = sum / det.length;
    // 阈值基准取「全图平均细节」：纯色/渐变背景上平均细节≈0，有图标的图自然抬高。
    // 灵敏度越高 → 系数越小 → 阈值越低 → 连淡淡的轮廓也吃进来（代价是误检变多，但都进人工确认表）。
    const thr = Math.max(3, meanDet * (2.0 - sens * 0.7));

    const mask = new Uint8Array(w * h);
    for (let i = 0; i < det.length; i++) if (det[i] >= thr) mask[i] = 1;

    const minSide = SIZES[0];
    const maxSide = Math.min(w, h) * 0.9;
    const raw = components(mask, w, h, Math.max(40, minSide * minSide * 0.03));
    const boxes = [];
    const push = (cx, cy, s) => { if (s >= minSide * 0.7 && s <= maxSide) boxes.push({ cx, cy, s }); };
    for (const c of raw) {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      const minor = Math.min(bw, bh), major = Math.max(bw, bh);
      if (minor < minSide * 0.5 || major > maxSide * 1.8) continue;
      // ⚠️ 长条形丢掉时要注意区分两类「长条」：
      //    · 文字行 / UI 分隔线 / **图标外的卡框** → 不是图标，必须丢；
      //    · 一排**贴在一起**的图标 → 是图标，要按方格切开救回来。
      //    判据：宽高比 ≥ 2 且切开后每格近正方形，才认第二种。
      if (major / minor > 1.7) {
        const k = Math.round(major / minor);
        const cell = major / k;
        const ok = k >= 2 && k <= 12 && major / minor >= 2.0
          && minor >= minSide * 0.9 && Math.abs(cell - minor) / minor <= 0.25;
        if (!ok) continue;
        for (let j = 0; j < k; j++) {
          if (bw >= bh) push(c.x0 + (j + 0.5) * bw / k, (c.y0 + c.y1) / 2, minor);
          else push((c.x0 + c.x1) / 2, c.y0 + (j + 0.5) * bh / k, minor);
        }
        continue;
      }
      push((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, (bw + bh) / 2);
    }
    if (!boxes.length) return [];

    // ⚠️ 尺寸下限**必须跟着「这张图里图标有多大」走，不能写死**：
    //    截图常常是 2 倍图，图标 180px 而名字文字只有 40px；写死一个 30px 的下限，
    //    文字就会全部被当成候选灌进确认表（实测 6 个图标配出 24 行文字噪声，占满整张表）。
    //    做法：把候选尺寸降序排，**在最大的那个相对断层处切开**（图标 ≥ 文字 2.2 倍才会被切开），
    //    只保留断层上方那拨 —— 也就是「图标尺寸」那一拨。
    //    · 用「最大断层」而不是「第 N 百分位」：文字数量远多于图标，任何百分位都会被文字拽下去。
    //    · 阈值 2.2 也避免了「同图里两种尺寸的图标（180 / 90）被误切」的情况。
    const ss = boxes.map(b => b.s).sort((a, b) => b - a);
    let cut = ss.length, bestRatio = 2.2;
    for (let i = 1; i < ss.length; i++) {
      const ratio = ss[i - 1] / Math.max(1, ss[i]);
      if (ratio >= bestRatio) { cut = i; bestRatio = ratio; }
    }
    const kept = boxes.filter(b => b.s >= ss[cut - 1]);

    // 嵌套/重叠：同一个图标可能拆成「外圈轮廓」+「内部花纹」好几个连通域 → 中心近的合并
    const use = kept.length ? kept : boxes;
    use.sort((a, b) => b.s - a.s);
    const keep = [];
    for (const b of use) {
      if (keep.length >= MAX_BOXES) break;
      if (keep.some(k => Math.abs(k.cx - b.cx) < Math.max(k.s, b.s) * 0.5
                       && Math.abs(k.cy - b.cy) < Math.max(k.s, b.s) * 0.5)) continue;
      keep.push(b);
    }
    return keep;
  }

  // ── 主流程 ────────────────────────────────────────────────────────────────
  /**
   * @param {File|Blob} file  上传的截图
   * @param {object} lib      { ch:[{id,name,dir}], lc:[...] }（来自 /api/iconlib）
   * @param {object} opts     { sensitivity:1.0, fivesOnly:true, onProgress(msg, pct) }
   * @returns {Promise<{rows:Array, boxes:Array, meta:object}>}
   */
  async function run(file, lib, opts) {
    const o = opts || {};
    const sens = o.sensitivity != null ? o.sensitivity : 1.0;
    const onP = o.onProgress || (() => {});
    const t0 = performance.now();

    onP('读入图片…', 2);
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error('这张图读不出来（可能不是图片，或者格式不支持）'));
      im.src = url;
    });
    const natW = img.naturalWidth, natH = img.naturalHeight;
    const scale = Math.min(1, WORK_LONG / Math.max(natW, natH));
    const w = Math.max(32, Math.round(natW * scale)), h = Math.max(32, Math.round(natH * scale));

    onP('灰度化 ' + natW + '×' + natH + ' → 工作尺寸 ' + w + '×' + h + '…', 8);
    const gray = grayOf(img, w, h);

    onP('检测图标位置…', 18);
    const boxes = detectBoxes(gray, w, h, sens);

    // 只保留合理尺寸的框（太小的碎片、占满整屏的整块都丢掉）
    const cand = boxes.filter(b => b.s >= 26 && b.s <= Math.min(w, h) * 0.9).slice(0, MAX_CAND);
    onP('检出 ' + cand.length + ' 个候选区域，准备比对图标库…', 30);

    // 预生成图标库特征
    const items = [];
    for (const e of (lib.ch || [])) items.push({ kind: 'ch', id: e.id, name: e.name, dir: 'avatar', rarity: e.rarity });
    for (const e of (lib.lc || [])) items.push({ kind: 'lc', id: e.id, name: e.name, dir: 'light_cone', rarity: e.rarity });
    const pool = o.fivesOnly === false ? items : items.filter(x => x.rarity == null || x.rarity >= 5);
    let done = 0;
    for (const it of pool) {
      const im = await new Promise(res => {
        const x = new Image();
        x.onload = () => res(x); x.onerror = () => res(null);
        x.src = 'assets/' + it.dir + '/' + it.id + '.png';
      });
      if (!im) { it.vec = null; continue; }
      it.vec = toVector(grayOf(im, N, N), INSET);
      if (++done % 12 === 0) onP('载入图标库 ' + done + '/' + pool.length + '…', 30 + Math.round(done / pool.length * 25));
    }
    const lib2 = pool.filter(x => x.vec);

    onP('逐个候选区域做匹配（' + cand.length + ' × ' + lib2.length + '）…', 58);
    const rows = [];
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (i % 6 === 0) onP('匹配中 ' + (i + 1) + '/' + cand.length + '…', 58 + Math.round(i / cand.length * 36));
      let best = null;
      // 框的松紧不确定 → 试几档窗口倍数，取全局最优
      for (const mul of WIN_MUL) {
        const s = b.s * mul;
        const sx = (b.cx - s / 2) / scale, sy = (b.cy - s / 2) / scale;
        const sw = s / scale, sh = s / scale;
        if (sx < -2 || sy < -2 || sx + sw > natW + 2 || sy + sh > natH + 2) continue;
        const v = toVector(grayOfRect(img, sx, sy, sw, sh, N), INSET);
        for (const it of lib2) {
          const sc = ncc(v, it.vec);
          if (!best || sc > best.score) best = { kind: it.kind, id: it.id, name: it.name, dir: it.dir, score: sc, mul, s };
        }
      }
      if (!best) continue;
      rows.push({
        kind: best.kind, id: best.id, name: best.name, score: +best.score.toFixed(3),
        // 框在**原图**坐标下的位置（画调试框、以及「第几行」排序都要它）
        x: Math.round((b.cx - best.s / 2) / scale), y: Math.round((b.cy - best.s / 2) / scale),
        size: Math.round(best.s / scale), mul: best.mul,
        // 星魂/叠影识别不出来（那通常是数字或角标）→ 交给人工填，默认给个安全值
        v: best.kind === 'lc' ? 1 : 0,
      });
    }

    // 同一位置只留分数最高的；按 y 再 x 排序（截图是从上到下的清单，顺序稳定）
    rows.sort((a, b) => a.y - b.y || a.x - b.x || b.score - a.score);
    const final = [];
    for (const r of rows) {
      if (final.some(k => Math.abs(k.x - r.x) < Math.max(k.size, r.size) * 0.5
                        && Math.abs(k.y - r.y) < Math.max(k.size, r.size) * 0.5)) continue;
      final.push(r);
    }
    URL.revokeObjectURL(url);
    onP('完成：' + final.length + ' 个区域有识别结果', 100);
    return {
      rows: final, boxes: cand,
      meta: {
        natural: natW + '×' + natH, work: w + '×' + h, scale: +scale.toFixed(3),
        boxes: cand.length, lib: lib2.length, ms: Math.round(performance.now() - t0),
      },
    };
  }

  W.Match = { run, detectBoxes, toVector, ncc, GRAY_BG, N, INSET };
})();
