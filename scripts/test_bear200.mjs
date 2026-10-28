import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveMarket} from '../lib/live-engine.js';
import '../public/custom-backtest.js';
const C=globalThis.CustomBacktest,clone=structuredClone;
const dates=Array.from({length:245},(_,i)=>new Date(Date.UTC(2007,0,3+i)).toISOString().slice(0,10));
function panel(prices){return{schemaVersion:1,meta:{start:dates[0],end:dates.at(-1)},signalTypes:C.RULES.map(r=>r.id),dates,symbols:[{symbol:'QQQ',underlying:'QQQ',leverage:1},{symbol:'TQQQ',underlying:'QQQ',leverage:3},{symbol:'SOXX',underlying:'SOXX',leverage:1},{symbol:'SOXL',underlying:'SOXX',leverage:3},{symbol:'PSQ',underlying:'QQQ',leverage:-1},{symbol:'BIL',underlying:'BIL',leverage:0}],returns:prices.map((p,i)=>{const r=i?p/prices[i-1]-1:0;return[r,3*r,.001,.003,-r,0];}),costs:dates.map(()=>[.001,.001,.001,.001,.001,0]),tradable:dates.map(()=>63),signals:dates.map(()=>0)};}
const prices=dates.map((_,i)=>i<221?100:i===221?90:i===222?80:110),data=panel(prices);
function config(){const c=C.defaults();c.start=dates[219];c.end=dates.at(-1);c.bearGateEnabled=true;c.band=0;c.costMultiplier=0;for(const r of c.rules)r.action='ignore';return c;}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`),point=(d,c,i)=>C.run(d,c).details.points[dates[i]];
assert.equal(C.defaults().bearGateEnabled,false);const legacy=config();delete legacy.bearGateEnabled;legacy.bear200Enabled=true;assert.equal(C.validate(legacy).bearGateEnabled,true);assert.equal('bear200Enabled' in C.validate(legacy),false);
const fresh=config();delete fresh.bearGateEnabled;assert.equal(C.validate(fresh).bearGateEnabled,false);const off=config();off.bearGateEnabled=false;assert.deepEqual(C.run(data,fresh).history,C.run(data,off).history);
assert.equal(C.bearGate200(data,219).ready,false);near(C.bearGate200(data,220).priceToMA,1);near(C.bearGate200(data,220).maToPastMA,1);assert.equal(C.bearGate200(data,220).active,false,'Equality must not close the gate');
const rising=panel(dates.map((_,i)=>i<221?100+i*.1:105));const rg=C.bearGate200(rising,221);assert.equal(rg.below,true);assert.equal(rg.maFalling,false);assert.equal(rg.active,false,'A dip below a rising MA must not trigger the fitted gate');
const falling=panel(dates.map((_,i)=>i<221?150-i*.2:150));const fg=C.bearGate200(falling,221);assert.equal(fg.maFalling,true);assert.equal(fg.below,false);assert.equal(fg.active,false,'A falling MA alone is insufficient');
const flat=panel(dates.map((_,i)=>i<201?100:i<221?100.5:90));const bg=C.bearGate200(flat,221);assert.equal(bg.below,true);near(bg.maToPastMA,1);assert.equal(bg.active,false,'MA equality reopens the gate even below the MA');
const run=C.run(data,config()),p=i=>run.details.points[dates[i]];
assert.equal(p(221).state,'常态','Signal-day decline cannot cause same-close liquidation');assert.equal(p(222).state,'熊市闸门');near(p(222).targetExposure,0);near(p(222).cash,1);near(p(222).nav,.8);
assert.equal(p(223).holdings.length,0);near(p(224).targetExposure,1);assert.equal(p(224).state,'常态');assert.equal(run.audit.bearGateDays,2);assert.equal(run.audit.bearGateAppliedDays,2);
assert.ok(p(222).reasons.some(r=>r.includes('21个交易日前')&&r.includes('常态多头归零')));assert.equal(run.details.trades.find(t=>t.type==='sell').date,dates[222]);
const fees=config();fees.costMultiplier=1;assert.ok(C.run(data,fees).history.at(-1).nav<run.history.at(-1).nav);
const blueData=clone(data);blueData.signals[221]=1<<2;const blue=config();Object.assign(blue.rules[2],{action:'blue_ladder',value:.5,steps:1,priority:95});const bp=point(blueData,blue,222);assert.equal(bp.bearGate.active,true);assert.equal(bp.bearGate.applied,false);near(bp.blueComparison.baselineExposure,0);near(bp.targetExposure,.5);assert.equal(bp.blueLadder.selected,true,'Blue can override the ordinary gate');
const credit=clone(blueData);credit.signals[221]|=(1<<5)|(1<<8);const cc=clone(blue);Object.assign(cc.rules[5],{action:'scale',value:.75,days:63,priority:60});Object.assign(cc.rules[8],{action:'scale',value:.3,priority:80});const cp=point(credit,cc,222);near(cp.blueComparison.baselineExposure,0);near(cp.targetExposure,.5,'Blue compares with the gated CCC target');
cc.rules[8].priority=99;near(point(credit,cc,222).targetExposure,0,'Custom priorities remain effective');
const yellow=config();Object.assign(yellow.rules[4],{action:'short',value:.5,priority:90,unlock:{tdcEnabled:false,priceEnabled:false,blueEnabled:true,tdcThreshold:60,repairPct:3}});const lock=clone(data);lock.signals[220]=1<<4;const yp=point(lock,yellow,222);assert.equal(yp.bearGate.active,true);near(yp.targetExposure,-.5);assert.equal(yp.state,'黄点预警','The dedicated yellow lock is preserved');
const yellowLong=clone(yellow);yellowLong.rules[4].action='long';near(point(lock,yellowLong,222).targetExposure,.5,'Dedicated yellow targets are not ordinary long exposure');
const red=config();Object.assign(red.rules[0],{action:'short',value:1,days:30,priority:80});const redData=clone(data);redData.signals[220]=1;near(point(redData,red,222).targetExposure,-1,'The fitted gate preserves red-window inverse positions');
const semi=config();semi.asset='SOXX';near(point(data,semi,222).targetExposure,0,'QQQ remains the market reference across assets');
const future=clone(data);future.returns[230]=[1,1,1,1,1,0];future.signals[230]=511;assert.deepEqual(C.run(future,config()).history.slice(0,10),run.history.slice(0,10));
const invalid=config();invalid.bearGateEnabled='yes';assert.throws(()=>C.validate(invalid));const missing=clone(data);missing.returns[221][0]=null;assert.throws(()=>C.run(missing,config()),/熊市闸门缺少有效/);
// Independent contract check against the original incremental fitted engine.
const seed=JSON.parse(readFileSync(new URL('../lib/live-seed.json',import.meta.url)));assert.equal(seed.config['fitted-aggressive'].bear_mult,0);
const real=JSON.parse(readFileSync(new URL('../public/custom-inputs.json',import.meta.url))),qi=real.symbols.findIndex(s=>s.symbol==='QQQ'),si=real.symbols.findIndex(s=>s.symbol==='SOXX');let q=1,semiPrice=1,history=[];
for(let i=0;i<real.dates.length;i++){if(i){q*=1+real.returns[i][qi];semiPrice*=1+real.returns[i][si];}const row={date:real.dates[i],prices:{QQQ:q,SOXX:semiPrice},priceBasis:'adjusted'};history.push(row);if(i>=220){const original=deriveMarket(history,row,'QQQ',real.dates[i-1]),gate=C.bearGate200(real,i);assert.equal(gate.active,original.bear,'Original fitted gate contract '+row.date);}}
console.log(JSON.stringify({fittedBearGate:true,bothPriceAnd21DaySlopeRequired:true,warmup221:true,equalityReopens:true,ordinaryLongOnly:true,blueCanOverride:true,yellowAndRedShortPreserved:true,customPrioritiesPreserved:true,nextClose:true,noLookahead:true,legacyMigration:true,originalEngineDaysVerified:real.dates.length-220}));
