import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {registerCustomVersion,configDigest} from '../lib/custom-registration.js';
import {advanceLedger,queueTargets,publicLedger} from '../lib/forward-ledger.js';
import {extendDgs30} from './dgs30.mjs';
import '../public/custom-backtest.js';
const C=globalThis.CustomBacktest,args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>i%2===0?[...a,[x.replace(/^--/,''),all[i+1]]]:a,[]));
if(!args.settings||!args.name||!args.id||!args.start||!args.at)throw new Error('须指定 --settings --name --id --start --at');
const read=async p=>JSON.parse(await readFile(p,'utf8')),save=async(p,x)=>writeFile(p,JSON.stringify(x,null,2)+'\n');
async function replayPrevious(old,current,targets){
  if(!old?.points.length)throw new Error('旧策略没有可重放的收盘记录。');
  const evidenceByHash=new Map(),firstSeen=new Map();
  for(const filename of await readdir('tracking/evidence')){
    if(!filename.endsWith('.json'))continue;
    const raw=await readFile('tracking/evidence/'+filename),evidence=JSON.parse(raw);
    evidenceByHash.set(createHash('sha256').update(raw).digest('hex'),evidence);
    for(const row of evidence.modelRows){
      const seen=firstSeen.get(row.date);
      if(!seen||evidence.observedAt<seen)firstSeen.set(row.date,evidence.observedAt);
    }
  }
  const start=old.points[0].date;
  let replay={startDate:start,strategies:[{...current,startDate:start,registeredAt:old.registeredAt}]};
  for(const p of old.points){
    const market=evidenceByHash.get(p.sourceHash)?.marketRows;
    const close=market?.find(r=>r.date===p.date);
    if(!close)throw new Error('历史回放缺少原收盘证据 '+p.date);
    const prior=replay.strategies[0];
    if(p.signalDate&&p.signalDate!==prior.pending?.signalDate){
      const target=targets.get(p.signalDate),seen=firstSeen.get(p.signalDate);
      const eligibleAt=old.registeredAt&&old.registeredAt>seen?old.registeredAt:seen;
      if(!target||!seen||p.signalDate>=p.date||!(Date.parse(eligibleAt)<Date.parse(close.closeAt)))throw new Error('历史回放缺少成交前的信号证据 '+p.signalDate);
      replay=queueTargets(replay,{[current.id]:target},eligibleAt);
    }
    replay=advanceLedger(replay,market.filter(r=>r.date<=p.date),{observedAt:p.observedAt,sourceHash:p.sourceHash});
    const point=replay.strategies[0].points.at(-1);
    if(point?.date!==p.date||point.signalDate!==p.signalDate)throw new Error('历史回放的信号或成交日期不一致 '+p.date);
    point.replayed=true;
  }
  const {points,lastDate,amounts,applied}=replay.strategies[0];
  if(points.length!==old.points.length||lastDate!==old.lastDate)throw new Error('历史回放未覆盖全部旧记录。');
  return {points,lastDate,amounts,applied,replay:{start,through:lastDate,days:points.length,sourceStrategyId:old.id}};
}
const source=await readFile(args.settings),document=JSON.parse(source),panel=await read('public/custom-inputs.json');
if(document.inputHash!==panel.meta.inputHash)throw new Error('设置导出的研究输入哈希与本站不一致。');
const config=await read('tracking/config.json'),previous=await read('tracking/state.json');
if(C.usesTriangle(document.config)||C.usesTriangle(config.custom))panel.vixTermRelease=await read('public/vix-term-release.json');
const validated=C.validate({...document.config,name:args.name},panel);
const hasTriangleRule=document.config.rules.some(r=>r.id==='triangle');
const custom=hasTriangleRule?validated:{...validated,rules:validated.rules.filter(r=>r.id!=='triangle')};
const sourceCopy=structuredClone(document.config);sourceCopy.name=args.name;
if(C.usesDgs30(custom)){
  const rates=await read('public/dgs30.json');
  if(document.audit?.dgs30CSVHash!==rates.csvSHA256)throw new Error('请用当前网页的动量规则重新生成回测并下载设置。');
  panel.dgs30=rates.yieldsBp;
  if(sourceCopy.momentum&&sourceCopy.momentum.method===undefined)sourceCopy.momentum.method=C.DEFAULT_MOMENTUM_METHOD;
}
if(!isDeepStrictEqual(sourceCopy,custom))throw new Error('文件参数未完整保留。');
const backtest=C.run(panel,custom);
for(const key of ['cagr','mdd','mult','sharpe','turn_yr'])if(document.metrics?.[key]!==undefined&&Math.abs(backtest.metrics[key]-document.metrics[key])>1e-9)throw new Error('文件回测指标未复现 '+key);
const previousCustom=C.validate({...config.custom,rules:config.custom.rules.map(r=>r.id==='blue'?{...r,onlyIfNotLower:r.onlyIfNotLower??false}:r.id==='ccc_top'?{...r,stackWithCredit:r.stackWithCredit??false}:r.id==='yellow'?{...r,unlock:{...r.unlock,blueEnabled:r.unlock?.blueEnabled??false}}:r)},panel);
const result=registerCustomVersion(previous,config,custom,{id:args.id,startDate:args.start,registeredAt:args.at,sourceSettingsFile:basename(args.settings),sourceSettingsSHA256:createHash('sha256').update(source).digest('hex'),previousCustom});
if(result.idempotent){console.log(JSON.stringify({idempotent:true,id:args.id}));process.exit(0);}
const extra=result.state.customRows||[];
for(const r of extra){panel.dates.push(r.date);panel.returns.push(r.returns);panel.costs.push(r.costs);panel.tradable.push(r.tradable);panel.signals.push(r.signals);panel.yellowContext.tdc.push(r.tdc);panel.yellowContext.qqqDrawdown52.push(r.dd52);}
if(C.usesDgs30(custom)){
  const csv=args['dgs30-csv']?await readFile(args['dgs30-csv'],'utf8'):null;
  const warning=await extendDgs30(panel,extra,csv===null?undefined:async()=>csv);
  if(warning)console.warn(warning);
  result.audit.dgs30CSVHash=document.audit.dgs30CSVHash;
}
panel.meta.end=panel.dates.at(-1);
if(C.usesTriangle(custom)){
  const live=await read('public/daily-live.json');
  if(C.hasTriangleCoverage(live.vixTermRelease,panel.meta.end))panel.vixTermRelease=live.vixTermRelease;
}
const resolved=C.validate({...custom,end:panel.meta.end},panel),memory=C.RULES.map(()=>-1e9);
const old=previous.strategies.find(s=>s.id===(config.customId||'custom-momentum'));
const replayDates=new Set(args['replay-previous']==='true'?old?.points.map(p=>p.signalDate):[]);
const targets=new Map(),version=configDigest(custom);
let latest;
for(let t=0;t<panel.dates.length;t++){
  const target=C.resolveTarget(panel,resolved,t,memory),signalDate=panel.dates[t];
  if(!replayDates.has(signalDate)&&t!==panel.dates.length-1)continue;
  latest={configVersion:version,signalDate,weights:Object.fromEntries(panel.symbols.map((s,j)=>[s.symbol,target.weights[j]]).filter(([,w])=>w!==0)),selection:target.selection,state:target.state,reasons:target.reasons,...(target.vixReversalSignalDate?{vixReversalSignalDate:target.vixReversalSignalDate}:{})};
  targets.set(signalDate,latest);
}
if(args['replay-previous']==='true'){
  const current=result.state.strategies.find(s=>s.id===args.id);
  Object.assign(current,await replayPrevious(old,current,targets));
  result.audit.replay=current.replay;
  result.config.notes=result.config.notes.filter(note=>!note.startsWith('自定义策略按本文件登记'));
  result.config.notes.push('自定义策略按本文件登记。历史回放按当前参数重算，后续每日跟踪接续该净值，旧版本归档。');
  result.state.configHash=result.audit.nextConfigHash=configDigest(result.config);
}
result.state=queueTargets(result.state,{[args.id]:latest},args.at);
result.audit.inputHash=document.inputHash;result.audit.backtestMetricsVerified=true;result.audit.initialTarget=result.state.strategies.find(s=>s.id===args.id).pending;
await mkdir('tracking/registrations',{recursive:true});await save('tracking/registrations/'+args.id+'.json',result.audit);await save('tracking/config.json',result.config);await save('tracking/state.json',result.state);await save('public/forward.json',publicLedger(result.state,result.state.lastCheck));
console.log(JSON.stringify({id:args.id,name:custom.name,startDate:args.start,registeredAt:args.at,configVersion:configDigest(custom),previousPointsPreserved:result.audit.previousPointsCount,initialSignal:result.audit.initialTarget.signalDate,initialWeights:result.audit.initialTarget.weights,backtestMetricsVerified:true}));
