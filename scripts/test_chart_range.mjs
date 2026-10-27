import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8'),ctx={window:{}};
vm.runInNewContext(read('public/history-chart.js'),ctx);const H=ctx.window.HistoryChart;
const daily=JSON.parse(read('public/history-daily.json')),base=JSON.parse(read('public/data.json'));
const dates=['2025-01-03','2025-01-06','2025-01-07','2025-01-08'];
const snapped=H.rangeIndices(dates,'2025-01-04','2025-01-08');assert.equal(snapped.start,'2025-01-06');assert.equal(snapped.end,'2025-01-08');
for(const [a,b,side]of [['2100-01-01','2100-01-02','start'],['1900-01-01','1900-01-02','end'],['2025-01-08','2025-01-03','end']]){const r=H.rangeIndices(dates,a,b,side);assert.ok(r.first>=0&&r.last<dates.length&&r.first<r.last);}
let checked=0;
for(const s of base.strategies)for(const key of ['inSample','semiOut']){
  const r=base.windows[key],points=daily.dates.flatMap((date,i)=>date>=r.start&&date<=r.end?[{date,nav:daily.strategies[s.id][i]}]:[]),metrics=H.summarize(points);
  assert.ok(Math.abs(metrics.mdd-s.metrics[key].mdd)<1e-9);assert.equal(metrics.drawdown.troughDate,s.metrics[key].mdd_date);assert.ok(Math.abs(metrics.cagr-s.metrics[key].cagr)<1e-9);checked++;
}
const fixture=[{date:'2025-01-03',nav:2},{date:'2025-01-06',nav:4},{date:'2025-01-07',nav:1},{date:'2025-01-08',nav:3}];
const full=H.summarize(fixture),crop=H.summarize(fixture.slice(2));assert.equal(full.mdd,-.75);assert.equal(crop.mdd,0);assert.equal(full.drawdown.recoveryDate,null,'Recovery beyond the selected range cannot be claimed');
assert.equal(H.summarize(fixture.slice(1,3)).drawdown.peakDate,'2025-01-06');
const trades=[{date:'2025-01-06',weightChange:.3,cashBefore:.5,cashAfter:.4},{date:'2025-01-06',weightChange:-.2,cashBefore:.5,cashAfter:.4}];
const m=H.summarize(fixture,trades),years=5/365.25;assert.ok(Math.abs(m.turn_yr*years-.3)<1e-12);assert.equal(m.rebalanceDays,1,'One cash change per date, even when several ETFs trade');
const flat=H.summarize([{date:'2025-01-03',nav:1},{date:'2025-01-06',nav:1}]);assert.equal(flat.sharpe,null);assert.equal(flat.cagr,0);assert.equal(flat.mdd,0);
assert.equal(fixture[0].nav,2,'Range selection must not rewrite the underlying NAV');
assert.ok(H.tooltipHTML({date:'2025-01-03',value:1},1,null,null,'ready').includes('暂无存档持仓明细'));
console.log(JSON.stringify({chartRange:true,originalDailyWindowsVerified:checked,weekendSnapping:true,nonCrossing:true,inRangeDrawdown:true,noFutureRecovery:true,turnoverDeduplicated:true,twoPointMinimum:true}));
