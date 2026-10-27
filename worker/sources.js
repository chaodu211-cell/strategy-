/** Read published model output as data. Never evaluates upstream scripts. */
export const SOURCE_URLS = Object.freeze({
  bestPage: 'https://chaodu211-cell.github.io/best-weights/',
  bestStatus: 'https://chaodu211-cell.github.io/best-weights/status.json',
  bestInputs: 'https://chaodu211-cell.github.io/best-weights/monitor-inputs.json',
  creditPage: 'https://chaodu211-cell.github.io/ccc-spread/',
});
const BEST_REPO = 'chaodu211-cell/best-weights';
const CREDIT_REPO = 'chaodu211-cell/ccc-spread';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const dateValid = value => typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));

export function embeddedJSON(html, name) {
  const pattern = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`);
  const match = pattern.exec(html);
  if (!match) throw new Error(`上游页面缺少 ${name} JSON 数据`);
  const start = match.index + match[0].length;
  if (html[start] !== '{' && html[start] !== '[') throw new Error(`${name} 必须是 JSON 对象`);
  let depth=0, quoted=false, escaped=false;
  for(let i=start;i<html.length;i++) {
    const c=html[i];
    if(quoted) {if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue;}
    if(c==='"') quoted=true;
    else if(c==='{'||c==='[') depth++;
    else if(c==='}'||c===']') {depth--;if(depth===0)return JSON.parse(html.slice(start,i+1));}
  }
  throw new Error(`上游 ${name} JSON 不完整`);
}

export function parseCSV(text) {
  const rows=[];let row=[],cell='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<=text.length;i++) {
    const c=text[i];
    if(quoted) {if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else if(c!==undefined)cell+=c;continue;}
    if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c===undefined){row.push(cell.replace(/\r$/,''));if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV 引号不完整');
  const headers=rows.shift()||[];
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}

function readSeries(text, valueColumn) {
  const rows=parseCSV(text), result=new Map();
  if(!rows.length || !Object.hasOwn(rows[0],'date') || !Object.hasOwn(rows[0],valueColumn))throw new Error(`原始序列缺少 date/${valueColumn}`);
  for(const row of rows){const value=Number(row[valueColumn]);if(!dateValid(row.date)||row[valueColumn]===''||!finite(value)||value<=0)throw new Error(`原始序列值无效 ${row.date}`);if(result.has(row.date))throw new Error(`原始序列日期重复 ${row.date}`);result.set(row.date,value);}
  return new Map([...result].sort(([a],[b])=>a.localeCompare(b)));
}

async function fetchText(fetchImpl,url,{optional=false,maxBytes=9_000_000}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetchImpl(url,{headers:{'User-Agent':'DualModelStrategyMonitor/1.0','Accept':'application/json, text/html, text/csv;q=0.9'},signal:controller.signal,cache:'no-store'});
    if(optional&&response.status===404)return null;
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const text=await response.text();if(text.length>maxBytes)throw new Error('响应超过大小限制');return text;
  } catch(error){throw new Error(`${new URL(url).hostname}${new URL(url).pathname}: ${error.message}`);}
  finally {clearTimeout(timer);}
}
async function fetchJSON(fetchImpl,url,options){const text=await fetchText(fetchImpl,url,options);return text===null?null:JSON.parse(text);}
const headCache=new Map();
async function headSHA(fetchImpl,repo,force=false) {
  const key=`${repo}`,cached=headCache.get(key);
  if(!force&&cached&&Date.now()-cached.at<600000){if(cached.error)throw new Error(cached.error);return cached.sha;}
  let value;try{value=await fetchJSON(fetchImpl,`https://api.github.com/repos/${repo}/commits/main`);}catch(error){headCache.set(key,{error:error.message,at:Date.now()});throw error;}
  if(!/^[a-f\d]{40}$/.test(value.sha))throw new Error('GitHub 提交标识无效');headCache.set(key,{sha:value.sha,at:Date.now()});return value.sha;
}
const rawURL=(repo,sha,path)=>`https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
function eventFromFlags(dates,flags,type,label){let i=flags.length-1;while(i>=0&&!flags[i])i--;return{type,label,date:i>=0?dates[i]:null,age:i>=0?dates.length-1-i:null};}
function validateDates(dates){if(!Array.isArray(dates)||dates.length<252)throw new Error('模型交易日历不足');for(let i=0;i<dates.length;i++){if(!dateValid(dates[i])||(i&&dates[i]<=dates[i-1]))throw new Error('模型交易日历无效');}}

async function loadBest(fetchImpl,marketInput=null) {
  const [status,page,shaResult,inputResult]=await Promise.all([
    fetchJSON(fetchImpl,SOURCE_URLS.bestStatus),fetchText(fetchImpl,SOURCE_URLS.bestPage),
    headSHA(fetchImpl,BEST_REPO).then(value=>({value})).catch(error=>({error:error.message})),
    marketInput?Promise.resolve({value:marketInput}):fetchJSON(fetchImpl,SOURCE_URLS.bestInputs,{optional:true}).then(value=>({value})).catch(error=>({error:error.message})),
  ]);
  const data=embeddedJSON(page,'D');
  if(!plain(data.series)||!plain(data.alerts?.flags)||!dateValid(data.as_of))throw new Error('最优拟合输出结构无效');
  if(status.as_of!==data.as_of)throw new Error(`最优拟合 status(${status.as_of}) 与页面(${data.as_of}) 日期不一致`);
  const dates=data.series.dates;validateDates(dates);
  if(dates.at(-1)!==data.as_of)throw new Error('最优拟合日期与序列末日不一致');
  for(const field of ['temperature_sell','tdc','ndx'])if(!Array.isArray(data.series[field])||data.series[field].length!==dates.length)throw new Error(`最优拟合 ${field} 序列长度不一致`);
  for(const field of ['hot','hot_ad','cold','cold_soft','tdc'])if(!Array.isArray(data.alerts.flags[field])||data.alerts.flags[field].length!==dates.length)throw new Error(`最优拟合 ${field} 旗标长度不一致`);
  if(!finite(data.series.tdc.at(-1))||!finite(data.series.temperature_sell.at(-1)))throw new Error('最优拟合最新读数缺失');
  const warnings=[];if(!status.fetch_ok)warnings.push('最优拟合上游最近抓取失败，页面可能沿用缓存行情。');
  if(shaResult.error)warnings.push(`最优拟合 GitHub 提交检查失败：${shaResult.error}`);
  const commitSHA=shaResult.value||status.sha;
  if(!/^[a-f\d]{40}$/.test(commitSHA||''))throw new Error('最优拟合无可核验的源提交');
  let snapshots=[],snapshotVerified=true;
  try{snapshots=parseCSV(await fetchText(fetchImpl,rawURL(BEST_REPO,commitSHA,'_信号快照.csv')));}catch(error){snapshotVerified=false;warnings.push('最优拟合历史快照暂不可读，源模型当前读数仍可显示；组合暂不推进。');}
  const snapMap=new Map(snapshots.filter(r=>dateValid(r['日期'])).map(r=>[r['日期'],r]));
  const fields={red:'hot',red_ad:'hot_ad',blue:'cold',blue_soft:'cold_soft',yellow:'tdc'};
  const snapshotFields={red:'实心红点',red_ad:'空心红点',blue:'实心蓝点',blue_soft:'空心蓝点',yellow:'黄点'};
  const rows=dates.map((date,i)=>{
    const snap=snapMap.get(date),fit={};
    for(const [key,flag]of Object.entries(fields))fit[key]=snap&&snap[snapshotFields[key]]!==''?Number(snap[snapshotFields[key]])===1:Boolean(data.alerts.flags[flag][i]);
    fit.tdc=snap&&snap.TDC!==''?Number(snap.TDC):data.series.tdc[i];
    fit.temp_red=snap&&snap['红点温度']!==''?Number(snap['红点温度']):data.series.temperature_sell[i];
    return{date,fit,qqqDisplay:data.series.ndx[i]};
  });
  const events=[['red','实心红点'],['red_ad','空心红点'],['blue','实心蓝点'],['yellow','黄点']].map(([type,label])=>eventFromFlags(dates,rows.map(r=>r.fit[type]),type,label));
  const last=rows.at(-1);
  let input=snapshotVerified?inputResult.value:null;
  if(inputResult.error)warnings.push(`完整持仓输入暂不可用：${inputResult.error}`);
  if(input===null||input===undefined)warnings.push('最优拟合尚未发布完整 ETF 复权行情接口；组合仅推进到输入齐全的日期。');
  if(input && (input.schemaVersion!==1||input.priceBasis!=='adjusted'||!dateValid(input.as_of)))throw new Error('monitor-inputs.json 的版本或价格口径无效');
  if(input && input.health?.ok!==true){warnings.push('ETF 输入健康校验未通过，暂停推进组合；保留已核验的模型读数。');input=null;}
  if(input?.as_of>data.as_of)warnings.push('ETF 数据领先最优拟合信号，组合仅使用信号已发布的交易日。');
  return{data,status,rows,input,events,source:{id:'best-weights',name:'最优拟合',repo:BEST_REPO,url:SOURCE_URLS.bestPage,repositoryURL:`https://github.com/${BEST_REPO}`,commitSHA,publishedCommitSHA:status.sha||null,observationDate:data.as_of,publishedAt:status.generated_at||data.generated_at,upstreamFetchOk:status.fetch_ok===true,health:status.fetch_ok?'healthy':'degraded',warnings},last};
}

function computeCredit(raw,nas,params) {
  const dates=[...nas.keys()],observations=[...raw.keys()];let pos=-1;
  const observationDates=[],S=dates.map(date=>{while(pos+1<observations.length&&observations[pos+1]<=date)pos++;const d=observations[pos];observationDates.push(d||null);return d&&(Date.parse(date)-Date.parse(d))/86400000<=7?raw.get(d):null;});
  const N=dates.map(d=>nas.get(d)),ma=(values,n)=>values.map((_,i)=>{if(i<n-1)return null;let sum=0;for(let j=i-n+1;j<=i;j++){if(!finite(values[j]))return null;sum+=values[j];}return sum/n;});
  const ma200=ma(S,params.top_ma),ma10=ma(S,params.bot_ma);
  const pct=S.map((value,i)=>{if(i<251||!finite(value))return null;let count=0;for(let j=i-251;j<=i;j++){if(!finite(S[j]))return null;if(S[j]<=value)count++;}return count*100/252;});
  const dd=N.map((value,i)=>i<125?null:value/Math.max(...N.slice(Math.max(0,i-251),i+1))-1);
  const topRaw=dates.map((_,i)=>i>0&&[S[i],S[i-1],ma200[i],ma200[i-1],dd[i]].every(finite)&&S[i]>ma200[i]&&S[i-1]<=ma200[i-1]&&dd[i]>=-params.top_near);
  const botRaw=dates.map((_,i)=>i>=params.bot_slope&&[S[i],ma10[i],ma10[i-params.bot_slope],dd[i]].every(finite)&&Math.max(...pct.slice(Math.max(0,i-params.bot_look+1),i+1).filter(finite))>=params.bot_pct&&S[i]<ma10[i]&&ma10[i]<ma10[i-params.bot_slope]&&dd[i]<=-params.bot_dd);
  const cooled=(flags,cool)=>{let last=-1e9;const events=new Set();flags.forEach((flag,i)=>{if(flag){if(i-last>cool)events.add(i);last=i;}});return events;};
  const tops=cooled(topRaw,params.top_cool),bots=cooled(botRaw,params.bot_cool);
  return dates.map((date,i)=>({date,spread:S[i],ma200:ma200[i],percentile:pct[i],above200:finite(S[i])&&finite(ma200[i])&&S[i]>ma200[i],stress:finite(pct[i])&&pct[i]>=95,top:tops.has(i),bot:bots.has(i),observationDate:observationDates[i]}));
}

async function loadCredit(fetchImpl,forceHead=false) {
  const [page,head]=await Promise.all([fetchText(fetchImpl,SOURCE_URLS.creditPage),headSHA(fetchImpl,CREDIT_REPO,forceHead).then(sha=>({sha})).catch(error=>({error:error.message}))]);
  const data=embeddedJSON(page,'ALL'),ccc=data.series?.ccc;
  if(!ccc||!Array.isArray(data.d))throw new Error('CCC 发布页结构无效');validateDates(data.d);
  const dates=data.d;for(const field of ['s','ma200','pct'])if(!Array.isArray(ccc[field])||ccc[field].length!==dates.length)throw new Error(`CCC ${field} 序列长度不一致`);
  if(!dateValid(ccc.latest?.date)||!finite(ccc.latest?.v)||!finite(ccc.cur?.ma200)||!finite(ccc.cur?.pct))throw new Error('CCC 最新发布读数无效');
  const warnings=[];if(head.error)warnings.push('CCC 仓库版本检查暂不可用，改为交叉校验当前分支公开数据。');
  const sha=head.sha||null;
  let oasText,nasText,status;
  try {
    [oasText,nasText,status]=await Promise.all([
      fetchText(fetchImpl,rawURL(CREDIT_REPO,sha||'main','data/ccc_oas.csv')),
      fetchText(fetchImpl,rawURL(CREDIT_REPO,sha||'main','data/nasdaq.csv')),
      fetchJSON(fetchImpl,rawURL(CREDIT_REPO,sha||'main','ci_status.json')),
    ]);
  }catch(error){
    warnings.push('CCC 原始序列暂不可读；仅展示源站已发布读数，组合保留最后完整结果。');
    return{data,status:null,series:[],raw:null,verified:false,source:{id:'ccc-spread',name:'CCC 利差',repo:CREDIT_REPO,url:SOURCE_URLS.creditPage,repositoryURL:`https://github.com/${CREDIT_REPO}`,commitSHA:sha,observationDate:ccc.latest.date,publishedAt:data.generated,calendarDate:dates.at(-1),upstreamFetchOk:null,health:'degraded',warnings}};
  }
  const raw=readSeries(oasText,'ccc_oas_pct'),nas=readSeries(nasText,'close');
  const observations=[...raw.keys()],observationDate=observations.at(-1),rawValue=raw.get(observationDate);
  if(ccc.latest.date!==observationDate||Math.abs(ccc.latest.v-rawValue)>1e-7)throw new Error('CCC 发布页与原始利差日期/读数不一致');
  if(status.as_of!==dates.at(-1)||[...nas.keys()].at(-1)!==dates.at(-1))throw new Error('CCC 页面、运行状态与原始纳指日历不同步');
  const series=computeCredit(raw,nas,data.params);
  for(let i=0;i<dates.length;i++) {
    const row=series[i];
    if(row.date!==dates[i])throw new Error('CCC 原始交易日历与页面不一致');
    if(finite(row.spread)&&finite(ccc.s[i])&&Math.abs(row.spread-ccc.s[i])>1e-7)throw new Error(`CCC 页面与原始数据不一致 ${dates[i]}`);
    if(finite(row.ma200)&&finite(ccc.ma200[i])&&Math.abs(row.ma200-ccc.ma200[i])>.000501)throw new Error(`CCC 均线公式与页面不一致 ${dates[i]}`);
  }
  const failures=Object.entries(status.fetch||{}).filter(([,v])=>v.ok!==true);
  if(failures.length)warnings.push(`CCC 上游抓取未全部成功：${failures.map(([k])=>k).join('、')}。`);
  return{data,status,series,raw,verified:true,source:{id:'ccc-spread',name:'CCC 利差',repo:CREDIT_REPO,url:SOURCE_URLS.creditPage,repositoryURL:`https://github.com/${CREDIT_REPO}`,commitSHA:sha,observationDate,publishedAt:data.generated||status.generated,calendarDate:dates.at(-1),upstreamFetchOk:!failures.length,health:failures.length||head.error?'degraded':'healthy',warnings}};
}

function inputsRows(input) {
  if(!input)return[];
  if(Array.isArray(input.rows))return input.rows;
  if(!plain(input.assets))throw new Error('完整行情接口没有 rows 或 assets');
  const map=new Map();
  for(const[symbol,asset]of Object.entries(input.assets))for(const p of asset.rows||[]){if(!map.has(p.date))map.set(p.date,{date:p.date,prices:{},tradable:{}});map.get(p.date).prices[symbol]=p.adjclose;if(typeof p.tradable==='boolean')map.get(p.date).tradable[symbol]=p.tradable;}
  return[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export async function loadRemoteSources(fetchImpl=fetch,marketInput=null) {
  const results=await Promise.allSettled([loadBest(fetchImpl,marketInput),loadCredit(fetchImpl).catch(error=>{if(/不一致|不同步/.test(error.message))return loadCredit(fetchImpl,true);throw error;})]);
  const best=results[0].status==='fulfilled'?results[0].value:null;
  const credit=results[1].status==='fulfilled'?results[1].value:null;
  const errors=results.flatMap((r,i)=>r.status==='rejected'?[`${i===0?'最优拟合':'CCC 利差'}：${r.reason.message}`]:[]);
  const warnings=[...errors,...(best?.source.warnings||[]),...(credit?.source.warnings||[])];
  const rows=[];
  let marketRows=[];
  if(best&&credit&&credit.verified&&best.input) {
    const fitRows=new Map(best.rows.map(row=>[row.date,row.fit]));
    marketRows=inputsRows(best.input);let lastDate='';
    const creditDateIndex=new Map(credit.series.map((r,i)=>[r.date,i]));
    for(const market of marketRows) {
      if(!dateValid(market.date)||market.date<=lastDate)throw new Error('完整行情接口日期重复或非递增');lastDate=market.date;
      if(!plain(market.prices)||!Object.values(market.prices).every(v=>finite(v)&&v>0))throw new Error(`完整行情接口价格无效 ${market.date}`);
      const fit=fitRows.get(market.date),ci=creditDateIndex.get(market.date);
      if(!fit||ci===undefined||ci<1||market.date>best.data.as_of)continue;
      const lagged=credit.series[ci-1];
      if(![lagged.spread,lagged.ma200,lagged.percentile].every(finite))continue;
      rows.push({date:market.date,fit,credit:{...lagged},prices:market.prices,priceBasis:'adjusted',tradable:market.tradable||{},previousPrices:market.previousPrices});
    }
    if(marketRows.at(-1)?.date!==best.input.as_of)throw new Error('完整行情末日与 as_of 不一致');
    if(!rows.length)warnings.push('上游完整行情与两个模型没有共同可计算交易日。');
  }
  return{best,credit,rows,marketRows,errors,warnings,sources:[best?.source||{id:'best-weights',name:'最优拟合',repo:BEST_REPO,url:SOURCE_URLS.bestPage,health:'failed',error:errors.find(e=>e.startsWith('最优拟合'))},credit?.source||{id:'ccc-spread',name:'CCC 利差',repo:CREDIT_REPO,url:SOURCE_URLS.creditPage,health:'failed',error:errors.find(e=>e.startsWith('CCC'))}]};
}
