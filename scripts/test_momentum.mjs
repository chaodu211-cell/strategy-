import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {alignDgs30,extendDgs30,parseDgs30} from './dgs30.mjs';
import '../public/custom-backtest.js';

const C=globalThis.CustomBacktest;
const dates=[];
const holidays=new Set(['2024-12-25','2025-01-01','2025-01-20','2025-02-17']);
for(const day=new Date('2024-06-03');day<=new Date('2025-04-01');day.setUTCDate(day.getUTCDate()+1)){
  const date=day.toISOString().slice(0,10);
  if(day.getUTCDay()%6&&!holidays.has(date))dates.push(date);
}
const idx=date=>dates.indexOf(date);
const panel=soxx=>({
  dates,symbols:[{symbol:'QQQ'},{symbol:'SOXX'}],
  returns:dates.map(()=>[0,soxx]),
  dgs30:Object.fromEntries(dates.map(date=>[date,400]))
});
const replay=data=>{const memory={};return data.dates.map((_,t)=>C.momentumChoice(data,t,memory));};
const first=dates.findIndex((d,i)=>i>=126&&d.slice(0,7)!==dates[i-1].slice(0,7));
const next=dates.findIndex((d,i)=>i>first&&d.slice(0,7)!==dates[i-1].slice(0,7));
assert.ok(first>126);
assert.equal(replay(panel(.003))[126].decisionDate,null,'History completing mid-month cannot trigger a comparison');
assert.equal(replay(panel(0))[first].monthlySelection,'QQQ','Initial tie chooses QQQ');

const tie=panel(0);
tie.returns[first-125][1]=.1;
tie.returns[first-126][0]=.9; // Return into the starting close is outside the window.
const ties=replay(tie);
assert.equal(ties[first].monthlySelection,'SOXX');
assert.equal(ties[first].from,dates[first-126]);
assert.equal(ties[first].through,dates[first-21]);
assert.deepEqual(ties[next].scores,{QQQ:0,SOXX:0});
assert.equal(ties[next].monthlySelection,'SOXX','A tie retains the previous monthly winner');

const jan=idx('2025-01-02'),feb=idx('2025-02-03');
const oneNegative=panel(.003);
oneNegative.returns[jan][1]=-.08;
const shortOnly=replay(oneNegative)[jan];
assert.ok(shortOnly.weakness.shortChange<0&&shortOnly.weakness.longChange>0);
assert.equal(shortOnly.selection,'SOXX','One negative horizon does not lock the month');
const zero=panel(.012);
zero.returns[jan-22][1]=-.45;
for(let i=jan-20;i<=jan;i++)zero.returns[i][1]=0;
const atZero=replay(zero)[jan];
assert.equal(atZero.weakness.shortChange,0);
assert.ok(atZero.weakness.longChange<0);
assert.equal(atZero.selection,'SOXX','Zero does not count as negative');

const weekly=panel(.003),drop=idx('2025-01-15'),check=idx('2025-01-21');
weekly.returns[drop][1]=-.35;
weekly.returns[check+1][1]=.6;
const weeks=replay(weekly);
assert.equal(weeks[drop].selection,'SOXX','A midweek price drop cannot change the selection');
assert.equal(weeks[check-1].selection,'SOXX');
assert.equal(weeks[check].selection,'QQQ','The first session after the Monday holiday checks relative strength');
assert.deepEqual([weeks[check].weakness.check,weeks[check].weakness.locked],['week',true]);
assert.equal(weeks[idx('2025-01-27')].selection,'QQQ','A relative recovery cannot lift the same-month lock');
assert.equal(weeks[feb].selection,'SOXX','The next month re-evaluates the lock');
assert.equal(weeks[feb].weakness.check,'month','A month start takes precedence over a week start');

const monthWeak=panel(.003);
monthWeak.returns[feb][1]=-.35;
const month=replay(monthWeak)[feb];
assert.equal(month.monthlySelection,'SOXX','The signal day is excluded from monthly momentum');
assert.deepEqual([month.selection,month.weakness.check,month.weakness.locked],['QQQ','month',true]);

const bond=panel(.003);
Object.assign(bond.dgs30,{'2025-01-07':450,'2025-01-08':445,'2025-01-09':440,'2025-01-10':null,'2025-01-13':439,'2025-01-14':449,'2025-01-15':450});
const bonds=replay(bond);
assert.deepEqual(
  ['2025-01-07','2025-01-08','2025-01-09','2025-01-10','2025-01-13','2025-01-14','2025-01-15','2025-01-16'].map(date=>{
    const p=bonds[idx(date)];
    return[p.bond.deltaBp,p.bond.active,p.selection];
  }),
  [[0,false,'SOXX'],[50,true,'QQQ'],[45,true,'QQQ'],[40,true,'QQQ'],[null,true,'QQQ'],[39,false,'SOXX'],[49,false,'SOXX'],[50,true,'QQQ']]
);
const signal=idx('2025-01-08');
assert.equal(bonds[signal].bond.observationDate,dates[signal-1]);
assert.equal(bonds[signal].bond.baselineDate,dates[signal-127]);
const missingBaseline=structuredClone(bond);
missingBaseline.dgs30[dates[idx('2025-01-14')-127]]=null;
assert.equal(replay(missingBaseline)[idx('2025-01-14')].bond.active,true);

const alreadyQQQ=structuredClone(weekly);
alreadyQQQ.dgs30['2025-01-16']=450;
alreadyQQQ.dgs30['2025-01-17']=439;
const filtered=replay(alreadyQQQ);
assert.equal(filtered[check-1].selection,'QQQ');
assert.equal(filtered[check].selection,'SOXX','A weekly check does not lock an incoming QQQ selection');
assert.equal(filtered[check].weakness.locked,false);
const future=structuredClone(weekly);
future.returns[check+1]=[5,-.99];
future.dgs30[dates[check]]=599;
assert.deepEqual(replay(future).slice(0,check+1),weeks.slice(0,check+1),'Future returns and signal-day yields cannot change previous signals');

const csv='observation_date,DGS30\n2025-11-10,4.40\n2025-11-11,\n2025-11-12,.\n2025-11-13,4.50\n';
const tradingDays=['2025-11-10','2025-11-11','2025-11-12','2025-11-13'];
assert.deepEqual(Object.values(alignDgs30(tradingDays,parseDgs30(csv))),[440,440,null,450]);
const live={dates:tradingDays,dgs30:{'2025-11-10':440}},rows=[{},{},{}];
assert.equal(await extendDgs30(live,rows,async()=>csv),null);
assert.deepEqual(rows.map(r=>r.dgs30LagBp),[440,440,null]);
const retry={dates:tradingDays,dgs30:{'2025-11-10':440}};
await extendDgs30(retry,rows,async()=>assert.fail('Already observed inputs must be reused'));
assert.deepEqual(retry.dgs30,live.dgs30);

const read=async name=>JSON.parse(await readFile(new URL('../public/'+name,import.meta.url)));
const raw=await read('custom-inputs.json'),snapshot=await read('dgs30.json');
assert.equal(snapshot.through,raw.dates.at(-1));
assert.equal(Object.keys(snapshot.yieldsBp).length,raw.dates.length);
assert.equal(snapshot.yieldsBp['2026-10-12'],snapshot.yieldsBp['2026-10-09'],'Historical Fed holiday carries forward');
raw.dgs30=snapshot.yieldsBp;
const cfg=C.defaults();
cfg.asset='momentum';
cfg.momentum={lookback:22,skip:0,frequency:'daily',buffer:.1};
const run=C.run(raw,cfg);
assert.deepEqual(run.config.momentum,C.defaults().momentum,'Legacy browser settings use the fixed three-layer rules');
let soxx=0,weak=0,rates=0;
for(const point of Object.values(run.details.points)){
  const m=point.momentum;
  assert.equal(m.selection,m.monthlySelection==='SOXX'&&!m.weakness?.locked&&!m.bond.active?'SOXX':'QQQ');
  assert.equal(m.bond.observationDate,raw.dates[raw.dates.indexOf(point.signalDate)-1]);
  if(point.blueLadder)assert.equal(point.blueLadder.asset,point.selection);
  soxx+=m.selection==='SOXX';
  weak+=m.weakness?.locked?1:0;
  rates+=m.bond.active?1:0;
}
assert.ok(soxx&&weak&&rates,'The historical run exercises all three layers');
assert.ok(run.details.trades.some(t=>['SOXL','USD','SOXX'].includes(t.symbol)));
assert.ok(run.details.trades.every(t=>t.signalDate<t.date),'Targets still trade after the signal close');
console.log(JSON.stringify({momentumThreeLayers:true,soxxDays:soxx,weaknessLockedDays:weak,bondFilterDays:rates}));
