import {calculateLive,rebaseSeed} from './live-engine.js';
import {advanceLedger,queueTargets} from './forward-ledger.js';

const leverage={QQQ:1,SOXX:1,QLD:2,USD:2,TQQQ:3,SOXL:3,PSQ:-1,SQQQ:-3};
const cash=weights=>weights.BIL??0;
const equities=weights=>Object.entries(weights).filter(([symbol,weight])=>symbol!=='BIL'&&weight>1e-9);
const exposure=weights=>equities(weights).reduce((sum,[symbol,weight])=>sum+weight*leverage[symbol],0);

export function portfolioTarget(style) {
  return {signalDate:style.signalDate,weights:{...Object.fromEntries(style.holdings.map(h=>[h.symbol,h.weight])),BIL:style.cash},
    selection:style.selection,state:style.state,reasons:[style.summary,...style.reasons.filter(r=>r.active).map(r=>r.title+'：'+r.detail)]};
}

function recordClose(style,point,before,target,priorTarget,benchmarkNav) {
  const weights=point.weights,desired=target.weights;
  style.points[point.date]={signalDate:point.signalDate,state:point.state,selection:point.selection,
    holdings:equities(weights),cash:cash(weights),exposure:exposure(weights),
    targetHoldings:equities(desired),targetCash:cash(desired),targetExposure:exposure(desired),
    reasons:point.reasons,rebalanced:point.rebalanced,benchmarkNav,nav:point.nav};
  if(!point.rebalanced)return;
  const symbols=new Set([...Object.keys(before),...Object.keys(weights)]);
  const rebalanceOnly=priorTarget&&[...new Set([...Object.keys(desired),...Object.keys(priorTarget.weights)])]
    .every(symbol=>Math.abs((desired[symbol]??0)-(priorTarget.weights[symbol]??0))<1e-9);
  for(const symbol of symbols){
    if(symbol==='BIL')continue;
    const a=before[symbol]??0,b=weights[symbol]??0;
    if(Math.abs(a-b)<1e-9)continue;
    const type=a<=1e-9?'buy':b<=1e-9?'sell':b>a?'add':'reduce';
    style.trades.push({date:point.date,signalDate:point.signalDate,symbol,type,weightBefore:a,weightAfter:b,weightChange:b-a,
      cashBefore:cash(before),cashAfter:cash(weights),exposureBefore:exposure(before),exposureAfter:exposure(weights),
      leverage:leverage[symbol],inverse:leverage[symbol]<0,state:point.state,rebalanceOnly:!!rebalanceOnly,
      reason:rebalanceOnly?'rebalancing_band':'target_update',reasonDate:point.date});
  }
}

/** Recompute the dated backtest extension from the verified research close. The forward ledger has its own observation times. */
export function extendResearchHistory(base,seed,daily,details,marketRows,modelRows,prior,observedAt) {
  const version=base.meta.researchVersion,baseEnd=seed.date;
  if(!version||[seed.researchVersion,daily.meta.researchVersion,details.meta.researchVersion].some(value=>value!==version)
    ||daily.dates.at(-1)!==baseEnd||details.meta.historyEnd!==baseEnd)throw new Error('回测起点版本不一致');
  const market=marketRows.filter(row=>Date.parse(row.closeAt)<=Date.parse(observedAt));
  const start=market.findIndex(row=>row.date===baseEnd);
  if(start<0)throw new Error('缺少回测截止日的复权行情');
  const closes=market.slice(start);
  if(prior?.version===version&&prior.dates.at(-1)>closes.at(-1).date)throw new Error('最新行情早于已发布的回测日期');

  const signals=new Map();
  for(const row of [...(prior?.version===version?prior.modelRows:[]),...modelRows]){
    if(row.date>baseEnd)signals.set(row.date,{date:row.date,fit:row.fit,credit:row.credit});
  }
  const aligned=[];
  for(const row of closes.slice(1)){
    const signal=signals.get(row.date);
    if(!signal)break;
    aligned.push({...row,...signal});
  }
  const targets=new Map();
  const calculated=calculateLive(base,rebaseSeed(seed,market),aligned,style=>{
    if(!targets.has(style.signalDate))targets.set(style.signalDate,{});
    targets.get(style.signalDate)[style.id]=portfolioTarget(style);
  });
  if(calculated.blocked.length)throw new Error(calculated.blocked.map(b=>b.id+' '+b.reason).join('、'));
  const strategies={};
  let state={startDate:baseEnd,strategies:base.strategies.map(style=>{
    const {id}=style,point=details.strategies[id].points[baseEnd];
    const nav=daily.strategies[id].at(-1);
    const weights=Object.fromEntries([...point.holdings,['BIL',point.cash]]);
    const total=Object.values(weights).reduce((sum,value)=>sum+value,0);
    if(!Number.isFinite(nav)||nav<=0||Math.abs(total-1)>1e-6||Object.keys(weights).some(s=>s!=='BIL'&&!leverage[s]))throw new Error('回测收盘仓位无效 '+id);
    strategies[id]={nav:[],points:{},trades:[]};
    return {id,band:.05,points:[],lastDate:baseEnd,amounts:Object.fromEntries(Object.entries(weights).map(([s,w])=>[s,w/total*nav])),
      pending:{...portfolioTarget(style),observedAt:closes[0].closeAt}};
  })};

  const dates=[],benchmark=[];
  let benchmarkNav=daily.benchmark.at(-1);
  for(let i=1;i<closes.length;i++){
    const row=closes[i],previous=closes[i-1];
    benchmarkNav*=row.prices.QQQ/previous.prices.QQQ;
    const lastTargets=Object.fromEntries(state.strategies.map(s=>[s.id,s.applied]));
    state=advanceLedger(state,[previous,row],{observedAt:row.closeAt,onClose(id,point,before,target){
      strategies[id].nav.push(point.nav);
      recordClose(strategies[id],point,before,target,lastTargets[id],benchmarkNav);
    }});
    for(const strategy of state.strategies)strategy.points=[];
    dates.push(row.date);
    benchmark.push(benchmarkNav);
    const next=targets.get(row.date);
    if(next)state=queueTargets(state,next,row.closeAt);
  }
  return {version,baseEnd,dates,benchmark,strategies,signalThrough:calculated.checkpoint.date,modelRows:[...signals.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
