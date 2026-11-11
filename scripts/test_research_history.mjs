import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {extendResearchHistory} from '../lib/research-history.js';

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
