import '../public/custom-backtest.js';

const C=globalThis.CustomBacktest;

export function customMarketInput(symbols,previous,row){
  const returns=symbols.map(({symbol,synthetic})=>synthetic?0:row.prices[symbol]/previous.prices[symbol]-1);
  if(returns.some(value=>!Number.isFinite(value)||value<=-1))throw new Error('自定义回测缺少复权收盘行情 '+row.date);
  const costs=symbols.map(({symbol})=>row.costs[symbol]??0);
  const tradable=symbols.reduce((mask,{symbol},i)=>mask|(row.tradable[symbol]===true?1<<i:0),0);
  return {date:row.date,returns,costs,tradable};
}

export function customSignalInput({fit:f,credit:c}){
  const flags=[f.red,f.red_ad,f.blue,f.blue_soft,f.yellow,c.top,c.bot,c.stress,c.above200];
  const signals=flags.reduce((mask,flag,i)=>mask|(flag?1<<i:0),0);
  return {signals,tdc:f.tdc,readings:[f.temp_red,f.tdc,c.spread,c.ma200,c.percentile,c.observationDate]};
}

export function customHistory(panel,research,confirmed,market,prior){
  const baseEnd=panel.meta.end,inputHash=panel.meta.inputHash;
  if(!research||research.baseEnd!==baseEnd||research.version!==panel.meta.researchVersion)return null;
  const signals=new Map(research.modelRows.map(row=>[row.date,row]));
  const confirmedByDate=new Map(confirmed.map(row=>[row.date,row]));
  const previous=prior?.inputHash===inputHash?new Map(prior.rows.map(row=>[row.date,row])):new Map();
  const marketIndex=new Map(market.map((row,i)=>[row.date,i]));
  const rows=[];
  let signalThrough=baseEnd;
  for(const date of research.dates){
    const row=confirmedByDate.get(date),model=signals.get(date),i=marketIndex.get(date);
    if(row&&model&&date<=research.signalThrough&&signalThrough===(rows.at(-1)?.date??baseEnd)){
      rows.push({...row,...customSignalInput(model)});
      signalThrough=date;
    }else{
      const input=i>0?customMarketInput(panel.symbols,market[i-1],market[i]):previous.get(date);
      if(!input)break;
      const {returns,costs,tradable}=input;
      rows.push({date,returns,costs,tradable});
    }
  }
  return {inputHash,baseEnd,signalThrough,rows};
}

export function validationHistory(daily,details,research,panel,extension,rates,vix,registration){
  if(!research||!extension||!registration)return null;
  const {baseEnd,dates,signalThrough}=research;
  const point=(date,detail,baseNav)=>({date,nav:detail.nav/baseNav,signalDate:detail.signalDate,
    weights:{...Object.fromEntries(detail.holdings),BIL:detail.cash},state:detail.state,
    reasons:detail.reasons,rebalanced:detail.rebalanced,replayed:true});
  const strategies=Object.fromEntries(Object.entries(research.strategies).map(([id,style])=>{
    const base=daily.strategies[id].at(-1);
    return [id,[point(baseEnd,{...details.strategies[id].points[baseEnd],nav:base},base),
      ...dates.map(date=>point(date,style.points[date],base))]];
  }));
  const config=registration.configSnapshot;
  const source=C.extendInputs(panel,extension,rates,vix,config);
  const result=C.run(source,{...config,end:source.meta.end});
  const base=result.details.points[baseEnd].nav;
  strategies[registration.id]=result.history.filter(p=>p.date>=baseEnd)
    .map(p=>point(p.date,result.details.points[p.date],base));
  return {baseEnd,marketThrough:dates.at(-1)??baseEnd,signalThrough,
    customSignalThrough:source.signalThrough??source.meta.end,customVersion:registration.configVersion,
    researchVersion:research.version,strategies};
}
