'use strict';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let DATA;
let RUNTIME = {mode:'sites'};
let MONITOR = null;
let initialized = false;
let refreshing = false;
let lastSuccessMonitor = null;
let HISTORY_DETAILS = null;
let historyLoadState = 'idle';
let customResult = null, customReadings = null, historySource = 'original';
const annotationFilters = new Set(ModelAnnotations.TYPES.map(t=>t.id));
const strategyDetails = StrategyDetails.attach();
let selection = { family: 'simple', risk: 'balanced', window: 'inSample' };
const riskNames = {conservative:'稳健',balanced:'均衡',aggressive:'进取'};
const riskDescriptions = {conservative:'控制敞口，优先防守',balanced:'参与增长，兼顾风险',aggressive:'放大参与，承受波动'};
const fmt = (n, digits = 1) => Number(n).toFixed(digits);
const pct = (n, digits = 1) => `${fmt(n * 100, digits)}%`;
const weight = (n) => pct(n, Math.abs(n * 100 - Math.round(n * 100)) < .001 ? 0 : 2);
const escapeHTML = (str) => String(str).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const displayName = (s) => s.family === 'fitted' ? `拟合·${riskNames[s.risk]}` : s.name;
const selected = () => DATA.strategies.find(s => s.family === selection.family && s.risk === selection.risk);
const holdingText = (s) => s.holdings.length ? s.holdings.map(h => `${h.symbol} ${weight(h.weight)}`).join(' / ') : '无权益持仓';

function init() {
  const {meta,models} = DATA;
  $$('[data-signal-date]').forEach(el => el.textContent = meta.signalDate.replaceAll('-','.'));
  $('#freshness-copy').textContent = `组合目标仓位截至 ${meta.signalDate}；模型各自最新日期见下方。仓位按原策略的次日收盘口径计算。`;
  $('#tdc-top').textContent = fmt(models.fit.tdc);
  $('#credit-top').textContent = fmt(models.credit.percentile);
  $('#fit-summary').textContent = models.fit.state;
  $$('.fit-overview .tag, .signal-panel:first-child .signal-title .tag').forEach(el=>{el.textContent=models.fit.state==='未触发离场约束'?'择时许可':'离场约束';});
  $$('.credit-overview .tag, .signal-panel:last-child .signal-title .tag').forEach(el=>{el.textContent=models.credit.phase==='压力'?'信用压力':models.credit.phase;});
  $('#fit-state-title').textContent = models.fit.state;
  $('#fit-state-detail').textContent = models.fit.facts.slice(0,2).join(' ');
  $('#credit-state-title').textContent = `${models.credit.above200?'高于':'不高于'}200日均线 · ${models.credit.phase}阶段`;
  $('#credit-state-detail').textContent = models.credit.facts.at(-1);
  $('#credit-summary').textContent = `利差 ${fmt(models.credit.spread,2)}%，${models.credit.above200?'高于':'不高于'}200日均线`;
  $('#fit-temperature').textContent = fmt(models.fit.temperature);
  $('#fit-tdc').textContent = fmt(models.fit.tdc);
  $('#credit-spread').innerHTML = `${fmt(models.credit.spread,2)}<small>%</small>`;
  $('#credit-ma').innerHTML = `${fmt(models.credit.ma200,2)}<small>%</small>`;
  $('#credit-percentile').textContent = `${fmt(models.credit.percentile)} / 100`;
  $('#credit-percentile-fill').style.width = `${models.credit.percentile}%`;
  $('#credit-footnote').textContent = `源模型实际观察日 ${models.credit.observationDate || meta.cccObservationDate}；组合使用值 ${meta.cccObservationDate}，已按原规则滞后。历史分位不是风险概率。`;
  $('#fit-events').innerHTML = models.fit.events.map(e=>`<div class="event-item"><i class="event-dot ${escapeHTML(e.type)}"></i><div class="event-info"><div><span>${escapeHTML(e.label)}</span><small>${e.age===null?'尚无记录':e.age+' 交易日前'}</small></div><p>${e.date || '—'}</p></div></div>`).join('');
  $('#footer-date').textContent = `历史研究 · ${meta.backtestEnd || '2026-10-22'}`;
  render();
  renderMonitor();
  if (initialized) return;
  initialized = true;
  $('#refresh-live').addEventListener('click',()=>refreshLive());
  $$('[data-family]').forEach(button=>button.addEventListener('click',()=>{selection.family=button.dataset.family;historySource='original';render();}));
  $$('[data-window]').forEach(button=>button.addEventListener('click',()=>{selection.window=button.dataset.window;renderHistory();}));
  $('#download-snapshot').addEventListener('click', downloadSnapshot);
  $('#annotation-controls').addEventListener('change',event=>{const id=event.target.dataset.annotationFilter;if(!id)return;if(event.target.checked)annotationFilters.add(id);else annotationFilters.delete(id);renderHistory();});
  CustomControls.attach((result,readings)=>{customResult=result;customReadings=readings;historySource='custom';$$('[data-history-source="custom"]').forEach(b=>b.disabled=false);renderHistory();});
  $$('[data-history-source]').forEach(button=>button.addEventListener('click',()=>{historySource=button.dataset.historySource;renderHistory();}));
  $('[data-strategy-history]').addEventListener('click',()=>{historySource='original';renderHistory();});
  $('#open-strategy-details').addEventListener('click',()=>strategyDetails.open(selected(),'#open-strategy-details'));
  render();
  const observer = new IntersectionObserver(entries=>{
    const active = entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];
    if(active) $$('.nav-link').forEach(a=>a.classList.toggle('active',a.getAttribute('href') === `#${active.target.id}`));
  },{rootMargin:'-100px 0px -50% 0px',threshold:0});
  $$('.anchor-section').forEach(section=>observer.observe(section));
}

function render() {
  $$('[data-family]').forEach(button=>{const active=button.dataset.family===selection.family;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  const current = selected();
  $('#risk-options').innerHTML = DATA.strategies.filter(s=>s.family===selection.family).map(s=>`<button class="risk-option ${s.risk===selection.risk?'active':''}" data-risk="${s.risk}" aria-haspopup="dialog" aria-controls="strategy-dialog" aria-pressed="${s.risk===selection.risk}"><div><strong>${riskNames[s.risk]} <small style="display:inline;margin-left:4px;font-weight:400">${s.baseExposure}× 常态</small></strong><small>${riskDescriptions[s.risk]}</small></div><span>当前 ${fmt(s.exposure,2)}×</span><span class="risk-more">查看策略 ↗</span></button>`).join('');
  $$('[data-risk]').forEach(button=>button.addEventListener('click',()=>{selection.risk=button.dataset.risk;historySource='original';render();strategyDetails.open(selected(),`[data-risk="${selection.risk}"]`);}));
  $('#allocation-title').textContent = displayName(current);
  $('#allocation-date').textContent = `信号日 ${current.signalDate || DATA.meta.signalDate} · ${current.liveStatus==='blocked'?'保留最后完整结果':'次日收盘成交'}`;
  $('#position-status').textContent = current.exposure === 0 ? '风控 · 防守' : current.exposure < 0 ? '风控 · 反向' : current.exposure < current.baseExposure ? '风控 · 减仓' : '常态持有';
  $('#position-status').className = 'tag '+(current.exposure===0?'amber':'green');
  $('#exposure-value').textContent = `${fmt(current.exposure,2)}×`;
  $('#underlying-label').textContent = current.exposure===0?'BIL 现金类持仓':(current.selection==='SOXX'?'半导体底层敞口':'纳指底层敞口');
  const equity = current.holdings.reduce((sum,h)=>sum+h.weight,0);
  $('#allocation-donut').style.background = `conic-gradient(var(--green) ${equity*100}%, var(--cash) ${equity*100}% 100%)`;
  $('#allocation-legend').innerHTML = current.holdings.map(h=>`<div class="allocation-item"><div class="allocation-item-top"><span><i></i>${h.symbol}</span><strong>${weight(h.weight)}</strong></div><p>${Math.abs(h.leverage)}倍${h.underlying==='SOXX'?'半导体':'纳指'}${h.leverage<0?'反向':''}工具 · 资金权重</p></div>`).join('')+`<div class="allocation-item cash"><div class="allocation-item-top"><span><i></i>BIL</span><strong>${weight(current.cash)}</strong></div><p>现金类工具 · 资金权重</p></div>`;
  $('#exposure-formula').textContent = current.holdings.length ? `${holdingText(current)} × ${current.holdings[0].leverage} ≈ ${fmt(current.exposure,2)}倍` : '权益工具 0% → 底层敞口 0倍';
  renderReasons(current);
  $('#holdings-table').innerHTML = DATA.strategies.map(s=>`<tr tabindex="0" role="button" data-strategy="${s.id}" class="${s.id===current.id?'selected':''}" aria-haspopup="dialog" aria-controls="strategy-dialog" aria-label="查看${displayName(s)}的完整策略"><td>${displayName(s)}${s.id===current.id?'<span class="row-arrow">↗</span>':''}</td><td>${holdingText(s)}</td><td>${weight(s.cash)}</td><td><strong>${fmt(s.exposure,2)}×</strong></td><td>${escapeHTML(s.signalDate || DATA.meta.signalDate)}</td><td>${escapeHTML(s.reasons.filter(r=>r.active&&r!==s.reasons[0]).map(r=>r.title).join('、') || s.state)}</td></tr>`).join('');
  $$('[data-strategy]').forEach(row=>{
    const activate=()=>{const s=DATA.strategies.find(s=>s.id===row.dataset.strategy);selection.family=s.family;selection.risk=s.risk;historySource='original';render();strategyDetails.open(s,`[data-strategy="${s.id}"]`);};
    row.addEventListener('click',activate);
    row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}});
  });
  renderHistory();
}

function renderReasons(s) {
  const base = s.reasons[0];
  const creditReasons=s.reasons.filter(r=>r.active && r!==base && !['红点窗口','黄点锁仓'].includes(r.title));
  const timingActive=s.reasons.some(r=>['红点窗口','黄点锁仓'].includes(r.title) && r.matched);
  const adjusted=s.exposure!==s.baseExposure;
  const steps=[
    {title:s.family==='simple'?'从纳指常态敞口出发':'月度动量选品，确定常态敞口',detail:base.detail,active:false,status:'基准'},
    {title:timingActive?'最优拟合：当前有离场约束':'最优拟合：当前允许参与',detail:(s.reasons.find(r=>r.title==='红点窗口')?.detail || '') + ' ' + (s.reasons.find(r=>r.title==='黄点锁仓')?.detail || ''),active:timingActive,status:timingActive?'条件命中':'未限制'},
    {title:creditReasons.length?'信用与风控：调整敞口':'其它风控：当前无额外限制',detail:creditReasons.map(r=>r.detail).join(' ') || '当前没有生效的额外风控乘数，按择时状态与常态敞口执行。',active:creditReasons.length>0,status:creditReasons.length?'当前生效':'未限制'}
  ];
  $('#reason-list').innerHTML = steps.map((r,i)=>`<div class="reason ${r.active?'active':''}"><span class="reason-number">0${i+1}</span><div><h4>${r.title}<span class="tiny-status">${r.status}</span></h4><p>${escapeHTML(r.detail)}</p></div></div>`).join('')+`<details class="all-rules"><summary>查看全部 ${s.reasons.length} 项规则 <span>＋</span></summary><div>${s.reasons.map(r=>`<p><strong>${escapeHTML(r.title)}${r.active?' · 生效':''}</strong>${escapeHTML(r.detail)}</p>`).join('')}</div></details>`;
  $('#reason-result').textContent = `→  ${s.formula}`;
}

function loadHistoryDetails() {
  if (historyLoadState !== 'idle') return;
  historyLoadState = 'loading';
  fetch('./history-positions.json').then(r => {if(!r.ok)throw new Error('历史持仓读取失败');return r.json();}).then(data => {
    if(data.schemaVersion !== 1 || !data.strategies)throw new Error('历史持仓格式无效');
    HISTORY_DETAILS=data;historyLoadState='ready';renderHistory();
  }).catch(error => {historyLoadState='error';$('#drawdown-summary').textContent='每日最大回撤与历史持仓明细加载失败，请刷新页面重试。';});
}
function renderAnnotationControls(collection) {
  const container=$('#annotation-filter-groups');
  if(!container.dataset.ready){
    const groups=[['trade','策略成交'],['fit','最优拟合'],['credit','CCC 利差']];
    const icons={buy:'▲',sell:'▼',add:'⊕',reduce:'⊖',red:'●',red_ad:'○',blue:'●',blue_soft:'○',yellow:'◆',ccc_top:'▼',ccc_bot:'▲',ccc_stress:'▰',ccc_above:'▱'};
    container.innerHTML=groups.map(([group,label])=>`<div class="annotation-filter-row"><span class="annotation-group-label">${label}</span><div>${ModelAnnotations.TYPES.filter(t=>t.group===group).map(t=>`<label class="annotation-filter" style="--annotation-color:${t.color}"><input type="checkbox" data-annotation-filter="${t.id}" checked><i aria-hidden="true">${icons[t.id]||'●'}</i><span>${escapeHTML(t.label)}</span><small data-annotation-count="${t.id}">—</small></label>`).join('')}</div></div>`).join('');
    container.dataset.ready='true';
  }
  $$('[data-annotation-filter]').forEach(input=>input.checked=annotationFilters.has(input.dataset.annotationFilter));
  $$('[data-annotation-count]').forEach(el=>{el.textContent=HISTORY_DETAILS?.modelAnnotations?(collection.counts[el.dataset.annotationCount]||0):'—';});
  $('#annotation-status').textContent=HISTORY_DETAILS?.modelAnnotations?`本区间显示 ${collection.trades.length} 个ETF仓位调整、${collection.events.length} 个模型标记、${collection.intervals.length} 段信用状态。买卖按实际收盘成交日；CCC信号额外滞后一交易日。`:'正在载入历史特殊点位…';
}
function renderHistory() {
  const isCustom=historySource==='custom'&&customResult;
  $$('[data-history-source]').forEach(b=>{b.classList.toggle('active',b.dataset.historySource===historySource);b.setAttribute('aria-pressed',b.dataset.historySource===historySource);});
  $('#history-window-controls').hidden=!!isCustom;
  $('#history-caveat-copy').textContent=isCustom?'自定义规则由你设定。反复根据历史结果调整参数可能过拟合；源模型设计也参考过历史，2007–16不能视作完全独立样本外。历史回测不保证未来表现。':'十年数据参与了参数选择，属于样本内；2007–16年的信号设计也参考了历史，只能视作半样本外。回撤预算是筛选条件，不能保证未来回撤上限。';
  if(isCustom){renderCustomHistory();return;}
  const current=selected(), key=selection.window;
  $$('[data-window]').forEach(button=>{const active=button.dataset.window===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  $('#history-title').innerHTML = `${displayName(current)} <span>vs 持有 QQQ</span>`;
  const m=current.metrics[key],b=DATA.benchmark.metrics[key];
  $('#history-metrics').innerHTML=[
    {label:'年化收益',value:pct(m.cagr),note:`QQQ ${pct(b.cagr)}`},
    {label:'最大回撤',value:pct(m.mdd),note:`QQQ ${pct(b.mdd)}`},
    {label:'夏普比率',value:fmt(m.sharpe,2),note:`QQQ ${fmt(b.sharpe,2)}`},
    {label:'年换手率',value:`${fmt(m.turn_yr)}×`,note:key==='inSample'?'十年窗 · 样本内':'2007–16 · 半样本外'}
  ].map(m=>`<div class="history-metric"><span>${m.label}</span><strong>${m.value}</strong><small>${m.note}</small></div>`).join('');
  const range=DATA.windows[key];
  $('#chart-period').textContent=`${range.start} — ${range.end}`;
  const filter=history=>history.filter(p=>p.date>=range.start&&p.date<=range.end);
  loadHistoryDetails();
  const detail=HISTORY_DETAILS?.strategies[current.id];
  const drawdown=detail?.windows[key];
  const annotations=HISTORY_DETAILS?.modelAnnotations;
  const collection=ModelAnnotations.collect(annotations,detail,range,annotationFilters);
  const allMarks=ModelAnnotations.collect(annotations,detail,range,new Set(ModelAnnotations.TYPES.map(t=>t.id)));
  renderAnnotationControls(collection);
  const strategy=ModelAnnotations.addPoints(HistoryChart.mergeLandmarks(filter(current.history),drawdown),detail,allMarks.dates,false);
  const benchmarkLandmarks=drawdown?{...drawdown,peakNav:detail.points[drawdown.peakDate].benchmarkNav,troughNav:detail.points[drawdown.troughDate].benchmarkNav}:null;
  const benchmark=ModelAnnotations.addPoints(HistoryChart.mergeLandmarks(filter(DATA.benchmark.history),benchmarkLandmarks),detail,allMarks.dates,true);
  $('#drawdown-summary').textContent=drawdown?`最大回撤 ${(drawdown.value*100).toFixed(2)}% · 峰值 ${drawdown.peakDate} → 谷底 ${drawdown.troughDate}${drawdown.recoveryDate?' · 修复 '+drawdown.recoveryDate:' · 区间内尚未修复'}`:historyLoadState==='error'?'每日最大回撤与历史持仓明细加载失败，请刷新页面重试。':'正在核对每日净值中的最大回撤…';
  drawChart(strategy, benchmark,detail,drawdown,collection,annotations);
}

function renderCustomHistory() {
  const result=customResult,m=result.metrics,b=result.benchmarkMetrics,detail=result.details,drawdown=m.drawdown;
  $('#history-title').innerHTML=`${escapeHTML(result.config.name)} <span>自定义 vs 持有 QQQ</span>`;
  $('#history-metrics').innerHTML=[
    {label:'年化收益',value:pct(m.cagr),note:`QQQ ${pct(b.cagr)}`},
    {label:'最大回撤',value:pct(m.mdd),note:`QQQ ${pct(b.mdd)}`},
    {label:'夏普比率',value:m.sharpe===null?'—':fmt(m.sharpe,2),note:`QQQ ${b.sharpe===null?'—':fmt(b.sharpe,2)}`},
    {label:'年换手率',value:`${fmt(m.turn_yr)}×`,note:`${result.audit.rebalanceDays} 次实际调仓`}
  ].map(m=>`<div class="history-metric"><span>${m.label}</span><strong>${m.value}</strong><small>${m.note}</small></div>`).join('');
  $('#chart-period').textContent=`${result.range.start} — ${result.range.end}`;
  loadHistoryDetails();
  const sourceAnnotations=HISTORY_DETAILS?.modelAnnotations||{};
  const customDescriptions={yellow:'最优拟合趋势下跌预警；自定义黄点锁定至TDC回落或QQQ价格修复条件满足，不按持续天数结束。',blue:'最优拟合实心蓝点；本次自定义规则不自动解锁其他预警，操作依本次设置。',blue_soft:'最优拟合空心蓝点；是否配置仓位依本次自定义设置。'};
  const annotations={...sourceAnnotations,events:(sourceAnnotations.events||[]).map(e=>customDescriptions[e.type]?{...e,description:customDescriptions[e.type]}:e),readings:customReadings};
  const collection=ModelAnnotations.collect(annotations,detail,result.range,annotationFilters);
  renderAnnotationControls(collection);
  $('#annotation-status').textContent=`自定义回测：${collection.trades.length} 个ETF仓位调整、${collection.events.length} 个模型标记。成交按所保存的设置生成，原策略持仓不参与计算。`;
  $('#drawdown-summary').textContent=drawdown.value<0?`最大回撤 ${(drawdown.value*100).toFixed(2)}% · 峰值 ${drawdown.peakDate} → 谷底 ${drawdown.troughDate}${drawdown.recoveryDate?' · 修复 '+drawdown.recoveryDate:' · 区间内尚未修复'}`:'所选区间未出现净值回撤。';
  drawChart(result.history,result.benchmark,detail,drawdown,collection,annotations);
}

function annotationMarkup(collection,normalized,plot) {
  const {x,y,width,height,pad}=plot,plotBottom=height-pad.bottom;
  const specs=Object.fromEntries(ModelAnnotations.TYPES.map(t=>[t.id,t]));
  const ySlots={red:282,red_ad:289,yellow:296,blue:303,blue_soft:310,ccc_top:329,ccc_bot:338,ccc_stress_on:347,ccc_stress_off:347,ccc_above_on:356,ccc_above_off:356};
  const eventFilter=type=>type.startsWith('ccc_stress')?'ccc_stress':type.startsWith('ccc_above')?'ccc_above':type;
  const targets=[];
  let background='',tracks=`<g class="model-annotation-tracks"><rect x="${pad.left}" y="274" width="${width-pad.left-pad.right}" height="42" rx="3" class="fit-track-bg"/><rect x="${pad.left}" y="322" width="${width-pad.left-pad.right}" height="43" rx="3" class="credit-track-bg"/><text x="3" y="299" class="annotation-track-label">拟合</text><text x="3" y="348" class="annotation-track-label">CCC</text>`;
  for(const interval of collection.intervals){
    const left=x(interval.clipStart),right=x(interval.clipEnd),color=specs[interval.type]?.color||'#c2a879';
    if(interval.type==='ccc_stress')background+=`<rect class="credit-pressure-shade" data-pressure-start="${interval.start}" x="${left}" y="${pad.top}" width="${Math.max(1,right-left)}" height="${plotBottom-pad.top}"/>`;
    const ty=interval.type==='ccc_stress'?324:354,th=interval.type==='ccc_stress'?27:8;
    tracks+=`<rect class="credit-state-band ${interval.type}" data-state-start="${interval.start}" x="${left}" y="${ty}" width="${Math.max(1,right-left)}" height="${th}" fill="${color}"/>`;
  }
  for(const event of collection.events){
    const cx=x(event.date),cy=ySlots[event.type]||338,color=specs[eventFilter(event.type)]?.color||'#a4b69a';
    let shape='';
    if(event.type==='ccc_top')shape=`<path d="M${cx-3.8},${cy-3} L${cx+3.8},${cy-3} L${cx},${cy+4} Z" fill="${color}"/>`;
    else if(event.type==='ccc_bot')shape=`<path d="M${cx-3.8},${cy+3} L${cx+3.8},${cy+3} L${cx},${cy-4} Z" fill="${color}"/>`;
    else if(event.type==='yellow'||event.type.startsWith('ccc_stress'))shape=`<path d="M${cx},${cy-3.8} L${cx+3.8},${cy} L${cx},${cy+3.8} L${cx-3.8},${cy} Z" fill="${event.type.endsWith('_off')?'white':color}" stroke="${color}" stroke-width="1"/>`;
    else if(event.type.startsWith('ccc_above'))shape=`<rect x="${cx-2.7}" y="${cy-2.7}" width="5.4" height="5.4" fill="${event.type.endsWith('_off')?'white':color}" stroke="${color}" stroke-width=".9"/>`;
    else shape=`<circle cx="${cx}" cy="${cy}" r="2.7" fill="${event.type==='red_ad'||event.type==='blue_soft'?'#fbfcf8':color}" stroke="${color}" stroke-width="1.1"/>`;
    tracks+=`<g class="model-signal-marker" data-event-date="${event.date}" data-event-type="${event.type}">${shape}</g>`;
    targets.push({date:event.date,x:cx,y:cy});
  }
  tracks+='</g>';
  const pointMap=new Map(normalized.map(p=>[p.date,p]));
  const byDate=new Map();for(const trade of collection.trades){if(!byDate.has(trade.date))byDate.set(trade.date,[]);byDate.get(trade.date).push(trade);}
  let trades='';
  for(const [date,items] of byDate){const point=pointMap.get(date);if(!point)continue;const anchorX=x(date),anchorY=y(point.value);
    items.forEach((trade,index)=>{const cx=anchorX+(index-(items.length-1)/2)*8,up=trade.type==='buy'||trade.type==='add',cy=Math.max(pad.top+6,Math.min(plotBottom-6,anchorY+(up?-13:13))),color=specs[trade.type]?.color||'#7f9d74',border=trade.inverse?'#916b9d':color;
      let shape='';
      if(trade.type==='buy')shape=`<path d="M${cx-3.8},${cy+3.2} L${cx+3.8},${cy+3.2} L${cx},${cy-4.2} Z" fill="${color}" stroke="${border}" stroke-width=".9"/>`;
      else if(trade.type==='sell')shape=`<path d="M${cx-3.8},${cy-3.2} L${cx+3.8},${cy-3.2} L${cx},${cy+4.2} Z" fill="${color}" stroke="${border}" stroke-width=".9"/>`;
      else shape=`<circle cx="${cx}" cy="${cy}" r="3.5" fill="#fff" stroke="${border}" stroke-width="1.2"/><path d="M${cx-2},${cy} L${cx+2},${cy}${trade.type==='add'?` M${cx},${cy-2} L${cx},${cy+2}`:''}" fill="none" stroke="${color}" stroke-width="1.1"/>`;
      trades+=`<g class="portfolio-trade-marker${trade.inverse?' inverse':''}" data-trade-date="${date}" data-trade-type="${trade.type}" data-trade-symbol="${escapeHTML(trade.symbol)}"><path d="M${anchorX},${anchorY} L${cx},${cy}" class="trade-marker-stem"/>${shape}</g>`;
      targets.push({date,x:cx,y:cy});
    });
  }
  return{background,tracks,trades,targets};
}

function drawChart(series,benchmark,details,drawdown,collection,annotations) {
  $('#chart-tooltip').hidden=true;
  $('#chart-tooltip').classList.remove('pinned');
  const svg=$('#nav-chart');
  if(!series.length||!benchmark.length) {svg.innerHTML='<text x="50" y="100">当前区间无净值数据</text>';return;}
  const width=1000,height=380,pad={left:40,right:22,top:18,bottom:131};
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const normalized=series.map(p=>({...p,value:p.nav/series[0].nav}));
  const bench=benchmark.map(p=>({...p,value:p.nav/benchmark[0].nav}));
  const t0=Date.parse(series[0].date),t1=Date.parse(series.at(-1).date);
  const values=[...normalized,...bench].map(p=>Math.log(p.value));
  let low=Math.min(...values),high=Math.max(...values);const margin=Math.max((high-low)*.09,.01);low-=margin;high+=margin;
  const x=date=>pad.left+(Date.parse(date)-t0)/(t1-t0)*(width-pad.left-pad.right);
  const y=value=>height-pad.bottom-(Math.log(value)-low)/(high-low)*(height-pad.top-pad.bottom);
  const path=points=>points.map((p,i)=>`${i?'L':'M'}${x(p.date).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const ticks=[.25,.5,1,2,3,5,10,20,50,100,200,500,1000].filter(v=>Math.log(v)>=low&&Math.log(v)<=high);
  const startYear=Number(series[0].date.slice(0,4)),endYear=Number(series.at(-1).date.slice(0,4));
  const years=[];for(let yr=startYear;yr<=endYear;yr+=2){const date=yr===startYear?series[0].date:`${yr}-01-01`;years.push({date,label:yr});}
  let drawdownMarkup='';
  if(drawdown){
    const peak={x:x(drawdown.peakDate),y:y(drawdown.peakNav/series[0].nav)},trough={x:x(drawdown.troughDate),y:y(drawdown.troughNav/series[0].nav)};
    const labelWidth=152,labelX=Math.min(Math.max(pad.left+4,trough.x+11),width-pad.right-labelWidth),labelY=Math.min(Math.max(pad.top+4,trough.y+12),height-pad.bottom-28);
    drawdownMarkup=`<g class="drawdown-markers" aria-label="最大回撤 ${(drawdown.value*100).toFixed(2)}%"><path d="M${peak.x},${peak.y} L${trough.x},${trough.y}" class="drawdown-link"/><circle cx="${peak.x}" cy="${peak.y}" r="4" class="drawdown-peak"/><circle cx="${trough.x}" cy="${trough.y}" r="4.5" class="drawdown-trough"/><rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="24" rx="4" class="drawdown-label-bg"/><text x="${labelX+10}" y="${labelY+16}" class="drawdown-label">最大回撤 ${(drawdown.value*100).toFixed(2)}%</text></g>`;
    svg.setAttribute('aria-label',`策略与QQQ历史净值。最大回撤 ${(drawdown.value*100).toFixed(2)}%，峰值 ${drawdown.peakDate}，谷底 ${drawdown.troughDate}。`);
  }
  const marks=annotationMarkup(collection,normalized,{x,y,width,height,pad});
  svg.innerHTML=`<defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#a1b49a" stop-opacity=".13"/><stop offset="100%" stop-color="#a1b49a" stop-opacity="0"/></linearGradient><clipPath id="plot-clip"><rect x="${pad.left}" y="${pad.top}" width="${width-pad.left-pad.right}" height="${height-pad.top-pad.bottom}"/></clipPath></defs>${marks.background}`+
    ticks.map(v=>`<line class="chart-grid" x1="${pad.left}" y1="${y(v)}" x2="${width-pad.right}" y2="${y(v)}"/><text x="${pad.left-10}" y="${y(v)+3}" text-anchor="end">${v}×</text>`).join('')+
    years.map(p=>`<text x="${x(p.date)}" y="${height-pad.bottom+17}" text-anchor="middle">${p.label}</text>`).join('')+
    `<g clip-path="url(#plot-clip)"><path d="${path(normalized)} L${x(series.at(-1).date)},${height-pad.bottom} L${pad.left},${height-pad.bottom} Z" fill="url(#chart-fill)"/><path class="benchmark-line" d="${path(bench)}"/><path class="chart-line" d="${path(normalized)}"/>${drawdownMarkup}${marks.trades}<line id="hover-line" class="hover-line" y1="${pad.top}" y2="${height-pad.bottom}" visibility="hidden"/><circle id="hover-dot" r="3.5" fill="#52785d" stroke="white" stroke-width="2" visibility="hidden"/></g>${marks.tracks}<rect id="chart-hitbox" tabindex="0" role="slider" aria-label="历史净值点，方向键查看当时持仓与依据" aria-valuemin="0" aria-valuemax="${normalized.length-1}" aria-valuenow="0" x="${pad.left}" y="${pad.top}" width="${width-pad.left-pad.right}" height="${height-pad.top-8}" fill="transparent"/>`;
  const hit=$('#chart-hitbox'),tooltip=$('#chart-tooltip');
  hit.setAttribute('aria-describedby','chart-tooltip');
  let activeIndex=-1,pinned=false;
  function placeTooltip(event){
    const gap=12,box=tooltip.getBoundingClientRect();
    let left=event.clientX+16,top=event.clientY+16;
    if(left+box.width>window.innerWidth-gap)left=event.clientX-box.width-16;
    if(top+box.height>window.innerHeight-gap)top=event.clientY-box.height-16;
    tooltip.style.left=`${Math.max(gap,Math.min(left,window.innerWidth-box.width-gap))}px`;
    tooltip.style.top=`${Math.max(gap,Math.min(top,window.innerHeight-box.height-gap))}px`;
  }
  function showIndex(index,event){
    index=Math.max(0,Math.min(normalized.length-1,index));
    const p=normalized[index],b=bench[HistoryChart.nearestIndex(bench,Date.parse(p.date))];
    $('#hover-line').setAttribute('x1',x(p.date));$('#hover-line').setAttribute('x2',x(p.date));$('#hover-line').setAttribute('visibility','visible');
    $('#hover-dot').setAttribute('cx',x(p.date));$('#hover-dot').setAttribute('cy',y(p.value));$('#hover-dot').setAttribute('visibility','visible');
    if(index!==activeIndex||tooltip.hidden){
      tooltip.innerHTML='<div class="tooltip-pin-bar"><span>点击图中点位固定详情，可滚动阅读</span><button type="button" data-close-chart-detail aria-label="关闭历史详情">×</button></div>'+HistoryChart.tooltipHTML(p,b.value,details?.points[p.date],drawdown,historyLoadState,ModelAnnotations.tooltipHTML(p.date,collection,annotations?.readings?.[p.date]));
      tooltip.scrollTop=0;
    }
    activeIndex=index;tooltip.hidden=false;
    const entry=collection.byDate[p.date];
    const marksSummary=[...(entry?.trades||[]).map(t=>`${ModelAnnotations.TYPES.find(type=>type.id===t.type)?.label} ${t.symbol}`),...(entry?.events||[]).map(e=>e.label)].join('，');
    hit.setAttribute('aria-valuenow',index);hit.setAttribute('aria-valuetext',`${p.date}，策略净值 ${fmt(p.value,2)} 倍，${details?.points[p.date]?.state||'持仓明细加载中'}${marksSummary?'，'+marksSummary:''}`);
    if(event)placeTooltip(event);
    else {
      const matrix=svg.getScreenCTM();if(matrix){const point=new DOMPoint(x(p.date),y(p.value)).matrixTransform(matrix);placeTooltip({clientX:point.x,clientY:point.y});}
    }
  }
  function hover(event,force=false){
    if(pinned&&!force)return;
    const matrix=svg.getScreenCTM();if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const timestamp=t0+Math.max(0,Math.min(1,(point.x-pad.left)/(width-pad.left-pad.right)))*(t1-t0);
    let index=HistoryChart.nearestIndex(normalized,timestamp);
    const nearby=marks.targets.map(target=>({...target,distance:Math.hypot(target.x-point.x,target.y-point.y)})).filter(target=>target.distance<=8).sort((a,b)=>a.distance-b.distance)[0];
    if(nearby)index=HistoryChart.nearestIndex(normalized,Date.parse(nearby.date));
    showIndex(index,event);
  }
  function hide(){pinned=false;tooltip.classList.remove('pinned');tooltip.hidden=true;$('#hover-line').setAttribute('visibility','hidden');$('#hover-dot').setAttribute('visibility','hidden');}
  tooltip.onclick=event=>{if(event.target.closest('[data-close-chart-detail]'))hide();};
  tooltip.onkeydown=event=>{if(event.key==='Escape'){hit.focus();hide();}};
  hit.addEventListener('pointermove',event=>hover(event));
  hit.addEventListener('pointerdown',event=>{hover(event,true);pinned=true;tooltip.classList.add('pinned');});
  hit.addEventListener('pointerleave',event=>{if(!pinned&&event.pointerType!=='touch'&&document.activeElement!==hit)hide();});
  hit.addEventListener('focus',()=>showIndex(activeIndex<0?0:activeIndex));
  hit.addEventListener('blur',()=>{if(!pinned)hide();});
  hit.addEventListener('keydown',event=>{
    if(event.key==='Escape'){hide();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();showIndex(activeIndex<0?0:activeIndex);pinned=true;tooltip.classList.add('pinned');return;}
    let index=activeIndex<0?0:activeIndex;
    if(event.key==='ArrowLeft')index--;else if(event.key==='ArrowRight')index++;else if(event.key==='Home')index=0;else if(event.key==='End')index=normalized.length-1;else return;
    event.preventDefault();showIndex(index);
  });

}

function downloadSnapshot() {
  if(!DATA)return;
  const rows=[['信号日','策略','ETF','目标资金权重','底层敞口倍数','原因']];
  DATA.strategies.forEach(s=>{[...s.holdings,{symbol:'BIL',weight:s.cash}].forEach(h=>rows.push([s.signalDate,displayName(s),h.symbol,pct(h.weight,4),s.exposure,s.summary]));});
  const csv='\uFEFF'+rows.map(row=>row.map(cell=>'"'+String(cell).replaceAll('"','""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`双模型策略_目标持仓_${DATA.meta.signalDate}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  $('#toast').textContent='已导出六种策略的目标持仓与依据';$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3000);
}


const readableTime = (iso) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return '未提供';
  return new Date(iso).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false, month:'2-digit', day:'2-digit',hour:'2-digit', minute:'2-digit', second:'2-digit' }) + ' 北京时间';
};
function renderMonitor() {
  const m=MONITOR;
  const status=m?.status || 'loading';
  const okay=['ok','healthy','current','synced'].includes(status);
  const degraded=['partial','degraded','blocked','stale','error','offline'].includes(status);
  $('#connection-badge').innerHTML=`<i></i> ${okay?'仓库已连接':degraded?'更新需关注':'正在连接仓库'}`;
  $('#connection-badge').classList.toggle('connection-degraded',degraded);
  $('#monitor-dot').className='monitor-live-dot '+(okay?'healthy':degraded?'degraded':'');
  $('#freshness-title').textContent=okay?'仓库已同步':degraded?'保留完整数据':'模型数据同步中';
  $('#last-checked').textContent=m?.checkedAt?`最近检查 ${readableTime(m.checkedAt)}`:'首次检查中';
  if (m?.sources?.length) $('#repo-status-grid').innerHTML=m.sources.map(source=>{
    const repo=source.repo || source.repository || (source.id==='credit'?'chaodu211-cell/ccc-spread':'chaodu211-cell/best-weights');
    const url=`https://github.com/${repo}`;
    const state=source.health || source.status || 'unknown';
    const healthy=['ok','healthy','current','synced'].includes(state);
    const sha=source.commitSHA || source.commitSha || source.sha;
    const date=source.observationDate || source.dataDate || source.asOf || source.signalDate || '未提供';
    return `<article class="repo-status"><div class="repo-heading"><a href="${url}" target="_blank" rel="noopener"><span class="github-mark">⌘</span>${escapeHTML(repo.split('/').at(-1))} ↗</a><span class="tag ${healthy?'green':'amber'}">${healthy?'已连接':state==='error'?'读取失败':'需关注'}</span></div><div class="repo-dates"><span>实际观察 / 信号日<strong>${escapeHTML(date)}</strong></span><span>仓库版本<strong>${sha?`<a href="${url}/commit/${encodeURIComponent(sha)}" target="_blank" rel="noopener">${escapeHTML(sha.slice(0,7))} ↗</a>`:'未读取'}</strong></span></div><p>${escapeHTML(source.message || source.note || source.detail || (healthy?'已读取上游发布数据':'保留最后可验证数据'))}</p></article>`;
  }).join('');
  const warnings=[...(m?.warnings || [])].map(w=>typeof w==='string'?w:(w.message||w.reason||JSON.stringify(w)));
  if(status==='loading')warnings.push('首次联网校验尚未完成，下方先展示已保存的完整结果。');
  $('#monitor-warnings').hidden=warnings.length===0;
  $('#monitor-warnings').innerHTML=warnings.map(w=>`<p>◷ ${escapeHTML(w)}</p>`).join('');
  $('#refresh-live').disabled=refreshing;
  $('#refresh-live').textContent=refreshing?'↻ 正在检查':'↻ 检查更新';
}
async function refreshLive() {
  if(refreshing)return;
  refreshing=true;renderMonitor();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
  try {
    const response=await fetch(RUNTIME.mode==='github-pages'?(RUNTIME.liveURL||'./daily-live.json'):'./api/live',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    if(!payload.data?.strategies?.length || !payload.monitor?.checkedAt)throw new Error('上游响应未通过结构校验');
    DATA=payload.data;MONITOR=payload.monitor;lastSuccessMonitor=MONITOR;
    $('#loading-error').hidden=true;
    try{localStorage.setItem('dual-model-last-verified',JSON.stringify({schema:1,data:DATA,monitor:MONITOR}));}catch{}
    init();
  } catch(error) {
    MONITOR={...(lastSuccessMonitor||MONITOR||{}),status:'error',checkedAt:new Date().toISOString(),warnings:[`本次仓库检查失败（${error.name==='AbortError'?'请求超时':error.message}）。保留最近完整结果；持仓日期不会前移。`]};
    renderMonitor();
  } finally {clearTimeout(timeout);refreshing=false;renderMonitor();}
}
async function bootstrap() {
  try {
    try{RUNTIME=await fetch('./runtime-config.json').then(r=>r.json());}catch{}
    const response=await fetch('./data.json');if(!response.ok)throw new Error('研究数据读取失败');
    const base=await response.json();DATA=base;
    try{const saved=JSON.parse(localStorage.getItem('dual-model-last-verified'));if(saved?.schema===1 && saved.data?.meta?.signalDate>=base.meta.signalDate){DATA=saved.data;lastSuccessMonitor=saved.monitor;MONITOR={...saved.monitor,status:'loading',warnings:['正在重新校验仓库，暂时显示此设备上次保存的结果。']};}}catch{}
    init();await refreshLive();
  }catch(error){$('#loading-error').hidden=false;$('#freshness-copy').textContent=error.message;}
}
bootstrap();
setInterval(()=>{if(!document.hidden)refreshLive();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive();});
