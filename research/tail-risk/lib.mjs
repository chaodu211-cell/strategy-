// Tail-risk research harness for the original fitted strategies.
// Replays lib/live-engine.js stepStrategy (the exact incremental port of strategy2.py)
// on the frozen research panel public/custom-inputs.json, with the original
// "signal t, trade at close t+1" execution, 60-day-ADV cost tiers and 5pp band.
// Run `node scripts/build-pages.mjs --restore-only` first to restore the panel.
import {readFileSync} from 'node:fs';
import {stepStrategy} from '../../lib/live-engine.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const sum = a => a.reduce((s, x) => s + x, 0);
const copy = v => JSON.parse(JSON.stringify(v));
const readJSON = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

export function loadPanel() {
  const d = readJSON('../../public/custom-inputs.json');
  d.T = d.dates.length; d.S = d.symbols.length;
  d.sym = Object.fromEntries(d.symbols.map((s, j) => [s.symbol, j]));
  d.px = {};
  for (const name of ['QQQ', 'SOXX']) { // relative adjusted price index from frozen returns
    const j = d.sym[name], p = new Array(d.T);
    let v = 1;
    for (let t = 0; t < d.T; t++) { const r = d.returns[t][j]; if (t > 0) v = finite(r) ? v * (1 + r) : NaN; p[t] = v; }
    d.px[name] = p;
  }
  const seed = readJSON('../../lib/live-seed.json');
  d.configs = seed.config; d.kinds = seed.kinds;
  d.history = readJSON('../../public/history-daily.json');
  return d;
}

function rollingVol(p, t, w) {
  const out = [];
  for (let i = Math.max(1, t - w + 1); i <= t; i++) { const a = p[i - 1], b = p[i]; if (finite(a) && a > 0 && finite(b)) out.push(b / a - 1); }
  if (out.length < Math.floor(w * .8) || out.length < 2) return NaN;
  const m = sum(out) / out.length;
  return Math.sqrt(sum(out.map(x => (x - m) ** 2)) / (out.length - 1)) * Math.sqrt(252);
}
function mean(p, a, b, min) { let s = 0, n = 0; for (let i = Math.max(0, a); i <= b; i++) if (finite(p[i])) { s += p[i]; n++; } return n >= min ? s / n : NaN; }

// Same definitions as live-engine deriveMarket. During the 2005 warm-up, when the
// 126-day momentum is unavailable, the previous pick (initially QQQ) is kept.
function marketAt(d, t, prevChoice) {
  const q = d.px.QQQ;
  const ma = t >= 199 ? mean(q, t - 199, t, 200) : NaN, oldMa = t >= 220 ? mean(q, t - 220, t - 21, 200) : NaN;
  let hi = -Infinity, n = 0;
  for (let i = Math.max(0, t - 251); i <= t; i++) if (finite(q[i])) { hi = Math.max(hi, q[i]); n++; }
  let choice = prevChoice;
  if (t === 0 || d.dates[t].slice(0, 7) !== d.dates[t - 1].slice(0, 7) || !['QQQ', 'SOXX'].includes(choice)) {
    const calc = name => { const a = d.px[name][t - 21], b = d.px[name][t - 126]; return t >= 126 && finite(a) && finite(b) && b > 0 ? a / b - 1 : NaN; };
    const sq = calc('QQQ'), ss = calc('SOXX');
    if (finite(sq) && finite(ss)) choice = prevChoice === 'SOXX' ? (sq > ss ? 'QQQ' : 'SOXX') : (ss > sq ? 'SOXX' : 'QQQ');
    else if (!['QQQ', 'SOXX'].includes(choice)) choice = 'QQQ';
  }
  const vol = Object.fromEntries(['QQQ', 'SOXX'].map(s => [s, Object.fromEntries([10, 20, 40, 60].map(w => [w, rollingVol(d.px[s], t, w)]))]));
  return {bear: q[t] < ma && ma < oldMa, dd52: n >= 60 ? q[t] / hi - 1 : NaN, choice, vol, ma, oldMa, best: bestTools(d, t)};
}

// Highest-leverage tradable tool, real ETF before research synthetic (original rule).
function bestTools(d, t) {
  const avail = d.symbols.map((s, j) => ({...s, j})).filter(s => s.symbol !== 'BIL' && (d.tradable[t] & (1 << s.j)));
  const pick = f => avail.filter(f).sort((a, b) => Math.abs(b.leverage) - Math.abs(a.leverage) || Number(a.synthetic) - Number(b.synthetic) || a.j - b.j)[0] || null;
  const tool = s => s ? {symbol: s.symbol, leverage: s.leverage, underlying: s.underlying} : null;
  const shortLev = tool(pick(s => s.leverage < 0)), psq = tool(pick(s => s.symbol === 'PSQ'));
  return {
    lev: {QQQ: tool(pick(s => s.leverage > 0 && s.underlying === 'QQQ')), SOXX: tool(pick(s => s.leverage > 0 && s.underlying === 'SOXX')), short: {SQQQ: shortLev, PSQ: shortLev}},
    one: {QQQ: tool(pick(s => s.symbol === 'QQQ')), SOXX: tool(pick(s => s.symbol === 'SOXX')), short: {PSQ: psq, SQQQ: psq}},
  };
}

let MARKETS = null;
export function markets(d) {
  if (MARKETS) return MARKETS;
  MARKETS = []; let choice = 'QQQ';
  for (let t = 0; t < d.T; t++) { const m = marketAt(d, t, choice); MARKETS.push(m); choice = m.choice; }
  return MARKETS;
}

function rowAt(d, t, market) {
  const m = d.signals[t], bit = i => !!(m & (1 << i)), r = d.readings[t];
  return {date: d.dates[t], priceBasis: 'adjusted', prices: {}, market,
    returns: Object.fromEntries(d.symbols.map((s, j) => [s.symbol, d.returns[t][j]])),
    fit: {red: bit(0), red_ad: bit(1), blue: bit(2), blue_soft: bit(3), yellow: bit(4), tdc: d.yellowContext.tdc[t], temp_red: r[0]},
    credit: {top: bit(5), bot: bit(6), stress: bit(7), above200: bit(8), spread: r[2], ma200: r[3], percentile: r[4]}};
}

const initialCheckpoint = () => ({index: -1, date: null, lastRed: -1e9, lastBlue: -1e9, lastSoft: -1e9, lastCreditTop: -1e9, lastCreditBottom: -1e9,
  locked: false, nav: 1, peak: 1, braked: false, prevWeights: {}, prevPrices: {}, blueIndices: [], softIndices: [], choice: 'QQQ'});

/**
 * Copy of stepStrategy with optional risk hooks; makeStep({}) reproduces it exactly
 * (asserted in run.mjs). Hooks:
 *  blueBearCap L        - solid-blue ladder exposure <= L while the bear gate is on (signal day)
 *  regime(d,t,market)   - replaces the bear-gate definition used by blueBearCap
 *  blueEntryBearCap L   - exposure <= L for the whole blue window if the gate was on at its first solid blue
 *  blueStressVolBudget b- under CCC stress, blue exposure <= min(3, b / sigma_window) (custom cccStressBlueLimit formula)
 *  blueStressWindow w   - window for the above (default 10)
 *  blueGateWindows [ws] - blue vol gate uses max(sigma_w) instead of sigma10
 *  blueBrake            - the portfolio drawdown brake also halves blue exposure
 *  noBlueUnlockInBear   - a solid blue does not release the yellow lock while the bear gate is on
 *  ordVolBudget v       - ordinary base exposure <= v / sigma20 of the selected asset
 *  brake2 [dd, m]       - second brake stage: reference drawdown <= -dd multiplies ordinary by m
 */
export function makeStep(hooks = {}) {
  return function step(checkpoint, cfg, row, market, kind = 'lev', ctx = {}) {
    const s = copy(checkpoint), p = cfg, t = s.index + 1;
    if (p.dd_brake) {
      let ret = 0;
      for (const [symbol, weight] of Object.entries(s.prevWeights)) {
        if (!weight) continue;
        const r = row.returns?.[symbol];
        if (!finite(r)) throw new Error(`missing return ${row.date} ${symbol}`);
        ret += weight * r;
      }
      s.nav *= 1 + ret; s.peak = Math.max(s.peak, s.nav);
      s.dd = s.nav / s.peak - 1;
      if (s.dd <= -p.dd_brake[0]) s.braked = true;
      else if (s.dd >= -p.dd_brake[0] / 2) s.braked = false;
    }
    const f = row.fit, c = row.credit, bear = market.bear;
    if (f.red || (p.use_ad && f.red_ad)) s.lastRed = t;
    if (f.blue) { s.lastBlue = t; if (p.blue_unlock && !(hooks.noBlueUnlockInBear && bear)) s.locked = false; }
    if (f.blue_soft) s.lastSoft = t;
    if (c.top) s.lastCreditTop = t;
    if (c.bot) { s.lastCreditBottom = t; if (p.ccc_bot_release) s.locked = false; }
    if (f.yellow && p.yellow_lock) s.locked = true;
    else if (s.locked && finite(f.tdc) && f.tdc < p.rearm) s.locked = false;
    else if (s.locked && p.rec_unlock !== null && finite(market.dd52) && market.dd52 >= p.rec_unlock) s.locked = false;
    const hold = Math.max(p.blue_hold, 1);
    if (f.blue && !s.blueIndices.some(i => i > t - hold)) s.blueEntryBear = !!bear;
    s.blueIndices.push(...(f.blue ? [t] : [])); s.softIndices.push(...(f.blue_soft ? [t] : []));
    s.blueIndices = s.blueIndices.filter(i => i > t - hold);
    s.softIndices = s.softIndices.filter(i => i > t - hold);
    const redOn = t - s.lastRed < p.red_hold;
    const blueOn = t - s.lastBlue < p.blue_hold || (p.soft_mult > 0 && t - s.lastSoft < p.blue_hold);
    const bottomOn = p.ccc_bot_hold > 0 && t - s.lastCreditBottom < p.ccc_bot_hold;
    const stress = c.stress ?? c.percentile >= 95;
    const vol = (asset, w) => market.vol?.[asset]?.[w];
    let Eb = 0;
    if (blueOn || bottomOn) {
      if (blueOn) Eb = p.blue_lev * Math.min(1, (s.blueIndices.length + p.soft_mult * s.softIndices.length) / p.blue_k);
      if (bottomOn) Eb = Math.max(Eb, p.ccc_bot_lev);
      if (p.blue_gate_vol) {
        const v = hooks.blueGateWindows ? Math.max(...hooks.blueGateWindows.map(w => vol(p.blue_asset, w)).filter(finite)) : vol(p.blue_asset, 10);
        if (finite(v) && v > 0) Eb *= Math.min(1, p.blue_gate_vol / v);
      }
      const regime = hooks.regime ? hooks.regime(ctx.d, ctx.t, market) : bear;
      if (hooks.blueBearCap !== undefined && regime) Eb = Math.min(Eb, hooks.blueBearCap);
      if (hooks.blueEntryBearCap !== undefined && s.blueEntryBear) Eb = Math.min(Eb, hooks.blueEntryBearCap);
      if (hooks.blueStressVolBudget !== undefined && stress) {
        const v = vol(p.blue_asset, hooks.blueStressWindow ?? 10);
        if (finite(v) && v > 0) Eb = Math.min(Eb, 3, hooks.blueStressVolBudget / v);
      }
      if (hooks.blueBrake && s.braked) Eb *= p.dd_brake?.[1] ?? 1;
    }
    const selection = p.pick === 'switch' ? market.choice : p.pick;
    let state = 0, En, mult = 1, base = p.lev_max;
    if (s.locked) { state = 3; En = -p.short_yellow; }
    else {
      const add = (cond, m) => { if (cond) mult *= m; };
      add(redOn, p.red_mult); if (redOn) state = 1;
      add(c.above200 ?? c.spread > c.ma200, p.ccc_up_mult);
      add(stress, p.ccc_stress_mult);
      add(t - s.lastCreditTop < p.ccc_top_hold, p.ccc_top_mult);
      add(bear, p.bear_mult);
      add(s.braked, p.dd_brake?.[1] ?? 1);
      if (hooks.brake2 && p.dd_brake && s.dd <= -hooks.brake2[0]) mult *= hooks.brake2[1];
      if (mult <= 0) { state = state || 2; En = state === 1 ? -p.short_red : 0; }
      else {
        const v = vol(selection, p.vol_win);
        if (p.vol_tgt !== null && finite(v) && v > 0) base = Math.min(base, p.vol_tgt / v);
        if (hooks.ordVolBudget !== undefined) { const vv = vol(selection, 20); if (finite(vv) && vv > 0) base = Math.min(base, hooks.ordVolBudget / vv); }
        En = base * mult;
      }
    }
    let holdings = [], exposure = 0;
    const assign = (underlying, e, isShort = false) => {
      const tool = isShort ? market.best[kind]?.short?.[underlying] : market.best[kind]?.[underlying]; if (!tool) return;
      const weight = Math.min(1, e / Math.abs(tool.leverage));
      if (weight > 0) { holdings = [{...tool, weight}]; exposure = weight * tool.leverage; }
    };
    if (Eb > 0 && Eb >= En) { state = 4; assign(p.blue_asset, Eb); }
    else if (En < 0) assign(p.short_inst, -En, true);
    else if (En > 0) assign(selection, En);
    s.index = t; s.date = row.date; s.prevWeights = Object.fromEntries(holdings.map(h => [h.symbol, h.weight])); s.choice = market.choice;
    s.state = state; s.exposure = exposure;
    return {checkpoint: s, holdings, exposure, state: ['常态', '红点', '乘数为零', '黄点锁仓', '抄底'][state], selection,
      flags: {redOn, locked: s.locked, blueOn, braked: s.braked, bear, stress}};
  };
}

// targets[t]: weight vector decided with information through close t.
export function targets(d, cfg, kind = 'lev', step = stepStrategy) {
  const M = markets(d), weights = new Array(d.T), info = new Array(d.T);
  let s = initialCheckpoint();
  for (let t = 0; t < d.T; t++) {
    const res = step(s, cfg, rowAt(d, t, M[t]), M[t], kind, {d, t});
    s = res.checkpoint;
    const w = new Array(d.S).fill(0);
    for (const h of res.holdings) w[d.sym[h.symbol]] += h.weight;
    w[d.sym.BIL] = 1 - sum(w);
    weights[t] = w; info[t] = {state: res.state, exposure: res.exposure, flags: res.flags, selection: res.selection};
  }
  return {weights, info};
}

// The target from signal day t-1 is traded at close t (same as custom-backtest run()).
export function simulate(d, W, {band = .05, costMult = 1} = {}) {
  let h = W[0].slice(), v = 1;
  const nav = new Array(d.T).fill(NaN), held = new Array(d.T);
  nav[0] = 1; held[0] = h.slice();
  for (let t = 1; t < d.T; t++) {
    h = h.map((x, j) => x * (1 + (finite(d.returns[t][j]) ? d.returns[t][j] : 0)));
    v = sum(h);
    if (!(v > 0)) throw new Error('nav exhausted ' + d.dates[t]);
    const before = h.map(x => x / v), target = W[t - 1], delta = target.map((x, j) => Math.abs(x - before[j]));
    if (Math.max(...delta) > band + 1e-12 || target.some((x, j) => (x > 1e-9) !== (before[j] > 1e-9))) {
      v *= 1 - sum(delta.map((x, j) => x * d.costs[t][j] * costMult)); h = target.map(x => x * v);
    }
    nav[t] = v; held[t] = h.map(x => x / v);
  }
  return {nav, held};
}

export const idx = (d, date, side = 'ge') => side === 'ge' ? d.dates.findIndex(x => x >= date) : d.dates.findLastIndex(x => x <= date);

export function stats(d, nav, from, to) {
  const a = idx(d, from), b = idx(d, to, 'le'), rets = [];
  let peak = nav[a], mdd = 0;
  for (let t = a; t <= b; t++) { if (t > a) rets.push(nav[t] / nav[t - 1] - 1); peak = Math.max(peak, nav[t]); mdd = Math.min(mdd, nav[t] / peak - 1); }
  const years = (Date.parse(d.dates[b]) - Date.parse(d.dates[a])) / 86400000 / 365.25;
  const m = sum(rets) / rets.length, sd = Math.sqrt(sum(rets.map(r => (r - m) ** 2)) / (rets.length - 1));
  return {cagr: (nav[b] / nav[a]) ** (1 / years) - 1, mdd, sharpe: m / sd * Math.sqrt(252)};
}

export const WINDOWS = {ten: ['2016-10-21', '2026-10-22'], first5: ['2016-10-21', '2021-10-21'], last5: ['2021-10-21', '2026-10-22'], semi: ['2007-01-03', '2016-10-21'], full: ['2007-01-03', '2026-10-22']};
export const CRISES = {'2008': ['2007-10-31', '2009-06-30'], '2010': ['2010-04-23', '2010-09-30'], '2011': ['2011-02-17', '2011-12-31'], '2015-16': ['2015-06-01', '2016-06-30'],
  '2018Q4': ['2018-08-29', '2019-04-12'], '2020': ['2020-02-19', '2020-06-03'], '2022': ['2021-12-27', '2023-12-13'], '2025': ['2025-02-19', '2025-06-24']};

export function windowMDD(d, nav, from, to) {
  const a = idx(d, from), b = idx(d, to, 'le');
  let pk = nav[a], mdd = 0;
  for (let t = a; t <= b; t++) { pk = Math.max(pk, nav[t]); mdd = Math.min(mdd, nav[t] / pk - 1); }
  return mdd;
}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Block bootstrap of daily returns into 10-year paths (63-day blocks, fixed seed).
export function bootstrap(d, nav, from, to, {paths = 10000, len = 2520, block = 63, seed = 20261109} = {}) {
  const a = idx(d, from), b = idx(d, to, 'le'), r = [];
  for (let t = a + 1; t <= b; t++) r.push(nav[t] / nav[t - 1] - 1);
  const rnd = mulberry32(seed), mdds = [], cagrs = [];
  for (let p = 0; p < paths; p++) {
    let v = 1, pk = 1, mdd = 0, n = 0;
    while (n < len) { const s = Math.floor(rnd() * (r.length - block)); for (let k = 0; k < block && n < len; k++, n++) { v *= 1 + r[s + k]; pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); } }
    mdds.push(mdd); cagrs.push(v ** (252 / len) - 1);
  }
  mdds.sort((x, y) => x - y); cagrs.sort((x, y) => x - y);
  const q = (arr, x) => arr[Math.floor(x * (arr.length - 1))];
  return {cagr50: q(cagrs, .5), cagr10: q(cagrs, .1), cagr90: q(cagrs, .9), mdd50: q(mdds, .5), mdd10: q(mdds, .1), p35: mdds.filter(x => x < -.35).length / paths, p50: mdds.filter(x => x < -.5).length / paths};
}
