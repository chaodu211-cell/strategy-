import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {advanceLedger,queueTargets} from '../lib/forward-ledger.js';
import '../public/custom-backtest.js';

const engine=globalThis.CustomBacktest;
const read=async name=>JSON.parse(await readFile(new URL('../public/'+name,import.meta.url)));
const reversal=cfg=>cfg.rules.find(rule=>rule.id==='triangle');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' != '+expected);

const panel=await read('custom-inputs.json');
panel.vixTermRelease=await read('vix-term-release.json');
const config={...engine.defaults(),start:'2022-06-13',end:'2022-12-09',baseExposure:1,
  bearGateEnabled:true,cccStressBlueLimitEnabled:true,band:.25};
for(const rule of config.rules)rule.action='ignore';
Object.assign(reversal(config),{action:'scale',value:6,days:40});
const result=engine.run(panel,config);
const june=result.details.points['2022-06-27'];
assert.equal(june.bearGate.multiplier,0);
assert.equal(june.bearGate.applied,false);
assert.equal(june.cccStressBlueLimit.applied,true);
near(june.targetExposure,june.cccStressBlueLimit.cap);

for(const date of ['2022-08-11','2022-08-12','2022-08-15']){
  const point=result.details.points[date];
  assert.equal(point.state,'vix反转 · 抄底仓位');
  assert.equal(point.bearGate.applied,false);
  near(point.targetExposure,6);
  near(point.targetCash,-1);
}
assert.equal(result.details.points['2022-08-12'].bearGate.multiplier,0);
assert.ok(result.details.points['2022-08-11'].bearGate.multiplier>0);
assert.ok(!result.details.trades.some(trade=>trade.date==='2022-08-12'&&trade.type==='sell'));

const ma200=engine.run(panel,{...config,bearGateMethod:'ma200'}).details.points['2022-06-27'];
assert.equal(ma200.bearGate.active,true);
assert.equal(ma200.bearGate.applied,false);
near(ma200.targetExposure,ma200.cccStressBlueLimit.cap);

const dates=['2022-01-03','2022-01-04','2022-01-05','2022-01-06','2022-01-07','2022-01-10','2022-01-11'];
const fixture={
  schemaVersion:1,meta:{start:dates[1],end:dates.at(-1)},
  signalTypes:engine.RULES.filter(rule=>rule.id!=='triangle').map(rule=>rule.id),
  dates,symbols:[{symbol:'QQQ',underlying:'QQQ',leverage:1},{symbol:'TQQQ',underlying:'QQQ',leverage:3},{symbol:'BIL',leverage:0}],
  signals:dates.map(()=>0),tradable:dates.map(()=>7),costs:dates.map(()=>[0,0,0]),
  returns:dates.map(date=>[0,date==='2022-01-07'?.01:0,0]),
  vixTermRelease:{through:dates.at(-1),events:{'2022-01-05':{blue_date:'2022-01-04',wait:1,s41:1}}},
};
const firstEntryConfig={...structuredClone(config),start:dates[1],end:dates.at(-1),baseExposure:1.5,
  bearGateEnabled:false,cccStressBlueLimitEnabled:false};
Object.assign(reversal(firstEntryConfig),{value:1.1,days:2});
const points=engine.run(fixture,firstEntryConfig).details.points;
near(points['2022-01-05'].exposure,1.5);
near(points['2022-01-06'].exposure,1.65);
assert.equal(points['2022-01-06'].rebalanced,true,'The first entry reaches the full target inside the band');
assert.equal(points['2022-01-07'].rebalanced,false,'The same signal does not force the next close to trade');
assert.equal(points['2022-01-10'].state,'常态');

const market=dates.map((date,i)=>({date,closeAt:date+'T20:00:00Z',prices:{QQQ:100,BIL:100,TQQQ:i<4?100:101},
  tradable:{QQQ:true,TQQQ:true},costs:{QQQ:0,BIL:0,TQQQ:0}}));
const ledger={startDate:dates[1],strategies:[{id:'vix',name:'vix',band:.25,lastDate:dates[2],
  amounts:{TQQQ:.5,BIL:.5},points:[]}]};
const target={signalDate:dates[2],vixReversalSignalDate:dates[2],weights:{TQQQ:.55,BIL:.45},state:'vix反转 · 抄底仓位'};
const queued=queueTargets(ledger,{vix:target},dates[2]+'T21:00:00Z');
const live=advanceLedger(queued,market.slice(0,5),{observedAt:dates[4]+'T21:00:00Z'}).strategies[0].points;
assert.equal(live[0].rebalanced,true);
near(live[0].weights.TQQQ,.55);
assert.equal(live[1].rebalanced,false);
console.log('vix reversal: both bear gates bypassed, financed target, CCC cap, one-time entry and ledger execution verified.');
