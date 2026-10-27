/** Append-only paper NAV. Only previously observed targets can trade at a later close. */
const clone=x=>JSON.parse(JSON.stringify(x));
const total=o=>Object.values(o).reduce((s,v)=>s+v,0);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function advanceLedger(previous,marketRows,{observedAt,sourceHash}={}) {
  const state=clone(previous),rows=[...marketRows].sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(rows.map(r=>r.date)).size!==rows.length)throw new Error('行情日期重复');
  for(let i=1;i<rows.length;i++)if(rows[i].date<=rows[i-1].date)throw new Error('行情日期非递增');
  for(const strategy of state.strategies){
    for(const row of rows){
      if(row.date<state.startDate||row.date<=strategy.lastDate)continue;
      if(Date.parse(row.closeAt)>Date.parse(observedAt))continue;
      const previousRow=rows.find(r=>r.date===strategy.lastDate);
      let amounts={...strategy.amounts},interest=0,fees=0,rebalanced=false;
      const target=strategy.pending;
      const eligible=target&&target.signalDate<row.date&&Date.parse(target.observedAt)<Date.parse(row.closeAt);
      if(strategy.lastDate){
        if(!previousRow)throw new Error('缺少账本上一个交易日行情 '+strategy.lastDate);
        const days=(Date.parse(row.date)-Date.parse(strategy.lastDate))/86400000;
        for(const [symbol,value]of Object.entries(amounts)){
          if(symbol==='BIL'&&value<0){interest=-value*.05*days/365;amounts[symbol]=value-interest;continue;}
          if(!value)continue;
          if(!finite(row.prices[symbol])||!finite(previousRow.prices[symbol])||previousRow.prices[symbol]<=0)throw new Error('持仓复权行情缺失 '+symbol);
          amounts[symbol]=value*row.prices[symbol]/previousRow.prices[symbol];
        }
      }else if(eligible){
        for(const [s,w]of Object.entries(target.weights))if(w>1e-9&&s!=='BIL'&&row.tradable?.[s]!==true)throw new Error('起始目标工具不可交易 '+s);
        amounts={...target.weights};rebalanced=true;
      }
      let nav=total(amounts);
      if(!finite(nav)||nav<=0)throw new Error(strategy.id+' 净值耗尽，暂停账本');
      const before=Object.fromEntries(Object.entries(amounts).map(([s,v])=>[s,v/nav]));
      if(strategy.lastDate&&eligible){
        const symbols=[...new Set([...Object.keys(before),...Object.keys(target.weights)])];
        const delta=symbols.map(s=>Math.abs((target.weights[s]||0)-(before[s]||0)));
        if(Math.max(...delta)>strategy.band+1e-12||symbols.some(s=>((before[s]||0)>1e-9)!==((target.weights[s]||0)>1e-9))){
          let rate=0;
          symbols.forEach((s,i)=>{if(!delta[i])return;if(s==='BIL'&&((before[s]||0)<0||(target.weights[s]||0)<0))return;if(!finite(row.costs?.[s]))throw new Error('缺少交易成本 '+s);if((target.weights[s]||0)>1e-9&&s!=='BIL'&&row.tradable?.[s]!==true)throw new Error('目标工具不可交易 '+s);rate+=delta[i]*row.costs[s];});
          if(rate>=1)throw new Error('交易成本耗尽净值');fees=nav*rate;nav-=fees;
          amounts=Object.fromEntries(Object.entries(target.weights).map(([s,w])=>[s,w*nav]));rebalanced=true;
        }
      }
      const weights=Object.fromEntries(Object.entries(amounts).map(([s,v])=>[s,v/nav]));
      const applied=eligible?target:strategy.applied;
      if(eligible)strategy.applied=clone(target);
      const point={date:row.date,nav,weights,signalDate:applied?.signalDate||null,selection:applied?.selection||'BIL',state:applied?.state||'等待完整信号',reasons:applied?.reasons||['尚无在成交前已观测的完整目标，持有BIL。'],rebalanced,fees,financingInterest:interest,sourceHash,observedAt};
      strategy.points.push(point);strategy.lastDate=row.date;strategy.amounts=amounts;
    }
  }
  return state;
}
export function queueTargets(previous,targets,observedAt){
  const state=clone(previous);
  for(const s of state.strategies){const t=targets[s.id];if(!t)continue;
    if(s.pending&&t.signalDate<=s.pending.signalDate)continue;
    if(!Object.values(t.weights).every(finite)||Math.abs(total(t.weights)-1)>1e-8)throw new Error('目标权重无效 '+s.id);
    s.pending={...clone(t),observedAt};
  }
  return state;
}
export function publicLedger(state,status){return{schemaVersion:1,startDate:state.startDate,updatedAt:status.checkedAt,status,strategies:state.strategies.map(s=>({id:s.id,name:s.name,configVersion:state.configHash,points:s.points,pending:s.pending,baselinePending:!s.lastDate,latest:s.points.at(-1)||{date:state.startDate,nav:1,weights:{BIL:1},state:'跟踪起点 · 等待首个完整收盘',reasons:['净值基准为1，尚未记录交易日收益。']}}))};}
