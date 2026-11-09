// Reproduces every table in research/tail-risk/README.md and writes results.md.
//   node scripts/build-pages.mjs --restore-only
//   node research/tail-risk/run.mjs
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {stepStrategy} from '../../lib/live-engine.js';
import {loadPanel, markets, makeStep, targets, simulate, stats, idx, windowMDD, bootstrap, WINDOWS, CRISES} from './lib.mjs';

const d = loadPanel(), M = markets(d), ID = 'fitted-aggressive';
const out = [], log = s => { out.push(s); console.log(s); };
const p1 = x => (x * 100).toFixed(1), pct = x => (x >= 0 ? '+' : '') + p1(x) + '%';
const lev = d.symbols.map(s => s.leverage);
const exposure = (held, t) => held[t].reduce((s, w, j) => s + w * lev[j], 0);

// 1. Exact replay contract: all six original strategies vs the published research NAV.
const hist = d.history, hi = new Map(hist.dates.map((x, i) => [x, i]));
for (const id of Object.keys(hist.strategies)) {
  const live = targets(d, d.configs[id], d.kinds[id]), hooked = targets(d, d.configs[id], d.kinds[id], makeStep({}));
  for (let t = 0; t < d.T; t++) for (let j = 0; j < d.S; j++) assert.equal(hooked.weights[t][j], live.weights[t][j], `${id} hook-free variant differs ${d.dates[t]}`);
  const {nav} = simulate(d, live.weights), ref = hist.strategies[id];
  let n = 0;
  for (let t = 1; t < d.T; t++) {
    const a = hi.get(d.dates[t]), b = hi.get(d.dates[t - 1]);
    if (a === undefined || b === undefined) continue;
    assert.ok(Math.abs(nav[t] / nav[t - 1] - ref[a] / ref[b]) < 1e-9, `${id} replay differs on ${d.dates[t]}`); n++;
  }
  log(`复现核对 ${id}: ${n} 个交易日日收益与 history-daily.json 一致（<1e-9）；无挂钩变体与 stepStrategy 目标权重逐日相同。`);
}

function run(hooks = {}, patch = {}, opts = {}) {
  const T = targets(d, {...d.configs[ID], ...patch}, d.kinds[ID], makeStep(hooks));
  const W = opts.lag ? [T.weights[0], ...T.weights.slice(0, -1)] : T.weights;
  const {nav, held} = simulate(d, W, opts);
  return {nav, held, info: T.info, w: Object.fromEntries(Object.entries(WINDOWS).map(([k, [a, b]]) => [k, stats(d, nav, a, b)])),
    crises: Object.fromEntries(Object.entries(CRISES).map(([k, [a, b]]) => [k, windowMDD(d, nav, a, b)]))};
}
const header = `| 变体 | 十年窗 | 前五年 | 后五年 | 2007-16 | 十年夏普 | ${Object.keys(CRISES).join(' | ')} |\n|---|---|---|---|---|---|${Object.keys(CRISES).map(() => '---').join('|')}|`;
const row = (name, r) => `| ${name} | ${p1(r.w.ten.cagr)} / ${p1(r.w.ten.mdd)} | ${p1(r.w.first5.cagr)} / ${p1(r.w.first5.mdd)} | ${p1(r.w.last5.cagr)} / ${p1(r.w.last5.mdd)} | ${p1(r.w.semi.cagr)} / ${p1(r.w.semi.mdd)} | ${r.w.ten.sharpe.toFixed(2)} | ${Object.keys(CRISES).map(k => p1(r.crises[k])).join(' | ')} |`;
const table = (title, list) => { log(`\n### ${title}\n\n${header}`); for (const [name, h, patch] of list) log(row(name, run(h, patch))); };

// 2. Where the baseline loses: drawdowns deeper than 20% since 2007, by state.
const base = run();
log('\n### 基线回撤（2007 年以来超过 20%），按持仓来源状态拆分\n\n| 高点 → 低点 | 回撤 | 同期 QQQ | 收复 | 亏损来源（按状态） | 期间最高敞口 |\n|---|---|---|---|---|---|');
{
  const start = idx(d, '2007-01-03'), eps = [];
  let pk = start, tr = start;
  for (let t = start; t < d.T; t++) {
    if (base.nav[t] >= base.nav[pk]) { if (base.nav[tr] / base.nav[pk] - 1 <= -.2) eps.push({pk, tr, rec: t}); pk = t; tr = t; }
    else if (base.nav[t] < base.nav[tr]) tr = t;
  }
  if (base.nav[tr] / base.nav[pk] - 1 <= -.2) eps.push({pk, tr, rec: null});
  for (const e of eps.sort((a, b) => base.nav[a.tr] / base.nav[a.pk] - base.nav[b.tr] / base.nav[b.pk]).slice(0, 8)) {
    const by = {};
    for (let t = e.pk + 1; t <= e.tr; t++) { const st = base.info[t - 2].state; by[st] = (by[st] || 0) + Math.log(base.nav[t] / base.nav[t - 1]); }
    let mx = 0; for (let t = e.pk; t <= e.tr; t++) mx = Math.max(mx, exposure(base.held, t));
    log(`| ${d.dates[e.pk]} → ${d.dates[e.tr]} | ${pct(base.nav[e.tr] / base.nav[e.pk] - 1)} | ${pct(d.px.QQQ[e.tr] / d.px.QQQ[e.pk] - 1)} | ${e.rec === null ? '—' : d.dates[e.rec]} | ${Object.entries(by).map(([k, v]) => `${k} ${pct(Math.expm1(v))}`).join('，')} | ${mx.toFixed(2)} 倍 |`);
  }
}

// 3. Each solid-blue bottom-fishing episode and its regime at entry.
log('\n### 基线每段蓝点抄底（入场信号日的状态）\n\n| 入场 → 结束（信号日） | 熊市闸门 | CCC 压力 | 10 日 / 60 日波动 | 最高敞口 | 本段盈亏 | 段内最大回撤 |\n|---|---|---|---|---|---|---|');
{
  const eps = [];
  for (let t = 1; t < d.T; t++) { if (base.info[t].state === '抄底' && base.info[t - 1].state !== '抄底') eps.push({a: t, b: t}); else if (base.info[t].state === '抄底') eps.at(-1).b = t; }
  for (const e of eps.filter(e => e.b - e.a >= 5)) {
    const h0 = e.a + 1, h1 = Math.min(d.T - 1, e.b + 1);
    let mx = 0, pk = h0, mdd = 0;
    for (let t = h0; t <= h1; t++) { mx = Math.max(mx, exposure(base.held, t)); if (base.nav[t] > base.nav[pk]) pk = t; mdd = Math.min(mdd, base.nav[t] / base.nav[pk] - 1); }
    log(`| ${d.dates[e.a]} → ${d.dates[e.b]} | ${M[e.a].bear ? '亮' : '—'} | ${(d.signals[e.a] >> 7) & 1 ? '是' : '否'} | ${p1(M[e.a].vol.QQQ[10])}% / ${p1(M[e.a].vol.QQQ[60])}% | ${mx.toFixed(2)} 倍 | ${pct(base.nav[h1] / base.nav[h0] - 1)} | ${pct(mdd)} |`);
  }
  log(`\n熊市闸门亮时的抄底信号日 ${base.info.filter(x => x.state === '抄底' && x.flags.bear).length} / 全部抄底信号日 ${base.info.filter(x => x.state === '抄底').length}。`);
}

// 4. Pre-registered candidates (blue channel), then the secondary ordinary-channel ones.
table('预登记候选：蓝点通道（年化 / 最大回撤，%；危机列为窗口内最大回撤）', [
  ['基线（现行拟合·进取）', {}], ['A 熊市抄底上限 L=1（主值）', {blueBearCap: 1}], ['A 邻居 L=0', {blueBearCap: 0}], ['A 邻居 L=0.5', {blueBearCap: .5}],
  ['A 邻居 L=1.5', {blueBearCap: 1.5}], ['A 邻居 L=2', {blueBearCap: 2}], ['B CCC 压力 ≤0.5/σ10（主值）', {blueStressVolBudget: .5}],
  ['B 邻居 0.4/σ10', {blueStressVolBudget: .4}], ['B 邻居 0.6/σ10', {blueStressVolBudget: .6}], ['B 邻居 0.5/σ20', {blueStressVolBudget: .5, blueStressWindow: 20}],
  ['C 门控 σ=max(σ10,σ60)（主值）', {blueGateWindows: [10, 60]}], ['C 邻居 max(σ10,σ40)', {blueGateWindows: [10, 40]}], ['C 邻居 max(σ10,σ20)', {blueGateWindows: [10, 20]}],
  ['D 回撤闸覆盖抄底', {blueBrake: true}], ['E 熊市蓝点不解锁黄点（探索）', {noBlueUnlockInBear: true}], ['A+B（探索）', {blueBearCap: 1, blueStressVolBudget: .5}],
]);
table('次要候选：常态通道（针对 2011、2015-16）与结构性对照', [
  ['基线', {}], ['F 常态 ≤0.6/σ20', {ordVolBudget: .6}], ['F 常态 ≤0.75/σ20', {ordVolBudget: .75}], ['F 常态 ≤0.9/σ20', {ordVolBudget: .9}],
  ['G 二级回撤闸 −30% 再 ×0.5', {brake2: [.3, .5]}], ['A + G', {blueBearCap: 1, brake2: [.3, .5]}],
  ['常态 2.5 倍（对照）', {}, {lev_max: 2.5}], ['常态 2 倍（对照）', {}, {lev_max: 2}], ['只做 QQQ（对照）', {}, {pick: 'QQQ'}],
  ['A + 常态 2.5 倍', {blueBearCap: 1}, {lev_max: 2.5}], ['A + 常态 2 倍', {blueBearCap: 1}, {lev_max: 2}],
]);

// 5. Sensitivity of A to the bear definition, and the post-hoc entry-locked A'.
const q = d.px.QQQ, ma = (t, n) => { if (t < n - 1) return NaN; let s = 0; for (let i = t - n + 1; i <= t; i++) s += q[i]; return s / n; };
const bearDef = (n, k) => (_, t) => { const m = ma(t, n); return q[t] < m && m < ma(t - k, n); };
table('A 对熊市定义的敏感性（上限都取 1 倍）', [
  ['A 主值：MA200 且 21 日斜率（现有熊市闸门）', {blueBearCap: 1}], ['仅 QQQ<MA200', {blueBearCap: 1, regime: (_, t) => q[t] < ma(t, 200)}],
  ['MA200 且 10 日斜率', {blueBearCap: 1, regime: bearDef(200, 10)}], ['MA200 且 42 日斜率', {blueBearCap: 1, regime: bearDef(200, 42)}],
  ['MA150 且 21 日斜率', {blueBearCap: 1, regime: bearDef(150, 21)}], ['MA250 且 21 日斜率', {blueBearCap: 1, regime: bearDef(250, 21)}],
  ['仅 MA200 下行', {blueBearCap: 1, regime: (_, t) => ma(t, 200) < ma(t - 21, 200)}],
]);
table("事后变体 A'：按本轮蓝点窗口首个实心蓝点当天的熊市状态锁定（看过 2025 之后才提出）", [
  ['A 逐日（预登记）', {blueBearCap: 1}], ["A' L=1", {blueEntryBearCap: 1}], ["A' L=0.5", {blueEntryBearCap: .5}], ["A' L=1.5", {blueEntryBearCap: 1.5}],
]);

// 6. Execution timing and costs.
log('\n### 成交口径与成本\n\n| 变体 | 口径 | 十年窗 | 2007-16 | 全期 2007-2026 | 2008 段 |\n|---|---|---|---|---|---|');
for (const [name, h] of [['基线', {}], ['A L=1', {blueBearCap: 1}], ["A' L=1", {blueEntryBearCap: 1}], ['B 0.5/σ10', {blueStressVolBudget: .5}]])
  for (const [label, opts] of [['t+1 收盘', {}], ['t+2 收盘', {lag: true}], ['成本 ×2', {costMult: 2}]]) {
    const r = run(h, {}, opts);
    log(`| ${name} | ${label} | ${p1(r.w.ten.cagr)} / ${p1(r.w.ten.mdd)} | ${p1(r.w.semi.cagr)} / ${p1(r.w.semi.mdd)} | ${p1(r.w.full.cagr)} / ${p1(r.w.full.mdd)} | ${p1(r.crises['2008'])} |`);
  }

// 7. Block bootstrap.
const bootList = [['基线', {}], ['A L=1', {blueBearCap: 1}], ["A' L=1", {blueEntryBearCap: 1}], ['B 0.5/σ10', {blueStressVolBudget: .5}], ['A+B', {blueBearCap: 1, blueStressVolBudget: .5}], ['A + 常态 2.5 倍', {blueBearCap: 1}, {lev_max: 2.5}], ['A + 常态 2 倍', {blueBearCap: 1}, {lev_max: 2}]];
for (const [label, [from, to]] of [['全样本 2007-01 → 2026-10', WINDOWS.full], ['十年窗 2016-10 → 2026-10（原研究口径）', WINDOWS.ten]]) {
  log(`\n### 分块重抽样：${label}（63 日块，1 万条 10 年路径）\n\n| 变体 | 年化中位（10%~90%） | 回撤中位 | 较坏 10% 回撤 | 回撤超 35% | 回撤超 50% |\n|---|---|---|---|---|---|`);
  for (const [name, h, patch] of bootList) {
    const s = bootstrap(d, run(h, patch).nav, from, to);
    log(`| ${name} | ${p1(s.cagr50)}%（${p1(s.cagr10)}% ~ ${p1(s.cagr90)}%） | ${p1(s.mdd50)}% | ${p1(s.mdd10)}% | ${p1(s.p35)}% | ${p1(s.p50)}% |`);
  }
}

// 8. Calendar years.
{
  const list = [['基线', {}], ['A L=1', {blueBearCap: 1}], ["A' L=1", {blueEntryBearCap: 1}], ['B 0.5/σ10', {blueStressVolBudget: .5}]].map(([n, h]) => [n, run(h)]);
  log(`\n### 逐年收益\n\n| 年份 | ${list.map(x => x[0]).join(' | ')} | QQQ |\n|---|${list.map(() => '---').join('|')}|---|`);
  for (const y of [...new Set(d.dates.filter(x => x >= '2007').map(x => x.slice(0, 4)))]) {
    const a = Math.max(d.dates.findLastIndex(x => x < y), idx(d, '2007-01-03')), b = d.dates.findLastIndex(x => x.slice(0, 4) === y);
    log(`| ${y} | ${list.map(([, r]) => `${((r.nav[b] / r.nav[a] - 1) * 100).toFixed(0)}%`).join(' | ')} | ${((q[b] / q[a] - 1) * 100).toFixed(0)}% |`);
  }
}
writeFileSync(new URL('./results.md', import.meta.url), `# 拟合·进取尾部风控研究：完整输出\n\n由 \`node research/tail-risk/run.mjs\` 生成，勿手改。\n\n${out.join('\n')}\n`);
