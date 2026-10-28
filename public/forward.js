(function(){
  'use strict';
  const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors=['#27755d','#b07a34','#a74b53','#497ea8','#8c6eaa','#4f8d8a','#202e39'];
  const title=s=>s.id.startsWith('fitted-')?'拟合·'+({conservative:'稳健',balanced:'均衡',aggressive:'进取'}[s.id.split('-')[1]]||s.name):s.name;
  const selected=new Set(),known=new Set();let data=null,index=0,focus=null;
  const svg=$('#forward-chart');
  function points(s){return s.points.length?s.points:[s.latest];}
  function draw(){
    if(!data)return;
    const strategies=data.strategies,series=strategies.filter(s=>selected.has(s.id));
    const dates=[...new Set(strategies.flatMap(s=>points(s).map(p=>p.date)))].sort();
    index=Math.max(0,Math.min(dates.length-1,index));
    const values=series.flatMap(s=>points(s).map(p=>p.nav));let lo=Math.min(.99,...values),hi=Math.max(1.01,...values),pad=(hi-lo)*.12;lo-=pad;hi+=pad;
    const X=d=>dates.length===1?530:70+dates.indexOf(d)/(dates.length-1)*870,Y=v=>275-(v-lo)/(hi-lo)*235;
    let html='';for(let k=0;k<=4;k++){const v=lo+(hi-lo)*k/4,y=Y(v);html+=`<line x1="70" y1="${y}" x2="940" y2="${y}" stroke="#e5e9e6"/><text x="57" y="${y+4}" text-anchor="end" fill="#76827d" font-size="12">${v.toFixed(3)}</text>`;}
    for(const s of series){const color=colors[strategies.indexOf(s)],ps=points(s);html+=`<path d="${ps.map((p,i)=>(i?'L':'M')+X(p.date)+','+Y(p.nav)).join(' ')}" fill="none" stroke="${color}" stroke-width="${s.id===focus?3:1.8}"/>`;html+=ps.map(p=>`<circle cx="${X(p.date)}" cy="${Y(p.nav)}" r="${ps.length===1?5:2}" fill="${color}"/>`).join('');}
    html+=`<line x1="${X(dates[index])}" x2="${X(dates[index])}" y1="32" y2="282" stroke="#89968f" stroke-dasharray="4 5"/><text x="70" y="310" fill="#76827d" font-size="12">${dates[0]}</text><text x="940" y="310" text-anchor="end" fill="#76827d" font-size="12">${dates.at(-1)}</text>`;
    svg.innerHTML=html;svg.setAttribute('aria-label',`从${data.startDate}开始的策略净值。当前查看${dates[index]}；方向键选择交易日。`);
    const strategy=strategies.find(s=>s.id===focus)||strategies[0],point=points(strategy).find(p=>p.date===dates[index]);
    $('#forward-detail').innerHTML=point?`<div class="forward-detail-heading"><strong>${esc(title(strategy))} · ${esc(point.date)}</strong><span>净值 ${point.nav.toFixed(6)}</span></div><p><b>${esc(point.state)}</b> · ${Object.entries(point.weights||{}).filter(([,w])=>Math.abs(w)>1e-8).map(([s,w])=>`${esc(s==='BIL'&&w<0?'融资负债':s)} ${(Math.abs(w)*100).toFixed(2)}%`).join(' / ')}</p><p>信号日 ${esc(point.signalDate||'待首个完整收盘')} · ${point.rebalanced?'收盘已调仓':'持仓估值 / 基准'}</p><div class="forward-reasons">${(point.reasons||[]).map(r=>'<p>'+esc(r)+'</p>').join('')}</div>`:'<p>该策略在此日尚无记录。</p>';
    $('#forward-date').textContent=dates[index];
  }
  function registrationPanel(){
    const current=data.strategies.find(s=>s.configSnapshot&&s.id.startsWith('custom-')),archives=data.archivedStrategies||[],host=$('#forward-registration');
    if(!current){host.hidden=true;return;}host.hidden=false;
    const c=current.configSnapshot,blue=c.rules.find(r=>r.id==='blue'),yellow=c.rules.find(r=>r.id==='yellow');
    const labels=Object.fromEntries(CustomBacktest.RULES.map(r=>[r.id,r.label]));
    const pct=x=>(x*100).toFixed(2).replace(/\.?0+$/,'')+'%',weights=w=>Object.entries(w||{}).filter(([,v])=>Math.abs(v)>1e-8).map(([k,v])=>esc(k==='BIL'&&v<0?'融资负债':k)+' '+pct(Math.abs(v))).join(' / ');
    const local=d=>d?new Date(d).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'初始登记';
    host.innerHTML=`<details><summary><strong>${esc(current.name)}</strong> · 登记参数与版本记录</summary><p class="forward-meta">登记时间 ${esc(local(current.registeredAt))}（北京时间） · 起点交易日 ${esc(current.startDate)} · 净值基准1。登记后的首个完整收盘继承当时已观测目标，后续累计收益。参数版本 ${esc(current.configVersion.slice(0,12))}。</p><div class="forward-config-grid"><span>常态底层 <b>${esc(c.asset==='momentum'?'动量 QQQ / SOXX':c.asset)}</b></span><span>常态敞口 <b>${esc(c.baseExposure)}倍</b></span><span>再平衡带 <b>${pct(c.band).replace('%','')}个百分点</b></span><span>融资年利率 <b>5%</b></span><span>原成本倍数 <b>${esc(c.costMultiplier)}</b></span><span>熊市闸门 <b>${c.bearGateEnabled?'开启':'关闭'}</b></span><span>历史合成序列 <b>${c.allowSynthetic?'允许':'关闭'}</b></span></div><p class="forward-meta">蓝点标的 ${esc(blue.asset==='inherit'?'跟随常态':blue.asset==='momentum'?'动量 QQQ / SOXX':blue.asset)} · 目标上限 ${esc(blue.value)}倍 · 分${esc(blue.steps)}次 · ${esc(blue.days)}交易日窗口 · 敞口比较${blue.onlyIfNotLower?'开启':'关闭'}。黄点解锁：${[yellow.unlock.tdcEnabled?'TDC＜'+yellow.unlock.tdcThreshold:'',yellow.unlock.priceEnabled?'QQQ距52周高点不超过'+yellow.unlock.repairPct+'%':'',yellow.unlock.blueEnabled?'实心蓝点永久解锁':''].filter(Boolean).map(esc).join(' / ')}。</p><div class="table-scroll"><table><thead><tr><th>信号</th><th>操作</th><th>敞口 / 乘数</th><th>有效期</th><th>优先级</th></tr></thead><tbody>${c.rules.map(r=>`<tr><td>${esc(labels[r.id]||r.id)}</td><td>${esc(CustomBacktest.ACTIONS[r.action])}${r.stackWithCredit?' · 与信用状态累乘':''}</td><td>${['flat','ignore'].includes(r.action)?'—':esc(r.value)}</td><td>${r.id==='yellow'?'条件解锁':['ccc_stress','ccc_above'].includes(r.id)?'条件保持':esc(r.days)+'交易日'}</td><td>${esc(r.priority)}</td></tr>`).join('')}</tbody></table></div><p class="forward-meta">来源 ${esc(current.sourceSettingsFile||'仓库登记配置')}。${current.pending?'下一目标：'+weights(current.pending.weights)+'；信号日 '+esc(current.pending.signalDate)+'，实际登记目标时间 '+esc(local(current.pending.observedAt))+'。':''} <a href="https://github.com/chaodu211-cell/strategy-/blob/main/tracking/config.json" target="_blank" rel="noopener">查看完整登记配置 ↗</a></p>${archives.length?`<details class="forward-archive"><summary>已归档的自定义版本（${archives.length}）</summary>${archives.map(s=>`<p class="forward-meta"><b>${esc(s.name)}</b> · ${s.points.length}个已记录收盘 · 归档 ${esc(local(s.archivedAt))}（北京时间）。旧记录保留原参数与原净值。</p><div class="table-scroll"><table><thead><tr><th>估值日</th><th>净值</th><th>持仓</th><th>状态</th></tr></thead><tbody>${s.points.map(p=>`<tr><td>${esc(p.date)}</td><td>${p.nav.toFixed(6)}</td><td>${weights(p.weights)}</td><td>${esc(p.state)}</td></tr>`).join('')}</tbody></table></div>`).join('')}<p class="forward-meta"><a href="./forward.json" target="_blank" rel="noopener">查看完整账本与历史依据 ↗</a></p></details>`:''}</details>`;
  }
  function render(payload){
    data=payload;const status=data.status||{},okay=status.status==='ok';
    $('#forward-status').textContent=status.message||'等待首次更新';$('#forward-status').className='tag '+(okay?'green':'amber');
    $('#forward-updated').textContent=`跟踪起点 ${data.startDate} · 最近尝试 ${status.checkedAt?new Date(status.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'待更新'}（北京时间）`;
    $('#forward-warning').textContent=(status.warnings||[]).join(' ');$('#forward-warning').hidden=!(status.warnings||[]).length;
    for(const s of data.strategies){if(!known.has(s.id))selected.add(s.id);known.add(s.id);}
    if(!data.strategies.some(s=>s.id===focus))focus=data.strategies.find(s=>s.id.startsWith('custom-'))?.id||data.strategies[0].id;
    registrationPanel();
    $('#forward-legend').innerHTML=data.strategies.map((s,i)=>`<label><input type="checkbox" value="${esc(s.id)}" ${selected.has(s.id)?'checked':''}><i style="background:${colors[i]}"></i>${esc(title(s))}</label>`).join('');
    $('#forward-legend').querySelectorAll('input').forEach(el=>el.addEventListener('change',()=>{if(el.checked)selected.add(el.value);else selected.delete(el.value);draw();}));
    $('#forward-strategy').innerHTML=data.strategies.map(s=>`<option value="${esc(s.id)}">${esc(title(s))}</option>`).join('');$('#forward-strategy').value=focus;
    $('#forward-table').innerHTML=data.strategies.map(s=>{const p=s.latest;return`<tr><td>${esc(title(s))}</td><td><strong>${p.nav.toFixed(6)}</strong></td><td>${s.baselinePending?'等待首个完整收盘':esc(p.date)}</td><td>${Object.entries(p.weights||{}).filter(([,w])=>Math.abs(w)>1e-8).map(([k,v])=>`${esc(k==='BIL'&&v<0?'融资负债':k)} ${(Math.abs(v)*100).toFixed(1)}%`).join(' / ')}</td><td>${esc(s.pending?.signalDate||'尚无完整目标')}</td></tr>`;}).join('');
    index=new Set(data.strategies.flatMap(s=>points(s).map(p=>p.date))).size-1;draw();
  }
  async function refresh(){
    try{const cfg=await fetch('./runtime-config.json').then(r=>r.json());const response=await fetch(cfg.forwardURL||'./forward.json',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const value=await response.json();if(value.schemaVersion!==1||!value.strategies?.length)throw new Error('账本格式无效');render(value);}
    catch(error){try{if(!data){const fallback=await fetch('./forward.json').then(r=>r.json());render(fallback);}}catch{}$('#forward-warning').hidden=false;$('#forward-warning').textContent='暂未读到 GitHub 最新账本（'+error.message+'），显示本次部署保存的状态。';}
  }
  svg.addEventListener('pointermove',e=>{if(!data)return;const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*1000;const n=new Set(data.strategies.flatMap(s=>points(s).map(p=>p.date))).size;index=Math.round(Math.max(0,Math.min(1,(x-70)/870))*(n-1));draw();});
  svg.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();index=e.key==='Home'?0:e.key==='End'?1e9:index+(e.key==='ArrowRight'?1:-1);draw();});
  $('#forward-strategy').addEventListener('change',e=>{focus=e.target.value;draw();});$('#forward-refresh').addEventListener('click',refresh);
  refresh();setInterval(()=>{if(!document.hidden)refresh();},300000);
})();
