import {createHash} from 'node:crypto';
const clone=x=>JSON.parse(JSON.stringify(x));
export const configDigest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
/** Register a new paper strategy version; never replace or recalculate old points. */
export function registerCustomVersion(previous,previousConfig,custom,{id,startDate,registeredAt,sourceSettingsFile,sourceSettingsSHA256,previousCustom}){
  if(previous.configHash!==configDigest(previousConfig))throw new Error('登记前账本与配置版本不一致，须先同步最新状态。');
  if(!/^custom-[a-z0-9-]+$/.test(id)||!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(Date.parse(registeredAt)))throw new Error('登记标识、日期或时间无效。');
  if(startDate<registeredAt.slice(0,10))throw new Error('新版本不能回填登记以前的日期。');
  const version=configDigest(custom),existing=previous.strategies.find(s=>s.id===id);
  if(existing){if(existing.configVersion!==version||existing.archivedAt)throw new Error('策略ID已用于其他参数版本。');return{state:clone(previous),config:clone(previousConfig),audit:null,idempotent:true};}
  const state=clone(previous),oldId=previousConfig.customId||'custom-momentum',old=state.strategies.find(s=>s.id===oldId&&!s.archivedAt);
  if(!old)throw new Error('未找到要替换的自定义跟踪版本。');
  const previousPointsHash=configDigest(old.points);
  for(const s of state.strategies)s.configVersion??=previous.configHash;
  old.archivedAt=registeredAt;old.configSnapshot=clone(previousCustom||previousConfig.custom);
  const registration={strategyId:id,previousStrategyId:oldId,name:custom.name,startDate,registeredAt,configVersion:version,sourceSettingsFile,sourceSettingsSHA256};
  state.strategies.push({id,name:custom.name,startDate,registeredAt,configVersion:version,configSnapshot:clone(custom),sourceSettingsFile,band:custom.band,costMultiplier:custom.costMultiplier,lastDate:null,amounts:{BIL:1},points:[],pending:null,applied:null});
  state.registrations=[...(state.registrations||[]),registration];
  const config={...clone(previousConfig),customId:id,custom:clone(custom),customRegistration:registration};
  config.notes=[...(config.notes||[]).filter(n=>!n.includes('自定义动量按本文件')),'自定义策略按本文件登记；浏览器草稿不会自动上传。旧版本归档，新版本从登记后可执行的完整收盘开始，以1为基准记录。'];
  state.configHash=configDigest(config);
  const audit={schemaVersion:1,...registration,previousConfigHash:previous.configHash,nextConfigHash:state.configHash,previousPointsHash,previousPointsCount:old.points.length,previousLastDate:old.lastDate,configSnapshot:clone(custom)};
  return{state,config,audit,idempotent:false};
}
