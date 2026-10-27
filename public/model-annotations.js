/* Pure presentation for original model flags and actual simulated ETF trades. */
(function(root){
  'use strict';
  const TYPES=Object.freeze([
    {id:'buy',label:'买入',color:'#56886d',group:'trade'},
    {id:'sell',label:'卖出',color:'#b97570',group:'trade'},
    {id:'add',label:'加仓',color:'#6b92ad',group:'trade'},
    {id:'reduce',label:'减仓',color:'#b69462',group:'trade'},
    {id:'red',label:'实心红点',color:'#c17b75',group:'fit'},
    {id:'red_ad',label:'空心红点',color:'#c17b75',group:'fit'},
    {id:'blue',label:'实心蓝点',color:'#709db9',group:'fit'},
    {id:'blue_soft',label:'空心蓝点',color:'#709db9',group:'fit'},
    {id:'yellow',label:'黄点预警',color:'#c5a459',group:'fit'},
    {id:'ccc_top',label:'见顶预警',color:'#ad7d79',group:'credit'},
    {id:'ccc_bot',label:'见底预警',color:'#6d9b86',group:'credit'},
    {id:'ccc_stress',label:'信用压力',color:'#c3a35f',group:'credit'},
    {id:'ccc_above',label:'高于200日线',color:'#91ab89',group:'credit'},
  ].map(item=>Object.freeze(item)));
  const BY_TYPE=Object.freeze(Object.fromEntries(TYPES.map(item=>[item.id,item])));
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const value=(number,digits=2)=>finite(number)?number.toFixed(digits):'—';
  const percent=number=>finite(number)?`${(number*100).toFixed(2)}%`:'—';
  const inRange=(date,range)=>typeof date==='string'&&date>=range.start&&date<=range.end;
  function filterType(type){
    if(type==='ccc_stress_on'||type==='ccc_stress_off')return 'ccc_stress';
    if(type==='ccc_above_on'||type==='ccc_above_off')return 'ccc_above';
    return type;
  }
  function enabledEvent(type,enabled){return enabled==null||enabled.has(filterType(typeof type==='object'?type.type:type));}
  function intervalActive(interval,date){
    const start=interval.origStart||interval.start;
    const end=interval.origEnd||interval.end;
    return date>=start&&(interval.endExclusive?date<interval.endExclusive:!end||date<=end);
  }
  function collect(annotations,details,range,enabledSet){
    annotations=annotations||{};details=details||{};
    range=range||{start:'0000-01-01',end:'9999-12-31'};
    const enabled=enabledSet==null?null:enabledSet instanceof Set?enabledSet:new Set(enabledSet);
    const availableEvents=(annotations.events||[]).filter(event=>BY_TYPE[filterType(event.type)]&&inRange(event.date,range));
    const availableTrades=(details.trades||[]).filter(trade=>BY_TYPE[trade.type]?.group==='trade'&&inRange(trade.date,range));
    const availableIntervals=(annotations.intervals||[]).filter(interval=>{
      if(!BY_TYPE[interval.type]||typeof interval.start!=='string'||interval.start>range.end)return false;
      return interval.endExclusive?interval.endExclusive>range.start:!interval.end||interval.end>=range.start;
    });
    const counts=Object.fromEntries(TYPES.map(item=>[item.id,0]));
    for(const event of availableEvents){const key=filterType(event.type);if(key!=='ccc_stress'&&key!=='ccc_above')counts[key]++;}
    for(const trade of availableTrades)counts[trade.type]++;
    for(const interval of availableIntervals)counts[interval.type]++;
    const events=availableEvents.filter(event=>enabledEvent(event.type,enabled)).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type));
    const trades=availableTrades.filter(trade=>enabledEvent(trade.type,enabled)).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol)||a.type.localeCompare(b.type));
    const intervals=availableIntervals.filter(interval=>enabledEvent(interval.type,enabled)).map(interval=>({...interval,origStart:interval.start,origEnd:interval.end,clipStart:interval.start<range.start?range.start:interval.start,clipEnd:(interval.endExclusive||interval.end||range.end)>range.end?range.end:(interval.endExclusive||interval.end||range.end)}));
    const dates=new Set(),byDate=Object.create(null);
    const entry=date=>byDate[date]||(byDate[date]={events:[],trades:[]});
    for(const event of events){dates.add(event.date);entry(event.date).events.push(event);}
    for(const trade of trades){dates.add(trade.date);entry(trade.date).trades.push(trade);}
    for(const interval of intervals)for(const date of [interval.start,interval.end,interval.endExclusive])if(inRange(date,range))dates.add(date);
    return {events,trades,intervals,dates:[...dates].sort(),byDate,counts,enabled:enabled===null?TYPES.map(t=>t.id):[...enabled],range:{...range}};
  }
  function addPoints(series,details,dates,benchmark=false){
    const points=new Map(series.map(point=>[point.date,point]));
    const key=benchmark?'benchmarkNav':'nav';
    for(const date of dates||[]){const point=details?.points?.[date];if(point&&finite(point[key])&&point[key]>0)points.set(date,{...points.get(date),date,nav:point[key]});}
    return [...points.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function timingText(event){
    const source=event.sourceDate||event.date;
    return `${event.model==='credit'?'源模型计算日':'模型信号日'} ${source} · 可采用日 ${event.date} · 次日收盘 ${event.executionDate||'样本结束后'}`;
  }
  function tooltipHTML(date,collected,readings){
    if(!collected)return '';
    const entry=collected.byDate?.[date]||{events:(collected.events||[]).filter(e=>e.date===date),trades:(collected.trades||[]).filter(t=>t.date===date)};
    const active=(collected.intervals||[]).filter(interval=>intervalActive(interval,date));
    if(!entry.events.length&&!entry.trades.length&&!active.length)return '';
    let html='<section class="annotation-tooltip">';
    if(entry.trades.length){
      html+='<div class="annotation-tooltip-title">当日回测实际成交</div><div class="annotation-tooltip-trades">';
      for(const trade of entry.trades){
        const inverse=trade.inverse||/^(?:SYN_)?(?:SQQQ|PSQ)$/.test(trade.symbol);
        const symbol=trade.symbol?.startsWith('SYN_')?`${trade.symbol.slice(4)}（合成）`:trade.symbol;
        html+=`<div class="annotation-trade"><strong>${escape(BY_TYPE[trade.type]?.label||trade.type)} ${escape(symbol)}${inverse?' · 反向ETF':''}</strong><span>${percent(trade.weightBefore)} → ${percent(trade.weightAfter)}</span></div>`;
      }
      html+='</div>';
      const signalDates=[...new Set(entry.trades.map(t=>t.signalDate).filter(Boolean))];
      html+=`<p class="annotation-tooltip-note">信号日 ${escape(signalDates.join(' / ')||'—')} → ${escape(date)} 收盘成交；权重比较为当日收益后、调仓前后。</p>`;
      if(entry.trades.some(trade=>trade.rebalanceOnly||trade.reason==='rebalancing_band')){const bands=[...new Set(entry.trades.map(t=>Number(((t.band??.05)*100).toFixed(4))))];html+=`<p class="annotation-tooltip-note">沿用原目标；资金权重漂移触及${bands.join(' / ')}个百分点再平衡带，触发本次调仓。</p>`;}
    }
    if(entry.events.length){
      html+='<div class="annotation-tooltip-title">当日模型标记</div><ul class="annotation-tooltip-events">';
      for(const event of entry.events){
        html+=`<li><b>${escape(event.label||BY_TYPE[filterType(event.type)]?.label||event.type)}</b>${event.description?`<span>${escape(event.description)}</span>`:''}</li>`;
      }
      html+='</ul>';
      if(entry.events.some(e=>e.type==='red')&&entry.events.some(e=>e.type==='red_ad'))html+='<p class="annotation-tooltip-note">实心与自适应红点条件同日成立，两类原始信号均保留。</p>';
      const timings=[...new Set(entry.events.map(timingText))];
      html+=timings.map(timing=>`<p class="annotation-tooltip-note">${escape(timing)}</p>`).join('');
    }
    if(active.length||entry.events.some(event=>event.model==='credit')){
      html+='<div class="annotation-tooltip-title">信用环境</div>';
      const stateLabels=active.map(interval=>interval.label||BY_TYPE[interval.type]?.label||interval.type);
      if(readings?.creditStress===false)stateLabels.push('信用压力未触发');
      if(readings?.creditAbove===false)stateLabels.push('CCC 未高于200日线');
      if(stateLabels.length)html+=`<p class="annotation-credit-state">${stateLabels.map(escape).join(' · ')}</p>`;
      if(readings)html+=`<p class="annotation-tooltip-note">CCC 利差 ${value(readings.creditSpread)}% · 200日线 ${value(readings.creditMA200)}% · 252日分位 ${value(readings.creditPercentile,1)}${readings.creditSourceDate?`<br>源模型计算日 ${escape(readings.creditSourceDate)}`:''}</p>`;
      html+='<p class="annotation-tooltip-note">信用压力表示历史分位≥95，不是价格压力线。</p>';
    }
    if(entry.events.some(e=>e.model==='fit')&&readings&&(finite(readings.temperature)||finite(readings.tdc)))html+=`<p class="annotation-tooltip-note">红点温度 ${value(readings.temperature,1)} · TDC ${value(readings.tdc,1)}</p>`;
    html+='</section>';
    return html;
  }
  root.ModelAnnotations=Object.freeze({TYPES,filterType,enabledEvent,intervalActive,collect,addPoints,tooltipHTML});
})(window);
