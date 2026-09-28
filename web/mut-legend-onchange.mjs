// 变异测试：把 alluvial-chart.js / phil-chord.js 里那根「图例点击 → 喊宿主重画」的线
// 逐条改坏，确认两个 check 真的会红。
//
// 为什么值得单独跑一遍：那几行断言测的是**模块与宿主之间的接线**，恰恰是模块自己的几何
// 测试看不见的地方。一个永远通过的断言比没有断言更糟 —— 它会让人以为这段接线被覆盖了。
//
// 用法（在仓库根目录）：
//   node web/mut-legend-onchange.mjs
// 退出码 0 表示每一条变异体都被抓住、且都不是「崩溃」而是「断言失败」。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const TMP = process.env.TEMP || process.env.TMPDIR || '/tmp';

// 两个用过的坏变异体，记下来免得再踩 —— 两者都让检查脚本**崩溃**而不是**报错**，
// 于是「8 条全绿」里混着 2 条什么都没测到的：
//   - 把 forEach(...) 开头换成 `for (const row of []) {` —— 后面的 `});` 没配对，
//     源码直接语法错误，new Function 抛异常。变异体本身必须是**合法程序**，
//     否则测的是解析器不是断言。
//   - 把 `(opts && opts.onChange) || (() => {})` 换成 `opts.onChange` —— 检查脚本
//     一开始就用 createAlluvialView() 无参构造，于是死在构造那行，新断言根本没跑到。
//     要针对那条断言，变异体得是「默认值**不是**空函数」。
// 还有第三种崩溃，是**断言自己**造成的：装不上处理器时 `row.onclick()` 直接抛
// TypeError，检查脚本死在它唯一要报告的那个缺陷上。所以两个 check 里那段改成了
// 显式分支 —— 先 `ok(false, …)` 再跳过点击，不调用不存在的东西。
const CALL = 'onChange();          // 见 main.js：图例点击必须触发重画';

const NOOP = 'const onChange = (opts && opts.onChange) || (() => {});';
const THROWING = "const onChange = (opts && opts.onChange) || (() => { throw new Error('no host'); });";
const NO_HANDLER = "el.querySelectorAll('[data-dom]').forEach((row) => {";
const NO_HANDLER_TO = "(false ? el.querySelectorAll('[data-dom]') : []).forEach((row) => {";

const CASES = [
  ['[alluvial] 图例点击不再喊 onChange', 'alluvial-chart.js', 'check-alluvial.mjs',
   'ALLUVIAL_CHART', CALL, ''],
  ['[alluvial] 点击不再真的切换', 'alluvial-chart.js', 'check-alluvial.mjs',
   'ALLUVIAL_CHART', 'toggleDomain(row.dataset.dom);', ''],
  ['[alluvial] 不装点击处理器', 'alluvial-chart.js', 'check-alluvial.mjs',
   'ALLUVIAL_CHART', NO_HANDLER, NO_HANDLER_TO],
  ['[alluvial] 默认的 onChange 不是空函数', 'alluvial-chart.js', 'check-alluvial.mjs',
   'ALLUVIAL_CHART', NOOP, THROWING],
  ['[chord] 图例点击不再喊 onChange', 'phil-chord.js', 'check-phil-chord.mjs',
   'CHORD_CHART', CALL, ''],
  ['[chord] 点击不再真的切换', 'phil-chord.js', 'check-phil-chord.mjs',
   'CHORD_CHART', 'toggleDomain(+row.dataset.dom);', ''],
  ['[chord] 不装点击处理器', 'phil-chord.js', 'check-phil-chord.mjs',
   'CHORD_CHART', NO_HANDLER, NO_HANDLER_TO],
  ['[chord] 默认的 onChange 不是空函数', 'phil-chord.js', 'check-phil-chord.mjs',
   'CHORD_CHART', NOOP, THROWING],
];

let caught = 0, missed = 0, crash = 0, skipped = 0;

for (const [name, file, check, envName, from, to] of CASES) {
  const srcPath = path.join(WEB, file);
  const src = fs.readFileSync(srcPath, 'utf8');
  const n = src.split(from).length - 1;
  // 锚点必须**恰好**匹配一次。匹配 0 次说明源码改了、这条变异体已经是空转的。
  if (n !== 1) { skipped++; console.log(`SKIP   ${name}  (anchor matched ${n} times, need 1)`); continue; }
  const outPath = path.join(TMP, 'mut-' + file);
  fs.writeFileSync(outPath, src.replace(from, to));
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(WEB, check)], {
      env: { ...process.env, [envName]: outPath }, encoding: 'utf8', stdio: 'pipe',
    });
  } catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
  const fails = out.split('\n').filter((l) => l.includes('✗') || /^FAIL /.test(l.trim())).length;
  // 两个 harness 的收尾行格式不同：chord 是 "N of M checks"，alluvial 是 "N checks passed, M FAILED"。
  // 只认前者会让 alluvial 的四条全部报成 "?"，看不出到底红了几条 —— 报告本身也得准。
  const m = out.match(/(\d+) of (\d+) checks/) || out.match(/(\d+) FAILED/);
  if (code === 0) { missed++; console.log(`MISSED ${name}`); }
  else if (fails === 0) {
    crash++;
    console.log(`CRASH  ${name}  (exit ${code}, 0 parsed failures)\n${out.slice(-500)}`);
  } else { caught++; console.log(`caught ${name}  -> ${m ? m[1] + ' failures' : '?'}`); }
}

console.log(`\n${caught} caught, ${missed} missed, ${crash} crash-only, ${skipped} skipped`);
process.exit(missed || crash || skipped ? 1 : 0);
