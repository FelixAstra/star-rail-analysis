#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 双语覆盖率静态校验（CI 里跑，无依赖、不需要起服务）
//
// 校验五件事：
//   ① 界面源码里每一个 t('…') 字面量 key，在 web/i18n.dict.js 里都有英文词条；
//   ② 每条译文的占位符集合与 key 完全一致（漏一个 {n} 就会在页面上露出 {n}）；
//   ③ 译文里不残留中文（占卜**内容层**刻意不翻译，但那些字符串不走 t()，
//      所以「译文含中文」一定是漏译或误收，一律当错误）；
//   ④ 词条表里没有从未被引用的死条目（只警告，不失败 —— 运行时 key 扫不出来）；
//   ⑤ L(中文, 英文) 的英文那一侧写了、且不混中文（「解释说明」页的长文不在词典里，
//      ①②③ 覆盖不到它，这条是它唯一的机械保障）。
//
// 用法：node tools/check-i18n.js        （有错退出码 1）
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

// ── 载入词条表 ──────────────────────────────────────────────────────────────
require(path.join(WEB, 'i18n.dict.js'));
const DICT = (globalThis.W && globalThis.W.DICT_EN) || null;
if (!DICT) {
  console.error('✗ 读不到 web/i18n.dict.js 的 W.DICT_EN');
  process.exit(1);
}
// 运行时 key 的清单由词条表自己给出（RUNTIME 段），避免两处硬编码各改各的
const runtimeKeys = new Set((globalThis.W && globalThis.W.DICT_RUNTIME_KEYS) || []);

// ── 收集源码文件 ────────────────────────────────────────────────────────────
const files = [
  'app.js', 'match.js', 'i18n.js',
  ...fs.readdirSync(path.join(WEB, 'components')).map(f => 'components/' + f),
].map(f => path.join(WEB, f)).filter(f => fs.existsSync(f));

// t('…') 的字面量扫描 —— 用共享实现（tools/lib/i18n-keys.js），别在这里另写一条正则：
// 正则版会在两种写法上出错（单引号 JS 串里的转义引号 / v-html 属性里的 HTML 实体），
// 而这两种恰好都会让 key 静默失配、回退中文，是最难靠肉眼发现的一类漏译。
const { scanTKeys, scanLCalls, literalsIn, CJK } = require(path.join(__dirname, 'lib', 'i18n-keys.js'));

const used = new Map();   // key → 首次出现的「文件:行」
const problems = [];
let lPairs = 0;           // 受检的 L(中文, 英文) 对数
let lSkipped = 0;         // 两侧都不是字面量的 L(变量, 变量) —— 静态查不了，只能靠运行时验收

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');

  // ⑤ L(中文, 英文) 成对检查 —— 「解释说明」页那批长文不在词典里，t() 的扫描覆盖不到它，
  //    所以单独查：英文那一侧写了没有、有没有混进中文。
  for (const { index, args } of scanLCalls(src)) {
    const line = src.slice(0, index).split('\n').length;
    const zhLits = args.length ? literalsIn(args[0]) : [];
    const enLits = args.length > 1 ? literalsIn(args[1]) : [];
    if (!zhLits.some(s => CJK.test(s)) && !enLits.length) { lSkipped++; continue; }  // L(变量, 变量)
    if (args.length < 2) {
      problems.push(`L() 只有一个参数 · ${rel}:${line}\n    ${args[0].trim().slice(0, 90)}`);
      continue;
    }
    lPairs++;
    if (!enLits.length) {
      problems.push(`L() 英文侧没有字符串字面量（漏写？）· ${rel}:${line}\n    ${args[0].trim().slice(0, 90)}`);
      continue;
    }
    for (const s of enLits) {
      if (CJK.test(s)) problems.push(`L() 英文侧含中文 · ${rel}:${line}\n    ${JSON.stringify(s).slice(0, 100)}`);
    }
  }

  for (const { key, index } of scanTKeys(src)) {
    const line = src.slice(0, index).split('\n').length;
    if (!used.has(key)) used.set(key, rel + ':' + line);
    // ① 有没有词条
    if (DICT[key] == null) {
      problems.push(`缺词条 · ${rel}:${line}\n    ${JSON.stringify(key).slice(0, 150)}`);
      continue;
    }
    const en = DICT[key];
    // ② 占位符一致性
    const pk = (key.match(/\{(\w+)\}/g) || []).sort().join(',');
    const pv = (String(en).match(/\{(\w+)\}/g) || []).sort().join(',');
    if (pk !== pv) {
      problems.push(`占位符不一致 · ${rel}:${line}\n    key: ${pk || '(无)'}\n    译文: ${pv || '(无)'}  ← ${JSON.stringify(key).slice(0, 90)}`);
    }
    // ③ 译文残留中文
    if (/[\u3400-\u9fff]/.test(en)) {
      problems.push(`译文含中文 · ${rel}:${line}\n    ${JSON.stringify(key).slice(0, 90)} → ${JSON.stringify(String(en)).slice(0, 90)}`);
    }
  }
}

// ── ④ 死条目（仅警告）──────────────────────────────────────────────────────
const dead = Object.keys(DICT).filter(k => !used.has(k) && !runtimeKeys.has(k));

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log('i18n 覆盖率检查');
console.log('  源码扫描文件 :', files.length);
console.log('  引用到的 key :', used.size);
console.log('  词条表条目   :', Object.keys(DICT).length);
console.log('  运行时 key   :', runtimeKeys.size);
console.log('  L() 成对检查 :', lPairs, '对（另有', lSkipped, '处 L(变量, 变量) 静态查不了，交给运行时验收）');

if (dead.length) {
  console.log('\n⚠️  从未被引用的词条（' + dead.length + ' 条，仅警告）：');
  dead.slice(0, 20).forEach(k => console.log('    ' + JSON.stringify(k).slice(0, 110)));
  if (dead.length > 20) console.log('    …还有 ' + (dead.length - 20) + ' 条');
}

if (problems.length) {
  console.log('\n✗ 发现 ' + problems.length + ' 个问题：');
  problems.forEach(p => console.log('  · ' + p));
  process.exit(1);
}
console.log('\n✓ ' + used.size + ' 个界面 key 均有英文词条、占位符一致、译文无中文残留；'
  + lPairs + ' 对 L(中文, 英文) 成对且英文侧无中文');
