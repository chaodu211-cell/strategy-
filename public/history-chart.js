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
  function summarize(series,trades=[]){
    if(series.length<2)throw new Error('区间至少保留两个交易日');
    const first=series[0],last=series.at(-1),years=(Date.parse(last.date)-Date.parse(first.date))/86400000/365.25;
    const returns=series.slice(1).map((p,i)=>p.nav/series[i].nav-1),mean=returns.reduce((a,b)=>a+b,0)/returns.length;
    const vol=returns.length>1?Math.sqrt(returns.reduce((s,r)=>s+(r-mean)**2,0)/(returns.length-1))*Math.sqrt(252):0;
    let peak=first,dd={value:0,peakDate:first.date,troughDate:first.date,peakNav:first.nav,troughNav:first.nav,recoveryDate:first.date};
    for(const p of series){if(p.nav>=peak.nav)peak=p;const value=p.nav/peak.nav-1;if(value<dd.value)dd={value,peakDate:peak.date,troughDate:p.date,peakNav:peak.nav,troughNav:p.nav,recoveryDate:null};}
    if(dd.value<0)dd.recoveryDate=series.find(p=>p.date>=dd.troughDate&&p.nav>=dd.peakNav)?.date||null;
    const days=new Map();for(const t of trades){if(t.date<=first.date||t.date>last.date)continue;let d=days.get(t.date);if(!d){d={equity:0,cash:Math.abs(t.cashAfter-t.cashBefore)};days.set(t.date,d);}d.equity+=Math.abs(t.weightChange);}
    const turnover=[...days.values()].reduce((s,d)=>s+(d.equity+d.cash)/2,0);
    return{cagr:(last.nav/first.nav)**(1/years)-1,mdd:dd.value,sharpe:vol>0?mean*252/vol:null,vol,turn_yr:turnover/years,drawdown:dd,rebalanceDays:days.size};
  }
  function customReasons(detail, config) {
    const n=value=>Number.isFinite(value)?String(Number(value.toFixed(2))):'—';
    const x=value=>`${n(value)}倍`,p=value=>`${n(value*100)}%`;
    const labels={red:'实心红点',red_ad:'空心红点',blue:'实心蓝点',blue_soft:'空心蓝点',yellow:'黄点预警',ccc_top:'CCC 见顶预警',ccc_bot:'CCC 见底预警',ccc_stress:'信用压力（分位≥95）',ccc_above:'利差高于200日线'};
    const base=String(detail.state||'常态').split(' · ')[0],rules=config.rules||[];
    const rule=rules.find(r=>labels[r.id]===base),ladder=detail.blueLadder,credit=detail.creditStack;
    const reasons=[],source=detail.reasons||[];
    if(detail.bearGate?.applied)reasons.push('熊市闸门：QQQ低于200日线且均线下行，常态多头归零。');
    else if(ladder?.selected)reasons.push(`蓝点分批：${ladder.asset}，已建 ${Math.min(ladder.count,ladder.steps)}/${ladder.steps} 份，原目标 ${x(ladder.target)}。`);
    else if(credit?.selected)reasons.push(`CCC见顶 × ${credit.creditLabel}：常态敞口 × ${n(credit.combinedMultiplier)}。`);
    else if(rule){
      const action={flat:'清仓至BIL',long:`原多头目标 ${x(rule.value)}`,short:`做空目标 ${x(rule.value)}`,scale:`常态敞口 × ${n(rule.value)}`,blue_ladder:'分批建仓'}[rule.action]||'按当前配置';
      const original=source.find(r=>r.startsWith(base+'：'))||'',window=original.match(/信号日 (\d{4}-\d{2}-\d{2})，有效 (\d+) 个交易日/);
      reasons.push(`${base}：${action}${window?`（${window[1]}起，${window[2]}日窗口）`:''}。`);
    }else reasons.push(base==='常态'?`常态配置：${detail.selection}，目标 ${x(detail.targetExposure)}。`:`生效规则：${base}。`);
    const blueMode=rules.find(r=>r.id==='blue')?.asset??'inherit';
    const usesMomentum=ladder?.selected?(blueMode==='momentum'||(blueMode==='inherit'&&config.asset==='momentum')):config.asset==='momentum';
    if(usesMomentum&&detail.targetExposure>0)reasons[0]+=` 动量选中${detail.selection}。`;
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
  function tooltipHTML(point, benchmarkValue, detail, drawdown, loadState,annotationHTML='',customConfig=null) {
    const landmark = point.date === drawdown?.troughDate ? '最大回撤谷底' : point.date === drawdown?.peakDate ? '最大回撤起点' : '';
    let html = `<div class="hover-heading"><strong>${escape(point.date)}</strong>${landmark ? `<em>${landmark}</em>` : ''}</div><div class="hover-nav"><span>策略净值 <b>${multiple(point.value)}</b></span><span>QQQ <b>${multiple(benchmarkValue)}</b></span></div>`;
    html += annotationHTML;
    if (!detail) return html + `<p class="hover-note">${loadState === 'error' ? '历史持仓明细加载失败，可重试刷新页面。' : loadState==='ready'?'此交易日暂无存档持仓明细，可扩大区间查看邻近记录。':'正在加载历史持仓明细…'}</p>`;
    html += `<div class="hover-position-title"><span>回测收盘持仓</span><b>${escape(detail.state)}</b></div><div class="hover-holdings">`;
    for (const [symbol, weight] of [...detail.holdings, [detail.cash<0?'融资负债':'BIL', detail.cash]]) {
      html += `<div><span>${escape(symbolName(symbol))}</span><strong>${percent(weight)}</strong></div>`;
    }
    html += `</div><div class="hover-exposure">底层敞口 <strong>${multiple(detail.exposure)}</strong></div>`;
    const target = [...detail.targetHoldings, [detail.targetCash<0?'融资负债':'BIL',detail.targetCash]].map(([s,w]) => `${symbolName(s)} ${percent(w)}`).join(' / ');
    const reasons=customConfig?customReasons(detail,customConfig):detail.reasons;
    html += `<div class="hover-target">规则目标：${escape(target)}</div><div class="hover-basis-title">信号依据 · ${escape(detail.signalDate)}</div><ul class="hover-reasons">${reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul>`;
    const band=Number.isFinite(detail.band)?Number((detail.band*100).toFixed(4)):5;
    html += `<p class="hover-note">${detail.rebalanced ? '当日收盘已按前一交易日信号再平衡。' : `未触发${band}个百分点再平衡带，权重可能随价格浮动。`}<br>回测模拟持仓，非账户实盘持仓。</p>`;
    return html;
  }
  root.HistoryChart = Object.freeze({nearestIndex, mergeLandmarks, tooltipHTML,rangeIndices,summarize,customReasons});
})(window);
