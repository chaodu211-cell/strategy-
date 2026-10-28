(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=value=>`${(value*100).toFixed(2).replace(/\.?0+$/,'')}%`;
  const names={conservative:'稳健',balanced:'均衡',aggressive:'进取'};
  const name=s=>`${s.family==='simple'?'简明':'拟合'}·${names[s.risk]}`;
  function buildContent(s){
    const active=(s.reasons||[]).filter(r=>r.active),holdings=s.holdings.map(h=>`${h.symbol} ${pct(h.weight)}`),cash=s.cash<0?`融资负债 ${pct(-s.cash)}`:`BIL ${pct(s.cash)}`;
    return `<section class="strategy-detail-section strategy-current"><div class="strategy-current-heading"><h3>当前目标仓位</h3><span>信号日 ${esc(s.signalDate)}</span></div><p class="strategy-current-holdings">${esc([...holdings,cash].join(' / '))}</p><p>底层敞口 <strong>${Number(s.exposure).toFixed(2)}倍</strong></p><p>${esc(s.summary)}</p><div class="strategy-current-formula">${esc(s.formula)}</div></section><section class="strategy-detail-section"><h3>当前依据</h3>${active.length?`<ul class="strategy-active-rules">${active.map(r=>`<li><strong>${esc(r.title)}</strong>：${esc(r.detail)}</li>`).join('')}</ul>`:'<p>当前未命中额外约束，按常态配置。</p>'}${s.liveStatus==='blocked'?`<p class="strategy-data-note">${esc(s.liveMessage||'数据尚未齐全，保留最后完整目标。')}</p>`:''}</section>`;
  }
  function attach(){
    const dialog=document.querySelector('#strategy-dialog'),body=document.querySelector('#strategy-dialog-body');let returnSelector=null;
    function close(){if(dialog.open)dialog.close();}
    dialog.querySelector('[data-close-strategy]').addEventListener('click',close);
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
    dialog.addEventListener('close',()=>{document.documentElement.classList.remove('strategy-dialog-open');if(returnSelector)document.querySelector(returnSelector)?.focus({preventScroll:true});});
    dialog.querySelector('[data-strategy-history]').addEventListener('click',()=>{close();document.querySelector('#history').scrollIntoView({behavior:'smooth',block:'start'});});
    return{open(s,selector){returnSelector=selector;document.querySelector('#strategy-dialog-title').textContent=name(s);document.querySelector('#strategy-dialog-description').textContent='当前仓位与生效依据';body.innerHTML=buildContent(s);body.scrollTop=0;if(!dialog.open)dialog.showModal();document.documentElement.classList.add('strategy-dialog-open');},close};
  }
  root.StrategyDetails=Object.freeze({buildContent,attach});
})(window);
