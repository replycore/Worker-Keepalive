#!/usr/bin/env node
/**
 * 一键构建：把 Vue + Tailwind 编译产物内联进 worker.js，得到零外部依赖的单文件。
 *
 * 用法（在仓库根目录）：
 *     npm i                  # 安装 vue + tailwindcss（版本见 package.json，已锁定）
 *     node scripts/build.js [--worker PATH]
 *
 * 可重复执行：worker.js 里是占位符、旧版内联产物都能处理，每次整体重写
 * `const VUE_SRC = "...";` 与 `/*__TAILWIND_CSS__*\/` 两处。
 *
 * 原理：
 * - Vue：读取 node_modules/vue/dist/vue.global.prod.js，做 JS 字符串转义后注入 VUE_SRC。
 *   UI 模板里用 `<script>${VUE_SRC}</script>` 求值内联。注意模板字符串里只有
 *   `${...}` 会被求值，`"</scr"+"ipt>"` 这种拆散写法不会拼接（曾因此导致浏览器
 *   找不到 `</script>`、把整个页面吞进第一个 script 块，页面只剩裸 `{{ }}`），
 *   所以闭合标签必须原样写 `</script>`。同理，模板内 JS 代码里的字符串转义必须
 *   双写反斜杠（如 `'\\n'`），否则模板求值会把它变成真实换行、撑破字符串。
 *   转义规则（顺序不能错）：\ -> \\，" -> \"，换行 -> \n，${ -> \${。
 *   Vue 官方 bundle 不含 `</script`（构建前会校验）。
 * - Tailwind：用 tailwindcss(JIT) 扫描 worker.js 的 HTML 模板 + :class 动态类 +
 *   tabClass 返回值，编译 utilities（关闭 preflight，避免重置污染），注入 <style> 内的
 *   `/*__TAILWIND_CSS__*\/` 占位。darkMode 用 class 策略，与现有 toggleTheme 逻辑一致。
 * - 无动态拼接类名（构建前会校验）：所有条件分支的类都以字符串字面量出现在模板/JS 里，
 *   JIT 扫描即可覆盖，无需 safelist。
 *
 * 单文件无外部依赖：直接 node 运行即可，不需要 python。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER_VUE = '"__VUE_BUNDLE_PLACEHOLDER__"';
// 内联后的 VUE_SRC 是转义过的单行字符串（无字面换行），可用行级正则整体替换
const VUESRC_LINE_RE = /^const VUE_SRC = ".*";$/m;

const PLACEHOLDER_CSS = '/*__TAILWIND_CSS__*/';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function countOccurrences(s, sub) {
  return s.split(sub).length - 1;
}

function loadVue(vuePath) {
  const src = fs.readFileSync(vuePath, 'utf8');
  if (src.toLowerCase().includes('</scr' + 'ipt')) {
    fail('Vue bundle contains </script>, refusing to inline (would break HTML parsing).');
  }
  // 转义顺序不能错：先反斜杠，再引号，再换行，最后 ${
  return src
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\$\{/g, '\\${');
}

function collectClasses(body) {
  // 只扫描 HTML 模板（UI_HTML 到其结束反引号）+ 全文件的 :class/tabClass 字符串字面量
  const uiStart = body.indexOf('const UI_HTML');
  const uiEnd = body.indexOf('`;', uiStart);
  const ui = body.slice(uiStart, uiEnd);
  const classes = new Set();
  for (const m of ui.matchAll(/class="([^"]*)"/g))
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  for (const m of body.matchAll(/:class="([^"]*)"/g))
    for (const s of m[1].matchAll(/'([^']+)'/g))
      for (const c of s[1].split(/\s+/)) if (c) classes.add(c);
  for (const m of body.matchAll(/\? '([^']+)'\s*:\s*'([^']+)'/g))
    for (const g of [m[1], m[2]])
      for (const c of g.split(/\s+/)) if (c) classes.add(c);
  return classes;
}

async function buildCss(bodyText) {
  // require 从脚本所在目录向上解析，与原 python 版把临时 builder 放在 scripts/ 内一致
  const postcss = require('postcss');
  const tailwindcss = require('tailwindcss');
  const classes = collectClasses(bodyText);
  const html = [...classes].map(c => `<div class="${c}"></div>`).join('');
  let css;
  try {
    const r = await postcss([tailwindcss({
      darkMode: 'class',
      content: [{ raw: html }],
      corePlugins: { preflight: false },
    })]).process('@tailwind utilities;', { from: undefined });
    css = r.css.trim();
  } catch (e) {
    fail('tailwind build failed: ' + (e && e.message || e));
  }
  if (!css) fail('tailwind build produced empty CSS, refusing to inline.');
  if (css.includes('</')) {
    fail('compiled CSS contains "</", refusing to inline (would break HTML parsing).');
  }
  return css;
}

function checkNoDynamicClasses(bodyText) {
  // 拦截运行时拼接类名：形如 'bg-' + x / "text-" + y，若存在则 JIT 会漏编
  const bad = [];
  const lines = bodyText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('const VUE_SRC')) continue;
    if (/['"](?:bg-|text-|border-|from-|to-|via-|ring-|divide-|space-|hover:|dark:|sm:|md:|lg:)[^'"]*['"]\s*\+/.test(line))
      bad.push([i + 1, line.trim().slice(0, 100)]);
    if (/\+\s*['"](?:bg-|text-|border-|from-|to-|via-|ring-|divide-|space-)/.test(line))
      bad.push([i + 1, line.trim().slice(0, 100)]);
  }
  if (bad.length) {
    fail('dynamic class concatenation detected (JIT would miss these):\n' +
      bad.slice(0, 10).map(([n, l]) => `  line ${n}: ${l}`).join('\n'));
  }
}

async function main() {
  const args = process.argv.slice(2);
  let workerArg = 'worker.js';
  const wi = args.indexOf('--worker');
  if (wi !== -1 && args[wi + 1]) workerArg = args[wi + 1];

  const repo = path.resolve(__dirname, '..');
  const worker = path.resolve(repo, workerArg);
  // 注意：仓库文件可能是 CRLF，构建全程用 LF 处理、最后统一转回 CRLF。
  // 行级定位必须基于 LF 切分后的行号，不能混用。
  const raw = fs.readFileSync(worker, 'utf8');
  let s = raw.replace(/\r\n/g, '\n');

  // ---- 1) Vue ----
  const vuePath = path.join(repo, 'node_modules', 'vue', 'dist', 'vue.global.prod.js');
  if (!fs.existsSync(vuePath)) fail(`missing ${vuePath}, run \`npm i\` first.`);
  const vue = loadVue(vuePath);
  const replacement = `"${vue}"`;
  if (countOccurrences(s, PLACEHOLDER_VUE) === 1) {
    // 用函数式 replacement：vue 转义串里含 $ { 等序列，字符串式 replacement 会被二次解释
    s = s.replace(PLACEHOLDER_VUE, () => replacement);
  } else if (VUESRC_LINE_RE.test(s)) {
    const newLine = `const VUE_SRC = ${replacement};`;
    s = s.replace(VUESRC_LINE_RE, () => newLine);
  } else {
    fail(`no ${PLACEHOLDER_VUE} placeholder or inlined VUE_SRC line found in ${worker}`);
  }

  // ---- 2) Tailwind ----
  // 占位符或已内联产物都能处理：编译产物块 = <style> 之后、自定义 CSS
  // （以 `::-webkit-scrollbar` 开头）之前的内容，整体替换。
  // 注意 VUE_SRC 单行巨长，不能用全文件 DOTALL 正则（会把 VUE_SRC 也吞掉导致破坏）。
  // 改用行级定位：找到 <style> 行与自定义 CSS 起始行，只替换中间行。
  const bodyForScan = s.split('\n').filter(l => !l.startsWith('const VUE_SRC')).join('\n');
  checkNoDynamicClasses(bodyForScan);
  const css = await buildCss(bodyForScan);
  // CSS 要内联进 JS 模板字符串：反斜杠必须双写，否则模板求值会把 `\[` `\/` `\:` 等
  // 吃成 `[` `/` `:`，选择器变非法被浏览器丢弃（曾导致 dark: / z-[90] / bg-black/60 全灭）。
  // 顺序：先反斜杠，再 ${（CSS 里一般没有，防一手）。
  const cssEscaped = css.replace(/\\/g, '\\\\').replace(/\$\{/g, '\\${');
  const newCssBlock = '\n' + cssEscaped + '\n';
  if (countOccurrences(s, PLACEHOLDER_CSS) === 1) {
    s = s.replace(PLACEHOLDER_CSS, () => newCssBlock);
  } else {
    // 行级定位（LF 行号）：UI 模板内的 <style> 行与自定义 CSS 起始行之间整体替换。
    // 注意文件头注释里也提到 "<style>"，必须从 `const UI_HTML` 之后开始找。
    const lines = s.split('\n');
    const uiStart = lines.findIndex(l => l.startsWith('const UI_HTML'));
    let styleIdx = -1;
    for (let i = uiStart; i < lines.length && i >= 0; i++) {
      if (lines[i].includes('<style>')) { styleIdx = i; break; }
    }
    let customIdx = -1;
    for (let i = styleIdx + 1; i < lines.length && styleIdx >= 0; i++) {
      if (/^\s*::-webkit-scrollbar\s*\{/.test(lines[i])) { customIdx = i; break; }
    }
    if (uiStart === -1 || styleIdx === -1 || customIdx === -1) {
      fail(`no ${PLACEHOLDER_CSS} placeholder or recognizable <style> block in ${worker}`);
    }
    lines.splice(styleIdx + 1, customIdx - (styleIdx + 1), ...newCssBlock.split('\n'));
    s = lines.join('\n');
  }

  fs.writeFileSync(worker, s.replace(/\n/g, '\r\n'), 'utf8');
  console.log(`inlined Vue (${vue.length} bytes) + Tailwind (${css.length} bytes) into ${worker}`);
}

main().catch(e => {
  console.error((e && e.message) || e);
  process.exit(1);
});
