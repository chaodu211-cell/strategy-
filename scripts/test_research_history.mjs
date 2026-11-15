import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {extendResearchHistory} from '../lib/research-history.js';
import {calculateLive,stepStrategy} from '../lib/live-engine.js';
import {customHistory,customMarketInput,validationHistory} from '../lib/validation-history.js';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
const [base,seed,daily,details]=['public/data.json','lib/live-seed.json','public/history-daily.json','public/history-positions.json'].map(read);
const closeAt=date=>date+'T20:00:00Z';
const market=seed.marketHistory.map(row=>({...row,closeAt:closeAt(row.date),prices:{...row.prices,BIL:100}}));
const baseline=market.at(-1);
const symbols=['QQQ','SOXX','QLD','USD','TQQQ','SOXL','PSQ','SQQQ','BIL'];
const tradeDay=(date,factor)=>({date,closeAt:closeAt(date),priceBasis:'adjusted',
  prices:Object.fromEntries(symbols.map(s=>[s,baseline.prices[s]*(s==='BIL'?1:factor)])),
  tradable:Object.fromEntries(symbols.map(s=>[s,true])),costs:Object.fromEntries(symbols.map(s=>[s,.0003]))});
market.push(tradeDay('2026-10-23',.99),tradeDay('2026-10-26',.95));
const signals=[{date:'2026-10-23',fit:{red:false,red_ad:false,blue:false,blue_soft:false,yellow:false,tdc:50,temp_red:50},
  credit:{top:false,bot:false,spread:8,ma200:9,percentile:35,observationDate:'2026-10-22',above200:false,stress:false}}];
const first=extendResearchHistory(base,seed,daily,details,market,signals,null,market.at(-1).closeAt);
assert.deepEqual(first.dates,['2026-10-23','2026-10-26']);
assert.equal(first.signalThrough,'2026-10-23');
assert.ok(Math.abs(first.benchmark.at(-1)/daily.benchmark.at(-1)-.95)<1e-12);
for(const id of Object.keys(seed.config)){
  assert.equal(first.strategies[id].points['2026-10-23'].signalDate,seed.date);
  assert.equal(first.strategies[id].points['2026-10-26'].signalDate,'2026-10-23');
  assert.equal(first.strategies[id].nav.length,2);
}
const during=extendResearchHistory(base,seed,daily,details,market,signals,null,market.at(-2).closeAt);
assert.deepEqual(during.dates,['2026-10-23']);
assert.deepEqual(extendResearchHistory(base,seed,daily,details,market,[],first,market.at(-1).closeAt),first,'Reuse verified signals during a source outage');
assert.throws(()=>extendResearchHistory(base,seed,daily,details,market.slice(0,-1),[],first,market.at(-1).closeAt),/早于已发布/);
const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../public/history-chart.js',import.meta.url),'utf8'),context);
const chart=context.window.HistoryChart;
const id='fitted-aggressive';
const series=chart.extendDailyHistory(daily,details.strategies[id],first,id);
assert.equal(series.dates.at(-1),'2026-10-26');
assert.equal(series.detail.points[series.dates.at(-1)].nav,series.nav.at(-1));
assert.equal(series.nav[daily.dates.length-1],daily.strategies[id].at(-1));
assert.equal(chart.extendDailyHistory(daily,details.strategies[id],{...first,version:'old'},id).dates,daily.dates);
const sample=series.dates.slice(-3).map((date,i)=>({date,nav:series.nav.at(i-3)}));
const peak=Math.max(...sample.map(row=>row.nav));
assert.equal(chart.summarize(sample).currentDrawdown,sample.at(-1).nav/peak-1);
console.log(JSON.stringify({researchContinuation:true,marketAheadOfSignals:true,versionCheck:true,liveDrawdown:true}));

const panel=read('public/custom-inputs.json'),C=globalThis.CustomBacktest;
const lateMarket=[...market,tradeDay('2026-10-27',.9)];
const research=extendResearchHistory(base,seed,daily,details,lateMarket,signals,first,lateMarket.at(-1).closeAt);
const confirmed=[{...customMarketInput(panel.symbols,baseline,market.at(-2)),dd52:-.01}];
const custom=customHistory(panel,research,confirmed,lateMarket);
assert.equal(custom.signalThrough,'2026-10-23');
assert.deepEqual(custom.rows.map(row=>row.date),research.dates);
assert.ok(!Object.hasOwn(custom.rows.at(-1),'signals'));
assert.deepEqual(customHistory(panel,research,confirmed,[],custom),custom);

const config={...C.defaults(),start:panel.meta.start};
for(const rule of config.rules)rule.action='ignore';
const projection=C.extendInputs(panel,custom,null,null,config);
const full=C.run(projection,{...config,end:projection.meta.end});
const frozen=C.run(panel,config);
assert.equal(full.details.points[seed.date].nav,frozen.history.at(-1).nav);
assert.equal(full.details.points['2026-10-27'].signalDate,'2026-10-23');
assert.ok(full.details.points['2026-10-27'].nav<full.details.points['2026-10-26'].nav);
const validation=validationHistory(daily,details,research,panel,custom,null,null,{id:'custom-test',configSnapshot:config,configVersion:'test'});
for(const id of [...Object.keys(seed.config),'custom-test']){
  assert.equal(validation.strategies[id][0].date,seed.date);
  assert.equal(validation.strategies[id][0].nav,1);
  assert.equal(validation.strategies[id].at(-1).date,'2026-10-27');
}
console.log(JSON.stringify({sharedOutOfSampleBaseline:true,exeterEngineContinuation:true,heldLastVerifiedSignal:true}));

const current=calculateLive(base,seed,[{...market.at(-2),...signals[0]}]).data.strategies;
for(const style of current){
  const trace=style.allocationBreakdown;
  assert.equal(trace.baseExposure,seed.config[style.id].lev_max);
  assert.ok(Math.abs((trace.steps.at(-1)?.after??trace.baseExposure)-style.exposure)<1e-9);
}
const fitted=seed.strategies['fitted-balanced'];
const checkpoint={...fitted,locked:false,braked:false,nav:1,peak:1,prevWeights:{},
  lastRed:-1e9,lastBlue:-1e9,lastSoft:-1e9,lastCreditTop:-1e9,lastCreditBottom:-1e9,blueIndices:[],softIndices:[]};
const params=seed.config['fitted-balanced'];
const input={...market.at(-2),...signals[0],market:{}};
const fixtureMarket={choice:'SOXX',bear:false,dd52:-.1,vol:{SOXX:{10:1}}};
const apply=(fit,credit={},config=params,tape=fixtureMarket)=>stepStrategy(checkpoint,config,{
  ...input,fit:{...input.fit,tdc:70,...fit},credit:{...input.credit,...credit}
},tape);
const ordinary=apply({}, {above200:true,stress:true});
assert.deepEqual(ordinary.allocationBreakdown.steps.map(({value,after})=>[value,after]),[[1,2],[.5,1]]);
const short=apply({red:true});
assert.deepEqual(short.allocationBreakdown.steps.map(({label,value,after})=>[label,value,after]),
  [['红点窗口',0,0],['红点反向配置',-.5,-.5]]);
const lock=apply({yellow:true},{stress:true});
assert.equal(lock.allocationBreakdown.steps[0].after,-1);
assert.equal(lock.allocationBreakdown.skipped.find(step=>step.label==='CCC 压力阶段').value,.5);
const buy=apply({blue:true},{stress:true},{...params,blue_k:2,soft_mult:.5,blue_lev:4});
assert.deepEqual(buy.allocationBreakdown.steps.map(({kind,value,after})=>[kind,value,after]),[['ladder',.5,2],['multiply',.5,1]]);
assert.equal(buy.allocationBreakdown.skipped.find(step=>step.label==='CCC 压力阶段').reason,'抄底规则覆盖');
const rejected=apply({blue:true});
assert.ok(rejected.allocationBreakdown.skipped.some(step=>step.label==='蓝点抄底覆盖'));
const cashFloor=apply({}, {bot:true}, {...params,ccc_bot_hold:10,ccc_bot_lev:3,blue_gate_vol:null});
assert.equal(cashFloor.allocationBreakdown.steps[0].label,'CCC 见底抄底覆盖');
const capped=apply({}, {}, {...params,lev_max:4});
assert.equal(capped.allocationBreakdown.steps.at(-1).after,3);
assert.equal(capped.allocationBreakdown.steps.at(-1).label,'ETF 可交易性与资金权重限制');
console.log(JSON.stringify({allOriginalFactors:true,neutralFactors:true,redShort:true,yellowLock:true,blueOverride:true,bottomOverride:true,etfLimit:true}));
