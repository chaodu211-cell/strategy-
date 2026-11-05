(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=value=>`${(value*100).toFixed(2).replace(/\.?0+$/,'')}%`;
  const num=value=>String(Number(Number(value).toFixed(6)));
  const names={conservative:'稳健',balanced:'均衡',aggressive:'进取'};
  const name=s=>`${s.family==='simple'?'简明':'拟合'}·${names[s.risk]}`;
  function ruleRows(s,p){
    const short=e=>e>0?`持有 ${num(e)} 倍纳指反向敞口，使用 ${p.short_inst}，资金权重为 ${pct(e/(p.short_inst==='PSQ'?1:3))}，余下配置 BIL。`:'权益敞口归零，配置 BIL。';
    const factor=m=>m===1?'不调整常态敞口（乘数 1）。':`常态敞口乘 ${num(m)}${m===0?'，普通多头敞口归零':''}。`;
    const unlock=[`TDC < ${num(p.rearm)}`,p.rec_unlock!==null?`QQQ 收盘距近 252 个交易日高点不超过 ${pct(-p.rec_unlock)}`:null,p.blue_unlock?'出现实心蓝点':null,p.ccc_bot_release?'出现 CCC 见底预警':null].filter(Boolean).join('，或');
    return [
      ['常态选品与敞口',`${p.pick==='switch'?'每月首个交易日比较 QQQ 与 SOXX 剔除最近 21 个交易日的 126 日动量，选较强者；相同则保留原选择。':`固定使用 ${p.pick} 底层。`}常态基准 ${num(p.lev_max)} 倍底层敞口。`],
      ['红点减仓',`${p.use_ad?'实心或空心红点':'仅实心红点'}触发 ${p.red_hold} 个交易日窗口（含触发日），再次触发重新计时；窗口内${factor(p.red_mult)}${p.use_ad?'':'空心红点不触发该窗口。'}${p.red_mult===0?short(p.short_red):`若叠加其它条件后乘数归零，${short(p.short_red)}`}`],
      ['黄点锁仓与解锁',p.yellow_lock?`黄点触发锁仓；锁仓时${short(p.short_yellow)}解锁条件为：${unlock}，任一满足即可解除并维持解锁，直到再次出现黄点；不设固定持有天数。同日同时出现蓝点和黄点，最终仍为锁仓。`:'不启用黄点锁仓。'],
      ['蓝点分批抄底',p.blue_hold>0?`最近 ${p.blue_hold} 个交易日内（含当日），按实心蓝点天数 N 计算：${num(p.blue_lev)} × min(1, N / ${p.blue_k}) 倍 ${p.blue_asset} 底层敞口；累计 ${p.blue_k} 天达到配置上限，旧蓝点移出窗口后重新计算。${p.soft_mult>0?`空心蓝点按 ${num(p.soft_mult)} 天折算。`:'空心蓝点不计入分批次数。'}仅当抄底敞口 > 0 且不低于当天常态／锁仓敞口时才覆盖，否则按常态／锁仓执行。`:'不启用蓝点分批抄底；实心蓝点仍可按黄点解锁规则解除锁仓。'],
      ['抄底波动限制',p.blue_hold>0&&p.blue_gate_vol?`抄底敞口再乘 min(1, ${pct(p.blue_gate_vol)} / ${p.blue_asset} 的 10 日年化实现波动率)，波动率高于 ${pct(p.blue_gate_vol)} 时缩减。`:'不启用抄底波动限制。'],
      ['CCC 高于 200 日线',`CCC 利差高于其自身 200 日均线时，${factor(p.ccc_up_mult)}`],
      ['信用压力',`CCC 利差的 252 日历史分位 ≥ 95 时，${factor(p.ccc_stress_mult)}`],
      ['CCC 见顶预警',p.ccc_top_hold>0?`见顶预警后 ${p.ccc_top_hold} 个交易日（含触发日），${factor(p.ccc_top_mult)}再次预警重新计时，可与其它常态乘数累乘。`:'不响应 CCC 见顶预警。'],
      ['CCC 见底预警',p.ccc_bot_hold>0?`见底预警后 ${p.ccc_bot_hold} 个交易日，抄底敞口至少为 ${num(p.ccc_bot_lev)} 倍，与蓝点抄底取较大值。${p.ccc_bot_release?'同时解除黄点锁仓。':'不解除黄点锁仓。'}`:`不启用 CCC 见底抄底。${p.ccc_bot_release?'见底预警可解除黄点锁仓。':'见底预警也不解除黄点锁仓。'}`],
      ['熊市闸门',`QQQ 收盘低于自身 200 日均线，且该均线低于 21 个交易日前的值时，${factor(p.bear_mult)}仅作用于常态通道；不替代黄点锁仓配置，符合条件的蓝点抄底仍可覆盖。`],
      ['组合回撤闸',p.dd_brake?`按原引擎上一日目标权重与实际 ETF 日收益累计的内部参考净值，距历史高点回撤达到 ${pct(p.dd_brake[0])} 时，常态敞口再乘 ${num(p.dd_brake[1])}；回撤修复至 ${pct(p.dd_brake[0]/2)} 以内时解除。`:'不启用组合回撤闸。'],
      ['持仓工具与成交',`${s.risk==='conservative'?'多头仅使用 1 倍 QQQ／SOXX。':'多头优先使用该底层最高倍数的可交易 ETF：QQQ 对应 TQQQ → QLD → QQQ，SOXX 对应 SOXL → USD → SOXX。'}资金权重 = 目标底层敞口 ÷ 工具倍数，单个工具最多配置 100%，余下配置 BIL。t 日收盘信号于下一交易日收盘执行；CCC 数据按原模型滞后一个交易日使用。`]
    ];
  }
  function rulesContent(s,p){
    return `<section class="strategy-detail-section"><h3>具体策略规则</h3><dl class="strategy-rule-list">${ruleRows(s,p).map(([title,detail])=>`<div class="strategy-rule-row"><dt>${esc(title)}</dt><dd>${esc(detail)}</dd></div>`).join('')}</dl></section><section class="strategy-detail-section"><h3>规则如何组合</h3><ol class="strategy-priority"><li>先计算常态／锁仓敞口：黄点锁仓时采用该档锁仓配置；未锁仓时，常态基准乘以所有命中的红点、CCC、熊市和回撤闸乘数。</li><li>常态乘数归零时：红点窗口内按该档红点反向配置，否则持有 BIL。常态规则之间累乘，不按自定义策略的优先级选单一规则。</li><li>单独计算蓝点抄底；抄底敞口为正且 ≥ 常态／锁仓敞口时优先执行，因此也可能覆盖 BIL 或反向仓位。</li><li>最后将底层敞口换算为 ETF 资金权重。上方“当前目标仓位”显示的是本策略最新信号日的计算结果。</li></ol></section>`;
  }
  function buildContent(s,p){
    const active=(s.reasons||[]).filter(r=>r.active),holdings=s.holdings.map(h=>`${h.symbol} ${pct(h.weight)}`),cash=s.cash<0?`融资负债 ${pct(-s.cash)}`:`BIL ${pct(s.cash)}`;
    return `<section class="strategy-detail-section strategy-current"><div class="strategy-current-heading"><h3>当前目标仓位</h3><span>信号日 ${esc(s.signalDate)}</span></div><p class="strategy-current-holdings">${esc([...holdings,cash].join(' / '))}</p><p>底层敞口 <strong>${Number(s.exposure).toFixed(2)}倍</strong></p><p>${esc(s.summary)}</p><div class="strategy-current-formula">${esc(s.formula)}</div></section><section class="strategy-detail-section"><h3>当前依据</h3>${active.length?`<ul class="strategy-active-rules">${active.map(r=>`<li><strong>${esc(r.title)}</strong>：${esc(r.detail)}</li>`).join('')}</ul>`:'<p>当前未命中额外约束，按常态配置。</p>'}${s.liveStatus==='blocked'?`<p class="strategy-data-note">${esc(s.liveMessage||'数据尚未齐全，保留最后完整目标。')}</p>`:''}</section>${p?rulesContent(s,p):''}`;
  }
  let registryPromise;
  function loadRules(){
    if(!registryPromise)registryPromise=fetch('./strategy-rules.json?v=20261105-details').then(r=>{if(!r.ok)throw new Error('策略参数读取失败');return r.json();}).then(data=>{if(data.schemaVersion!==1||!data.strategies)throw new Error('策略参数格式无效');return data.strategies;}).catch(error=>{registryPromise=null;throw error;});
    return registryPromise;
  }
  function attach(){
    const dialog=document.querySelector('#strategy-dialog'),body=document.querySelector('#strategy-dialog-body');let returnSelector=null,request=0;
    async function show(s){
      const token=++request;
      body.innerHTML=buildContent(s)+'<p class="strategy-loading" role="status">正在读取本策略的具体规则…</p>';body.scrollTop=0;
      try{const rules=await loadRules();if(!rules[s.id])throw new Error('缺少本策略参数');if(token===request&&dialog.open)body.innerHTML=buildContent(s,rules[s.id]);}
      catch(error){if(token!==request||!dialog.open)return;body.innerHTML=buildContent(s)+'<section class="strategy-detail-section"><p class="strategy-data-note" role="status">具体策略规则暂未读取成功。</p><button class="button" data-retry-strategy>重新读取策略规则</button></section>';body.querySelector('[data-retry-strategy]').addEventListener('click',()=>show(s));}
    }
    function close(){if(dialog.open)dialog.close();}
    dialog.querySelector('[data-close-strategy]').addEventListener('click',close);
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
    dialog.addEventListener('close',()=>{request++;document.documentElement.classList.remove('strategy-dialog-open');if(returnSelector)document.querySelector(returnSelector)?.focus({preventScroll:true});});
    dialog.querySelector('[data-strategy-history]').addEventListener('click',()=>{close();document.querySelector('#history').scrollIntoView({behavior:'smooth',block:'start'});});
    return{open(s,selector){returnSelector=selector;document.querySelector('#strategy-dialog-title').textContent=name(s);document.querySelector('#strategy-dialog-description').textContent='具体策略规则 · 当前仓位与依据';if(!dialog.open)dialog.showModal();document.documentElement.classList.add('strategy-dialog-open');return show(s);},close};
  }
  root.StrategyDetails=Object.freeze({buildContent,ruleRows,attach});
})(window);
