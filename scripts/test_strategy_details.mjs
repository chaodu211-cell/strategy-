import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const source=readFileSync(new URL('../public/strategy-details.js',import.meta.url),'utf8'),data=read('../public/data.json'),registry=read('../public/strategy-rules.json'),seed=read('../lib/live-seed.json');
assert.deepEqual(registry.strategies,seed.config,'说明参数必须与六套原始引擎一致');
const context={window:{}};vm.runInNewContext(source,context);const {buildContent,ruleRows}=context.window.StrategyDetails;
for(const s of data.strategies){
  const p=registry.strategies[s.id],html=buildContent(s,p);
  for(const text of ['当前目标仓位','当前依据','具体策略规则','规则如何组合',s.signalDate,s.formula,`常态基准 ${p.lev_max} 倍`,`TDC &lt; ${p.rearm}`])assert.ok(html.includes(text),`${s.id}: ${text}`);
  assert.equal(ruleRows(s,p).length,12);
  for(const h of s.holdings)assert.ok(html.includes(h.symbol));
  for(const r of s.reasons.filter(r=>r.active))assert.ok(html.includes(r.title));
  assert.ok(html.includes(p.use_ad?'实心或空心红点':'仅实心红点'));
  if(p.blue_hold)assert.ok(html.includes(`${p.blue_lev} × min(1, N / ${p.blue_k})`));else assert.ok(html.includes('不启用蓝点分批抄底'));
  if(p.dd_brake)assert.ok(html.includes('20%')&&html.includes('10%'));else assert.ok(html.includes('不启用组合回撤闸'));
}
const aggressive=data.strategies.find(s=>s.id==='fitted-aggressive'),a=buildContent(aggressive,registry.strategies[aggressive.id]);
for(const text of ['3 × min(1, N / 10)','50% / QQQ','常态敞口乘 0.75','持有 1 倍纳指反向敞口','持有 0.5 倍纳指反向敞口','21 个交易日前','63 个交易日'])assert.ok(a.includes(text),text);
const unsafe=structuredClone(data.strategies[0]),params=structuredClone(registry.strategies[unsafe.id]);unsafe.summary='<script>bad</script>';unsafe.reasons=[{active:true,title:'<img src=x>',detail:'<script>bad</script>'}];params.pick='<img src=x>';
assert.ok(!buildContent(unsafe,params).includes('<script>'));assert.ok(!buildContent(unsafe,params).includes('<img'));

// Load errors remain recoverable, and a slow request cannot replace a newer card.
const makeUI=fetcher=>{
  const handlers={},retry={addEventListener:(type,fn)=>{handlers.retry=fn;}},body={innerHTML:'',scrollTop:0,querySelector:()=>retry};
  const dialog={open:false,querySelector:selector=>({addEventListener:(type,fn)=>{handlers[selector]=fn;}}),addEventListener:(type,fn)=>{handlers[type]=fn;},showModal(){this.open=true;},close(){this.open=false;handlers.close();}};
  const title={},description={},document={querySelector:selector=>({'#strategy-dialog':dialog,'#strategy-dialog-body':body,'#strategy-dialog-title':title,'#strategy-dialog-description':description}[selector]),documentElement:{classList:{add(){},remove(){}}}};
  const ctx={window:{},document,fetch:fetcher};vm.runInNewContext(source,ctx);return{api:ctx.window.StrategyDetails.attach(),body,dialog,title,handlers};
};
let resolve,requests=0;const ui=makeUI(()=>{requests++;return new Promise(r=>resolve=r);});
const first=ui.api.open(data.strategies[0]),second=ui.api.open(aggressive);
assert.ok(ui.body.innerHTML.includes('正在读取'));resolve({ok:true,json:async()=>registry});await Promise.all([first,second]);
assert.equal(requests,1);assert.equal(ui.title.textContent,'拟合·进取');assert.ok(ui.body.innerHTML.includes('3 × min(1, N / 10)'));
ui.api.close();assert.equal(ui.dialog.open,false);
let attempts=0;const retryUI=makeUI(async()=>{attempts++;if(attempts===1)throw Error('offline');return{ok:true,json:async()=>registry};});
await retryUI.api.open(aggressive);assert.ok(retryUI.body.innerHTML.includes('暂未读取成功'));assert.ok(retryUI.body.innerHTML.includes('当前目标仓位'));await retryUI.handlers.retry();assert.equal(attempts,2);assert.ok(retryUI.body.innerHTML.includes('具体策略规则'));
console.log(JSON.stringify({sixStrategyParameters:true,currentHoldingsAndReasons:true,asyncSelectionAndRetry:true,escapedHTML:true}));
