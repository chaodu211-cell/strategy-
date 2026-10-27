/**
 * Exact incremental continuation of strategy2.py, starting from a Python checkpoint.
 * No network access and no synthetic substitution for missing prices.
 * Price basis must be adjusted; instrument tradability must be supplied by the
 * upstream exporter using the source bt.py liquidity/listing rules.
 */
export const STATE_NAMES = {0:'常态',1:'红点',2:'乘数为零',3:'黄点锁仓',4:'抄底'};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const copy = value => JSON.parse(JSON.stringify(value));
const firstDayOfMonth = (date, previous) => date.slice(0,7) !== previous?.slice(0,7);
const sum = values => values.reduce((a,b)=>a+b,0);
const number = value => String(Number(Number(value).toFixed(6)));
export class MissingInput extends Error { constructor(message) {super(message);this.name='MissingInput';} }
function requireValue(value, name) {if(!finite(value))throw new MissingInput(`缺少 ${name}`);return value;}
function rollingMean(values,min) {const valid=values.filter(finite);return valid.length>=min?sum(valid)/valid.length:NaN;}
function rollingVol(history,symbol,window) {
  const returns=[];
  for(let i=Math.max(1,history.length-window);i<history.length;i++) {
    const a=history[i-1].prices[symbol],b=history[i].prices[symbol];
    if(finite(a)&&a>0&&finite(b))returns.push(b/a-1);
  }
  if(returns.length<Math.floor(window*.8)||returns.length<2)return NaN;
  const mean=sum(returns)/returns.length;
  return Math.sqrt(sum(returns.map(x=>(x-mean)**2))/(returns.length-1))*Math.sqrt(252);
}
export function deriveMarket(history, row, previousChoice, previousDate) {
  if(row.priceBasis!=='adjusted')throw new MissingInput('缺少经过验证的复权 ETF 日线，不能以模型页面两位小数价格替代');
  const q=requireValue(row.prices?.QQQ,`${row.date} QQQ复权收盘`);
  if(q<=0)throw new MissingInput('QQQ复权收盘无效');
  const qvalues=history.map(r=>r.prices.QQQ);
  const ma=rollingMean(qvalues.slice(-200),200);
  const oldMa=rollingMean(qvalues.slice(-221,-21),200);
  const high=qvalues.slice(-252).filter(finite);
  const dd52=high.length>=60?q/Math.max(...high)-1:NaN;
  let choice=previousChoice;
  if(firstDayOfMonth(row.date,previousDate)||!['QQQ','SOXX'].includes(choice)) {
    const l=history.length;
    const calc=symbol=>{
      const a=history[l-22]?.prices[symbol],b=history[l-127]?.prices[symbol];
      return finite(a)&&finite(b)&&b>0?a/b-1:NaN;
    };
    const sq=calc('QQQ'),ss=calc('SOXX');
    if(finite(sq)&&finite(ss)) {
      if(previousChoice==='SOXX')choice=sq>ss?'QQQ':'SOXX';
      else choice=ss>sq?'SOXX':'QQQ';
    } else if(row.pickVerified===true&&['QQQ','SOXX'].includes(row.pick))choice=row.pick;
    else throw new MissingInput('跨月动量选品缺少 QQQ/SOXX 第21与126交易日复权价格');
  }
  return {bear:q<ma&&ma<oldMa,dd52,choice,vol:Object.fromEntries(['QQQ','SOXX'].map(s=>[s,Object.fromEntries([10,20,40,60].map(w=>[w,rollingVol(history,s,w)]))])),best:null};
}
function instrument(row,market,kind,underlying,short=false) {
  if(market.best) {
    const got=short?market.best[kind]?.short?.[underlying]:market.best[kind]?.[underlying];
    return got||null;
  }
  const candidates=short?[[underlying,underlying==='PSQ'?-1:-3]]:kind==='one'?[[underlying,1]]:
    underlying==='QQQ'?[['TQQQ',3],['QLD',2],['QQQ',1]]:[['SOXL',3],['USD',2],['SOXX',1]];
  for(const [symbol,leverage] of candidates) {
    if(row.tradable?.[symbol]===false)continue;
    if(row.tradable?.[symbol]!==true)throw new MissingInput(`缺少 ${row.date} ${symbol} 可交易性检查（上市期和成交额）`);
    requireValue(row.prices?.[symbol],`${row.date} ${symbol}复权收盘`);
    return {symbol,leverage,underlying:short?'QQQ':underlying};
  }
  return null;
}
/** One transaction: checkpoint is not mutated when a required dependency is absent. */
export function stepStrategy(checkpoint, cfg, row, market, kind='lev') {
  const s=copy(checkpoint),p=cfg;
  const t=s.index+1;
  if(p.dd_brake) {
    let ret=0;
    for(const [symbol,weight] of Object.entries(s.prevWeights)) {
      if(!weight)continue;
      let r=row.returns?.[symbol];
      if(!finite(r)) {
        const before=row.previousPrices?.[symbol]??s.prevPrices?.[symbol],now=row.prices?.[symbol];
        if(row.priceBasis!=='adjusted'||!finite(before)||!finite(now)||before<=0)throw new MissingInput(`回撤闸缺少 ${row.date} ${symbol}真实复权日收益`);
        r=now/before-1;
      }
      ret+=weight*r;
    }
    s.nav*=1+ret;s.peak=Math.max(s.peak,s.nav);
    const dd=s.nav/s.peak-1;
    if(dd<=-p.dd_brake[0])s.braked=true;
    else if(dd>=-p.dd_brake[0]/2)s.braked=false;
  }
  const f=row.fit,c=row.credit;
  for(const key of ['red','red_ad','blue','blue_soft','yellow'])if(typeof f?.[key]!=='boolean')throw new MissingInput(`缺少 ${row.date} 最优拟合 ${key}信号`);
  if(!row.market){
    requireValue(f.tdc,`${row.date} TDC`);
    for(const key of ['spread','ma200','percentile'])requireValue(c?.[key],`${row.date} CCC ${key}`);
  }
  if(typeof c.top!=='boolean'||typeof c.bot!=='boolean')throw new MissingInput('缺少CCC冷却后的见顶/见底事件');
  if(f.red||(p.use_ad&&f.red_ad))s.lastRed=t;
  if(f.blue){s.lastBlue=t;if(p.blue_unlock)s.locked=false;}
  if(f.blue_soft)s.lastSoft=t;
  if(c.top)s.lastCreditTop=t;
  if(c.bot){s.lastCreditBottom=t;if(p.ccc_bot_release)s.locked=false;}
  if(f.yellow&&p.yellow_lock)s.locked=true;
  else if(s.locked&&finite(f.tdc)&&f.tdc<p.rearm)s.locked=false;
  else if(s.locked&&p.rec_unlock!==null&&finite(market.dd52)&&market.dd52>=p.rec_unlock)s.locked=false;
  s.blueIndices.push(...(f.blue?[t]:[]));s.softIndices.push(...(f.blue_soft?[t]:[]));
  s.blueIndices=s.blueIndices.filter(i=>i>t-Math.max(p.blue_hold,1));
  s.softIndices=s.softIndices.filter(i=>i>t-Math.max(p.blue_hold,1));
  const redOn=t-s.lastRed<p.red_hold;
  const blueOn=t-s.lastBlue<p.blue_hold||(p.soft_mult>0&&t-s.lastSoft<p.blue_hold);
  const bottomOn=p.ccc_bot_hold>0&&t-s.lastCreditBottom<p.ccc_bot_hold;
  let Eb=0;
  if(blueOn||bottomOn) {
    if(blueOn)Eb=p.blue_lev*Math.min(1,(s.blueIndices.length+p.soft_mult*s.softIndices.length)/p.blue_k);
    if(bottomOn)Eb=Math.max(Eb,p.ccc_bot_lev);
    if(p.blue_gate_vol) {
      const v=market.vol?.[p.blue_asset]?.[10];
      if(finite(v)&&v>0)Eb*=Math.min(1,p.blue_gate_vol/v);
    }
  }
  const selection=p.pick==='switch'?market.choice:p.pick;
  if(!['QQQ','SOXX'].includes(selection))throw new MissingInput('月度常态选品不可用');
  let state=0,En,mult=1,base=p.lev_max;
  const factors=[];
  if(s.locked){state=3;En=-p.short_yellow;}
  else {
    const add=(condition,multiplier,title)=>{if(condition){mult*=multiplier;if(multiplier!==1)factors.push({title,multiplier});}};
    add(redOn,p.red_mult,'红点窗口');if(redOn)state=1;
    add(c.above200??c.spread>c.ma200,p.ccc_up_mult,'CCC 高于 200 日线');
    add(c.stress??c.percentile>=95,p.ccc_stress_mult,'CCC 压力阶段');
    add(t-s.lastCreditTop<p.ccc_top_hold,p.ccc_top_mult,'CCC 见顶预警窗口');
    add(market.bear,p.bear_mult,'熊市闸门');
    add(s.braked,p.dd_brake?.[1]??1,'组合回撤闸');
    if(mult<=0){state=state||2;En=state===1?-p.short_red:0;}
    else {
      const v=market.vol?.[selection]?.[p.vol_win];
      if(p.vol_tgt!==null&&finite(v)&&v>0)base=Math.min(base,p.vol_tgt/v);
      En=base*mult;
    }
  }
  let holdings=[],exposure=0;
  const assign=(underlying,e,isShort=false)=>{
    const tool=instrument(row,market,kind,underlying,isShort);if(!tool)return;
    const weight=Math.min(1,e/Math.abs(tool.leverage));
    if(weight>0){holdings=[{...tool,weight}];exposure=weight*tool.leverage;}
  };
  if(Eb>0&&Eb>=En){state=4;assign(p.blue_asset,Eb);}
  else if(En<0)assign(p.short_inst,-En,true);
  else if(En>0)assign(selection,En);
  const cash=1-sum(holdings.map(h=>h.weight));
  s.index=t;s.date=row.date;s.prevWeights=Object.fromEntries(holdings.map(h=>[h.symbol,h.weight]));s.prevPrices={...row.prices};s.choice=market.choice;
  s.state=state;s.exposure=exposure;
  return {checkpoint:s,holdings,cash,exposure,state:STATE_NAMES[state],stateId:state,selection,baseExposure:base,
    flags:{redOn,locked:s.locked,blueOn,bottomOn,braked:s.braked,bear:market.bear,dd52:market.dd52},factors,
    formula:state===3||state===4?`${STATE_NAMES[state]}优先级覆盖 → ${number(exposure)} 倍底层敞口`:exposure<0?`红点离场 → ${number(exposure)} 倍纳指底层敞口`:`${[base,...factors.map(f=>f.multiplier)].map(number).join(' × ')} = ${number(exposure)} 倍底层敞口`};
}
function eventFrom(historyIndex,lastIndex,dates,type,label) {
  return {type,label,date:lastIndex>=0?dates?.[lastIndex]??null:null,age:lastIndex>=0?historyIndex-lastIndex:null};
}
function describe(result,p,row) {
  const flags=result.flags,c=row.credit,s=result.checkpoint;
  const selected=result.selection;
  const reason=(title,detail,matched=false,active=false,multiplier)=>({title,detail,matched,active,...(finite(multiplier)?{multiplier}:{})});
  const normal=result.stateId!==3&&result.stateId!==4;
  const reasons=[reason('常态选品与基准敞口',`${p.pick==='switch'?'月度动量选中':'固定持有'} ${selected} 底层，常态基准 ${number(result.baseExposure)} 倍。`,true,normal,result.baseExposure),
    reason('红点窗口',`${p.use_ad?'实心或空心':'实心'}红点距今 ${s.index-s.lastRed} 个交易日；${p.red_hold}日窗口${flags.redOn?'生效':'未生效'}。`,flags.redOn,normal&&flags.redOn&&p.red_mult!==1,p.red_mult),
    reason('黄点锁仓',flags.locked?'黄点锁仓仍生效，按该档锁仓规则配置。':`当前未锁仓；TDC ${number(row.fit.tdc)}，解锁条件按完整历史状态机判断。`,flags.locked,flags.locked&&result.stateId===3),
    reason('CCC 高于 200 日线',`利差 ${c.spread.toFixed(2)}%，200日均线 ${c.ma200.toFixed(2)}%；条件${c.above200?'命中':'未命中'}，命中乘 ${number(p.ccc_up_mult)}。`,c.above200,normal&&c.above200&&p.ccc_up_mult!==1,p.ccc_up_mult),
    reason('CCC 压力阶段',`252日分位 ${c.percentile.toFixed(1)}，压力阈值95；条件${c.stress?'命中':'未命中'}，命中乘 ${number(p.ccc_stress_mult)}。`,c.stress,normal&&c.stress&&p.ccc_stress_mult!==1,p.ccc_stress_mult),
    reason('CCC 见顶预警窗口',`距最近见顶事件 ${s.index-s.lastCreditTop} 个交易日，本档窗口 ${p.ccc_top_hold} 日。`,s.index-s.lastCreditTop<p.ccc_top_hold,normal&&s.index-s.lastCreditTop<p.ccc_top_hold&&p.ccc_top_mult!==1,p.ccc_top_mult),
    reason('熊市闸门',flags.bear?'QQQ低于200日均线且均线下行。':'未同时满足QQQ低于200日均线且均线下行。',flags.bear,normal&&flags.bear&&p.bear_mult!==1,p.bear_mult),
    reason('蓝点抄底覆盖',result.stateId===4?'抄底敞口优先于常态敞口。':flags.blueOn?'抄底窗口内，按抄底与常态敞口较大者执行。':'当前不在该档抄底窗口。',flags.blueOn,result.stateId===4)];
  if(p.dd_brake)reasons.push(reason('组合回撤闸',`按原引擎目标权重的实际ETF收盘收益累积；当前回撤 ${(100*(s.nav/s.peak-1)).toFixed(1)}%，${flags.braked?'已触发':'未触发'}。`,flags.braked,normal&&flags.braked,p.dd_brake[1]));
  let summary;
  if(result.stateId===3)summary=`黄点锁仓生效，目标底层敞口 ${number(result.exposure)} 倍。`;
  else if(result.stateId===4)summary=`抄底规则优先级覆盖，目标底层敞口 ${number(result.exposure)} 倍。`;
  else if(result.exposure===0)summary=`${result.factors.filter(f=>f.multiplier===0).map(f=>f.title).join('、')||'离场规则'}使权益敞口归零，目标为100% BIL。`;
  else summary=`常态底层 ${selected}；${result.factors.map(f=>f.title).join('、')||'无额外减仓条件'}，最终敞口 ${number(result.exposure)} 倍。`;
  return {reasons,summary};
}
/**
 * rows are complete, chronological trading-day inputs. A blocked style retains its
 * previous portfolio and date. Historical metrics and curves stay unchanged.
 */
export function calculateLive(baseData, seed, rows) {
  const data=copy(baseData),checkpoint=copy(seed),updates=[],blocked=[];
  const allDates={...checkpoint.dates};
  let history=checkpoint.marketHistory||[];
  let previousDate=checkpoint.date;
  let previousChoice=checkpoint.choice;
  const consumed=[];
  for(const row of rows) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date||''))throw new MissingInput('输入交易日格式错误');
    if(row.date<=checkpoint.date)continue;
    if(previousDate&&row.date<=previousDate)throw new MissingInput('输入交易日必须严格递增');
    history=[...history,{date:row.date,prices:row.prices||{}}].slice(-280);
    let market;
    try {market=row.market||deriveMarket(history,row,previousChoice,previousDate);}
    catch(error){
      if(!(error instanceof MissingInput))throw error;
      blocked.push(...data.strategies.map(s=>({id:s.id,date:row.date,reason:error.message})));
      break;
    }
    const nextIndex=Math.max(...Object.values(checkpoint.strategies).map(s=>s.index))+1;
    allDates[nextIndex]=row.date;
    for(const style of data.strategies) {
      if(blocked.some(b=>b.id===style.id))continue;
      const params=checkpoint.config[style.id],old=checkpoint.strategies[style.id];
      try {
        const result=stepStrategy(old,params,row,market,checkpoint.kinds[style.id]);
        checkpoint.strategies[style.id]=result.checkpoint;
        Object.assign(style,{holdings:result.holdings,cash:result.cash,exposure:result.exposure,state:result.state,selection:result.selection,baseExposure:result.baseExposure,formula:result.formula,signalDate:row.date,...describe(result,params,row),liveStatus:'updated'});
        updates.push({id:style.id,date:row.date});
      } catch(error){
        if(!(error instanceof MissingInput))throw error;
        blocked.push({id:style.id,date:row.date,reason:error.message});
        style.liveStatus='blocked';style.liveMessage=error.message;
      }
    }
    consumed.push(row);previousDate=row.date;previousChoice=market.choice;
  }
  checkpoint.marketHistory=history;checkpoint.dates=allDates;checkpoint.date=previousDate;checkpoint.choice=previousChoice;
  if(consumed.length) {
    const row=consumed.at(-1),ref=checkpoint.strategies['simple-conservative'];
    const index=ref.index;
    const red=eventFrom(index,ref.lastRed,allDates,'red','实心或空心红点');
    data.meta.signalDate=data.strategies.map(s=>s.signalDate).sort()[0];
    data.meta.marketDate=row.date;data.meta.fitDate=row.date;data.meta.cccObservationDate=row.credit.observationDate;
    data.meta.isLive=true;data.meta.targetDateRange={oldest:data.meta.signalDate,newest:data.strategies.map(s=>s.signalDate).sort().at(-1)};
    data.models.fit.tdc=row.fit.tdc;data.models.fit.temperature=row.fit.temp_red;data.models.fit.signalDate=row.date;
    data.models.fit.state=ref.locked?'黄点锁仓':red.age!==null&&red.age<30?'红点离场窗口':'未触发离场约束';
    data.models.fit.facts=[`${data.models.fit.state}。`,`TDC ${number(row.fit.tdc)}；黄点锁定按完整历史状态机计算。`];
    Object.assign(data.models.credit,{...row.credit,phase:row.credit.percentile>=95?'压力':row.credit.percentile<=10?'自满':row.credit.above200?'走阔':'平稳'});
  }
  for(const style of data.strategies){const b=blocked.find(b=>b.id===style.id);if(b){style.liveStatus='blocked';style.liveMessage=b.reason;}}
  data.meta.liveCalculation={updates,blocked,seedDate:seed.seedDate||seed.date};
  return {data,checkpoint,updates,blocked};
}

/** Replace the entire price overlap before continuing after adjusted-history restatements. */
export function rebaseSeed(seed, marketRows) {
  const result=copy(seed),byDate=new Map(marketRows.map(r=>[r.date,r]));
  const replacement=[];
  for(const old of result.marketHistory) {
    const row=byDate.get(old.date);
    if(!row)throw new MissingInput(`复权行情缺少种子重叠日 ${old.date}`);
    for(const symbol of ['QQQ','SOXX']){
      if(!finite(row.prices?.[symbol])||row.prices[symbol]<=0)throw new MissingInput(`复权行情缺少 ${old.date} ${symbol}`);
    }
    replacement.push({date:old.date,prices:copy(row.prices)});
  }
  const last=byDate.get(result.date);
  if(!last)throw new MissingInput('复权行情缺少种子截止日');
  result.marketHistory=replacement;
  for(const style of Object.values(result.strategies)){
    for(const symbol of Object.keys(style.prevWeights)){if(!finite(last.prices?.[symbol]))throw new MissingInput(`复权行情缺少种子持仓 ${symbol}`);}
    style.prevPrices=copy(last.prices);
  }
  result.rebasedAt=result.date;
  return result;
}
