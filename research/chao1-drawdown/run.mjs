// Chao#1 drawdown-control research. Reproduces every table in README.md and writes results.md.
//   node scripts/build-pages.mjs --restore-only
//   node research/chao1-drawdown/run.mjs
// The site engine (public/custom-backtest.js) is loaded unchanged for the baseline; a research copy
// with optional cfg.research hooks is evaluated in a separate VM context and must reproduce the
// site engine exactly when no hook is set (asserted below).
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import vm from 'node:vm';
import '../../public/custom-backtest.js';

const C = globalThis.CustomBacktest;
const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const panel = read('../../public/custom-inputs.json'), rates = read('../../public/dgs30.json');
const data = {...panel, dgs30: rates.yieldsBp, meta: {...panel.meta, dgs30CSVHash: rates.csvSHA256}};
const settings = read('./chao1-settings.json'), BASE = settings.config;
const clone = x => structuredClone(x);
const out = [], log = s => { out.push(s); console.log(s); };

// ---- research copy of the engine ------------------------------------------------------------
let src = readFileSync(new URL('../../public/custom-backtest.js', import.meta.url), 'utf8');
const patch = (from, to) => { assert.equal(src.split(from).length, 2, 'patch point missing or not unique: ' + from.slice(0, 70)); src = src.replace(from, to); };
// Caps on the blue-ladder target, applied before the blue / ordinary comparison.
patch('windowStart:data.dates[Math.max(0,t-39)],windowEnd:data.dates[t],selected:false};',
  `windowStart:data.dates[Math.max(0,t-39)],windowEnd:data.dates[t],selected:false};
      if(cfg.research){const R=cfg.research;
        if(R.blueBearCap!==undefined&&bearGate200(data,t).active)blueLadder.target=Math.min(blueLadder.target,R.blueBearCap);
        if(R.blueVolBudget!==undefined){const v=researchVol(data,t,defaultAsset,10);if(v)blueLadder.target=Math.min(blueLadder.target,R.blueVolBudget/v);}
      }`);
// Trend filter on the ordinary long channel only (like the bear gate: yellow, blue and shorts untouched).
patch('const beforeBrake=r=>gateApplies(r)?0:rawRuleExposure(r);',
  `const trendOn=cfg.research?.trend?researchTrend(data,t,cfg.research.trend):false;
    const trendApplies=r=>trendOn&&r?.id!=='yellow'&&r?.id!=='blue'&&rawRuleExposure(r)>0;
    const beforeBrake=r=>gateApplies(r)?0:trendApplies(r)?rawRuleExposure(r)*cfg.research.trend.mult:rawRuleExposure(r);`);
// Always-on cap on every final long target: min(3, budget / sigma of the default underlying).
patch('const exposure=cccStressBlueLimit?.exposure??originalExposure;', 'let exposure=cccStressBlueLimit?.exposure??originalExposure;');
patch("      state+=' · CCC压力位蓝点限制';\n    }\n", `      state+=' · CCC压力位蓝点限制';
    }
    if(cfg.research?.volCapAll&&exposure>0){const R=cfg.research.volCapAll,v=researchVol(data,t,defaultAsset,R.window??10);
      if(v){const cap=Math.min(3,R.budget/v);if(exposure>cap+1e-12){const ratio=cap/exposure;for(let j=0;j<weights.length;j++)if(j!==bil)weights[j]*=ratio;weights[bil]=1-sum(weights.filter((_,j)=>j!==bil));exposure=cap;}}}
`);
patch('  function stressBlueLimit(data,t,monitorAsset,originalExposure){', `  function researchVol(data,t,asset,w){const index=data.symbols.findIndex(s=>s.symbol===asset&&s.leverage===1);if(index<0||t<w-1)return null;const sample=data.returns.slice(t-w+1,t+1).map(row=>row[index]);if(!sample.every(v=>typeof v==='number'&&Number.isFinite(v)))return null;const mean=sum(sample)/w,vol=Math.sqrt(sum(sample.map(v=>(v-mean)**2))/(w-1))*Math.sqrt(252);return vol>0?vol:null;}
  function researchTrend(data,t,R){const j=data.symbols.findIndex(s=>s.symbol==='QQQ');
    if(R.kind==='ma'){if(t<R.n)return false;let p=1;const closes=[1];for(let i=t-R.n+2;i<=t;i++){p*=1+data.returns[i][j];closes.push(p);}return p<sum(closes)/R.n;}
    if(R.kind==='dd'){const v=data.yellowContext.qqqDrawdown52[t];return typeof v==='number'&&v<=-R.depth;}
    return false;}
  function stressBlueLimit(data,t,monitorAsset,originalExposure){`);
const context = vm.createContext({});
vm.runInContext(src, context);
const R = context.CustomBacktest;

// ---- metrics ---------------------------------------------------------------------------------
const CRISES = {'2008': ['2007-10-31', '2009-06-30'], '2010': ['2010-04-23', '2010-09-30'], '2011': ['2011-02-17', '2011-12-31'], '2015-16': ['2015-06-01', '2016-06-30'],
  '2018Q4': ['2018-08-29', '2019-04-12'], '2020': ['2020-02-19', '2020-06-03'], '2022': ['2021-12-27', '2023-12-13'], '2025': ['2025-02-19', '2025-06-24']};
const WINDOWS = {full: ['2007-01-03', '2026-10-22'], ten: ['2016-10-21', '2026-10-22'], semi: ['2007-01-03', '2016-10-21']};
function winStats(s, from, to) {
  const a = s.dates.findIndex(x => x >= from), b = s.dates.findLastIndex(x => x <= to), rets = [];
  let pk = s.nav[a], mdd = 0;
  for (let t = a; t <= b; t++) { if (t > a) rets.push(s.nav[t] / s.nav[t - 1] - 1); pk = Math.max(pk, s.nav[t]); mdd = Math.min(mdd, s.nav[t] / pk - 1); }
  const yrs = (Date.parse(s.dates[b]) - Date.parse(s.dates[a])) / 86400000 / 365.25, m = rets.reduce((x, y) => x + y, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((x, y) => x + (y - m) ** 2, 0) / (rets.length - 1));
  return {cagr: (s.nav[b] / s.nav[a]) ** (1 / yrs) - 1, mdd, sharpe: m / sd * Math.sqrt(252)};
}
function evaluate(r) {
  const s = {dates: r.history.map(p => p.date), nav: r.history.map(p => p.nav)};
  return {s, r, w: Object.fromEntries(Object.entries(WINDOWS).map(([k, [a, b]]) => [k, winStats(s, a, b)])), crises: Object.fromEntries(Object.entries(CRISES).map(([k, [a, b]]) => [k, winStats(s, a, b).mdd]))};
}
const p1 = x => (x * 100).toFixed(1), pct = x => (x >= 0 ? '+' : '') + p1(x) + '%';
const HEADER = `| 变体 | 全期 2007-26 | 十年窗 | 2007-16 | 全期夏普 | ${Object.keys(CRISES).join(' | ')} |\n|---|---|---|---|---|${Object.keys(CRISES).map(() => '---').join('|')}|`;
const row = (name, e) => `| ${name} | ${p1(e.w.full.cagr)} / ${p1(e.w.full.mdd)} | ${p1(e.w.ten.cagr)} / ${p1(e.w.ten.mdd)} | ${p1(e.w.semi.cagr)} / ${p1(e.w.semi.mdd)} | ${e.w.full.sharpe.toFixed(2)} | ${Object.keys(CRISES).map(k => p1(e.crises[k])).join(' | ')} |`;
const variant = f => { const c = clone(BASE); f(c); return evaluate(R.run(data, c)); };
const research = (c, x) => { c.research = {...(c.research || {}), ...x}; };
const table = (title, list) => { log(`\n### ${title}\n\n${HEADER}`); for (const [name, f] of list) log(row(name, variant(f))); };

// ---- 1. reproduction contracts ---------------------------------------------------------------
const site = C.run(data, BASE);
for (const k of ['cagr', 'mdd', 'sharpe']) assert.equal(site.metrics[k], settings.metrics[k], `uploaded ${k} not reproduced`);
assert.equal(data.meta.dgs30CSVHash, settings.audit.dgs30CSVHash);
for (const f of [c => c, c => { c.bearGateEnabled = true; }, c => { c.drawdownGateEnabled = true; }, c => { c.cccStressBlueLimitEnabled = false; }]) {
  const cfg = clone(BASE); f(cfg);
  const a = C.run(data, cfg), b = R.run(data, cfg);
  assert.ok(a.history.every((p, i) => p.nav === b.history[i].nav), 'hook-free research engine differs from site engine');
}
log(`复现核对：网站引擎在冻结面板 + DGS30 快照上复现上传设置（年化 ${p1(site.metrics.cagr)}%、最大回撤 ${p1(site.metrics.mdd)}%、夏普 ${site.metrics.sharpe.toFixed(2)}，逐位相同）；无挂钩研究引擎与网站引擎在 4 组设置上逐日净值相同。`);

// ---- 2. where Chao#1 loses ------------------------------------------------------------------
{
  const e = evaluate(site), {dates, nav} = e.s, pts = site.details.points, q = site.benchmark.map(p => p.nav);
  const eps = []; let pk = 0, tr = 0;
  for (let t = 0; t < nav.length; t++) { if (nav[t] >= nav[pk]) { if (nav[tr] / nav[pk] - 1 <= -.25) eps.push({pk, tr, rec: t}); pk = t; tr = t; } else if (nav[t] < nav[tr]) tr = t; }
  if (nav[tr] / nav[pk] - 1 <= -.25) eps.push({pk, tr, rec: null});
  log('\n### 现状回撤（超过 25%），按前一信号日的目标状态拆分\n\n| 高点 → 低点 | 回撤 | 同期 QQQ | 收复 | 亏损来源 | 最高敞口 |\n|---|---|---|---|---|---|');
  for (const ep of eps.sort((a, b) => nav[a.tr] / nav[a.pk] - nav[b.tr] / nav[b.pk])) {
    const by = {}; let mx = 0;
    for (let t = ep.pk + 1; t <= ep.tr; t++) { const st = pts[dates[t - 1]].state.replace('（分位≥95）', ''); by[st] = (by[st] || 0) + Math.log(nav[t] / nav[t - 1]); mx = Math.max(mx, pts[dates[t - 1]].exposure); }
    log(`| ${dates[ep.pk]} → ${dates[ep.tr]} | ${pct(nav[ep.tr] / nav[ep.pk] - 1)} | ${pct(q[ep.tr] / q[ep.pk] - 1)} | ${ep.rec === null ? '—' : dates[ep.rec]} | ${Object.entries(by).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(Math.expm1(v))}`).join('；')} | ${mx.toFixed(2)} 倍 |`);
  }
}

// ---- 3. pre-registered candidates -------------------------------------------------------------
table('预登记候选（年化 / 最大回撤，%；危机列为窗口内最大回撤）', [
  ['现状（CCC 压力位蓝点限制开）', c => {}],
  ['关闭 CCC 限制（对照）', c => { c.cccStressBlueLimitEnabled = false; }],
  ['A 只加蓝点熊市上限 1 倍', c => research(c, {blueBearCap: 1})],
  ['熊市闸门开关（单独）', c => { c.bearGateEnabled = true; }],
  ['O1 熊市闸门 + 蓝点熊市上限，关 CCC 限制', c => { c.cccStressBlueLimitEnabled = false; c.bearGateEnabled = true; research(c, {blueBearCap: 1}); }],
  ['O3 熊市闸门 + 蓝点熊市上限 + CCC 限制', c => { c.bearGateEnabled = true; research(c, {blueBearCap: 1}); }],
  ['回撤闸开关', c => { c.drawdownGateEnabled = true; }],
  ['V 全时段 ≤0.5/σ10', c => research(c, {volCapAll: {budget: .5}})],
  ['V 全时段 ≤0.75/σ10', c => research(c, {volCapAll: {budget: .75}})],
  ['V 全时段 ≤1.0/σ10', c => research(c, {volCapAll: {budget: 1}})],
  ['V 全时段 ≤0.75/σ20', c => research(c, {volCapAll: {budget: .75, window: 20}})],
  ['VB 蓝点全时段 ≤0.5/σ10', c => research(c, {blueVolBudget: .5})],
  ['VB 蓝点全时段 ≤0.75/σ10', c => research(c, {blueVolBudget: .75})],
  ['X 蓝点 x=3', c => { c.rules[2].value = 3; }],
  ['X 蓝点 x=3.5', c => { c.rules[2].value = 3.5; }],
  ['常态 2.5 倍（对照）', c => { c.baseExposure = 2.5; }],
]);

// ---- 4. combinations and exploratory fast-crash filters ----------------------------------------
const x3 = c => { c.rules[2].value = 3; };
table('组合与探索（标「探索」的是看过结果后补测的急跌过滤，不参与挑选）', [
  ['X3 + A 蓝点熊市上限', c => { x3(c); research(c, {blueBearCap: 1}); }],
  ['X3 + V 全时段 ≤1.0/σ10', c => { x3(c); research(c, {volCapAll: {budget: 1}}); }],
  ['X3 + 常态 2.5 倍', c => { x3(c); c.baseExposure = 2.5; }],
  ['（探索）X3 + QQQ<MA50 时常态 ×0.5', c => { x3(c); research(c, {trend: {kind: 'ma', n: 50, mult: .5}}); }],
  ['（探索）X3 + QQQ<MA100 时常态 ×0.5', c => { x3(c); research(c, {trend: {kind: 'ma', n: 100, mult: .5}}); }],
  ['（探索）X3 + QQQ<MA200 时常态 ×0.5', c => { x3(c); research(c, {trend: {kind: 'ma', n: 200, mult: .5}}); }],
  ['（探索）X3 + QQQ 距高点 ≤−8% 时常态 ×0.5', c => { x3(c); research(c, {trend: {kind: 'dd', depth: .08, mult: .5}}); }],
  ['（探索）X3 + QQQ 距高点 ≤−12% 时常态 ×0.5', c => { x3(c); research(c, {trend: {kind: 'dd', depth: .12, mult: .5}}); }],
  ['X3，蓝点固定 QQQ', c => { x3(c); c.rules[2].asset = 'QQQ'; }],
  ['X3，蓝点固定 SOXX（对照）', c => { x3(c); c.rules[2].asset = 'SOXX'; }],
  ['X3，再平衡带 15%', c => { x3(c); c.band = .15; }],
  ['X3，再平衡带 10%', c => { x3(c); c.band = .10; }],
  ['X3，再平衡带 5%', c => { x3(c); c.band = .05; }],
]);

// ---- 5. blue x neighbours, leverage dial and bootstrap -----------------------------------------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function bootstrap(nav, {paths = 10000, len = 2520, block = 63, seed = 20261109} = {}) {
  const r = []; for (let t = 1; t < nav.length; t++) r.push(nav[t] / nav[t - 1] - 1);
  const rnd = mulberry32(seed), mdds = [], cagrs = [];
  for (let p = 0; p < paths; p++) { let v = 1, pk = 1, mdd = 0, n = 0; while (n < len) { const s = Math.floor(rnd() * (r.length - block)); for (let k = 0; k < block && n < len; k++, n++) { v *= 1 + r[s + k]; pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); } } mdds.push(mdd); cagrs.push(v ** (252 / len) - 1); }
  mdds.sort((x, y) => x - y); cagrs.sort((x, y) => x - y);
  const q = (a, x) => a[Math.floor(x * (a.length - 1))];
  return {c50: q(cagrs, .5), c10: q(cagrs, .1), m50: q(mdds, .5), m10: q(mdds, .1), p40: mdds.filter(x => x < -.4).length / paths, p50: mdds.filter(x => x < -.5).length / paths};
}
const dial = [
  ['现状（x=4，常态 3 倍）', c => {}], ['x=2.5', c => { c.rules[2].value = 2.5; }], ['x=3', x3], ['x=3.5', c => { c.rules[2].value = 3.5; }], ['x=5（对照）', c => { c.rules[2].value = 5; }],
  ['x=3，常态 2.75 倍', c => { x3(c); c.baseExposure = 2.75; }], ['x=3，常态 2.5 倍', c => { x3(c); c.baseExposure = 2.5; }],
  ['x=3，常态 2.25 倍', c => { x3(c); c.baseExposure = 2.25; }], ['x=3，常态 2 倍', c => { x3(c); c.baseExposure = 2; }],
  ['O3 熊市闸门 + 蓝点熊市上限 + CCC 限制', c => { c.bearGateEnabled = true; research(c, {blueBearCap: 1}); }], ['回撤闸开关', c => { c.drawdownGateEnabled = true; }],
];
const dialRuns = dial.map(([name, f]) => [name, variant(f)]);
log(`\n### 蓝点 x 的邻居与常态杠杆刻度\n\n${HEADER}`);
for (const [name, e] of dialRuns) log(row(name, e));
log('\n### 全样本分块重抽样（2007-2026 日收益，63 日块，1 万条 10 年路径）\n\n| 变体 | 融资天数 | 年换手 | 年化中位（较差 10%） | 回撤中位 | 较坏 10% 回撤 | 回撤超 40% | 回撤超 50% |\n|---|---|---|---|---|---|---|---|');
for (const [name, e] of dialRuns) { const b = bootstrap(e.s.nav); log(`| ${name} | ${e.r.audit.financingDays} | ${e.r.metrics.turn_yr.toFixed(1)} | ${p1(b.c50)}%（${p1(b.c10)}%） | ${p1(b.m50)}% | ${p1(b.m10)}% | ${p1(b.p40)}% | ${p1(b.p50)}% |`); }

// ---- 6. the registered, forward-tracked version --------------------------------------------------
{
  const reg = read('../../tracking/registrations/custom-chao-1.json').configSnapshot;
  // Same normalisation as scripts/daily-update.mjs: absent switches stay at the registered behaviour (off).
  const registered = clone(reg);
  log(`\n### 已登记并每日跟踪的 custom-chao-1（常态 ${reg.asset}、蓝点 ${reg.rules[2].asset} ${reg.rules[2].value} 倍、CCC 限制字段缺失＝关闭）\n\n${HEADER}`);
  log(row('已登记 custom-chao-1', evaluate(C.run(data, registered))));
  const on = clone(reg); on.cccStressBlueLimitEnabled = true;
  log(row('已登记版 + CCC 压力位蓝点限制', evaluate(C.run(data, on))));
}
writeFileSync(new URL('./results.md', import.meta.url), `# Chao#1 回撤控制研究：完整输出\n\n由 \`node research/chao1-drawdown/run.mjs\` 生成，勿手改。\n\n${out.join('\n')}\n`);
