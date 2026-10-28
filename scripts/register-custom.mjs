import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {registerCustomVersion,configDigest} from '../lib/custom-registration.js';
import {queueTargets,publicLedger} from '../lib/forward-ledger.js';
import '../public/custom-backtest.js';
const C=globalThis.CustomBacktest,args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,all)=>i%2===0?[...a,[x.replace(/^--/,''),all[i+1]]]:a,[]));
if(!args.settings||!args.name||!args.id||!args.start||!args.at)throw new Error('须指定 --settings --name --id --start --at');
const read=async p=>JSON.parse(await readFile(p,'utf8')),save=async(p,x)=>writeFile(p,JSON.stringify(x,null,2)+'\n');
const source=await readFile(args.settings),document=JSON.parse(source),panel=await read('public/custom-inputs.json');
if(document.inputHash!==panel.meta.inputHash)throw new Error('设置导出的研究输入哈希与本站不一致。');
const custom=C.validate({...document.config,name:args.name},panel);
const sourceCopy=structuredClone(document.config);sourceCopy.name=args.name;
if(!isDeepStrictEqual(sourceCopy,custom))throw new Error('文件参数未完整保留。');
const backtest=C.run(panel,custom);
for(const key of ['cagr','mdd','mult','sharpe','turn_yr'])if(document.metrics?.[key]!==undefined&&Math.abs(backtest.metrics[key]-document.metrics[key])>1e-9)throw new Error('文件回测指标未复现 '+key);
const config=await read('tracking/config.json'),previous=await read('tracking/state.json');
const previousCustom=C.validate({...config.custom,rules:config.custom.rules.map(r=>r.id==='blue'?{...r,onlyIfNotLower:r.onlyIfNotLower??false}:r.id==='ccc_top'?{...r,stackWithCredit:r.stackWithCredit??false}:r.id==='yellow'?{...r,unlock:{...r.unlock,blueEnabled:r.unlock?.blueEnabled??false}}:r)},panel);
const result=registerCustomVersion(previous,config,custom,{id:args.id,startDate:args.start,registeredAt:args.at,sourceSettingsFile:basename(args.settings),sourceSettingsSHA256:createHash('sha256').update(source).digest('hex'),previousCustom});
if(result.idempotent){console.log(JSON.stringify({idempotent:true,id:args.id}));process.exit(0);}
for(const r of result.state.customRows||[]){panel.dates.push(r.date);panel.returns.push(r.returns);panel.costs.push(r.costs);panel.tradable.push(r.tradable);panel.signals.push(r.signals);panel.yellowContext.tdc.push(r.tdc);panel.yellowContext.qqqDrawdown52.push(r.dd52);}
panel.meta.end=panel.dates.at(-1);
const resolved=C.validate({...custom,end:panel.meta.end},panel),memory=C.RULES.map(()=>-1e9);let target;
for(let t=0;t<panel.dates.length;t++)target=C.resolveTarget(panel,resolved,t,memory);
result.state=queueTargets(result.state,{[args.id]:{configVersion:configDigest(custom),signalDate:panel.dates.at(-1),weights:Object.fromEntries(panel.symbols.map((s,j)=>[s.symbol,target.weights[j]]).filter(([,w])=>w!==0)),selection:target.selection,state:target.state,reasons:target.reasons}},args.at);
result.audit.inputHash=document.inputHash;result.audit.backtestMetricsVerified=true;result.audit.initialTarget=result.state.strategies.find(s=>s.id===args.id).pending;
await mkdir('tracking/registrations',{recursive:true});await save('tracking/registrations/'+args.id+'.json',result.audit);await save('tracking/config.json',result.config);await save('tracking/state.json',result.state);await save('public/forward.json',publicLedger(result.state,result.state.lastCheck));
console.log(JSON.stringify({id:args.id,name:custom.name,startDate:args.start,registeredAt:args.at,configVersion:configDigest(custom),previousPointsPreserved:result.audit.previousPointsCount,initialSignal:result.audit.initialTarget.signalDate,initialWeights:result.audit.initialTarget.weights,backtestMetricsVerified:true}));
