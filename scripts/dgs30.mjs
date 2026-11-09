import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SERIES='https://fred.stlouisfed.org/series/DGS30';
const CSV='https://fred.stlouisfed.org/graph/fredgraph.csv';
const iso=date=>date.toISOString().slice(0,10);
const dayMs=86400000;

export function parseDgs30(csv){
  const [header,...rows]=csv.trim().split(/\r?\n/);
  if(!/^(observation_date|DATE),DGS30$/.test(header))throw new Error('FRED DGS30 CSV 格式无效');
  const observations=new Map();
  for(const row of rows){
    const [date,value]=row.split(',');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||value===undefined)throw new Error('FRED DGS30 日期或收益率格式无效');
    if(value===''||value==='.')continue;
    if(!Number.isFinite(Number(value)))throw new Error('FRED DGS30 收益率格式无效 '+date);
    observations.set(date,Math.round(Number(value)*100));
  }
  return observations;
}

// Federal Reserve holiday calendar. A published observation always takes precedence.
// https://www.federalreserve.gov/aboutthefed/k8.htm
function holidays(year){
  const date=(month,day)=>new Date(Date.UTC(year,month-1,day));
  const observed=(month,day)=>{
    const d=date(month,day),weekday=d.getUTCDay();
    return iso(new Date(+d+(weekday===0?dayMs:weekday===6?-dayMs:0)));
  };
  const nth=(month,weekday,n)=>{
    const first=date(month,1).getUTCDay();
    return iso(date(month,1+((weekday-first+7)%7)+(n-1)*7));
  };
  const may31=date(5,31);
  const dates=[
    observed(1,1),nth(1,1,3),nth(2,1,3),
    iso(new Date(+may31-((may31.getUTCDay()+6)%7)*dayMs)),
    observed(7,4),nth(9,1,1),nth(10,1,2),observed(11,11),nth(11,4,4),observed(12,25)
  ];
  if(year>=2021)dates.push(observed(6,19));
  if(date(12,31).getUTCDay()===5)dates.push(iso(date(12,31)));
  return new Set(dates);
}

export function alignDgs30(dates,observations){
  const sorted=[...observations].sort(([a],[b])=>a.localeCompare(b));
  let i=0,previous=null,year=null,calendar;
  return Object.fromEntries(dates.map(date=>{
    while(i<sorted.length&&sorted[i][0]<=date)previous=sorted[i++][1];
    const currentYear=Number(date.slice(0,4));
    if(year!==currentYear){year=currentYear;calendar=holidays(year);}
    return[date,observations.get(date)??(calendar.has(date)?previous:null)];
  }));
}

export async function fetchDgs30(first,last){
  const from=iso(new Date(Date.parse(first)-7*dayMs));
  const query=new URLSearchParams({id:'DGS30',cosd:from,coed:last});
  const response=await fetch(CSV+'?'+query,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('FRED DGS30 HTTP '+response.status);
  return response.text();
}

export async function extendDgs30(panel,rows,fetchCsv=fetchDgs30){
  const lagDates=panel.dates.slice(panel.dates.length-rows.length-1,-1);
  const needed=lagDates.filter((date,i)=>!Object.hasOwn(panel.dgs30,date)&&!Object.hasOwn(rows[i],'dgs30LagBp'));
  let fresh={},warning=null;
  if(needed.length){
    try{fresh=alignDgs30(needed,parseDgs30(await fetchCsv(needed[0],needed.at(-1))));}
    catch{warning='FRED DGS30 暂不可用，缺值日期延续前一日的长债过滤状态。';}
  }
  for(const [i,row] of rows.entries()){
    const date=lagDates[i];
    // Keep the lagged observation used for each signal, including missing values.
    if(!Object.hasOwn(row,'dgs30LagBp'))row.dgs30LagBp=Object.hasOwn(panel.dgs30,date)?panel.dgs30[date]:fresh[date]??null;
    panel.dgs30[date]=row.dgs30LagBp;
  }
  return warning;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const panel=JSON.parse(await readFile(new URL('../public/custom-inputs.json',import.meta.url),'utf8'));
  const through=panel.dates.at(-1);
  const csv=process.argv[2]?await readFile(process.argv[2],'utf8'):await fetchDgs30(panel.dates[0],through);
  const yieldsBp=alignDgs30(panel.dates,parseDgs30(csv));
  const snapshot={series:'DGS30',source:SERIES,through,csvSHA256:createHash('sha256').update(csv).digest('hex'),yieldsBp};
  await writeFile(new URL('../public/dgs30.json',import.meta.url),JSON.stringify(snapshot)+'\n');
  console.log(JSON.stringify({series:snapshot.series,through,sessions:panel.dates.length,missing:Object.values(yieldsBp).filter(v=>v===null).length}));
}
