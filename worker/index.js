import { loadRemoteSources } from './sources.js';
import { calculateLive, rebaseSeed } from '../lib/live-engine.js';

// ASSETS, BASE_DATA and LIVE_SEED are injected by the deterministic build.
const POLL_SECONDS=60;
let cached=null,inflight=null;
const iso=()=>new Date().toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));
const number=value=>typeof value==='number'&&Number.isFinite(value);

export function latestModels(base,remote) {
  const models=clone(base.models);
  if(remote.best) {
    const best=remote.best,fit=best.last.fit,dates=best.data.series.dates;
    const events=best.events,eventByType=Object.fromEntries(events.map(e=>[e.type,e]));
    let locked=false;
    for(let i=0;i<best.rows.length;i++) {
      const row=best.rows[i];if(row.fit.blue)locked=false;
      if(row.fit.yellow)locked=true;
      else if(locked&&number(row.fit.tdc)&&row.fit.tdc<60)locked=false;
      else if(locked&&number(row.qqqDisplay)) {
        const prices=best.rows.slice(Math.max(0,i-251),i+1).map(r=>r.qqqDisplay).filter(number);
        if(prices.length&&row.qqqDisplay/Math.max(...prices)-1>=-.03)locked=false;
      }
    }
    const redAge=Math.min(eventByType.red?.age??Infinity,eventByType.red_ad?.age??Infinity);
    const redOn=redAge<30;
    models.fit={...models.fit,temperature:fit.temp_red,tdc:fit.tdc,signalDate:best.data.as_of,events,
      redAge:eventByType.red?.age??null,redAdaptiveAge:eventByType.red_ad?.age??null,blueAge:eventByType.blue?.age??null,yellowAge:eventByType.yellow?.age??null,
      state:locked?'黄点锁仓':redOn?'红点离场窗口':'未触发离场约束',
      facts:[redOn?`红点仍在30个交易日的离场窗口内，最近信号距今${redAge}日。`:'最近红点已超出30个交易日离场窗口。',locked?'黄点锁仓尚未解除。':`当前黄点未锁仓；TDC ${fit.tdc}。`,'此处是最新源模型读数，组合持仓使用各自标注的完整输入日期。'],
      currentFlags:{...fit},sourceHealth:best.source.health,sourceGeneratedAt:best.source.publishedAt,
    };
  }
  if(remote.credit) {
    const source=remote.credit,ccc=source.data.series.ccc,cur=ccc.cur;
    const count=source.data.d.length;
    const event=(type,label,array)=>{const last=(array||[]).at(-1);return{type,label,date:last?.date??null,age:last?count-1-source.data.d.indexOf(last.date):null};};
    const events=[event('ccc_top','CCC 见顶预警',ccc.top_events),event('ccc_bot','CCC 见底预警',ccc.bot_events)];
    models.credit={...models.credit,spread:ccc.latest.v,ma200:cur.ma200,percentile:cur.pct,phase:cur.phase,above200:cur.s>cur.ma200,stress:cur.pct>=95,
      observationDate:ccc.latest.date,signalDate:cur.date,calculationDate:cur.date,events,topAge:events[0].age,bottomAge:events[1].age,
      facts:['历史分位反映252日相对位置，并不是未来下跌概率。','高于200日均线不等于当天利差环比上升。',`源利差观察日 ${ccc.latest.date}；指标在纳指日历 ${cur.date} 计算。组合仍遵循额外滞后一交易日规则。`],
      sourceHealth:source.source.health,sourceGeneratedAt:source.source.publishedAt,
    };
  }
  return models;
}

function buildFallback(message) {
  const data=clone(cached?.value?.data||BASE_DATA);
  data.meta.monitoring=true;data.meta.isLive=false;
  const monitor={checkedAt:iso(),pollSeconds:POLL_SECONDS,status:'error',sources:[],warnings:[message],blocked:data.strategies.map(s=>({id:s.id,reason:'联网源检查失败，保留最后完整目标。'})),updates:[],portfolioDate:data.meta.signalDate};
  for(const s of data.strategies){s.liveStatus='blocked';s.liveMessage='联网源检查失败，保留最后完整目标。';}
  return{data,monitor};
}

export function mergeLiveData(previous,next) {
  if(!previous)return next;
  const data=clone(next),byId=new Map(previous.strategies.map(s=>[s.id,s]));
  for(let i=0;i<data.strategies.length;i++) {
    const newer=byId.get(data.strategies[i].id);
    if(newer?.signalDate>data.strategies[i].signalDate)data.strategies[i]={...clone(newer),liveStatus:'blocked',liveMessage:'上游暂不可用，保留最近一次完整目标。'};
  }
  for(const [key,dateKey]of [['fit','signalDate'],['credit','observationDate']])if(previous.models[key]?.[dateKey]>data.models[key]?.[dateKey])data.models[key]=clone(previous.models[key]);
  const dates=data.strategies.map(s=>s.signalDate).sort();
  data.meta.signalDate=dates[0];data.meta.targetDateRange={oldest:dates[0],newest:dates.at(-1)};
  const oldest=data.strategies.find(s=>s.signalDate===dates[0]);
  data.meta.cccObservationDate=oldest.creditObservationDate||previous.strategies.find(s=>s.id===oldest.id)?.creditObservationDate||data.meta.cccObservationDate;
  return data;
}

export async function produceLive(fetchImpl=fetch,previousData=null) {
  const remote=await loadRemoteSources(fetchImpl);
  let result={data:clone(BASE_DATA),updates:[],blocked:[]};
  const warnings=[...remote.warnings];
  if(remote.best&&remote.credit&&remote.credit.verified) {
    try {
      const seed=remote.marketRows?.length?rebaseSeed(LIVE_SEED,remote.marketRows):LIVE_SEED;
      const rows=remote.rows.filter(row=>row.date>LIVE_SEED.date);
      if(remote.best.input) {
        const end=[remote.best.data.as_of,remote.credit.series.at(-1).date,remote.best.input.as_of].sort()[0];
        const expected=remote.best.rows.filter(row=>row.date>LIVE_SEED.date&&row.date<=end).map(row=>row.date);
        const actual=rows.filter(row=>row.date<=end).map(row=>row.date);
        if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('完整输入存在交易日缺口，拒绝跨日跳算');
        if(end<remote.best.data.as_of)warnings.push(`完整组合输入暂时仅到 ${end}，模型信号可领先持仓。`);
      }
      result=calculateLive(BASE_DATA,seed,rows);
      if(!remote.best.input) {
        const newer=remote.best.data.as_of>BASE_DATA.meta.signalDate;
        const reason='缺少上游完整ETF复权行情接口；保留最后完整目标，模型信号仍持续监测。';
        if(newer)result.blocked=result.data.strategies.map(s=>({id:s.id,reason}));
        warnings.push(reason);
      }
    } catch(error) {
      const reason=`完整组合输入校验未通过：${error.message}`;warnings.push(reason);
      result={data:clone(BASE_DATA),updates:[],blocked:BASE_DATA.strategies.map(s=>({id:s.id,reason}))};
    }
  } else {
    const reason='两个模型的来源尚未全部校验成功，保留最后完整组合。';
    result.blocked=BASE_DATA.strategies.map(s=>({id:s.id,reason}));warnings.push(reason);
  }
  for(const strategy of result.data.strategies) {
    const row=remote.rows.find(r=>r.date===strategy.signalDate);
    strategy.creditObservationDate=row?.credit.observationDate||BASE_DATA.meta.cccObservationDate;
  }
  let data=result.data;data.models=latestModels(data,remote);
  data=mergeLiveData(previousData,data);
  data.meta.monitoring=true;data.meta.isLive=remote.errors.length===0;
  data.meta.historyDate=BASE_DATA.meta.backtestEnd;data.meta.historyGeneratedAt=BASE_DATA.meta.generatedAt;
  data.meta.lastCheckedAt=iso();data.meta.currentModelDates={fit:data.models.fit.signalDate,credit:data.models.credit.observationDate};
  const blockedById=new Map((result.blocked||[]).map(item=>[item.id,item]));
  for(const strategy of data.strategies){const blocked=blockedById.get(strategy.id);if(blocked){strategy.liveStatus='blocked';strategy.liveMessage=blocked.reason;}else if(strategy.liveStatus!=='blocked'){strategy.liveStatus='ok';strategy.liveMessage='按最新完整输入计算';}}
  const sources=remote.sources.map(source=>({...source,health:source.health==='healthy'?'ok':source.health==='degraded'?'degraded':'error',message:source.error||(source.warnings||[]).join(' ')}));
  const monitor={checkedAt:data.meta.lastCheckedAt,pollSeconds:POLL_SECONDS,status:remote.errors.length===2?'error':warnings.length||(result.blocked||[]).length?'degraded':'ok',sources,warnings:[...new Set(warnings)],updates:result.updates||[],blocked:result.blocked||[],portfolioDate:data.meta.signalDate,historyDate:BASE_DATA.meta.backtestEnd,
    inputDate:remote.best?.input?.as_of||null,inputSourceCommit:remote.best?.input?.sourceCommit||null};
  return{data,monitor};
}

async function liveResponse() {
  const now=Date.now();
  if(cached&&now-cached.at<POLL_SECONDS*1000)return cached.value;
  if(inflight)return inflight;
  inflight=(async()=>{
    try{
      const response=await fetch('https://chaodu211-cell.github.io/strategy-/daily-live.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(response.ok){const payload=await response.json();if(payload.data?.strategies?.length===6&&payload.monitor?.checkedAt&&payload.data.meta?.signalDate>=BASE_DATA.meta.signalDate)return payload;}
    }catch{}
    return produceLive(fetch,cached?.value?.data);
  })().then(value=>{cached={at:Date.now(),value};return value;}).catch(error=>buildFallback(error.message)).finally(()=>{inflight=null;});
  return inflight;
}

export default {
  async fetch(request) {
    const url=new URL(request.url);
    const common={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
    if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...common,Allow:'GET, HEAD'}});
    if(url.pathname==='/api/live'){
      const payload=await liveResponse();
      return new Response(request.method==='HEAD'?null:JSON.stringify(payload),{status:200,headers:{...common,'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'}});
    }
    if(url.pathname==='/api/health')return Response.json({status:'ok',mode:'repository-monitor',pollSeconds:POLL_SECONDS},{headers:{...common,'Cache-Control':'no-store'}});
    const path=url.pathname==='/'?'/index.html':url.pathname;
    const asset=ASSETS[path];
    if(!asset)return new Response('Not found',{status:404,headers:common});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{...common,'Content-Type':asset.type,'Cache-Control':path.endsWith('.html')?'no-cache':'public, max-age=60'}});
  }
};
