import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRemoteSources} from '../worker/sources.js';
import {calculateLive,rebaseSeed} from '../lib/live-engine.js';
import {advanceLedger,queueTargets,publicLedger} from '../lib/forward-ledger.js';
import {latestModels} from '../worker/index.js';
import {extendDgs30} from './dgs30.mjs';
import {extendResearchHistory,portfolioTarget} from '../lib/research-history.js';
import '../public/custom-backtest.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),C=globalThis.CustomBacktest;
const read=async p=>JSON.parse(await readFile(resolve(root,p),'utf8'));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const save=async(p,value)=>{const full=resolve(root,p);await mkdir(dirname(full),{recursive:true});await writeFile(full+'.tmp',JSON.stringify(value));await rename(full+'.tmp',full);};
const checkedAt=new Date().toISOString(),config=await read('tracking/config.json'),configHash=hash(config);
let state=await read('tracking/state.json');
if(state.configHash&&state.configHash!==configHash)throw new Error('跟踪参数已改变，请建立新的策略版本，不能覆写既有净值账本。');
state.configHash=configHash;
let status={checkedAt,status:'pending',message:'等待完整的ETF收盘行情与两个模型输入。',sources:[],warnings:[]};
let live=null,market,remote;
const [base,seed,prior]=await Promise.all([read('public/data.json'),read('lib/live-seed.json'),read('public/daily-live.json').catch(()=>null)]);
const version=seed.researchVersion;
const sameRelease=prior?.data?.meta?.researchVersion===version;
try{
  if(!process.argv.includes('--use-market-file'))execFileSync(process.env.PYTHON||'python3',[resolve(root,'scripts/fetch-forward-market.py')],{stdio:'inherit'});
  const fetched=await read('.runtime/market.json');
  if(fetched.schemaVersion!==1||fetched.health?.ok!==true||fetched.priceBasis!=='adjusted')throw new Error('行情未通过健康检查');
  market=fetched;
  const nativeFetch=async(url,options={})=>{
    const headers=new Headers(options.headers);
    if(new URL(url).hostname==='api.github.com'&&process.env.GITHUB_TOKEN)headers.set('Authorization','Bearer '+process.env.GITHUB_TOKEN);
    return fetch(url,{...options,headers});
  };
  remote=await loadRemoteSources(nativeFetch,market);
  const observedAt=new Date().toISOString();
  const evidence={observedAt,marketFetchedAt:market.fetchedAt,sources:remote.sources,modelRows:remote.rows.filter(r=>r.date>(state.checkpoint?.date||'2026-10-22')),marketRows:market.rows.filter(r=>r.date>=(state.strategies.map(s=>s.lastDate).filter(Boolean).sort()[0]||config.startDate))};
  const sourceHash=hash(evidence);
  // Value existing positions before observing new targets: late inputs never create past trades.
  state=advanceLedger(state,market.rows,{observedAt,sourceHash});
  const targets={};let calculated=null;
  if(remote.errors.length||!remote.best?.input||!remote.credit?.verified)status.warnings.push(...remote.errors,'模型未全部核验，已有持仓照常估值，暂停产生新目标。');
  else{
    const switching=state.checkpoint?.researchVersion!==version;
    const oldSeed=switching?seed:state.checkpoint;
    const checkpoint=rebaseSeed(oldSeed,market.rows);
    calculated=calculateLive(base,checkpoint,remote.rows.filter(r=>r.date>checkpoint.date));
    if(calculated.blocked.length)throw new Error(calculated.blocked.map(b=>b.id+': '+b.reason).join('; '));
    if(switching&&calculated.checkpoint.date<(state.checkpoint?.date??seed.date))throw new Error('新版目标尚未覆盖旧账本的信号日期');
    state.checkpoint=calculated.checkpoint;
    if(switching){
      for(const strategy of state.strategies.filter(s=>seed.config[s.id])){
        delete strategy.pending;
        strategy.configVersion=version;
      }
    }
    // An unchanged checkpoint needs its complete last target, rather than the historical base card.
    for(const s of calculated.data.strategies){
      const saved=state.strategies.find(x=>x.id===s.id)?.pending;
      if(s.signalDate!==state.checkpoint.strategies[s.id].date){if(saved)targets[s.id]=saved;continue;}
      targets[s.id]={...portfolioTarget(s),configVersion:version};
    }
    const panel=await read('public/custom-inputs.json'),byMarket=new Map(market.rows.map((r,i)=>[r.date,{r,i}]));
    const extra=state.customRows||[],lastDate=extra.at(-1)?.date||panel.dates.at(-1);
    for(const row of remote.rows.filter(r=>r.date>lastDate)){
      const {r,i}=byMarket.get(row.date)||{};if(!r||i<1)throw new Error('自定义跟踪缺少连续行情');
      const expected=market.rows[i-1].date;
      if(expected!==(extra.at(-1)?.date||panel.dates.at(-1)))throw new Error('自定义信号缺日，停止追加目标 '+row.date);
      const before=market.rows[i-1];
      const returns=panel.symbols.map(s=>s.synthetic?0:r.prices[s.symbol]/before.prices[s.symbol]-1);
      const costs=panel.symbols.map(s=>r.costs[s.symbol]||0),tradable=panel.symbols.reduce((m,s,j)=>m|(r.tradable[s.symbol]===true?1<<j:0),0);
      const f=row.fit,c=row.credit,flags=[f.red,f.red_ad,f.blue,f.blue_soft,f.yellow,c.top,c.bot,c.stress,c.above200];
      const peak=Math.max(...market.rows.slice(Math.max(0,i-251),i+1).map(x=>x.prices.QQQ));
      extra.push({date:row.date,returns,costs,tradable,signals:flags.reduce((m,f,j)=>m|(f?1<<j:0),0),tdc:f.tdc,dd52:r.prices.QQQ/peak-1});
    }
    state.customRows=extra;
    for(const r of extra){panel.dates.push(r.date);panel.returns.push(r.returns);panel.costs.push(r.costs);panel.tradable.push(r.tradable);panel.signals.push(r.signals);panel.yellowContext.tdc.push(r.tdc);panel.yellowContext.qqqDrawdown52.push(r.dd52);}
    panel.meta.end=panel.dates.at(-1);
    // Registered v1 rules predate the comparison switch; pin their original behavior.
    // Browser defaults can change without silently changing a running strategy version.
    const registered={...config.custom,rules:config.custom.rules.map(r=>r.id==='blue'?{...r,onlyIfNotLower:r.onlyIfNotLower??false}:r.id==='ccc_top'?{...r,stackWithCredit:r.stackWithCredit??false}:r.id==='yellow'?{...r,unlock:{...r.unlock,blueEnabled:r.unlock?.blueEnabled??false}}:r)};
    const custom=C.validate({...registered,end:panel.meta.end},panel),memory=C.RULES.map(()=>-1e9);let latest;
    if(C.usesDgs30(custom)){
      panel.dgs30=(await read('public/dgs30.json')).yieldsBp;
      const warning=await extendDgs30(panel,extra);
      if(warning)status.warnings.push(warning);
    }
    for(let t=0;t<panel.dates.length;t++)latest=C.resolveTarget(panel,custom,t,memory);
    targets[config.customId||'custom-momentum']={configVersion:hash(config.custom),signalDate:panel.dates.at(-1),weights:Object.fromEntries(panel.symbols.map((s,j)=>[s.symbol,latest.weights[j]]).filter(([,w])=>w!==0)),selection:latest.selection,state:latest.state,reasons:latest.reasons};
    state=queueTargets(state,targets,new Date().toISOString());
  }
  const warnings=[...new Set([...status.warnings,...remote.warnings])];
  status={checkedAt,status:warnings.length?'degraded':'ok',message:warnings.length?'部分源数据需关注；仅使用完整已观测目标。':'日频更新已完成。',marketDate:market.as_of,fitDate:remote.best?.data.as_of||null,creditDate:remote.credit?.source.observationDate||null,sources:remote.sources,warnings,sourceHash};
  let data=calculated?.data||base;
  // Keep the last complete daily cards when the source model is unavailable.
  if(sameRelease&&prior?.data){const priorById=new Map(prior.data.strategies.map(s=>[s.id,s]));data.strategies=data.strategies.map(s=>priorById.get(s.id)?.signalDate>s.signalDate?priorById.get(s.id):s);const dates=data.strategies.map(s=>s.signalDate).sort();data.meta.signalDate=dates[0];}
  if(!calculated&&sameRelease&&prior?.data)live=prior;
  else live={data,monitor:{checkedAt,pollSeconds:60,status:status.status,sources:remote.sources,warnings,blocked:remote.errors.length?data.strategies.map(s=>({id:s.id,reason:status.message})):[],updates:calculated?.updates||[],portfolioDate:data.meta.signalDate}};
  live.data.models=latestModels(live.data,remote);
  live.data.meta.currentModelDates={fit:live.data.models.fit.signalDate,credit:live.data.models.credit.observationDate};
  await save('tracking/evidence/'+checkedAt.replace(/[:.]/g,'-')+'.json',evidence);
}catch(error){
  status={...status,status:'error',message:'本次更新未完成，保留已记录净值与目标。',warnings:[error.message]};
  // Keep the entire transaction unchanged on a dependency or valuation error.
  state=await read('tracking/state.json');state.configHash=configHash;
  console.error('Daily update: '+error.message);
}
let researchHistory=sameRelease?prior?.researchHistory:null;
if(market){
  try{
    const [daily,details]=await Promise.all([read('public/history-daily.json'),read('public/history-positions.json')]);
    researchHistory=extendResearchHistory(base,seed,daily,details,market.rows,remote?.rows??[],researchHistory,checkedAt);
  }catch(error){
    status.warnings.push('回测行情续算：'+error.message);
    if(status.status==='ok'){status.status='degraded';status.message='回测行情续算待补查。';}
  }
}
live??=sameRelease?prior:{data:base,monitor:{pollSeconds:60,sources:status.sources,portfolioDate:base.meta.signalDate}};
if(live){
  live.researchHistory=researchHistory;
  live.monitor={...live.monitor,checkedAt,status:status.status,warnings:status.warnings};
}
state.lastCheck=status;
await save('tracking/state.json',state);await save('public/forward.json',publicLedger(state,status));
if(live)await save('public/daily-live.json',live);
await save('public/update-status.json',status);
console.log(JSON.stringify({status:status.status,startDate:state.startDate,points:state.strategies.map(s=>({id:s.id,days:s.points.length,date:s.lastDate})),warnings:status.warnings}));
