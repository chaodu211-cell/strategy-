import {validatePublicAssets} from './check-public-assets.mjs';
import {mkdir,readdir,copyFile,readFile,writeFile,access} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Public research assets are compressed in GitHub to keep source publication compact.
try{for(const name of await readdir(resolve(root,'seed-assets'))){if(!name.endsWith('.gz'))continue;const dest=name.slice(0,-3).replaceAll('__','/');if(dest==='public/daily-live.json'){try{await access(resolve(root,dest));continue;}catch{}}await mkdir(dirname(resolve(root,dest)),{recursive:true});await writeFile(resolve(root,dest),gunzipSync(await readFile(resolve(root,'seed-assets',name))));}}catch(error){if(error.code!=='ENOENT')throw error;}
if(process.argv.includes('--restore-only'))process.exit(0);
await validatePublicAssets(resolve(root,'public'));
await mkdir(resolve(root,'pages'),{recursive:true});
for(const name of await readdir(resolve(root,'public')))await copyFile(resolve(root,'public',name),resolve(root,'pages',name));
await writeFile(resolve(root,'pages/runtime-config.json'),JSON.stringify({mode:'github-pages',liveURL:'./daily-live.json',forwardURL:'./forward.json'}));
await writeFile(resolve(root,'pages/.nojekyll'),'');
console.log('GitHub Pages build ready.');
