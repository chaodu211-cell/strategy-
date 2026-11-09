/* Causal, deterministic custom rules. All inputs are from the frozen research panel. */
(function(root){
  'use strict';
  const RULES=Object.freeze([
    {id:'red',label:'实心红点',group:'最优拟合',days:30,priority:80,action:'flat',value:0},
    {id:'red_ad',label:'空心红点',group:'最优拟合',days:30,priority:75,action:'flat',value:0},
    {id:'blue',label:'实心蓝点',group:'最优拟合',days:40,priority:95,action:'blue_ladder',value:1,steps:10},
    {id:'blue_soft',label:'空心蓝点',group:'最优拟合',days:20,priority:20,action:'ignore',value:1},
    {id:'yellow',label:'黄点预警',group:'最优拟合',conditional:true,priority:90,action:'flat',value:0},
    {id:'ccc_top',label:'CCC 见顶预警',group:'CCC 利差',days:63,priority:60,action:'scale',value:.5},
    {id:'ccc_bot',label:'CCC 见底预警',group:'CCC 利差',days:20,priority:40,action:'ignore',value:1},
    {id:'ccc_stress',label:'信用压力（分位≥95）',group:'CCC 利差',state:true,days:1,priority:70,action:'scale',value:.5},
    {id:'ccc_above',label:'利差高于200日线',group:'CCC 利差',state:true,days:1,priority:50,action:'scale',value:.5},
  ].map(Object.freeze));
  const ACTIONS=Object.freeze({ignore:'不响应',flat:'清仓至 BIL',long:'指定多头敞口',short:'指定纳指空头',scale:'常态敞口 × 乘数',blue_ladder:'蓝点分批建仓'});
  const copy=x=>JSON.parse(JSON.stringify(x));
  const sum=a=>a.reduce((s,x)=>s+x,0);
  const number=x=>Number.isFinite(x)?Number(x.toFixed(6)).toString():'—';
  const FINANCING_RATE=.05;
  const DATE=/^\d{4}-\d{2}-\d{2}$/;
  const yellowDefaults=()=>({tdcEnabled:true,tdcThreshold:60,priceEnabled:true,repairPct:3,blueEnabled:true});
  const MOMENTUM={
    lookback:126,skip:21,frequency:'monthly',buffer:0,
    weakness:{short:21,long:63,frequency:'weekly'},
    longBond:{series:'DGS30',lag:1,lookback:126,onBp:50,offBelowBp:40}
  };
  const momentumDefaults=()=>copy(MOMENTUM);
  function usesMomentum(cfg){
    const blue=cfg.rules[2];
    return cfg.asset==='momentum'||(blue.action==='blue_ladder'&&blue.asset==='momentum');
  }
  function defaults(){return {schemaVersion:1,name:'我的双模型策略',start:'2016-10-21',end:'2026-10-22',asset:'QQQ',bearGateEnabled:false,drawdownGateEnabled:false,cccStressBlueLimitEnabled:false,momentum:momentumDefaults(),baseExposure:1,allowSynthetic:false,band:.05,costMultiplier:1,financingAnnualRate:FINANCING_RATE,rules:RULES.map(r=>({id:r.id,action:r.action,value:r.value,...(r.conditional?{unlock:yellowDefaults()}:{days:r.days}),priority:r.priority,...(r.id==='ccc_top'?{stackWithCredit:true}:{}),...(r.id==='blue'?{steps:r.steps,onlyIfNotLower:true,asset:'inherit'}:{})}))};}
  function validate(input,data){
    if(!input||input.schemaVersion!==1)throw new Error('自定义设置版本无效。');
    const c=copy(input);
    if(typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>40)throw new Error('策略名称请填写1–40个字符。');
    c.name=c.name.trim();c.financingAnnualRate=FINANCING_RATE;delete c.toolMode;
    c.bearGateEnabled=c.bearGateEnabled===undefined?(c.bear200Enabled===undefined?false:c.bear200Enabled):c.bearGateEnabled;
    if(typeof c.bearGateEnabled!=='boolean')throw new Error('熊市闸门开关无效。');
    c.cccStressBlueLimitEnabled=c.cccStressBlueLimitEnabled===undefined?false:c.cccStressBlueLimitEnabled;
    if(typeof c.cccStressBlueLimitEnabled!=='boolean')throw new Error('CCC压力位蓝点限制开关无效。');
    c.drawdownGateEnabled=c.drawdownGateEnabled===undefined?false:c.drawdownGateEnabled;
    if(typeof c.drawdownGateEnabled!=='boolean')throw new Error('回撤闸开关无效。');
    delete c.bear200Enabled;
    for(const key of ['start','end'])if(!DATE.test(c[key]||'')||!Number.isFinite(Date.parse(c[key]))||new Date(c[key]+'T00:00:00Z').toISOString().slice(0,10)!==c[key])throw new Error('请选择有效的回测起止日期。');
    if(c.start>c.end||c.start<(data?.meta.start||'2007-01-03')||c.end>(data?.meta.end||'2026-10-22'))throw new Error(`回测日期须在 ${data?.meta.start||'2007-01-03'} 至 ${data?.meta.end||'2026-10-22'} 之间，且结束日不早于开始日。`);
    if(!['QQQ','SOXX','momentum'].includes(c.asset)||typeof c.allowSynthetic!=='boolean')throw new Error('常态底层设置无效。');
    const bound=(x,min,max,label,integer=false)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max||(integer&&!Number.isInteger(x)))throw new Error(`${label}须为 ${min}–${max}${integer?' 的整数':' 之间的数值'}。`);};
    bound(c.baseExposure,0,3,'常态敞口');bound(c.band,0,.25,'再平衡带');bound(c.costMultiplier,0,5,'成本倍数');
    if(!Array.isArray(c.rules)||c.rules.length!==RULES.length||new Set(c.rules.map(r=>r.id)).size!==RULES.length)throw new Error('每个预警须有且仅有一条设置。');
    c.rules=RULES.map(r=>{
      const rule=c.rules.find(x=>x.id===r.id);if(!rule||!Object.hasOwn(ACTIONS,rule.action))throw new Error(`${r.label}操作无效。`);
      if(rule.action==='blue_ladder'&&r.id!=='blue')throw new Error('分批建仓只适用于实心蓝点。');
      if(rule.action==='blue_ladder'){if(typeof rule.value!=='number'||!Number.isFinite(rule.value)||rule.value<0)throw new Error('蓝点 x 须为非负有限数，不设人为上限。');}
      else bound(rule.value,0,3,r.label+'敞口/乘数');if(!r.conditional)bound(rule.days,1,252,r.label+'持续交易日',true);bound(rule.priority,1,99,r.label+'优先级',true);
      const steps=rule.steps===undefined?10:rule.steps;
      if(r.id==='blue')bound(steps,1,252,'蓝点分批数 n',true);
      const onlyIfNotLower=rule.onlyIfNotLower===undefined?true:rule.onlyIfNotLower;
      if(r.id==='blue'&&typeof onlyIfNotLower!=='boolean')throw new Error('蓝点敞口比较开关无效。');
      const stackWithCredit=rule.stackWithCredit===undefined?true:rule.stackWithCredit;
      if(r.id==='ccc_top'&&typeof stackWithCredit!=='boolean')throw new Error('CCC见顶累乘开关无效。');
      const asset=rule.asset??'inherit';
      if(r.id==='blue'&&!['inherit','momentum','QQQ','SOXX'].includes(asset))throw new Error('蓝点分批标的须为动量、QQQ、SOXX或跟随常态。');
      let unlock;
      if(r.conditional){
        if(rule.unlock!==undefined&&(!rule.unlock||typeof rule.unlock!=='object'))throw new Error('黄点解锁开关无效。');
        unlock={...yellowDefaults(),...rule.unlock};
        if(typeof unlock.tdcEnabled!=='boolean'||typeof unlock.priceEnabled!=='boolean'||typeof unlock.blueEnabled!=='boolean')throw new Error('黄点解锁开关无效。');
        bound(unlock.tdcThreshold,0,100,'黄点TDC解锁阈值');bound(unlock.repairPct,0,100,'QQQ距52周高点百分比');
        if(rule.action!=='ignore'&&!unlock.tdcEnabled&&!unlock.priceEnabled&&!unlock.blueEnabled)throw new Error('黄点至少启用一个解锁条件：TDC回落、价格修复或实心蓝点永久解锁。');
        unlock={tdcEnabled:unlock.tdcEnabled,tdcThreshold:unlock.tdcThreshold,priceEnabled:unlock.priceEnabled,repairPct:unlock.repairPct,blueEnabled:unlock.blueEnabled};
      }
      return{id:r.id,action:rule.action,value:rule.value,...(r.conditional?{unlock}:{days:rule.action==='blue_ladder'?40:rule.days}),priority:rule.priority,...(r.id==='ccc_top'?{stackWithCredit}:{}),...(r.id==='blue'?{steps,onlyIfNotLower,asset}:{})};
    });
    if(usesMomentum(c)||c.momentum===undefined)c.momentum=momentumDefaults();
    return c;
  }
  function resolveTarget(data,cfg,t,last){
    const drawdownGate=cfg.drawdownGateEnabled?advanceDrawdownGate(data,t,last):null;
    const mask=data.signals[t];
    RULES.forEach((r,i)=>{if(mask&(1<<i))last[i]=t;});
    const yellowRule=cfg.rules[4],unlock={...yellowDefaults(),...yellowRule.unlock};
    const memory=last.yellowLock||(last.yellowLock={locked:false,triggerIndex:null,releaseIndex:null,releaseReason:null});
    const tdc=data.yellowContext?.tdc?.[t],dd52=data.yellowContext?.qqqDrawdown52?.[t];
    const finite=v=>typeof v==='number'&&Number.isFinite(v);
    if(yellowRule.action==='ignore')memory.locked=false;
    else if(mask&(1<<4)){memory.locked=true;memory.triggerIndex=t;memory.releaseIndex=null;memory.releaseReason=null;}
    else if(memory.locked){
      const matched=[];
      if(unlock.blueEnabled&&(mask&(1<<2)))matched.push('出现实心蓝点，永久解除本次黄点锁定');
      if(unlock.tdcEnabled&&finite(tdc)&&tdc<unlock.tdcThreshold)matched.push(`TDC ${number(tdc)} < ${number(unlock.tdcThreshold)}`);
      if(unlock.priceEnabled&&finite(dd52)&&dd52>=-unlock.repairPct/100)matched.push(`QQQ距52周高点 ${number(dd52*100)}% ≥ -${number(unlock.repairPct)}%`);
      if(matched.length){memory.locked=false;memory.releaseIndex=t;memory.releaseReason=matched.join('；');}
    }
    const yellowLock={locked:memory.locked,triggerDate:memory.triggerIndex===null?null:data.dates[memory.triggerIndex],releaseDate:memory.releaseIndex===null?null:data.dates[memory.releaseIndex],releaseReason:memory.releaseReason,tdc:finite(tdc)?tdc:null,qqqDrawdown52:finite(dd52)?dd52:null,unlock:{...unlock}};
    const active=RULES.map((r,i)=>({...cfg.rules[i],label:r.label,index:i,sourceIndex:last[i],state:!!r.state,active:r.conditional?memory.locked:r.state?!!(mask&(1<<i)):t-last[i]<(cfg.rules[i].action==='blue_ladder'?40:cfg.rules[i].days)})).filter(r=>r.active&&r.action!=='ignore').sort((a,b)=>b.priority-a.priority||a.index-b.index);
    const blueAsset=cfg.rules[2].asset??'inherit';
    const momentum=usesMomentum(cfg)?momentumChoice(data,t,last):null;
    const defaultAsset=cfg.asset==='momentum'?momentum.selection:cfg.asset;
    let desired=cfg.baseExposure,selection=defaultAsset,blueLadder=null;
    const ladder=active.find(r=>r.action==='blue_ladder');
    const ladderAsset=blueAsset==='inherit'?defaultAsset:blueAsset==='momentum'?(momentum?.selection??defaultAsset):blueAsset;
    if(ladder){
      let count=0;for(let i=Math.max(0,t-39);i<=t;i++)if(data.signals[i]&(1<<2))count++;
      blueLadder={asset:ladderAsset,assetMode:blueAsset,count,steps:ladder.steps??10,cap:ladder.value,target:ladder.value*Math.min(1,count/(ladder.steps??10)),windowStart:data.dates[Math.max(0,t-39)],windowEnd:data.dates[t],selected:false};
    }
    // Top warning can pair with one credit state. The pair competes at its higher
    // member priority; stress and above-MA are still alternatives, never a triple product.
    const top=active.find(r=>r.id==='ccc_top'),creditState=active.find(r=>r.id==='ccc_stress'||r.id==='ccc_above');
    const creditStack=top?.stackWithCredit!==false&&top?.action==='scale'&&creditState?.action==='scale'?{topRule:top.id,creditRule:creditState.id,creditLabel:creditState.label,topMultiplier:top.value,creditMultiplier:creditState.value,combinedMultiplier:top.value*creditState.value,target:cfg.baseExposure*top.value*creditState.value,topSignalDate:data.dates[top.sourceIndex],days:top.days,priority:Math.max(top.priority,creditState.priority),selected:false}:null;
    const stackApplies=r=>creditStack&&(r===top||r===creditState);
    const stackLabel=creditStack?`${top.label} × ${creditState.label}`:null;
    const rawRuleExposure=r=>stackApplies(r)?creditStack.target:!r?cfg.baseExposure:r.action==='flat'?0:r.action==='long'?r.value:r.action==='short'?-r.value:r.action==='blue_ladder'?blueLadder.target:cfg.baseExposure*r.value;
    const bearGate=cfg.bearGateEnabled?bearGate200(data,t):null;
    // Match fitted-aggressive bear_mult=0 on the ordinary long channel.
    // Yellow's dedicated configuration, inverse positions and blue bottom-fishing
    // are separate channels, so the gate is not a global liquidation override.
    const gateApplies=r=>bearGate?.active&&r?.id!=='yellow'&&r?.id!=='blue'&&rawRuleExposure(r)>0;
    const beforeBrake=r=>gateApplies(r)?0:rawRuleExposure(r);
    const brakeApplies=r=>drawdownGate?.active&&r?.id!=='yellow'&&r?.id!=='blue'&&beforeBrake(r)>0;
    const ruleExposure=r=>brakeApplies(r)?Math.min(3,beforeBrake(r))*.5:beforeBrake(r);
    const ordinaryExposure=r=>Math.max(-3,Math.min(3,ruleExposure(r)));
    const baseline=active.find(r=>r.id!=='blue'),blue=active.find(r=>r.id==='blue'&&['blue_ladder','long','scale'].includes(r.action));
    if(bearGate){bearGate.baselineBefore=Math.max(-3,Math.min(3,rawRuleExposure(baseline)));bearGate.baselineAfter=ordinaryExposure(baseline);bearGate.baselineGated=!!gateApplies(baseline);}
    if(drawdownGate){drawdownGate.baselineBefore=Math.max(-3,Math.min(3,beforeBrake(baseline)));drawdownGate.baselineAfter=ordinaryExposure(baseline);}
    let blueComparison=null;
    if(blue){
      const blueExposure=blue.action==='blue_ladder'?ruleExposure(blue):ordinaryExposure(blue),baselineExposure=ordinaryExposure(baseline);
      const eligible=blueExposure+1e-12*Math.max(1,Math.abs(blueExposure),Math.abs(baselineExposure))>=baselineExposure;
      blueComparison={enabled:blue.onlyIfNotLower!==false,blueExposure,baselineExposure,baselineState:bearGate?.baselineGated?'熊市闸门后的'+(stackApplies(baseline)?stackLabel:baseline?.label||'常态'):stackApplies(baseline)?stackLabel:baseline?.label||'常态',baselineRule:baseline?.id||null,eligible,selected:false};
    }
    const applicable=active.filter(r=>!(r===blue&&blueComparison?.enabled&&!blueComparison.eligible));
    const winner=applicable[0];
    if(bearGate)bearGate.applied=!!gateApplies(winner);
    if(drawdownGate)drawdownGate.applied=!!brakeApplies(winner);
    if(creditStack)creditStack.selected=!!stackApplies(winner);
    let state=bearGate?.applied?'熊市闸门':creditStack?.selected?stackLabel:winner?.label||'常态';
    if(drawdownGate?.applied)state+=' · 回撤闸';
    if(blueLadder){blueLadder.selected=winner===ladder;if(blueLadder.selected)selection=ladderAsset;}
    if(blueComparison)blueComparison.selected=winner===blue;
    desired=ruleExposure(winner);
    const requested=desired;
    const financeAllowed=winner?.action==='blue_ladder';
    if(!financeAllowed)desired=Math.max(-3,Math.min(3,desired));
    const candidates=data.symbols.map((s,i)=>({...s,index:i})).filter(s=>{
      if(!(data.tradable[t]&(1<<s.index))||s.symbol==='BIL'||(!cfg.allowSynthetic&&s.synthetic))return false;
      return desired<0?s.leverage<0:s.leverage>0&&s.underlying===selection;
    }).sort((a,b)=>Math.abs(b.leverage)-Math.abs(a.leverage)||Number(a.synthetic)-Number(b.synthetic)||a.index-b.index);
    const tool=desired===0?null:candidates[0];
    const weight=tool?(financeAllowed?Math.abs(desired)/Math.abs(tool.leverage):Math.min(1,Math.abs(desired)/Math.abs(tool.leverage))):0;
    const weights=data.symbols.map(()=>0),bil=data.symbols.findIndex(s=>s.symbol==='BIL');
    if(tool)weights[tool.index]=weight;weights[bil]=1-weight;
    const originalExposure=tool?weight*tool.leverage:0;
    const limited=Math.abs(originalExposure-requested)>1e-9*Math.max(1,Math.abs(requested));
    const cccStressBlueLimit=cfg.cccStressBlueLimitEnabled?stressBlueLimit(data,t,defaultAsset,originalExposure):null;
    const exposure=cccStressBlueLimit?.exposure??originalExposure;
    if(cccStressBlueLimit?.applied){
      const ratio=exposure/originalExposure;
      for(let j=0;j<weights.length;j++)if(j!==bil)weights[j]*=ratio;
      weights[bil]=1-sum(weights.filter((_,j)=>j!==bil));
      state+=' · CCC压力位蓝点限制';
    }
    const action=winner?`${winner.label}：${ACTIONS[winner.action]}${!['flat','ignore'].includes(winner.action)?' '+number(winner.value)+(winner.action==='scale'?'':'×'):''}`:`常态：${selection} ${number(cfg.baseExposure)}×`;
    const reasons=[winner?`${action}。${winner.id==='yellow'?'锁定至解锁条件满足，不按天数到期':winner.state?'条件保持时生效':`信号日 ${data.dates[winner.sourceIndex]}，有效 ${winner.days} 个交易日（含信号日）`}；优先级 ${winner.priority}。`:`当前无已启用的预警规则生效，按常态 ${selection} ${number(cfg.baseExposure)} 倍配置。`];
    if(bearGate){
      const b=bearGate;
      const status=!b.ready?`可用 ${b.count} 个复权收盘数据，须完整221个交易日以比较当前200日均线与21个交易日前均线；当前不触发。`:`QQQ收盘 / 200日均线 = ${number(b.priceToMA*100)}%；当前均线 / 21个交易日前均线 = ${number(b.maToPastMA*100)}%。${b.active?'两项均低于100%，闸门条件命中。':'未同时低于100%，闸门未触发。'}`;
      reasons.unshift(`熊市闸门（同拟合·进取）：${status}${b.active?` 常态多头乘数为0；比较基准 ${number(b.baselineBefore)}× → ${number(b.baselineAfter)}×。${b.applied?'本次常态多头归零，余款持有BIL。':'本次采用独立配置或原目标已非多头。'}`:''} 黄点锁仓配置与空头配置保留；蓝点抄底仍按敞口比较及自定义优先级执行。次一交易日收盘成交；任一熊市条件不再满足即解除，其他规则状态继续更新。`);
    }
    if(creditStack){
      const c=creditStack;
      const explanation=`CCC见顶累乘${c.selected?'生效':'候选（本次未采用）'}：常态敞口 ${number(cfg.baseExposure)} × 见顶乘数 ${number(c.topMultiplier)} × ${c.creditLabel}乘数 ${number(c.creditMultiplier)} = ${number(c.target)}× 底层敞口。见顶信号日 ${c.topSignalDate}，有效 ${c.days} 个交易日（含信号日）；信用状态按当日条件。信用压力与高于200日线同时生效时只选优先级最高的一条，同级按表格顺序；组合以两条规则中较高的优先级 ${c.priority} 与其他规则比较。`;
      if(c.selected)reasons[bearGate?1:0]=explanation;else reasons.push(explanation);
    }
    if(drawdownGate){const g=drawdownGate;reasons.push(`回撤闸（同拟合·进取）：目标权重参考净值 ${number(g.referenceNAV)}，历史峰值 ${number(g.peak)}，回撤 ${number(g.drawdown*100)}%；${g.active?'已触发，常态多头目标乘0.5':'未触发或已解除'}。20%回撤触发，修复至10%以内解除；本次常态比较目标 ${number(g.baselineBefore)}× → ${number(g.baselineAfter)}×。${g.applied?'本次减半生效。':'本次采用蓝点、黄点专用配置、空头、空仓或其他限制，未额外压低目标。'} 参考净值自 ${g.referenceStartDate} 起连续累计，使用前一信号日最终目标ETF权重及本日复权收益，包含蓝点、空头和CCC封顶后的目标反馈；不计BIL收益、成本、融资利息及再平衡漂移，与图中实际净值口径不同。次一交易日收盘执行，蓝点仍按敞口比较和优先级覆盖，CCC压力限制继续最后封顶。`);}
    if(momentum)reasons.push(momentum.reason);
    if(blueComparison){
      const c=blueComparison;
      reasons.push(c.enabled?`蓝点敞口比较${c.eligible?'通过':'未通过'}：抄底目标 ${number(c.blueExposure)}× ${c.eligible?'≥':'<'} 当日${c.baselineState}目标 ${number(c.baselineExposure)}×（排除蓝点后按其他有效规则计算）。${!c.eligible?'不采用抄底配置，沿用当日配置。':c.selected?'本次按抄底配置执行。':'满足抄底门槛，但另有更高优先级规则生效。'}比较使用带方向的目标底层敞口，空头为负；不是ETF资金权重或漂移后的实际持仓。`:'蓝点敞口比较已关闭，按有效规则优先级决定是否采用抄底配置。');
    }
    if(yellowRule.action!=='ignore'&&yellowLock.triggerDate){
      if(yellowLock.locked){
        const checks=[];
        if(unlock.tdcEnabled)checks.push(`TDC ${finite(tdc)?number(tdc):'数据缺失'}（须 < ${number(unlock.tdcThreshold)}）`);
        if(unlock.priceEnabled)checks.push(`QQQ距52周高点 ${finite(dd52)?number(dd52*100)+'%':'数据缺失'}（须 ≥ -${number(unlock.repairPct)}%）`);
        if(unlock.blueEnabled)checks.push('等待新的实心蓝点永久解锁（空心蓝点不计）');
        reasons.push(`黄点锁定中，自 ${yellowLock.triggerDate} 触发；${checks.join('；')}。任一已启用条件满足即解除，缺失值不视为达标；黄点当日优先触发，下一信号日起检查解除。实心蓝点解锁与蓝点是否实际成交分开判断。`);
      }else reasons.push(`黄点已于 ${yellowLock.releaseDate} 信号日解除：${yellowLock.releaseReason}。解除后执行其他有效规则或常态；未出现新黄点前不重新锁定。`);
    }
    if(blueLadder)reasons.push(`${blueLadder.asset} 蓝点分批${blueLadder.selected?'生效':'候选'}：最近40个交易日（${blueLadder.windowStart} 至 ${blueLadder.windowEnd}，含当日）有 ${blueLadder.count} 个实心蓝点日；上限 x=${number(blueLadder.cap)} 倍，分 n=${blueLadder.steps} 次加满，目标 ${number(blueLadder.cap)} × min(1, ${blueLadder.count}/${blueLadder.steps}) = ${number(blueLadder.target)} 倍。旧蓝点移出窗口后不再计数，空心蓝点不计入。`);
    if(applicable.length>1)reasons.push(`同时生效：${applicable.map(r=>r.label+'（'+r.priority+'）').join('、')}；${creditStack?.selected?'本次采用CCC见顶与所选信用状态的累乘组合，其余规则不累乘':'采用优先级最高者，同级按设置表顺序'}。`);
    if(limited)reasons.push(`期望 ${number(requested)}×；按当时可交易工具与资金权重不超过100%的限制，限仓前可实现目标 ${number(originalExposure)}×，余款持BIL。`);
    if(cccStressBlueLimit){
      const c=cccStressBlueLimit,vol=c.ready?`${number(c.volatility*100)}%`:'不足10个有效日收益';
      reasons.push(`CCC压力位蓝点限制：${c.active?'CCC极端压力（252日分位≥95）成立':'CCC极端压力未成立，本层不限制'}；监测当日默认标的（常态底层）${c.monitorAsset} 的10日年化实现波动率 ${vol}（复权日收益样本标准差 × √252，含信号日）。${c.active&&c.ready?`多头上限 min(3, 50% / ${vol}) = ${number(c.cap)}×；本层前目标 ${number(c.originalExposure)}× → 最终目标 ${number(c.exposure)}×。${c.applied?'已限制最终多头，蓝点优先级也不能越过此上限。':'原目标无需降低。'}`:''} 压力解除即撤除此上限，目标回到其他规则结果，不等待账户净值修复；实际成交仍按次一交易日收盘及再平衡带执行。`);
    }
    const finalWeight=tool?weights[tool.index]:0;
    if(finalWeight>1)reasons.push(`蓝点融资持有：${tool.symbol}目标资金权重 ${number(finalWeight*100)}%，超出自有资金的 ${number((finalWeight-1)*100)}% 记为融资负债；年利率固定5%，按实际日历天数/365计息，利息计入负债。`);
    if(tool?.synthetic)reasons.push(`${tool.symbol} 为研究合成序列，不是当时已上市ETF。`);
    if(drawdownGate)last.drawdownGate.prevWeights=weights.map((w,j)=>j===bil?0:w);
    return{weights,exposure,drawdownGate,desired:requested,selection,momentum,blueLadder,blueComparison,creditStack,bearGate,cccStressBlueLimit,yellowLock,winner:winner?.id||null,state,reasons,limited,synthetic:!!tool?.synthetic};
  }
  function advanceDrawdownGate(data,t,last){
    const m=last.drawdownGate||(last.drawdownGate={nav:1,peak:1,active:false,prevWeights:null,triggerDate:null,releaseDate:null});
    let ret=0;
    if(m.prevWeights)for(let j=0;j<m.prevWeights.length;j++){
      if(!m.prevWeights[j])continue;
      const r=data.returns[t]?.[j];
      if(typeof r!=='number'||!Number.isFinite(r))throw new Error(`${data.dates[t]} 回撤闸缺少 ${data.symbols[j].symbol} 有效复权收益。`);
      ret+=m.prevWeights[j]*r;
    }
    m.nav*=1+ret;
    if(!(m.nav>0)||!Number.isFinite(m.nav))throw new Error(`${data.dates[t]} 回撤闸参考净值耗尽或无效，回测终止。`);
    m.peak=Math.max(m.peak,m.nav);const dd=m.nav/m.peak-1;
    if(dd<=-.2+1e-12){if(!m.active)m.triggerDate=data.dates[t];m.active=true;}
    else if(dd>=-.1-1e-12){if(m.active)m.releaseDate=data.dates[t];m.active=false;}
    return{enabled:true,active:m.active,referenceNAV:m.nav,peak:m.peak,drawdown:dd,trigger:.2,recovery:.1,multiplier:m.active?.5:1,triggerDate:m.triggerDate,releaseDate:m.releaseDate,referenceStartDate:data.dates[0],basis:'target_weight_etf_return',applied:false};
  }
  function stressBlueLimit(data,t,monitorAsset,originalExposure){
    const index=data.symbols.findIndex(s=>s.symbol===monitorAsset&&s.leverage===1);
    const sample=index<0?[]:data.returns.slice(Math.max(0,t-9),t+1).map(row=>row[index]);
    const ready=sample.length===10&&sample.every(v=>typeof v==='number'&&Number.isFinite(v));
    const mean=ready?sum(sample)/10:0;
    const volatility=ready?Math.sqrt(sum(sample.map(v=>(v-mean)**2))/9)*Math.sqrt(252):null;
    const cap=ready?Math.min(3,volatility===0?Infinity:.5/volatility):null;
    const active=!!(data.signals[t]&(1<<7));
    const exposure=active&&ready&&originalExposure>0?Math.min(originalExposure,cap):originalExposure;
    return{enabled:true,active,ready,monitorAsset,monitorBasis:'default',window:10,riskBudget:.5,maxExposure:3,volatility,cap,originalExposure,exposure,applied:exposure<originalExposure-1e-12,creditSourceDate:data.readings?.[t]?.[5]??null};
  }
  // Match QQQ < MA200 && MA200 < MA200.shift(21). A common price
  // scale cancels in both comparisons; the two 200-close windows need 221 closes.
  function bearGate200(data,t){
    const period=200,slopeLookback=21,required=period+slopeLookback,j=data.symbols.findIndex(s=>s.symbol==='QQQ');
    if(j<0)throw new Error('熊市闸门缺少QQQ复权行情。');
    if(t<required-1)return{asset:'QQQ',period,slopeLookback,date:data.dates[t],ready:false,count:t+1,priceToMA:null,maToPastMA:null,below:false,maFalling:false,active:false,multiplier:0};
    const closes=[1];let price=1;
    for(let i=t-required+2;i<=t;i++){
      const r=data.returns[i]?.[j];
      if(typeof r!=='number'||!Number.isFinite(r)||r<=-1)throw new Error('熊市闸门缺少有效QQQ复权收益 '+data.dates[i]);
      price*=1+r;closes.push(price);
    }
    const ma=sum(closes.slice(slopeLookback))/period,pastMA=sum(closes.slice(0,period))/period;
    const priceToMA=price/ma,maToPastMA=ma/pastMA;
    if(!Number.isFinite(priceToMA)||priceToMA<=0||!Number.isFinite(maToPastMA)||maToPastMA<=0)throw new Error('熊市闸门计算失败 '+data.dates[t]);
    const below=priceToMA<1-1e-12,maFalling=maToPastMA<1-1e-12;
    return{asset:'QQQ',period,slopeLookback,date:data.dates[t],ready:true,count:required,priceToMA,maToPastMA,below,maFalling,active:below&&maFalling,multiplier:0};
  }
  function grossReturn(data,symbol,start,end){
    const j=data.symbols.findIndex(s=>s.symbol===symbol);
    if(j<0)throw new Error('动量选品缺少 '+symbol);
    let growth=1;
    for(let i=start+1;i<=end;i++){
      const r=data.returns[i]?.[j];
      if(!Number.isFinite(r)||r<=-1)throw new Error('动量选品收益缺失 '+data.dates[i]);
      growth*=1+r;
    }
    return growth;
  }
  function weekStart(date){
    const day=new Date(date+'T00:00:00Z');
    return +day-((day.getUTCDay()+6)%7)*86400000;
  }
  function momentumChoice(data,t,memory){
    const {lookback,skip,weakness,longBond}=MOMENTUM;
    const date=data.dates[t],previous=data.dates[t-1];
    const monthStart=!previous||date.slice(0,7)!==previous.slice(0,7);
    const m=memory.momentum??={monthlySelection:'QQQ',selection:'QQQ',decisionDate:null,scores:null,weakness:null,bond:null};
    if(monthStart){
      m.weakness=null;
      if(t>=lookback){
        const start=t-lookback,end=t-skip;
        const qqq=grossReturn(data,'QQQ',start,end),soxx=grossReturn(data,'SOXX',start,end);
        if(soxx>qqq)m.monthlySelection='SOXX';
        if(qqq>soxx)m.monthlySelection='QQQ';
        m.scores={QQQ:qqq-1,SOXX:soxx-1};
        m.decisionDate=date;
        m.from=data.dates[start];
        m.through=data.dates[end];
      }
    }
    // The bond layer uses only t-1 and earlier yields, so it is resolved before the weakness check.
    if(!data.dgs30||typeof data.dgs30!=='object')throw new Error('动量选品缺少 FRED DGS30 收益率数据，不能静默关闭长债过滤。');
    const observationDate=data.dates[t-longBond.lag]??null;
    const baselineDate=data.dates[t-longBond.lag-longBond.lookback]??null;
    // null = checked and unavailable (state carries forward); an absent key means the input was never supplied.
    for(const d of [observationDate,baselineDate])if(d!==null&&!Object.hasOwn(data.dgs30,d))throw new Error(`动量选品缺少 ${d} 的 DGS30 收益率输入。`);
    const observed=observationDate===null?null:data.dgs30[observationDate],baseline=baselineDate===null?null:data.dgs30[baselineDate];
    const deltaBp=Number.isInteger(observed)&&Number.isInteger(baseline)?observed-baseline:null;
    const wasActive=m.bond?.active??false;
    const active=deltaBp===null?wasActive:deltaBp>=(wasActive?longBond.offBelowBp:longBond.onBp);
    m.bond={active,deltaBp,observationDate,baselineDate};
    // Check relative weakness at the month start, at a weekly check of an incoming SOXX selection,
    // and on the day the bond filter releases, so SOXX is never bought back without a weakness check.
    const weekCheck=!monthStart&&m.selection==='SOXX'&&weekStart(date)!==weekStart(previous);
    const released=!monthStart&&wasActive&&!active&&!m.weakness?.locked;
    if(m.monthlySelection==='SOXX'&&(monthStart||weekCheck||released)){
      const change=days=>grossReturn(data,'SOXX',t-days,t)/grossReturn(data,'QQQ',t-days,t)-1;
      const shortChange=change(weakness.short),longChange=change(weakness.long);
      m.weakness={date,check:monthStart?'month':released?'bond_release':'week',shortChange,longChange,locked:shortChange<0&&longChange<0};
    }
    m.selection=m.monthlySelection==='SOXX'&&!m.weakness?.locked&&!active?'SOXX':'QQQ';
    const monthly=m.scores?`月度动量（${m.decisionDate}）选 ${m.monthlySelection}，QQQ ${number(m.scores.QQQ*100)}%，SOXX ${number(m.scores.SOXX*100)}%`:'月度动量等待完整观察期';
    const relative=m.weakness?`相对走弱（${m.weakness.date}）21日 ${number(m.weakness.shortChange*100)}%，63日 ${number(m.weakness.longChange*100)}%，${m.weakness.locked?'本月锁定 QQQ':'未触发'}`:'相对走弱未触发';
    const bond=`DGS30 过滤${active?'开启':'关闭'}，${deltaBp===null?'缺少所需观测值，沿用状态':`${observationDate} 较 ${baselineDate} 变动 ${deltaBp} bp`}`;
    return{...m,reason:`${monthly}。 ${relative}。 ${bond}。 动量选品结果 ${m.selection}。`};
  }
  function stats(history,turnover){
    const years=(Date.parse(history.at(-1).date)-Date.parse(history[0].date))/86400000/365.25;
    const returns=history.slice(1).map((p,i)=>p.nav/history[i].nav-1),mean=sum(returns)/returns.length;
    const vol=returns.length>1?Math.sqrt(sum(returns.map(r=>(r-mean)**2))/(returns.length-1))*Math.sqrt(252):0;
    let peak=history[0],max={value:0,peakDate:peak.date,troughDate:peak.date,peakNav:peak.nav,troughNav:peak.nav,recoveryDate:null};
    for(const p of history){if(p.nav>=peak.nav)peak=p;const dd=p.nav/peak.nav-1;if(dd<max.value)max={value:dd,peakDate:peak.date,troughDate:p.date,peakNav:peak.nav,troughNav:p.nav,recoveryDate:null};}
    if(max.value<0){const recovered=history.find(p=>p.date>=max.troughDate&&p.nav>=max.peakNav);max.recoveryDate=recovered?.date||null;}else max.recoveryDate=max.troughDate;
    return{cagr:(history.at(-1).nav/history[0].nav)**(1/years)-1,mdd:max.value,sharpe:vol>0?mean*252/vol:null,vol,mult:history.at(-1).nav/history[0].nav,turn_yr:sum(turnover.slice(1))/years,drawdown:max};
  }
  function run(data,input){
    if(data?.schemaVersion!==1||!Array.isArray(data.dates)||!data.symbols?.some(s=>s.symbol==='BIL')||RULES.some((r,i)=>data.signalTypes?.[i]!==r.id))throw new Error('自定义回测数据不完整，请刷新重试。');
    const cfg=validate(input,data),start=data.dates.findIndex(d=>d>=cfg.start),end=data.dates.findLastIndex(d=>d<=cfg.end);
    if(start<1||end<=start)throw new Error('所选日期内至少需要两个交易日。');
    if(cfg.rules[4].action!=='ignore'&&(cfg.rules[4].unlock.tdcEnabled||cfg.rules[4].unlock.priceEnabled)&&(!data.yellowContext||data.yellowContext.tdc?.length!==data.dates.length||data.yellowContext.qqqDrawdown52?.length!==data.dates.length))throw new Error('缺少黄点条件解锁的TDC或QQQ修复历史，请刷新页面重试。');
    const last=RULES.map(()=>-1e9),targets=[];
    for(let t=0;t<=end;t++)targets.push(resolveTarget(data,cfg,t,last));
    for(let t=start-1;t<end;t++){const c=targets[t].cccStressBlueLimit;if(c?.active&&c.originalExposure>0&&!c.ready)throw new Error(`${data.dates[t]} CCC压力位蓝点限制缺少 ${c.monitorAsset} 完整10个有效日收益，请补全数据后重试。`);}
    const bil=data.symbols.findIndex(s=>s.symbol==='BIL'),qi=data.symbols.findIndex(s=>s.symbol==='QQQ'),turnover=[],history=[],benchmark=[],points={},trades=[];
    let h=targets[start-1].weights.slice(),benchmarkNav=1,limitedDays=0,syntheticDays=0,costPaid=0,rebalanceDays=0,financingDays=0,financingInterestPaid=0,bearGateDays=0,bearGateAppliedDays=0,cccStressBlueLimitDays=0,drawdownGateDays=0,drawdownGateAppliedDays=0;
    for(let t=start;t<=end;t++){
      const target=targets[t-1],date=data.dates[t];let rebalanced=false,turn=0,financingInterest=0;
      if(t>start){
        const days=(Date.parse(date)-Date.parse(data.dates[t-1]))/86400000;
        h=h.map((v,j)=>{if(j===bil&&v<0){const interest=-v*FINANCING_RATE*days/365;financingInterest=interest;return v-interest;}return v*(1+data.returns[t][j]);});
        financingInterestPaid+=financingInterest;benchmarkNav*=1+data.returns[t][qi];
      }
      let nav=sum(h);if(!(nav>0)||!Number.isFinite(nav))throw new Error(`${date} 净值已耗尽、为非正数或发生数值溢出，回测终止；不会将结果截为正净值。`);
      const before=h.map(v=>v/nav),delta=target.weights.map((v,j)=>Math.abs(v-before[j]));
      const reasons=target.reasons.slice();
      if(t>start&&(Math.max(...delta)>cfg.band+1e-12||target.weights.some((v,j)=>(v>1e-9)!==(before[j]>1e-9)))){
        const cost=sum(delta.map((d,j)=>d*(j===bil&&(before[bil]<0||target.weights[bil]<0)?0:data.costs[t][j])*cfg.costMultiplier));
        if(!Number.isFinite(cost)||cost>=1)throw new Error(`${date} 交易成本导致资产耗尽或数值溢出，回测终止。`);
        costPaid+=nav*cost;nav*=1-cost;h=target.weights.map(v=>v*nav);rebalanced=true;turn=sum(delta)/2;rebalanceDays++;
      }
      const weights=h.map(v=>v/nav),exposure=sum(weights.map((w,j)=>w*data.symbols[j].leverage));
      const rebalanceOnly=target.weights.every((w,j)=>Math.abs(w-targets[Math.max(0,t-2)].weights[j])<=1e-9);
      if(rebalanced){
        const beforeExposure=sum(before.map((w,j)=>w*data.symbols[j].leverage));
        data.symbols.forEach((s,j)=>{
          if(j===bil||Math.abs(weights[j]-before[j])<=1e-9)return;
          const kind=before[j]<=1e-9?'buy':weights[j]<=1e-9?'sell':weights[j]>before[j]?'add':'reduce';
          trades.push({date,signalDate:data.dates[t-1],type:kind,symbol:s.symbol,weightBefore:before[j],weightAfter:weights[j],weightChange:weights[j]-before[j],exposureBefore:beforeExposure,exposureAfter:exposure,cashBefore:before[bil],cashAfter:weights[bil],state:target.state,inverse:s.leverage<0,leverage:s.leverage,rebalanceOnly,reason:rebalanceOnly?'rebalancing_band':'target_update',reasonDate:date,band:cfg.band});
        });
      }
      if(weights[bil]<-1e-9)financingDays++;
      if(financingInterest>0||weights[bil]<-1e-9)reasons.push(`本期融资利息 ${number(financingInterest)}（初始资金=1），期末融资负债占净资产 ${number(Math.max(0,-weights[bil])*100)}%；融资年利率固定5%。负现金代表借款，不是负BIL持仓。`);
      if(target.drawdownGate?.active)drawdownGateDays++;
      if(target.drawdownGate?.applied)drawdownGateAppliedDays++;
      if(target.bearGate?.active)bearGateDays++;
      if(target.bearGate?.applied)bearGateAppliedDays++;
      if(target.cccStressBlueLimit?.applied)cccStressBlueLimitDays++;
      if(target.limited)limitedDays++;
      if(weights.some((w,j)=>w>1e-9&&data.symbols[j].synthetic))syntheticDays++;
      if(t===start)reasons.push('窗口首日收盘继承前一交易日目标，净值从1起算；首日不虚构成交，下一交易日起计收益和成本。');
      if(rebalanced&&rebalanceOnly)reasons.push(`目标不变，实际资金权重偏离超过 ${number(cfg.band*100)} 个百分点，按自定义再平衡带调仓。`);
      points[date]={signalDate:data.dates[t-1],state:target.state,selection:target.selection,holdings:weights.flatMap((w,j)=>j!==bil&&w>1e-9?[[data.symbols[j].symbol,w]]:[]),cash:weights[bil],exposure,targetHoldings:target.weights.flatMap((w,j)=>j!==bil&&w>1e-9?[[data.symbols[j].symbol,w]]:[]),targetCash:target.weights[bil],targetExposure:target.exposure,rebalanced,reasons,nav,benchmarkNav,band:cfg.band,rebalanceOnly,momentum:target.momentum,blueLadder:target.blueLadder,blueComparison:target.blueComparison,creditStack:target.creditStack,bearGate:target.bearGate,drawdownGate:target.drawdownGate,cccStressBlueLimit:target.cccStressBlueLimit,yellowLock:target.yellowLock,financingInterest,financingAnnualRate:FINANCING_RATE};
      history.push({date,nav});benchmark.push({date,nav:benchmarkNav});turnover.push(turn);
    }
    const metrics=stats(history,turnover),benchmarkMetrics=stats(benchmark,turnover.map(()=>0));
    return{config:cfg,range:{start:data.dates[start],end:data.dates[end]},history,benchmark,metrics,benchmarkMetrics,details:{points,trades},audit:{inputHash:data.meta.inputHash,...(data.meta.dgs30CSVHash?{dgs30CSVHash:data.meta.dgs30CSVHash}:{}),days:history.length,bearGateDays,bearGateAppliedDays,drawdownGateDays,drawdownGateAppliedDays,cccStressBlueLimitDays,limitedDays,syntheticDays,rebalanceDays,costPaid,financingDays,financingInterestPaid,financingAnnualRate:FINANCING_RATE},sourceMeta:copy(data.meta)};
  }
  function readings(data){return Object.fromEntries(data.dates.map((d,i)=>{const v=data.readings[i],mask=data.signals[i];return[d,{temperature:v[0],tdc:v[1],creditSpread:v[2],creditMA200:v[3],creditPercentile:v[4],creditSourceDate:v[5],creditStress:!!(mask&(1<<7)),creditAbove:!!(mask&(1<<8))}];}));}
  root.CustomBacktest=Object.freeze({RULES,ACTIONS,defaults,validate,usesMomentum,resolveTarget,bearGate200,momentumChoice,stats,run,readings});
})(typeof window!=='undefined'?window:globalThis);
