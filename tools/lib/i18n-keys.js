// ─────────────────────────────────────────────────────────────────────────────
// 从界面源码里扫出 t('…') 的 key —— 唯一实现，供 tools/check-i18n.js 与
// 一次性提取脚本共用（两份实现迟早会漂移，而漂移的后果是「漏词条查不出来」）。
//
// ⚠️ 为什么不用一条正则：
//   模板里的调用有两种写法
//     · 反引号模板             `{{ t('抽') }}`
//     · 单引号 JS 字符串里拼模板  template: '…{{ t(\'抽\') }}…'
//   正则要同时吃这两种，正文部分必然变成贪婪的 `(?:\\.|[^'\\])*`，
//   于是遇到 `t(\'抽\') }}<b v-if="x">{{ t(y) }}` 会一路吃到下一个撇号 ——
//   实测把一个 key 吞成 `抽') }}<b v-if="pt.tag">{{ t(pt.tag) }}</b></span>`。
//   改成逐字符扫描后歧义消失，且能正确处理 key 内部的转义撇号。
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// 允许出现在 t 前面的字符（词边界或成员访问，避免匹配到 `format(`、`split(` 之类）
const isIdent = c => /[A-Za-z0-9_$]/.test(c);

// ⚠️ key 必须按「HTML 实体解码后」的形式登记：
//   Vue 的模板是从 HTML 解析进来的，属性值 / 文本节点里的实体会被**先解码**，
//   所以 v-html="t('…&lt;0.72…')" 真正传给 t() 的是 '…<0.72…'。
//   实测踩过：词典里按源码原样写成 &quot; / &lt;，运行时永远查不到 → 静默回退中文。
//   （译文值那侧不受影响 —— 值走 innerHTML 注入，需要字面量 '<' 时仍要写 &lt;。）
const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
function decodeEntities(s) {
  return String(s).replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}

/**
 * 扫出一段源码里所有 t('…') 调用的 key。
 * @param {string} src
 * @returns {Array<{key: string, index: number}>} 按出现顺序，含重复
 */
function scanTKeys(src) {
  const out = [];
  for (let i = 0; i < src.length - 2; i++) {
    if (src[i] !== 't' || src[i + 1] !== '(') continue;
    if (i > 0 && isIdent(src[i - 1])) continue;      // xxxxt(  → 不是 t 调用
    let j = i + 2;
    while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j++;
    // 单引号 JS 字符串里拼模板时，开引号本身是转义的 → 记下来，闭合引号同样是转义的
    // （不记这一位就会把 `t(\'a\')` 的 `\'` 当成「key 内部的转义撇号」一路吃下去）
    const escStyle = (src[j] === '\\' && src[j + 1] === "'");
    if (escStyle) j++;
    if (src[j] !== "'") continue;                    // t(变量) / t("双引号") 都不是字面量
    j++;
    let key = '';
    let closed = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\' && src[j + 1] === "'") {
        if (escStyle) { closed = true; break; }       // 转义写法：这就是闭合引号
        key += "'"; j += 2; continue;                 // 模板写法：key 内部真的有个撇号
      }
      if (c === '\\') { key += src[j + 1] || ''; j += 2; continue; }   // \\ \n 等一律还原
      if (c === "'") { closed = true; break; }
      if (c === '\n') break;                         // 跨行说明不是字面量
      key += c;
      j++;
    }
    if (closed) out.push({ key: decodeEntities(key), index: i });
  }
  return out;
}

/** 扫出「去重后的 key → 首次出现位置」 */
function scanTKeyMap(src) {
  const m = new Map();
  for (const { key, index } of scanTKeys(src)) if (!m.has(key)) m.set(key, index);
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// L(中文, 英文) 的成对扫描
//
// 「解释说明」页是成段的长说明文字，中英贴着写在同一行用 L(…) 二选一（理由见
// web/components/help.js 顶部）。这批字符串**不在词典里**，所以 t() 的扫描覆盖不到 ——
// 用下面这两个函数补一条机械保障：英文那一侧写了没有、有没有混进中文。
//
// ⚠️ 只做「源码切片 + 取字符串字面量」，不解析成值：参数里允许出现 `'a' + x + 'b'`
//    这种拼装（实时数字要嵌进句子中间），把每个字面量都取出来够用了。
// ⚠️ 要能认出「这不是调用」的两种写法，否则会误报：
//    · `function L(zh, en) {`      —— 函数声明
//    · `L(zh, en) {`（对象方法简写）—— 右括号后面紧跟 `{`
// ─────────────────────────────────────────────────────────────────────────────

/** 从 src[start] 开始切一个参数列表，返回各参数的源码切片；括号不配对返回 null */
function splitArgs(src, start) {
  const args = [];
  let depth = 0, cur = '', i = start, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += src[i + 1] || ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ')') {
      if (depth === 0) { args.push(cur); return args; }
      depth--; cur += c; continue;
    }
    if (c === ']' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  return null;
}

/**
 * 扫出源码里所有 L(…) 调用，返回每个调用的参数源码切片。
 * @returns {Array<{index: number, args: string[]}>}
 */
function scanLCalls(src) {
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== 'L' || src[i + 1] !== '(') continue;
    if (i > 0 && isIdent(src[i - 1])) continue;            // xxxL( → 不是 L 调用
    // `function L(` —— 往前跳过空白，看看是不是紧跟着 function
    let p = i - 1;
    while (p >= 0 && (src[p] === ' ' || src[p] === '\t' || src[p] === '\n' || src[p] === '\r')) p--;
    if (src.slice(Math.max(0, p - 8), p + 1).endsWith('function')) continue;
    const args = splitArgs(src, i + 2);
    if (!args) continue;
    // 右括号后紧跟 `{` → 方法简写定义，不是调用
    const close = src.indexOf(')', i + 2);
    if (close >= 0) {
      let q = close + 1;
      while (q < src.length && /\s/.test(src[q])) q++;
      if (src[q] === '{') continue;
    }
    out.push({ index: i, args });
  }
  return out;
}

/**
 * 取一段源码里所有字符串字面量的「值」（\\ 转义已还原）。
 *
 * ⚠️ **只取最外层的**：嵌套调用里的字面量要跳过。否则
 *    L('…（含' + this.n('远坂凛') + '）…', '… (including ' + this.n('远坂凛') + ') …')
 *    会把 n() 的实参当成英文侧正文 —— 而那个中文是**查表用的 key**，本来就该是中文。
 *    判据是括号深度：深度 0 才算这对 L() 的正文。
 */
function literalsIn(src) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (c !== "'" && c !== '"' && c !== '`') continue;
    const q = c;
    let s = '', j = i + 1;
    for (; j < src.length; j++) {
      if (src[j] === '\\') { s += src[j + 1] || ''; j++; continue; }
      if (src[j] === q) break;
      s += src[j];
    }
    if (depth === 0) out.push(s);
    i = j;
  }
  return out;
}

const CJK = /[\u3400-\u9fff]/;

module.exports = { scanTKeys, scanTKeyMap, scanLCalls, literalsIn, decodeEntities, CJK };
