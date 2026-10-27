(function(root){
  'use strict';
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>String(Number(Number(value).toFixed(3)));
  const percent=value=>`${(value*100).toFixed(Math.abs(value*100-Math.round(value*100))<.001?0:2)}%`;
  const names={conservative:'稳健',balanced:'均衡',aggressive:'进取'};
  const name=s=>`${s.family==='simple'?'简明':'拟合'}·${names[s.risk]}`;
  const holdingList=s=>[...s.holdings.map(h=>`${h.symbol} ${percent(h.weight)}`),`BIL ${percent(s.cash)}`].join(' / ');
  const shortText=(e,p)=>e?`${p.short_inst} ${percent(e/(p.short_inst==='PSQ'?1:3))}，对应 ${num(e)} 倍纳指空头，余款进入 BIL`:'权益清仓，持有100% BIL';
  const row=(label,body)=>`<div class="strategy-rule-row"><dt>${esc(label)}</dt><dd>${esc(body)}</dd></div>`;
  function ruleRows(s,p){
    const rules=[];
    rules.push(['选品',p.pick==='switch'?'每月第一个交易日，比较 QQQ 与 SOXX 从第126至第21个交易日前的涨幅（剔除最近一月），持有动量更高的底层。':'固定使用 QQQ 对应的纳指底层，不在纳指与半导体之间切换。']);
    rules.push(['常态敞口',`常态底层敞口 ${num(p.lev_max)} 倍；${p.vol_tgt===null?'不启用额外的波动目标缩放。':`再按 ${percent(p.vol_tgt)} 的年化波动目标缩放，上限 ${num(p.lev_max)} 倍。`}`]);
    rules.push(['红点规则',`只认${p.use_ad?'实心或空心红点':'实心红点，忽略空心红点'}。触发日起 ${p.red_hold} 个交易日内，常态敞口乘 ${num(p.red_mult)}。${p.short_red?`多头乘数归零时，持有 ${shortText(p.short_red,p)}。`:'多头乘数归零时持有 BIL，不建立空头。'}`]);
    rules.push(['黄点锁仓',`黄点亮起即进入锁仓；锁仓配置为${shortText(p.short_yellow,p)}。${p.yellow_lock?'满足任一条件解锁：TDC < '+num(p.rearm)+'、QQQ 收复至距52周高点 '+percent(Math.abs(p.rec_unlock))+' 以内'+(p.blue_unlock?'，或出现实心蓝点':'')+'。':'本档未启用黄点锁仓。'}`]);
    rules.push(['CCC 高于均线',`采用策略口径的滞后利差值，高于自身200日均线时，常态敞口乘 ${num(p.ccc_up_mult)}${p.ccc_up_mult===1?'（本档不因此单独减仓）':''}。`]);
    rules.push(['CCC 压力阶段',`252日历史分位达到或超过95时，常态敞口乘 ${num(p.ccc_stress_mult)}${p.ccc_stress_mult===0?'（常态多头归零）':p.ccc_stress_mult===1?'（本档不额外减仓）':''}。历史分位不是下跌概率。`]);
    rules.push(['CCC 见顶预警',p.ccc_top_hold?`预警触发日起 ${p.ccc_top_hold} 个交易日内，常态敞口再乘 ${num(p.ccc_top_mult)}。`:'本档不启用 CCC 见顶预警后的减仓窗口。']);
    rules.push(['蓝点与抄底',p.blue_hold?`实心蓝点后 ${p.blue_hold} 个交易日内，买入 ${p.blue_asset} 底层；目标上限 ${num(p.blue_lev)} 倍，按窗口内蓝点天数分 ${p.blue_k} 次加满${p.soft_mult===0?'，空心蓝点不计入':''}。${p.blue_gate_vol?`再乘 min(1，${percent(p.blue_gate_vol)} ÷ 10日年化已实现波动率)。`:''}只有抄底敞口不小于当天常态/锁仓敞口时，才按抄底配置执行。`:`不以蓝点主动抄底或加仓。${p.blue_unlock?'实心蓝点可解除黄点锁定，但仍需服从红点窗口和 CCC 约束。':''}`]);
    rules.push(['熊市闸门',p.bear_mult===1?'本档不因熊市条件单独减少敞口。':`QQQ 低于200日均线，且该均线低于21个交易日前的水平时，常态敞口乘 ${num(p.bear_mult)}。`]);
    rules.push(['组合回撤闸',p.dd_brake?`策略自身近似净值相对历史高点的回撤达到 ${percent(p.dd_brake[0])} 时，常态敞口再乘 ${num(p.dd_brake[1])}；回撤收窄到 ${percent(p.dd_brake[0]/2)} 以内时解除。它依赖组合实际路径，不是指数回撤。`:'本档不额外设置组合净值回撤闸。']);
    rules.push(['CCC 见底与现金',`${p.ccc_bot_hold?`见底预警后 ${p.ccc_bot_hold} 日内，抄底敞口至少 ${num(p.ccc_bot_lev)} 倍。`:'本档不使用 CCC 见底预警主动抄底。'}剩余资金按 BIL 现金类工具处理。`]);
    return rules;
  }
  function buildContent(s,p){
    const steady=s.risk==='conservative',simple=s.family==='simple';
    const normalTool=steady?(p.pick==='switch'?'选中 QQQ 或 SOXX，资金权重100%':'QQQ 资金权重100%'):`${p.pick==='switch'?'选中纳指时用 TQQQ，选中半导体时用 SOXL':'TQQQ'}，资金权重 ${percent(p.lev_max/3)}，BIL ${percent(1-p.lev_max/3)}`;
    const rules=ruleRows(s,p);
    const active=s.reasons.filter(r=>r.active&&r!==s.reasons[0]);
    const warning=s.liveStatus==='blocked'?`<p class="strategy-data-note">${esc(s.liveMessage||'输入尚未齐全，保留最后完整目标。')}</p>`:'';
    return `<div class="strategy-stat-grid"><div><span>常态底层敞口</span><strong>${num(p.lev_max)}×</strong></div><div><span>参数筛选回撤预算</span><strong>${percent(s.budget)}</strong></div><div><span>当前底层敞口</span><strong>${Number(s.exposure).toFixed(2)}×</strong></div></div>
      <section class="strategy-detail-section"><h3>策略思路</h3><p>${simple?'保留四条核心规则：常态持有纳指、信用利差高于均线减半、红点窗口离场、黄点触发锁仓。三档共用规则，主要区别是常态敞口。':'每月在纳指与半导体之间按动量选品，叠加红黄蓝点、CCC 信用约束与本档风控。各档参数分别选定，并非只调整一个杠杆。'}</p><p>最优拟合负责择时，CCC 利差调节风险；不使用盈利修正模型。</p></section>
      <section class="strategy-detail-section"><h3>工具与常态配置</h3><p>${esc(normalTool)}。这是未触发风控时的常态配置，当前仓位见下方。</p><p>${steady?'本档只使用1倍多头产品；当前选定规则不建立空头。':'使用每日杠杆 ETF 实现目标敞口；产品倍数描述每日目标，不能直接乘到长期涨幅。'}资金权重 = 目标底层敞口 ÷ 产品倍数，余款持有 BIL。</p></section>
      <section class="strategy-detail-section"><h3>完整交易规则</h3><dl class="strategy-rule-list">${rules.map(([label,body])=>row(label,body)).join('')}</dl></section>
      <section class="strategy-detail-section"><h3>规则如何组合</h3><ol class="strategy-priority"><li>先更新红点窗口、黄点锁定与解除条件。</li><li>未锁仓时，将红点、CCC、熊市与回撤闸的常态乘数相乘；锁仓时采用本档专用现金/空头配置。</li><li>${p.blue_hold?'计算蓝点抄底敞口；若大于或等于常态/锁仓敞口，则由抄底配置覆盖，否则保留常态/锁仓配置。':'本档不启用主动抄底，按常态或锁仓规则执行。'}</li><li>将最终敞口换算成可交易 ETF 权重，余款配置 BIL。</li></ol></section>
      <section class="strategy-detail-section strategy-current"><div class="strategy-current-heading"><h3>当前执行结果</h3><span>信号日 ${esc(s.signalDate)}</span></div><p class="strategy-current-holdings">${esc(holdingList(s))}</p><p>${esc(s.summary)}</p><div class="strategy-current-formula">${esc(s.formula)}</div>${active.length?`<ul class="strategy-active-rules">${active.map(r=>`<li><strong>${esc(r.title)}</strong>：${esc(r.detail)}</li>`).join('')}</ul>`:'<p>当前未命中额外减仓或离场条件。</p>'}${warning}</section>
      <section class="strategy-detail-section"><h3>成交与再平衡</h3><p>t 日收盘后判定信号，t+1 交易日收盘成交；CCC 侧在回测与计算中另滞后一个交易日。任一资产权重偏离目标超过5个百分点，或持仓品种进入/退出时，按目标再平衡。</p><p class="strategy-research-note">回撤预算是参数筛选条件，不是未来回撤上限。历史十年结果属于样本内，2007–16只属半样本外；当前执行结果是模型目标仓位，不是账户实际持仓。</p></section>`;
  }
  function attach(){
    const dialog=document.querySelector('#strategy-dialog'),body=document.querySelector('#strategy-dialog-body');
    let returnSelector=null,requestId=0,registryPromise;
    const registry=()=>registryPromise||(registryPromise=fetch('./strategy-rules.json').then(r=>{if(!r.ok)throw new Error('规则文件读取失败');return r.json();}).then(d=>{if(d.schemaVersion!==1||!d.strategies)throw new Error('规则格式无效');return d.strategies;}).catch(error=>{registryPromise=null;throw error;}));
    function close(){if(dialog.open)dialog.close();}
    dialog.querySelector('[data-close-strategy]').addEventListener('click',close);
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
    dialog.addEventListener('close',()=>{requestId++;document.documentElement.classList.remove('strategy-dialog-open');if(returnSelector)document.querySelector(returnSelector)?.focus({preventScroll:true});});
    dialog.querySelector('[data-strategy-history]').addEventListener('click',()=>{close();document.querySelector('#history').scrollIntoView({behavior:'smooth',block:'start'});});
    return {open(s,selector){
      const id=++requestId;returnSelector=selector;
      document.querySelector('#strategy-dialog-title').textContent=name(s);
      document.querySelector('#strategy-dialog-description').textContent=`${simpleLabel(s)} · 完整规则、配置方式与当前执行依据`;
      body.innerHTML='<p class="strategy-loading" role="status">正在载入本策略的完整规则…</p>';
      body.scrollTop=0;if(!dialog.open)dialog.showModal();document.documentElement.classList.add('strategy-dialog-open');
      registry().then(config=>{if(id!==requestId||!dialog.open)return;if(!config[s.id])throw new Error('未找到这套策略的参数');body.innerHTML=buildContent(s,config[s.id]);body.scrollTop=0;}).catch(error=>{if(id!==requestId||!dialog.open)return;body.innerHTML=`<p class="strategy-loading">完整规则暂时无法读取，请关闭后重试。</p><dl class="strategy-rule-list">${s.rules.map(r=>row(r.label,r.detail)).join('')}</dl>`;});
    },close};
  }
  function simpleLabel(s){return `${s.family==='simple'?'简明版':'拟合版'} / ${names[s.risk]}`;}
  root.StrategyDetails=Object.freeze({ruleRows,buildContent,attach});
})(window);
