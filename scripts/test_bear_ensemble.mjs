import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../public/custom-backtest.js';
const C=globalThis.CustomBacktest,clone=x=>structuredClone(x),near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-9,`${m??''} ${a} != ${b}`);

// Synthetic weekday calendar with QQQ and BIL.
const dates=[];for(const d=new Date('2020-01-01T00:00:00Z');dates.length<700;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6)dates.push(d.toISOString().slice(0,10));
const panel=prices=>({schemaVersion:1,dates,symbols:[{symbol:'QQQ',underlying:'QQQ',leverage:1},{symbol:'BIL',underlying:'BIL',leverage:0}],returns:prices.map((p,i)=>i?[p/prices[i-1]-1,0]:[0,0])});
const up=dates.map((_,i)=>100*1.001**i);

// Defaults and validation: new browser settings use E2; a missing field keeps the original gate.
assert.equal(C.defaults().bearGateMethod,'ensemble');
assert.equal(C.DEFAULT_BEAR_GATE_METHOD,'ensemble');
const legacy=C.defaults();delete legacy.bearGateMethod;assert.equal('bearGateMethod' in C.validate(legacy),false,'Validation must not add the field to old settings');
assert.throws(()=>C.validate({...C.defaults(),bearGateMethod:'stop'}),/熊市闸门方法无效/);

// A steady uptrend is fully bullish once every family is ready; early history counts as bullish.
const g0=C.bearGateEnsemble(panel(up),5);assert.equal(g0.ready,false);assert.equal(g0.multiplier,1);assert.equal(g0.active,false);
const gUp=C.bearGateEnsemble(panel(up),690);assert.equal(gUp.ready,true);assert.equal(gUp.multiplier,1);
for(const [k,n] of Object.entries({trend:9,ma:3,monthly:3,momentum:3}))assert.equal(gUp.families[k].total,n);

// A long decline turns every family bearish.
const down=dates.map((_,i)=>i<350?100*1.001**i:100*1.001**350*0.998**(i-350));
const gDown=C.bearGateEnsemble(panel(down),690);assert.equal(gDown.multiplier,0);assert.equal(gDown.active,true);

// A fresh dip below the MAs moves the daily MA family before the slow families: a partial multiplier.
const dip=up.slice();for(let i=600;i<700;i++)dip[i]=up[599]*0.85;
const gDip=C.bearGateEnsemble(panel(dip),601);
assert.equal(gDip.families.ma.bullish,0,'Price below all three MAs');
assert.ok(gDip.multiplier>0&&gDip.multiplier<1,'Ensemble reduces gradually');

// Causality: changing prices after t cannot change the multiplier at t.
const fut=dip.slice();for(let i=602;i<700;i++)fut[i]=fut[i]*3;
assert.deepEqual(C.bearGateEnsemble(panel(fut),601),C.bearGateEnsemble(panel(dip),601));

// Monthly families use the latest month-end strictly before t and only change on the first session of a month.
const monthStart=dates.findIndex((d,i)=>i>500&&d.slice(0,7)!==dates[i-1].slice(0,7));
const crash=up.slice();crash[monthStart-1]=up[monthStart-1]*0.5;for(let i=monthStart;i<700;i++)crash[i]=crash[monthStart-1]*1.001**(i-monthStart+1);
const before=C.bearGateEnsemble(panel(crash),monthStart-1),after=C.bearGateEnsemble(panel(crash),monthStart);
assert.equal(before.families.monthly.bullish,3,'Month-end crash is not seen by the monthly family on the same day');
assert.equal(after.families.monthly.bullish,0,'First session of the new month uses the prior month-end close');
assert.equal(after.monthEnd,dates[monthStart-1]);

// The multiplier scales ordinary longs; yellow, blue and short channels keep their configuration.
const real=JSON.parse(await readFile(new URL('../public/custom-inputs.json',import.meta.url),'utf8'));
const cfg=()=>{const c=C.defaults();c.start='2016-10-21';c.end='2026-10-22';c.bearGateEnabled=true;c.bearGateMethod='ensemble';c.baseExposure=3;c.band=0;for(const r of c.rules)r.action='ignore';return c;};
const run=C.run(real,cfg());
const t22=real.dates.indexOf('2025-04-08'),g=C.bearGateEnsemble(real,t22);
const p=run.details.points[real.dates[t22+1]];
assert.ok(g.multiplier>0&&g.multiplier<1);
near(p.targetExposure,3*g.multiplier,'Target = base × multiplier');
assert.match(p.state,/熊市闸门×/);
assert.ok(run.audit.bearGateDays>0&&run.audit.bearGateAppliedDays>0);
// Zero multiplier is reported as the full gate state.
const zero=real.dates.findIndex((d,i)=>d>='2022-01-01'&&C.bearGateEnsemble(real,i).multiplier===0);
assert.equal(run.details.points[real.dates[zero+1]].state,'熊市闸门');near(run.details.points[real.dates[zero+1]].targetExposure,0);

// Legacy method is untouched: an explicit ma200 equals a missing field.
const m1=cfg();m1.bearGateMethod='ma200';const m2=cfg();delete m2.bearGateMethod;
assert.deepEqual(C.run(real,m1).history,C.run(real,m2).history);

// Missing returns fail loudly instead of silently disabling the gate.
const broken=clone(panel(up));broken.returns[300][0]=null;assert.throws(()=>C.bearGateEnsemble(broken,400),/熊市闸门缺少有效/);
console.log('bear ensemble tests passed');
