import assert from 'node:assert/strict';
import '../public/custom-backtest.js';
const C=globalThis.CustomBacktest,copy=x=>JSON.parse(JSON.stringify(x));
const dates=['2007-01-03','2007-01-04','2007-01-05','2007-01-08','2007-01-09','2007-01-10','2007-01-11','2007-01-12'];
const input={schemaVersion:1,meta:{start:dates[0],end:dates.at(-1)},signalTypes:C.RULES.map(r=>r.id),dates,
  symbols:[{symbol:'QQQ',underlying:'QQQ',leverage:1},{symbol:'TQQQ',underlying:'QQQ',leverage:3},{symbol:'PSQ',underlying:'QQQ',leverage:-1},{symbol:'SQQQ',underlying:'QQQ',leverage:-3},{symbol:'BIL',underlying:'BIL',leverage:0}],
  returns:dates.map(()=>[0,0,0,0,0]),costs:dates.map(()=>[0,0,0,0,0]),tradable:dates.map(()=>31),signals:dates.map(()=>0),
  yellowContext:{tdc:dates.map(()=>80),qqqDrawdown52:dates.map(()=>-.2)}};
function config(){const c=C.defaults();c.start=dates[1];c.end=dates.at(-1);c.costMultiplier=0;c.band=0;for(const r of c.rules)r.action='ignore';Object.assign(c.rules[2],{action:'blue_ladder',value:2,steps:4});return c;}
function point(data,c,i=2){return C.run(data,c).details.points[dates[i]];}
const blue=copy(input);blue.signals[1]=1<<2;
const c=config(),low=point(blue,c);
assert.equal(C.defaults().rules[2].onlyIfNotLower,true);
assert.equal(low.targetExposure,1,'A 0.5x blue tranche must not reduce a 1x ordinary target');
assert.equal(low.state,'常态');assert.equal(low.blueComparison.baselineExposure,1);assert.equal(low.blueComparison.eligible,false);assert.equal(low.blueLadder.selected,false);
assert.ok(low.reasons.some(x=>x.includes('比较未通过')&&x.includes('0.5× <')));
const legacy=copy(c);delete legacy.rules[2].onlyIfNotLower;assert.equal(C.validate(legacy,input).rules[2].onlyIfNotLower,true);
const disabled=copy(c);disabled.rules[2].onlyIfNotLower=false;assert.equal(point(blue,disabled).targetExposure,.5,'Opt-out retains the old priority-only behavior');
const equal=copy(c);equal.rules[2].value=4;const tie=point(blue,equal);assert.equal(tie.blueComparison.eligible,true);assert.equal(tie.state,'实心蓝点','Equality permits blue');
const larger=copy(c);larger.rules[2].value=8;assert.equal(point(blue,larger).targetExposure,2);
const growing=copy(blue);growing.signals[2]=growing.signals[3]=1<<2;
assert.equal(point(growing,c,2).targetExposure,1);assert.equal(point(growing,c,3).blueLadder.count,2);assert.equal(point(growing,c,3).state,'实心蓝点');assert.equal(point(growing,c,4).targetExposure,1.5,'Rejected blue days still count toward subsequent tranches');
const credit=copy(blue);credit.signals[1]|=1<<7;const cc=copy(c);cc.rules[7].action='scale';cc.rules[7].value=.25;
const cp=point(credit,cc);assert.equal(cp.blueComparison.baselineExposure,.25);assert.equal(cp.state,'实心蓝点');assert.equal(cp.targetExposure,.5,'Compare with the reduced ordinary target, not raw base exposure');
const locked=copy(blue);locked.signals[1]|=1<<4;const yc=copy(c);yc.rules[4].action='flat';
const yp=point(locked,yc);assert.equal(yp.targetExposure,.5);assert.equal(yp.blueComparison.baselineExposure,0);assert.equal(yp.yellowLock.locked,true,'Blue selection never unlocks yellow');
yc.rules[4].action='long';yc.rules[4].value=1;const longLock=point(locked,yc);assert.equal(longLock.state,'黄点预警');assert.equal(longLock.targetExposure,1);
yc.rules[4].action='short';yc.rules[4].value=1;const shortLock=point(locked,yc);assert.equal(shortLock.blueComparison.baselineExposure,-1);assert.equal(shortLock.state,'实心蓝点','Signed exposure is compared, not absolute exposure');
const precedence=copy(cc);precedence.rules[7].priority=99;const pp=point(credit,precedence);assert.equal(pp.blueComparison.eligible,true);assert.equal(pp.blueComparison.selected,false);assert.equal(pp.state,'信用压力（分位≥95）');
const direct=copy(c);direct.rules[2].action='long';direct.rules[2].value=.5;assert.equal(point(blue,direct).targetExposure,1,'Direct blue long orders use the same default gate');
const scale=copy(c);scale.rules[2].action='scale';scale.rules[2].value=.5;assert.equal(point(blue,scale).targetExposure,1);
const invalid=copy(c);invalid.rules[2].onlyIfNotLower='yes';assert.throws(()=>C.validate(invalid,input));
console.log(JSON.stringify({blueComparison:true,lowerRejected:true,equalityAllowed:true,creditAdjustedBaseline:true,yellowLockPreserved:true,signedExposure:true,prioritiesPreserved:true,legacyMigration:true,optOut:true}));
