(function(root){
  'use strict';
  const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORAGE='dual-model-custom-v1';
  function attach(onResult){
    const C=root.CustomBacktest,form=$('#custom-form'),status=$('#custom-status'),button=$('#run-custom');
    const asset=form.elements.namedItem('asset'),method=form.elements.namedItem('momentumMethod');
    const methodField=$('#momentum-method-field'),assetLabel=asset.closest('label');
    method.innerHTML=Object.entries(C.MOMENTUM_METHODS).map(([id,option])=>`<option value="${id}">${esc(option.label)}</option>`).join('');
    let data=null,loading=null,ratesLoading=null,lastResult=null,busy=false;
    const initial=C.defaults();let draft=initial,migratedYellow=false,migratedTools=false,migratedBlueComparison=false,migratedBlueUnlock=false,migratedCreditStack=false,migratedBearGate=false,migratedMomentum=false;
    try{const saved=JSON.parse(localStorage.getItem(STORAGE));if(saved){draft=C.validate({...saved,start:initial.start,end:initial.end});migratedMomentum=C.usesMomentum(draft)&&!saved.momentum?.longBond;migratedBearGate=Object.hasOwn(saved,'bear200Enabled');migratedCreditStack=saved.rules?.find(r=>r.id==='ccc_top')?.stackWithCredit===undefined;migratedYellow=!saved.rules?.find(r=>r.id==='yellow')?.unlock;migratedTools=Object.hasOwn(saved,'toolMode');migratedBlueComparison=saved.rules?.find(r=>r.id==='blue')?.onlyIfNotLower===undefined;migratedBlueUnlock=saved.rules?.find(r=>r.id==='yellow')?.unlock?.blueEnabled===undefined;}}catch{}
    $('#custom-rule-rows').innerHTML=C.RULES.map(r=>`<tr data-custom-rule="${r.id}"><th scope="row"><span class="custom-rule-group">${r.group}</span>${esc(r.label)}</th><td><label class="sr-only" for="rule-${r.id}-action">${r.label}操作</label><select id="rule-${r.id}-action" data-rule-field="action">${Object.entries(C.ACTIONS).filter(([key])=>key!=='blue_ladder'||r.id==='blue').map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('')}</select></td><td><label class="sr-only" for="rule-${r.id}-value">${r.label}敞口或乘数</label><div class="custom-number"><input id="rule-${r.id}-value" data-rule-field="value" type="number" min="0" max="3" step="0.05" required><span data-rule-unit></span></div></td><td>${r.conditional?'<span class="custom-state-duration">条件解锁</span>':r.state?'<span class="custom-state-duration">条件保持时</span>':`<label class="sr-only" for="rule-${r.id}-days">${r.label}持续交易日</label><input id="rule-${r.id}-days" data-rule-field="days" type="number" min="1" max="252" step="1" required>`}</td><td><label class="sr-only" for="rule-${r.id}-priority">${r.label}优先级</label><input id="rule-${r.id}-priority" data-rule-field="priority" type="number" min="1" max="99" step="1" required></td></tr>${r.id==='ccc_top'?'<tr class="ccc-stack-options" id="ccc-stack-options"><td colspan="5"><label class="ccc-stack-toggle"><input id="ccc-top-stack" type="checkbox">见顶预警与信用压力或高于200日线累乘（默认）</label><p id="ccc-stack-preview"></p><p>仅当双方操作均为“常态敞口 × 乘数”且同时生效时累乘；信用压力与高于200日线先按优先级选一条，同级选表中靠前者，不进行三项累乘。组合以两条中较高的优先级与其他规则比较，仍可能被红点、黄点或蓝点等更高优先级规则覆盖。关闭后恢复单条优先级规则。</p></td></tr>':''}${r.id==='yellow'?'<tr class="yellow-unlock-options" id="yellow-unlock-options"><td colspan="5"><div class="yellow-unlock-settings"><div><label class="yellow-toggle"><input id="yellow-tdc-enabled" type="checkbox">TDC 回落时解除</label><label for="yellow-tdc-threshold">TDC 严格低于<input id="yellow-tdc-threshold" type="number" min="0" max="100" step="0.1" required></label></div><div><label class="yellow-toggle"><input id="yellow-price-enabled" type="checkbox">QQQ 价格修复时解除</label><label for="yellow-repair-pct">距52周高点不超过<span class="custom-number"><input id="yellow-repair-pct" type="number" min="0" max="100" step="0.1" required><span>%</span></span></label></div><div class="yellow-blue-option"><label class="yellow-toggle"><input id="yellow-blue-enabled" type="checkbox">实心蓝点永久解锁（默认）</label><p>实心蓝点出现即解除本次黄点锁定；蓝点窗口结束也不重新锁仓，直到新黄点再次触发。</p></div></div><p class="yellow-unlock-note">任一已启用条件满足即解除，至少启用一项。黄点当日先锁定，从下一信号日起检查；不按持续天数结束。价格修复使用QQQ复权收盘价与最近252个交易日最高收盘价比较，至少60个有效交易日。缺失读数不视为达标。</p><p class="yellow-unlock-note">解除后按其他有效规则或常态配置，次一交易日收盘成交。勾选蓝点永久解锁后，解锁先于持仓规则与敞口比较，与蓝点操作是否启用、是否成交无关；空心蓝点不计。黄蓝同日先锁定；解除后，只有新黄点才会再次锁定。</p></td></tr>':''}${r.id==='blue'?'<tr class="blue-comparison-options" id="blue-comparison-options"><td colspan="5"><label class="blue-comparison-toggle"><input id="blue-only-if-not-lower" type="checkbox">仅当抄底敞口不小于当日常态/锁仓敞口时执行（默认）</label><p>先排除实心蓝点，按当天其余有效规则计算常态/锁仓目标，再与抄底目标比较；相等也满足。未达标则沿用当天配置，达标后仍按优先级执行。比较带方向的目标底层敞口（空头为负），不是ETF资金权重或漂移后的实际持仓。黄点是否永久解除取决于“实心蓝点永久解锁”开关，与是否实际采用抄底配置分开判断。</p></td></tr>':''}${r.id==='blue'?'<tr class="blue-ladder-options" id="blue-ladder-options" hidden><td colspan="5"><div class="blue-ladder-settings"><label for="rule-blue-asset" class="blue-asset-label">分批买入标的<select id="rule-blue-asset"><option value="inherit">跟随常态（原设置）</option><option value="momentum">动量 · QQQ / SOXX</option><option value="QQQ">QQQ · 纳指100</option><option value="SOXX">SOXX · 半导体</option></select></label><label for="rule-blue-steps">分批数 n<input id="rule-blue-steps" type="number" min="1" max="252" step="1" required></label><div><strong id="blue-ladder-asset-title">分批买入独立标的 · 滚动40个交易日</strong><p id="blue-ladder-preview"></p><p>每个实心蓝点日增加一份 x/n，最多 x 倍；包含信号日，空心蓝点不计入。旧蓝点移出窗口后目标可能回落，窗口结束后回到其他有效规则或常态。仍按优先级、可交易工具及再平衡带执行；蓝点 x 不设人为上限，超过所用ETF倍数时融资持有；融资年利率固定5%。</p></div></div></td></tr>':''}`).join('');
    function syncRows(){
      const monitorAsset=asset.value;
      $('#ccc-blue-limit-monitor').textContent=`当前监测：${monitorAsset==='momentum'?'动量选中的 QQQ / SOXX（每个信号日随常态选品结果变化）':monitorAsset}，由常态底层设置决定 · 10日年化实现波动率。`;
      const blueAsset=$('#rule-blue-asset');
      const blueMomentum=$('#rule-blue-action').value==='blue_ladder'&&blueAsset.value==='momentum';
      const momentum=monitorAsset==='momentum'||blueMomentum;
      const anchor=blueMomentum&&monitorAsset!=='momentum'?blueAsset.closest('label'):assetLabel;
      if(anchor.nextElementSibling!==methodField)anchor.after(methodField);
      methodField.hidden=method.disabled=!momentum;
      $('#momentum-options').hidden=!momentum;
      const layers=C.MOMENTUM_METHODS[method.value];
      $('#momentum-weakness').hidden=!layers.weakness;
      $('#momentum-bond').hidden=!layers.longBond;
      $('#momentum-bond-release').hidden=method.value!=='combined';
      form.querySelectorAll('[data-custom-rule]').forEach(row=>{
        const action=row.querySelector('[data-rule-field="action"]').value,ladder=action==='blue_ladder',disabled=['ignore','flat'].includes(action);
        const amount=row.querySelector('[data-rule-field="value"]');amount.disabled=disabled;
        if(ladder)amount.removeAttribute('max');else amount.setAttribute('max','3');amount.setAttribute('step',ladder?'any':'0.05');
        row.querySelector('[data-rule-unit]').textContent=disabled?'—':action==='scale'?'乘数':ladder?'x 倍':'倍';
        row.querySelector('[data-rule-field="priority"]').disabled=action==='ignore';
        const days=row.querySelector('[data-rule-field="days"]');if(days){if(ladder)days.value=40;days.disabled=action==='ignore'||ladder;}
        if(row.dataset.customRule==='blue'){
          const compare=['blue_ladder','long','scale'].includes(action);$('#blue-comparison-options').hidden=!compare;$('#blue-only-if-not-lower').disabled=!compare;
          $('#blue-ladder-options').hidden=!ladder;$('#rule-blue-steps').disabled=!ladder;$('#rule-blue-asset').disabled=!ladder;
          row.querySelector('label[for="rule-blue-value"]').textContent=ladder?'实心蓝点目标上限 x（倍）':'实心蓝点敞口或乘数';
          const x=row.querySelector('[data-rule-field="value"]').value,n=$('#rule-blue-steps').value,mode=$('#rule-blue-asset').value,chosen=mode==='inherit'?form.elements.namedItem('asset').value:mode,asset=chosen==='momentum'?'动量选中的 QQQ / SOXX':chosen;
          $('#blue-ladder-asset-title').textContent=`买入 ${asset}${mode==='inherit'?'（跟随常态）':'（蓝点独立设置）'}· 滚动40个交易日`;
          $('#blue-ladder-preview').textContent=`目标 ${asset} 敞口 = ${x||'x'} × min(1, 最近40日实心蓝点天数 ÷ ${n||'n'}) 倍。`;}
        if(row.dataset.customRule==='ccc_top'){
          $('#ccc-top-stack').disabled=action!=='scale';
          const val=id=>Number($('#rule-'+id+'-value').value),base=Number(form.elements.namedItem('baseExposure').value),top=val('ccc_top');
          $('#ccc-stack-preview').textContent=action!=='scale'?'见顶预警改为“常态敞口 × 乘数”时可启用累乘。':!$('#ccc-top-stack').checked?'累乘已关闭：同时出现的规则只按优先级选择一条。':`两条均为乘数操作且同时生效时：与信用压力组合 ${base} × ${top} × ${val('ccc_stress')} = ${Number((base*top*val('ccc_stress')).toFixed(6))} 倍；与高于200日线组合 ${base} × ${top} × ${val('ccc_above')} = ${Number((base*top*val('ccc_above')).toFixed(6))} 倍底层敞口。`;
        }
        if(row.dataset.customRule==='yellow'){
          const ignored=action==='ignore';$('#yellow-unlock-options').hidden=ignored;
          $('#yellow-tdc-enabled').disabled=ignored;$('#yellow-price-enabled').disabled=ignored;$('#yellow-blue-enabled').disabled=ignored;
          $('#yellow-tdc-threshold').disabled=ignored||!$('#yellow-tdc-enabled').checked;
          $('#yellow-repair-pct').disabled=ignored||!$('#yellow-price-enabled').checked;
        }
        row.classList.toggle('rule-ignored',action==='ignore');
      });
    }
    function write(c){
      for(const key of ['name','asset','baseExposure','band','costMultiplier']){
        const input=form.elements.namedItem(key);input.value=key==='band'?c[key]*100:c[key];
      }
      form.elements.namedItem('allowSynthetic').checked=c.allowSynthetic;
      method.value=c.momentum?.method??C.DEFAULT_MOMENTUM_METHOD;
      $('#bear-gate-enabled').checked=c.bearGateEnabled===true;
      $('#drawdown-gate-enabled').checked=c.drawdownGateEnabled===true;
      $('#ccc-stress-blue-limit-enabled').checked=c.cccStressBlueLimitEnabled===true;
      for(const r of c.rules){const row=form.querySelector(`[data-custom-rule="${r.id}"]`);for(const key of ['action','value','days','priority']){const input=row.querySelector(`[data-rule-field="${key}"]`);if(input)input.value=r[key];}}
      $('#ccc-top-stack').checked=c.rules.find(r=>r.id==='ccc_top').stackWithCredit!==false;
      $('#rule-blue-steps').value=c.rules.find(r=>r.id==='blue').steps??10;
      $('#rule-blue-asset').value=c.rules.find(r=>r.id==='blue').asset??'inherit';
      $('#blue-only-if-not-lower').checked=c.rules.find(r=>r.id==='blue').onlyIfNotLower!==false;
      const unlock=c.rules.find(r=>r.id==='yellow').unlock;
      $('#yellow-tdc-enabled').checked=unlock.tdcEnabled;$('#yellow-tdc-threshold').value=unlock.tdcThreshold;
      $('#yellow-blue-enabled').checked=unlock.blueEnabled;$('#yellow-price-enabled').checked=unlock.priceEnabled;$('#yellow-repair-pct').value=unlock.repairPct;
      syncRows();
    }
    function read(){
      const v=key=>form.elements.namedItem(key).value;
      return{schemaVersion:1,name:v('name'),asset:v('asset'),momentum:{method:method.value},bearGateEnabled:$('#bear-gate-enabled').checked,drawdownGateEnabled:$('#drawdown-gate-enabled').checked,cccStressBlueLimitEnabled:$('#ccc-stress-blue-limit-enabled').checked,baseExposure:Number(v('baseExposure')),band:Number(v('band'))/100,costMultiplier:Number(v('costMultiplier')),allowSynthetic:form.elements.namedItem('allowSynthetic').checked,rules:C.RULES.map(r=>{const row=form.querySelector(`[data-custom-rule="${r.id}"]`),val=k=>row.querySelector(`[data-rule-field="${k}"]`)?.value;return{id:r.id,action:val('action'),value:Number(val('value')),...(r.conditional?{unlock:{tdcEnabled:$('#yellow-tdc-enabled').checked,tdcThreshold:Number($('#yellow-tdc-threshold').value),priceEnabled:$('#yellow-price-enabled').checked,blueEnabled:$('#yellow-blue-enabled').checked,repairPct:Number($('#yellow-repair-pct').value)}}:{days:r.state?1:Number(val('days'))}),priority:Number(val('priority')),...(r.id==='ccc_top'?{stackWithCredit:$('#ccc-top-stack').checked}:{}),...(r.id==='blue'?{asset:$('#rule-blue-asset').value,steps:Number($('#rule-blue-steps').value),onlyIfNotLower:$('#blue-only-if-not-lower').checked}:{})};})};
    }
    function dirty(){syncRows();if(busy)return;status.textContent=lastResult?'设置已修改。图中仍为上次生成的回测，请点击“生成回测”应用新设置。':'设置完成后点击“生成回测”。';status.classList.remove('error');$('#custom-stale').hidden=!lastResult;}
    function load(){
      if(data)return Promise.resolve(data);
      if(!loading)loading=fetch('./custom-inputs.json').then(r=>{if(!r.ok)throw new Error('历史行情读取失败，请稍后重试。');return r.json();}).then(value=>{if(value.schemaVersion!==1)throw new Error('历史行情格式无效。');data=value;return value;}).catch(e=>{loading=null;throw e;});
      return loading;
    }
    function loadDgs30(){
      if(!ratesLoading)ratesLoading=fetch('./dgs30.json').then(r=>{
        if(!r.ok)throw new Error('FRED DGS30 历史数据读取失败，请稍后重试。');
        return r.json();
      }).then(snapshot=>{
        if(snapshot.series!=='DGS30'||!snapshot.yieldsBp)throw new Error('FRED DGS30 历史数据格式无效。');
        return snapshot;
      }).catch(e=>{ratesLoading=null;throw e;});
      return ratesLoading;
    }
    write(draft);
    if(migratedBlueComparison)status.textContent='蓝点已默认启用敞口比较：抄底目标不小于当天常态/锁仓目标时才允许执行。请重新生成回测应用新设置。';
    if(migratedTools)status.textContent='已统一使用当时可交易的最高倍数ETF；蓝点跟随常态底层，旧持仓工具选择不再使用，请重新生成回测。';
    if(migratedYellow)status.textContent='已将保存的黄点设置改为条件解锁：默认TDC＜60或QQQ距52周高点不超过3%；旧持续天数不再使用，请检查后生成回测。';
    if(migratedBlueUnlock)status.textContent='黄点已默认启用“实心蓝点永久解锁”：解锁后仅新黄点才重新锁定。请重新生成回测应用新设置。';
    if(migratedCreditStack)status.textContent='CCC见顶预警已启用与信用压力或高于200日线累乘；请检查乘数并重新生成回测。每日已登记策略保持原配置。';
    if(migratedBearGate)status.textContent='原200日线清仓已改为拟合·进取熊市闸门：低于均线且均线较21日前下降时，仅限制常态多头，允许蓝点抄底。请重新生成回测。';
    if(migratedMomentum)status.textContent='旧动量设置已选用综合方法，可切换选品方法后重新生成回测。';
    form.addEventListener('input',dirty);form.addEventListener('change',dirty);
    async function generate(settings,registered=false){
      if(busy)return;
      busy=true;button.disabled=true;form.setAttribute('aria-busy','true');status.classList.remove('error');status.textContent='正在读取每日行情并计算自定义回测…';
      // Freeze the submitted settings while input loading or calculation is in progress.
      const inputs=[...form.querySelectorAll('input,select,button')],previous=inputs.map(e=>e.disabled);inputs.forEach(e=>e.disabled=true);
      try{
        const [panel,rates]=await Promise.all([load(),C.usesDgs30(settings)?loadDgs30():null]);
        const source=rates?{...panel,dgs30:rates.yieldsBp,meta:{...panel.meta,dgs30CSVHash:rates.csvSHA256}}:panel;
        await new Promise(resolve=>setTimeout(resolve,0));
        const result=C.run(source,{
          ...settings,
          start:registered?settings.start:source.meta.start,
          end:registered?settings.end:source.meta.end
        });
        lastResult=result;
        let saved=true;
        if(!registered)try{localStorage.setItem(STORAGE,JSON.stringify(result.config));}catch{saved=false;}
        $('#custom-stale').hidden=true;
        $('#export-custom-settings').disabled=false;$('#export-custom-daily').disabled=false;
        const a=result.audit;
        $('#custom-summary').hidden=false;
        $('#custom-summary').innerHTML=`<strong>${esc(result.config.name)}</strong><span>${result.range.start} — ${result.range.end} · ${a.days.toLocaleString()} 个交易日 · ${a.rebalanceDays} 次调仓</span><p>${a.limitedDays?`${a.limitedDays} 日的目标受当时可交易工具及100%资金权重限制，已按实际可实现敞口计算。`:'全部目标均可按所选工具及蓝点融资规则实现。'}${result.config.bearGateEnabled?` 熊市闸门条件命中 ${a.bearGateDays} 日，常态多头受限 ${a.bearGateAppliedDays} 日。`:''}${result.config.drawdownGateEnabled?` 回撤闸触发状态 ${a.drawdownGateDays} 日，常态多头减半 ${a.drawdownGateAppliedDays} 日。`:''}${result.config.cccStressBlueLimitEnabled?` CCC压力位蓝点限制已启用（10日波动率、跟随当日默认标的），降低最终多头目标 ${a.cccStressBlueLimitDays} 日。`:''}${a.syntheticDays?` 含 ${a.syntheticDays} 日合成ETF持仓。`:' 未持有合成ETF。'}${a.financingDays?` 融资持仓 ${a.financingDays} 日，年利率固定5%，累计利息相当于初始资金的 ${(a.financingInterestPaid*100).toFixed(2)}%。`:''}</p>`;
        status.textContent=`回测已生成，可在图右上角切换查看周期。${registered?'本次采用当前登记参数。':saved?'设置已保存在本浏览器。':'本浏览器无法保存设置，可下载设置备份。'}`;
        onResult(result,C.readings(source),registered);
        $('#history').scrollIntoView({behavior:'smooth',block:'start'});
      }catch(e){status.textContent=(e.message||'回测未完成，请重试。')+(lastResult?' 本次未生成新回测，下方保留上次结果。':'');if(lastResult)$('#custom-stale').hidden=false;status.classList.add('error');if(registered)status.scrollIntoView({block:'center'});}
      finally{inputs.forEach((e,i)=>e.disabled=previous[i]);busy=false;button.disabled=false;form.removeAttribute('aria-busy');syncRows();}
    }
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if(!busy&&form.reportValidity())generate(read());
    });
    form.addEventListener('registered-backtest',event=>generate(event.detail,true));
    $('#reset-custom').addEventListener('click',()=>{write(C.defaults());dirty();});
    function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    $('#export-custom-settings').addEventListener('click',()=>{if(lastResult)download('自定义策略_设置.json',JSON.stringify({config:lastResult.config,inputHash:lastResult.audit.inputHash,metrics:lastResult.metrics,range:lastResult.range,audit:lastResult.audit},null,2),'application/json;charset=utf-8');});
    $('#export-custom-daily').addEventListener('click',()=>{
      if(!lastResult)return;
      const rows=[['日期','信号日','净值','QQQ净值','持仓','现金权重（负数为融资负债）','底层敞口','实际调仓','生效规则','依据','本期融资利息（初始资金单位）','融资年利率','CCC压力位蓝点限制已启用','CCC极端压力','波动率监测标的（当日常态底层）','10日年化实现波动率','本层前目标敞口','压力期多头上限','本层后目标敞口','本层实际限制目标','CCC数据观察日','回撤闸已启用','回撤闸触发状态','回撤闸本次减半','回撤闸参考净值','回撤闸参考峰值','回撤闸参考回撤']];
      for(const p of lastResult.history){const d=lastResult.details.points[p.date];rows.push([p.date,d.signalDate,p.nav,d.benchmarkNav,d.holdings.map(([s,w])=>`${s} ${(w*100).toFixed(4)}%`).join(' / '),d.cash,d.exposure,d.rebalanced?'是':'否',d.state,d.reasons.join(' '),d.financingInterest,d.financingAnnualRate,d.cccStressBlueLimit?'是':'否',d.cccStressBlueLimit?.active?'是':'否',d.cccStressBlueLimit?.monitorAsset??'',d.cccStressBlueLimit?.volatility??'',d.cccStressBlueLimit?.originalExposure??'',d.cccStressBlueLimit?.active?d.cccStressBlueLimit.cap??'':'',d.cccStressBlueLimit?.exposure??'',d.cccStressBlueLimit?.applied?'是':'否',d.cccStressBlueLimit?.creditSourceDate??'',d.drawdownGate?'是':'否',d.drawdownGate?.active?'是':'否',d.drawdownGate?.applied?'是':'否',d.drawdownGate?.referenceNAV??'',d.drawdownGate?.peak??'',d.drawdownGate?.drawdown??''])}
      const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');download('自定义策略_每日回测.csv',csv,'text/csv;charset=utf-8');
    });
    return{getResult:()=>lastResult};
  }
  root.CustomControls=Object.freeze({attach});
})(window);
