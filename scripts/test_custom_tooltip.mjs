import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../public/custom-backtest.js';
const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../public/history-chart.js',import.meta.url),'utf8'),context);const H=context.window.HistoryChart,C=globalThis.CustomBacktest;
const config=C.defaults(),fullRule='完整规则说明：未触发条件、全部阈值、次日成交、长期数据口径。'.repeat(12);
const point={date:'2026-06-12',signalDate:'2026-06-11',state:'空心红点',selection:'QQQ',holdings:[],cash:1,exposure:0,targetHoldings:[],targetCash:1,targetExposure:0,rebalanced:false,band:.05,reasons:['空心红点：清仓至 BIL。信号日 2026-06-08，有效 30 个交易日（含信号日）；优先级 75。',fullRule],bearGate:{active:false,applied:false},drawdownGate:{active:false,applied:false},cccStressBlueLimit:{active:false,applied:false}};
const saved=JSON.stringify(point),html=H.tooltipHTML({date:point.date,value:1},1,point,null,'ready','',config);
assert.ok(html.includes('空心红点：清仓至BIL（2026-06-08起，30日窗口）'));assert.ok(!html.includes(fullRule));assert.ok(!html.includes('优先级 75'));assert.ok(!html.includes('回撤闸：'));assert.ok(!html.includes('CCC波动限仓：'));
assert.ok(H.tooltipHTML({date:point.date,value:1},1,point,null,'ready').includes(fullRule),'Original strategy tooltips keep their existing complete evidence');assert.equal(JSON.stringify(point),saved,'Presentation must preserve export evidence');
const blue=structuredClone(point);Object.assign(blue,{state:'实心蓝点 · CCC压力位蓝点限制',targetExposure:.625,blueLadder:{selected:true,asset:'SOXX',count:7,steps:10,target:2.8},drawdownGate:{active:true,applied:false},cccStressBlueLimit:{active:true,applied:true,monitorAsset:'QQQ',window:10,volatility:.8,originalExposure:2.8,exposure:.625}});
const blueReasons=H.customReasons(blue,config).join(' ');assert.ok(blueReasons.includes('SOXX，已建 7/10 份'));assert.ok(blueReasons.includes('QQQ的10日年化波动率 80%'));assert.ok(blueReasons.includes('2.8倍 → 0.63倍'));assert.ok(!blueReasons.includes('回撤闸：'),'An active gate overridden by blue must not be presented as a reduction');
const gated=structuredClone(point);Object.assign(gated,{state:'常态 · 回撤闸',targetExposure:1.5,drawdownGate:{active:true,applied:true,drawdown:-.23,baselineBefore:3,baselineAfter:1.5}});assert.ok(H.customReasons(gated,config).join(' ').includes('参考回撤 -23%，常态目标 3倍 → 1.5倍'));
const rejected=structuredClone(point);rejected.blueComparison={enabled:true,eligible:false,blueExposure:.4,baselineExposure:1};assert.ok(H.customReasons(rejected,config).join(' ').includes('蓝点未执行：抄底 0.4倍 < 当日配置 1倍'));
const yellow=structuredClone(point);yellow.state='黄点预警';yellow.yellowLock={locked:true,unlock:{tdcEnabled:true,tdcThreshold:60,priceEnabled:false,repairPct:3,blueEnabled:true}};const yr=H.customReasons(yellow,config).join(' ');assert.ok(yr.includes('TDC<60 / 实心蓝点'));assert.ok(!yr.includes('52周'));
const malicious=structuredClone(point);malicious.state='<img src=x onerror=alert(1)>';const safe=H.tooltipHTML({date:point.date,value:1},1,malicious,null,'ready','',config);assert.ok(!safe.includes('<img'));assert.ok(safe.includes('&lt;img'));
const real=JSON.parse(fs.readFileSync(new URL('../public/custom-inputs.json',import.meta.url))),registered=JSON.parse(fs.readFileSync(new URL('../tracking/state.json',import.meta.url))).strategies.find(s=>s.id==='custom-chao-1').configSnapshot;
const result=C.run(real,{...registered,cccStressBlueLimitEnabled:true,drawdownGateEnabled:true}),before=JSON.stringify(result);let concise=0,full=0,riskDays=0;
for(const d of Object.values(result.details.points)){const reasons=H.customReasons(d,result.config);assert.ok(reasons.length>0);full+=d.reasons.join('').length;concise+=reasons.join('').length;if(d.cccStressBlueLimit?.applied||d.drawdownGate?.applied){riskDays++;assert.ok(reasons.some(r=>r.startsWith('CCC波动限仓：')||r.startsWith('回撤闸：')));}}
assert.equal(JSON.stringify(result),before);assert.ok(concise<full*.4);assert.ok(riskDays>0);
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.ok(app.includes('drawChart(strategy,benchmark,detail,m.drawdowns,collection,annotations,result.config)'));assert.ok(app.includes('annotationsHTML,customConfig,change)'));
console.log(JSON.stringify({conciseCustomEvidence:true,onlyRelevantLimits:true,ordinaryAndBlueAssetsCorrect:true,datesAndNumbersPreserved:true,originalTooltipsPreserved:true,exportsUnchanged:true,escapedHTML:true,customChartWired:true,textReduction:1-concise/full}));

vm.runInNewContext(fs.readFileSync(new URL('../public/model-annotations.js',import.meta.url),'utf8'),context);
const M=context.window.ModelAnnotations;
const trade=(date,type,symbol,extra={})=>({date,type,symbol,signalDate:'2026-06-11',...extra});
const rotation=[trade('2026-06-09','sell','SOXL'),trade('2026-06-09','buy','TQQQ')];
const drift=[trade('2026-06-10','reduce','TQQQ',{reason:'rebalancing_band'}),trade('2026-06-11','add','TQQQ',{rebalanceOnly:true})];
const reversal=[trade(point.date,'sell','TQQQ',{exposureBefore:1,exposureAfter:-1}),trade(point.date,'buy','PSQ',{exposureBefore:1,exposureAfter:-1})];
const opening=trade('2026-06-15','buy','SOXL');
const realIncrease=trade('2026-06-16','add','SOXL');
const details={trades:[...rotation,...drift,...reversal,opening,realIncrease]};
const snapshot=JSON.stringify(details),all=M.collect(null,details);
assert.deepEqual(Array.from(all.trades),[reversal[1],reversal[0],opening,realIncrease]);
assert.deepEqual(Array.from(M.collect(null,details,null,['buy']).trades),[reversal[1],opening]);
assert.equal(all.counts.reduce,0);
assert.equal(all.counts.sell,1);
assert.ok(!all.dates.includes(drift[0].date));
assert.equal(all.byDate[drift[0].date].executions[0],drift[0]);
assert.match(M.tooltipHTML(rotation[0].date,all),/卖出 SOXL.*买入 TQQQ/);
assert.equal(JSON.stringify(details),snapshot);

const change={trade:reversal[0],previous:{state:'常态'}};
const marked=H.tooltipHTML({date:point.date,value:1},1,point,null,'ready','<div>成交明细</div>',config,change);
assert.match(marked,/仓位变动原因.*1\.00× → -1\.00×.*常态 → 空心红点.*清仓至BIL.*成交明细/);
assert.equal(marked.match(/信号依据/g).length,1);

const renderChange=(next,previous,trade,custom=config)=>H.tooltipHTML({date:next.date,value:1},1,next,null,'ready','',custom,{trade,previous});
const ordinary={...point,state:'常态',targetExposure:1,activeRules:[],winningRule:null};
const redBefore={...point,state:'空心红点',targetExposure:0,activeRules:['red_ad'],winningRule:'red_ad'};
const reopened=renderChange(ordinary,redBefore,{signalDate:point.signalDate,exposureBefore:0,exposureAfter:1});
assert.match(reopened,/规则目标敞口.*0\.00× → 1\.00×.*空心红点的有效期结束/);
assert.doesNotMatch(renderChange({...ordinary,activeRules:['red_ad']},redBefore,{exposureBefore:0,exposureAfter:1}),/有效期结束/);
const blueBefore={...blue,blueLadder:{...blue.blueLadder,count:8,target:3.2}};
assert.match(renderChange(blue,blueBefore,{exposureBefore:1,exposureAfter:.625}),/实心蓝点日数 8 → 7/);
const resolved={...ordinary,drawdownGate:{active:false,drawdown:-.095,releaseDate:point.signalDate}};
assert.match(renderChange(resolved,gated,{exposureBefore:1.5,exposureAfter:3}),/参考净值回撤修复至 -9\.50%，回撤闸解除/);
const afterCap={...ordinary,cccStressBlueLimit:{active:false}};
assert.match(renderChange(afterCap,blue,{exposureBefore:.625,exposureAfter:1}),/CCC 信用压力解除/);
const driftHTML=renderChange(ordinary,redBefore,{exposureBefore:.82,exposureAfter:1,reason:'rebalancing_band',band:.06});
assert.match(driftHTML,/沿用原目标.*6 个百分点再平衡带/);
assert.doesNotMatch(driftHTML,/空心红点|规则目标敞口/);

const archive=JSON.parse(fs.readFileSync(new URL('../public/history-positions.json',import.meta.url)));
function renderOriginalTrade(id,date){
  const style=archive.strategies[id],next=style.points[date],trade=style.trades.find(t=>t.date===date);
  return renderChange({...next,date},next.previousTarget??style.points[trade.signalDate],trade,null);
}
for(const style of Object.values(archive.strategies)){
  for(const trade of style.trades.filter(t=>!t.rebalanceOnly)){
    assert.ok(style.points[trade.date].previousTarget??style.points[trade.signalDate], `Missing prior target for ${trade.date}`);
  }
}
assert.match(renderOriginalTrade('simple-conservative','2009-10-16'),/红点有效窗口结束/);
assert.match(renderOriginalTrade('simple-conservative','2007-07-16'),/CCC 利差回到 200 日均线或以下/);
assert.match(renderOriginalTrade('simple-conservative','2007-09-04'),/黄点锁仓解除：QQQ 距 52 周高点/);
assert.match(renderOriginalTrade('fitted-aggressive','2007-08-02'),/SOXX 当时没有符合策略可交易条件的多头 ETF/);

const momentumConfig={...config,asset:'momentum'};
const momentum=structuredClone(point);
momentum.momentum={monthlySelection:'SOXX',selection:'QQQ',scores:{},weakness:{locked:true},bond:{active:true},reason:fullRule};
assert.ok(H.customReasons(momentum,momentumConfig).includes('动量选品：QQQ（SOXX相对走弱、长债过滤）。'));
momentum.momentum.monthlySelection='QQQ';
assert.ok(H.customReasons(momentum,momentumConfig).includes('动量选品：QQQ（月度动量）。'));
assert.equal(momentum.momentum.reason,fullRule);
console.log(JSON.stringify({sameDirectionSwapsHidden:true,driftHidden:true,reversalsRetained:true,markerCountsAgree:true,reasonShownFirst:true,conciseMomentumEvidence:true}));
