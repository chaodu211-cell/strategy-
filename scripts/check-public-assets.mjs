import {readFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function validatePublicAssets(directory){
  const html=await readFile(resolve(directory,'index.html'),'utf8'),css=await readFile(resolve(directory,'style.css'),'utf8');
  if(Buffer.byteLength(css)<40000||![':root{','.sidebar','.chart-area','.custom-basics','.forward-chart-wrap'].every(s=>css.includes(s))||/^\s*(undefined|\[object Object\])/.test(css))throw new Error('完整样式校验失败：style.css 缺失基础排版或被截断，停止发布。');
  const linked=[...html.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)].map(m=>m[1].split(/[?#]/)[0]);
  for(const path of new Set(linked)){if(path.includes('..'))throw new Error('页面静态资源路径无效');await access(resolve(directory,path));}
  return{stylesheetBytes:Buffer.byteLength(css),linkedAssets:new Set(linked).size};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await validatePublicAssets(resolve(dirname(fileURLToPath(import.meta.url)),'../public'))));
