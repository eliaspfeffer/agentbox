// Workers launch external Node, which cannot import the store server from app.asar.
import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import * as asar from '@electron/asar';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
it('keeps the launcher, imports, package type and production dependencies available to external Node',async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'packaged-store-'));
 try{
  const source=path.join(dir,'app');fs.mkdirSync(source);
  for(const folder of ['mcp','main','shared'])fs.cpSync(path.join(root,folder),path.join(source,folder),{recursive:true});
  fs.copyFileSync(path.join(root,'package.json'),path.join(source,'package.json'));
  fs.mkdirSync(path.join(source,'node_modules'));
  fs.writeFileSync(path.join(source,'node_modules/runtime-probe.txt'),'present');
  const archive=path.join(dir,'app.asar');
  await asar.createPackageWithOptions(source,archive,{unpack:`{${manifest.build.asarUnpack.map(p=>`**/${p}`).join(',')}}`});
  const unpacked=archive+'.unpacked';
  for(const f of ['mcp/agentbox-mcp.sh','mcp/stdio.mjs','mcp/control-tools.mjs','main/store.mjs','main/repeats.mjs','shared/repeats.mjs','package.json','node_modules/runtime-probe.txt'])expect(fs.existsSync(path.join(unpacked,f)),f).toBe(true);
  expect(fs.statSync(path.join(unpacked,'mcp/agentbox-mcp.sh')).mode&0o111).not.toBe(0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
