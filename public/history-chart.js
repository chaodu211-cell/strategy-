/* Shared pure chart presentation helpers: no network or model calculation. */
(function (root) {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const percent = n => `${(n * 100).toFixed(2)}%`;
  const multiple = n => `${Number(n).toFixed(2)}×`;
  const symbolName = symbol => symbol.startsWith('SYN_') ? `${symbol.slice(4)}（合成）` : symbol;
  function nearestIndex(points, timestamp) {
    if (!points.length) return -1;
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(points[mid].date) < timestamp) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    return timestamp - Date.parse(points[lo - 1].date) <= Date.parse(points[lo].date) - timestamp ? lo - 1 : lo;
  }
  function mergeLandmarks(series, drawdown) {
    if (!drawdown) return series;
    const dates = new Map(series.map(p => [p.date, p]));
    dates.set(drawdown.peakDate, {...dates.get(drawdown.peakDate), date:drawdown.peakDate, nav:drawdown.peakNav});
    dates.set(drawdown.troughDate, {...dates.get(drawdown.troughDate), date:drawdown.troughDate, nav:drawdown.troughNav});
    return [...dates.values()].sort((a,b) => a.date.localeCompare(b.date));
  }
  function rangeIndices(dates,start,end,side='both'){
    if(dates.length<2)throw new Error('至少需要两个交易日');
    let first=start?dates.findIndex(d=>d>=start):0;if(first<0)first=dates.length-1;
    let last=end?dates.findLastIndex(d=>d<=end):dates.length-1;if(last<0)last=0;
    first=Math.max(0,Math.min(dates.length-2,first));last=Math.max(1,Math.min(dates.length-1,last));
    if(first>=last){if(side==='end')last=Math.min(dates.length-1,first+1);else first=Math.max(0,last-1);}
    if(first>=last)last=first+1;
    return{first,last,start:dates[first],end:dates[last]};
  }
  // One episode per high-water mark, from peak until first recovery.
  // The first point in the selected range sets its initial high-water mark.
  function rankDrawdowns(series,limit=3){
    let peak=series[0],episode=null;
    const episodes=[];
    for(const point of series.slice(1)){
      if(point.nav>=peak.nav){
        if(episode){episodes.push({...episode,recoveryDate:point.date});episode=null;}
        peak=point;
      }else{
        const value=point.nav/peak.nav-1;
        if(!episode||value<episode.value)episode={value,peakDate:peak.date,troughDate:point.date,peakNav:peak.nav,troughNav:point.nav,recoveryDate:null};
      }
    }
    if(episode)episodes.push(episode);
    return episodes.sort((a,b)=>a.value-b.value||a.troughDate.localeCompare(b.troughDate)).slice(0,limit);
  }
  function summarize(series,trades=[]){
    if(series.length<2)throw new Error('区间至少保留两个交易日');
    const first=series[0],last=series.at(-1),years=(Date.parse(last.date)-Date.parse(first.date))/86400000/365.25;
    const returns=series.slice(1).map((p,i)=>p.nav/series[i].nav-1),mean=returns.reduce((a,b)=>a+b,0)/returns.length;
    const vol=returns.length>1?Math.sqrt(returns.reduce((s,r)=>s+(r-mean)**2,0)/(returns.length-1))*Math.sqrt(252):0;
    const topFive=rankDrawdowns(series,5);
    const topFiveDrawdownMean=topFive.length?topFive.reduce((sum,episode)=>sum+episode.value,0)/topFive.length:0;
    const drawdowns=topFive.slice(0,3);
    const currentDrawdown=last.nav/series.reduce((peak,point)=>Math.max(peak,point.nav),first.nav)-1;
    const dd=drawdowns[0]||{value:0,peakDate:first.date,troughDate:first.date,peakNav:first.nav,troughNav:first.nav,recoveryDate:first.date};
    const days=new Map();for(const t of trades){if(t.date<=first.date||t.date>last.date)continue;let d=days.get(t.date);if(!d){d={equity:0,cash:Math.abs(t.cashAfter-t.cashBefore)};days.set(t.date,d);}d.equity+=Math.abs(t.weightChange);}
    const turnover=[...days.values()].reduce((s,d)=>s+(d.equity+d.cash)/2,0);
    return{cagr:(last.nav/first.nav)**(1/years)-1,mdd:dd.value,sharpe:vol>0?mean*252/vol:null,vol,turn_yr:turnover/years,drawdown:dd,drawdowns,topFiveDrawdownMean,currentDrawdown,rebalanceDays:days.size};
  }
  function extendDailyHistory(daily,detail,extension,id){
    const original={dates:daily.dates,nav:daily.strategies[id],benchmark:daily.benchmark,detail};
    const tail=extension?.strategies?.[id],dates=extension?.dates;
    if(!tail||!dates?.length||extension.version!==daily.meta?.researchVersion||extension.baseEnd!==daily.dates.at(-1)
      ||tail.nav?.length!==dates.length||extension.benchmark?.length!==dates.length||!Array.isArray(tail.trades))return original;
    if(dates.some((date,i)=>date<=(dates[i-1]??extension.baseEnd)||!tail.points?.[date]
      ||!Number.isFinite(tail.nav[i])||tail.nav[i]<=0||!Number.isFinite(extension.benchmark[i])||extension.benchmark[i]<=0))return original;
    return {dates:[...daily.dates,...dates],nav:[...original.nav,...tail.nav],benchmark:[...daily.benchmark,...extension.benchmark],
      detail:{...detail,points:{...detail.points,...tail.points},trades:[...detail.trades,...tail.trades]},signalThrough:extension.signalThrough};
  }
  const customRuleLabels={red:'实心红点',red_ad:'空心红点',blue:'实心蓝点',blue_soft:'空心蓝点',yellow:'黄点预警',ccc_top:'CCC 见顶预警',ccc_bot:'CCC 见底预警',ccc_stress:'信用压力（分位≥95）',ccc_above:'利差高于200日线',triangle:'vix反转'};
  function customReasons(detail, config) {
    const n=value=>Number.isFinite(value)?String(Number(value.toFixed(2))):'—';
    const x=value=>`${n(value)}倍`,p=value=>`${n(value*100)}%`;
    const base=String(detail.state||'常态').split(' · ')[0],rules=config.rules||[];
    const rule=rules.find(r=>customRuleLabels[r.id]===base),ladder=detail.blueLadder,credit=detail.creditStack;
    const reasons=[],source=detail.reasons||[];
    const partialGate=detail.bearGate?.applied&&detail.bearGate.method==='ensemble'&&detail.bearGate.multiplier>0;
    if(detail.bearGate?.applied&&!partialGate)reasons.push(detail.bearGate.method==='ensemble'?'熊市闸门（四类投票）：四类趋势信号全部看空，常态多头归零。':'熊市闸门：QQQ低于200日线且均线下行，常态多头归零。');
    else if(ladder?.selected)reasons.push(`蓝点分批：${ladder.asset}，已建 ${Math.min(ladder.count,ladder.steps)}/${ladder.steps} 份，原目标 ${x(ladder.target)}。`);
    else if(credit?.selected)reasons.push(`CCC见顶 × ${credit.creditLabel}：常态敞口 × ${n(credit.combinedMultiplier)}。`);
    else if(rule){
      const scale=rule.id==='triangle'
        ?`抄底仓位 ${detail.selection} ${x(rule.value)}底层敞口，熊市闸门跳过该仓位`
        :`常态敞口 × ${n(rule.value)}`;
      const action={flat:'清仓至BIL',long:`原多头目标 ${x(rule.value)}`,short:`做空目标 ${x(rule.value)}`,scale,blue_ladder:'分批建仓'}[rule.action]||'按当前配置';
      const original=source.find(r=>r.startsWith(base+'：'))||'',window=original.match(/信号日 (\d{4}-\d{2}-\d{2})，有效 (\d+) 个交易日/);
      reasons.push(`${base}：${action}${window?`（${window[1]}起，${window[2]}日窗口）`:''}。`);
    }else reasons.push(base==='常态'?`常态配置：${detail.selection}，目标 ${x(detail.targetExposure)}。`:`生效规则：${base}。`);
    if(partialGate)reasons.push(`熊市闸门（四类投票）：常态多头 × ${n(detail.bearGate.multiplier)}。`);
    const blueMode=rules.find(r=>r.id==='blue')?.asset??'inherit';
    const usesMomentum=ladder?.selected?(blueMode==='momentum'||(blueMode==='inherit'&&config.asset==='momentum')):config.asset==='momentum';
    if(usesMomentum&&detail.momentum){
      const momentum=detail.momentum,filters=[];
      if(momentum.monthlySelection==='SOXX'){
        if(momentum.weakness?.locked)filters.push('SOXX相对走弱');
        if(momentum.bond?.active)filters.push('长债过滤');
      }
      const why=filters.join('、')||(momentum.scores?'月度动量':'观察期未满');
      reasons.push(`动量选品：${momentum.selection}（${why}）。`);
    }
    const yellow=detail.yellowLock;
    if(rule?.id==='yellow'&&yellow?.locked){
      const u=yellow.unlock||{},checks=[];
      if(u.tdcEnabled)checks.push(`TDC<${n(u.tdcThreshold)}`);
      if(u.priceEnabled)checks.push(`QQQ距52周高点≤${n(u.repairPct)}%`);
      if(u.blueEnabled)checks.push('实心蓝点');
      if(checks.length)reasons.push(`黄点锁定中，待${checks.join(' / ')}任一满足后解除。`);
    }else if(yellow?.releaseDate===detail.signalDate&&yellow.releaseReason){
      const why=yellow.releaseReason.replace('出现实心蓝点，永久解除本次黄点锁定','实心蓝点解锁').replaceAll('QQQ距52周高点','QQQ距高点');
      reasons.push(`黄点已解除：${why}。`);
    }
    const compare=detail.blueComparison;
    if(compare?.enabled&&!compare.eligible)reasons.push(`蓝点未执行：抄底 ${x(compare.blueExposure)} < 当日配置 ${x(compare.baselineExposure)}。`);
    const gate=detail.drawdownGate;
    if(gate?.applied)reasons.push(`回撤闸：参考回撤 ${p(gate.drawdown)}，常态目标 ${x(gate.baselineBefore)} → ${x(gate.baselineAfter)}。`);
    const cap=detail.cccStressBlueLimit;
    if(cap?.applied)reasons.push(`CCC波动限仓：${cap.monitorAsset}的${cap.window}日年化波动率 ${p(cap.volatility)}，目标 ${x(cap.originalExposure)} → ${x(cap.exposure)}。`);
    const tool=source.map(r=>r.match(/^期望 (.+?)；.*?(?:限仓前可实现目标|实际目标) (.+?)，/)).find(Boolean);
    if(tool)reasons.push(`工具限制：期望 ${tool[1]}，可实现 ${tool[2]}。`);
    return reasons;
  }
  function customTransitions(previous, detail, config) {
    const reasons=[],oldRule=previous.winningRule;
    const oldRuleWasUsed=previous.creditStack?.selected||previous.state?.split(' · ')[0]===customRuleLabels[oldRule];
    if(oldRule&&oldRule!=='yellow'&&oldRuleWasUsed&&detail.activeRules&&!detail.activeRules.includes(oldRule)){
      const label=customRuleLabels[oldRule]||oldRule;
      const window=oldRule==='blue'&&config.rules?.find(rule=>rule.id===oldRule)?.action==='blue_ladder'?'40 日滚动窗口':'有效期';
      reasons.push(oldRule==='ccc_stress'||oldRule==='ccc_above'?`${label}条件退出。`:`${label}的${window}结束。`);
    }
    if(detail.vixReversalSignalDate&&detail.vixReversalSignalDate!==previous.vixReversalSignalDate){
      reasons.push(`vix反转信号于 ${detail.vixReversalSignalDate} 生效，一次性调整至抄底目标。`);
    }
    const oldLadder=previous.blueLadder,ladder=detail.blueLadder;
    if(oldLadder?.selected&&ladder?.selected&&oldLadder.target!==ladder.target&&oldLadder.count!==ladder.count){
      reasons.push(`最近 40 个交易日的实心蓝点日数 ${oldLadder.count} → ${ladder.count}，分批目标 ${multiple(oldLadder.target)} → ${multiple(ladder.target)}。`);
    }
    if(previous.creditStack?.selected&&!detail.creditStack?.selected){
      reasons.push('退出 CCC 见顶与信用状态的累乘配置。');
    }
    const oldBear=previous.bearGate,bear=detail.bearGate;
    if(oldBear?.applied&&bear?.method==='ensemble'){
      const next=bear.applied?bear.multiplier:1;
      if((bear.applied||!bear.active)&&oldBear.multiplier!==next){
        reasons.push(`熊市闸门看多票占比变化，常态多头乘数 ${multiple(oldBear.multiplier)} → ${multiple(next)}。`);
      }
    }else if(oldBear?.applied&&bear?.ready&&!bear.active){
      reasons.push(`熊市闸门解除，${bear.below?'200 日均线停止下行':'QQQ 收盘不再低于 200 日均线'}。`);
    }
    const gate=detail.drawdownGate;
    if(previous.drawdownGate?.applied&&gate?.releaseDate===detail.signalDate&&!gate.active){
      reasons.push(`参考净值回撤修复至 ${percent(gate.drawdown)}，回撤闸解除。`);
    }
    const oldCap=previous.cccStressBlueLimit,cap=detail.cccStressBlueLimit;
    if(oldCap?.applied&&cap){
      if(!cap.active)reasons.push('CCC 信用压力解除，撤销多头波动率上限。');
      else if(cap.applied&&Math.abs(oldCap.cap-cap.cap)>1e-9){
        reasons.push(`CCC 波动率上限 ${multiple(oldCap.cap)} → ${multiple(cap.cap)}。`);
      }
    }
    return reasons;
  }
  const originalRuleExits=[
    [/红点距今|^红点窗口：/,'红点有效窗口结束。'],
    [/CCC 利差 .*高于200日均线|^CCC 高于 200 日线：/,'CCC 利差回到 200 日均线或以下。'],
    [/CCC 252日分位|^CCC 压力阶段：/,'CCC 利差分位回落至 95 以下，解除信用压力减仓。'],
    [/CCC 见顶预警距今|^CCC 见顶预警窗口：/,'CCC 见顶预警有效窗口结束。'],
    [/熊市闸门[：:]/,'熊市闸门条件解除。'],
    [/回撤闸生效|^组合回撤闸：/,'参考净值回撤达到修复阈值，回撤闸解除。'],
  ];
  function originalTransitions(previous, detail) {
    const oldState=previous.state,state=detail.state;
    if(detail.yellowRelease&&oldState==='黄点锁仓')return [`黄点锁仓解除：${detail.yellowRelease}。`];
    if(state==='抄底'||state==='黄点锁仓')return [];
    if(oldState==='黄点锁仓')return ['黄点锁仓解除，按当前有效配置重新确定仓位。'];
    if(oldState==='抄底')return ['退出抄底配置，按当前有效规则重新确定仓位。'];
    if(!previous.reasons||!detail.reasons)return [];
    return originalRuleExits.flatMap(([pattern,reason])=>
      previous.reasons.some(text=>pattern.test(text))&&!detail.reasons.some(text=>pattern.test(text))?[reason]:[]);
  }
  function positionChangeReasons(detail, config, {trade,previous}) {
    if(trade.rebalanceOnly||trade.reason==='rebalancing_band'){
      const band=Number(((trade.band??detail.band??.05)*100).toFixed(4));
      return [`沿用原目标；资金权重漂移达到再平衡条件（${band} 个百分点再平衡带）。`];
    }
    if(!previous)return [];
    const reasons=config?customTransitions(previous,detail,config):originalTransitions(previous,detail);
    const oldSymbols=previous.targetHoldings?.map(([symbol])=>symbol),newSymbols=detail.targetHoldings?.map(([symbol])=>symbol);
    if(detail.unavailableAsset){
      reasons.push(`${detail.unavailableAsset} 当时没有符合策略可交易条件的多头 ETF，目标转为 BIL。`);
    }else if(previous.unavailableAsset&&detail.targetExposure>0&&newSymbols?.length){
      reasons.push(`上一目标的 ${previous.unavailableAsset} 缺少符合条件的多头 ETF，本次以 ${newSymbols.map(symbolName).join(' / ')} 建仓。`);
    }else if(previous.targetExposure>0&&detail.targetExposure>0&&oldSymbols?.length&&newSymbols?.length
      &&oldSymbols.join()!==newSymbols.join()){
      reasons.push(`目标 ETF 由 ${oldSymbols.map(symbolName).join(' / ')} 切换为 ${newSymbols.map(symbolName).join(' / ')}。`);
    }
    return reasons;
  }
  function tooltipHTML(point, benchmarkValue, detail, drawdowns, loadState,annotationHTML='',customConfig=null,change=null) {
    const landmark = (drawdowns||[]).flatMap((d,i)=>{
      const place=point.date===d.troughDate?'谷底':point.date===d.peakDate?'峰值':'';
      return place?[`第${i+1}大回撤${place}`]:[];
    }).join(' / ');
    let html = `<div class="hover-heading"><strong>${escape(point.date)}</strong>${landmark ? `<em>${landmark}</em>` : ''}</div><div class="hover-nav"><span>策略净值 <b>${multiple(point.value)}</b></span><span>QQQ <b>${multiple(benchmarkValue)}</b></span></div>`;
    if (!detail) return html + annotationHTML + `<p class="hover-note">${loadState === 'error' ? '历史持仓明细加载失败，可重试刷新页面。' : loadState==='ready'?'此交易日暂无存档持仓明细，可扩大区间查看邻近记录。':'正在加载历史持仓明细…'}</p>`;
    const evidence=customConfig?customReasons(detail,customConfig):detail.reasons??[];
    const signalTitle=`信号依据 · ${escape(change?.trade.signalDate||detail.signalDate)}`;
    let reasons=evidence;
    if(change){
      const {trade,previous}=change;
      const driftOnly=trade.rebalanceOnly||trade.reason==='rebalancing_band';
      const stateChange=!driftOnly&&previous?.state&&previous.state!==detail.state?` · ${escape(previous.state)} → ${escape(detail.state)}`:'';
      const prior=previous?.targetExposure,next=detail.targetExposure;
      const targetChange=!driftOnly&&Number.isFinite(prior)&&Number.isFinite(next)&&multiple(prior)!==multiple(next)
        ?`<div class="hover-exposure">规则目标敞口 <strong>${multiple(prior)} → ${multiple(next)}</strong></div>`:'';
      const transitions=positionChangeReasons(detail,customConfig,change);
      reasons=driftOnly?transitions:[...transitions,...evidence];
      html+=`<div class="hover-basis-title">仓位变动原因 · ${signalTitle}</div><div class="hover-exposure">成交敞口 <strong>${multiple(trade.exposureBefore)} → ${multiple(trade.exposureAfter)}</strong>${stateChange}</div>${targetChange}`;
    }
    const reasonList=`<ul class="hover-reasons">${reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul>`;
    if(change)html+=reasonList;
    html += annotationHTML;
    html += `<div class="hover-position-title"><span>回测收盘持仓</span><b>${escape(detail.state)}</b></div><div class="hover-holdings">`;
    for (const [symbol, weight] of [...detail.holdings, [detail.cash<0?'融资负债':'BIL', detail.cash]]) {
      html += `<div><span>${escape(symbolName(symbol))}</span><strong>${percent(weight)}</strong></div>`;
    }
    html += `</div><div class="hover-exposure">底层敞口 <strong>${multiple(detail.exposure)}</strong></div>`;
    const target = [...detail.targetHoldings, [detail.targetCash<0?'融资负债':'BIL',detail.targetCash]].map(([s,w]) => `${symbolName(s)} ${percent(w)}`).join(' / ');
    html += `<div class="hover-target">规则目标：${escape(target)}</div>`;
    if(!change)html+=`<div class="hover-basis-title">${signalTitle}</div>${reasonList}`;
    const band=Number.isFinite(detail.band)?Number((detail.band*100).toFixed(4)):5;
    html += `<p class="hover-note">${detail.rebalanced ? '当日收盘已按前一交易日信号再平衡。' : `未触发${band}个百分点再平衡带，权重可能随价格浮动。`}<br>回测模拟持仓，非账户实盘持仓。</p>`;
    return html;
  }
  root.HistoryChart = Object.freeze({nearestIndex, mergeLandmarks, tooltipHTML,rangeIndices,summarize,rankDrawdowns,extendDailyHistory,customReasons});
})(window);
