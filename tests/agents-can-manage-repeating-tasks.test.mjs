// Agents could start chats but could not create the repeating rules the app already runs.
import {beforeEach,afterEach,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {buildControlTools} from '../mcp/control-tools.mjs';
import {Store} from '../main/store.mjs';
import {Repeats} from '../main/repeats.mjs';
import {loadStore} from '../main/store-modules.mjs';
import {Supervisor} from '../main/supervisor.mjs';
let root,store,tools;
const run=async(name,args)=>{const tool=tools.find(t=>t.name===name);expect(tool,`${name} is exposed to agents`).toBeTruthy();return JSON.parse((await tool.run(z.object(tool.schema).parse(args))).content[0].text)};
beforeEach(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-repeat-'));
 for(const slug of ['qa','other']){fs.mkdirSync(path.join(root,slug));fs.writeFileSync(path.join(root,slug,'project.json'),JSON.stringify({id:slug,name:slug,schemaVersion:1}));}
 store=new Store({accountRoot:root,storeRoot:root,products:[],personalProducts:[]});store.modules=await loadStore();store.repeats=new Repeats(store.modules);
 tools=buildControlTools({root},{storeFactory:async()=>store});
});
afterEach(()=>{store.unwatch();fs.rmSync(root,{recursive:true,force:true})});
it('creates a weekly Sol rule, lists it and executes successive weeks exactly once',async()=>{
 const rule=await run('create_repeating_task',{product:'qa',title:'Weekly review',body:'Check the last seven days.',every:'week',on:1,at:'08:00',engine:'codex',model:'gpt-6.1-sol'});
 expect(rule).toMatchObject({every:'week',on:1,at:'08:00',engine:'codex',model:'gpt-6.1-sol'});
 const listed=await run('list_repeating_tasks',{product:'qa'});expect(listed.tasks).toContainEqual(expect.objectContaining({id:rule.id,nextRunAt:expect.any(Number)}));expect(listed.timeZone).toBeTruthy();
 const sup=Object.assign(Object.create(Supervisor.prototype),{paused:false,config:{},store});
 const monday=new Date();monday.setDate(monday.getDate()+((8-monday.getDay())%7||7));monday.setHours(9,0,0,0);
 await sup.serveRepeats(+monday);await sup.serveRepeats(+monday);
 let runs=store.listItems(+monday).filter(i=>i.labels.includes(`repeat:${rule.id}`));expect(runs).toHaveLength(1);expect(runs[0]).toMatchObject({engine:'codex',model:'gpt-6.1-sol'});
 monday.setDate(monday.getDate()+7);await sup.serveRepeats(+monday);
 runs=store.listItems(+monday).filter(i=>i.labels.includes(`repeat:${rule.id}`));expect(runs).toHaveLength(2);
});
it('edits and ends a rule through the same store without touching another project',async()=>{
 const rule=await run('create_repeating_task',{product:'qa',title:'Review',every:'day',at:'09:00'});
 await expect(run('update_repeating_task',{product:'other',id:rule.id,at:'10:00'})).rejects.toThrow('No such repeating task');
 expect(await run('update_repeating_task',{product:'qa',id:rule.id,every:'week',on:5,at:'10:00',body:'Revised'})).toMatchObject({every:'week',on:5,at:'10:00',body:'Revised'});
 await run('end_repeating_task',{product:'qa',id:rule.id});expect((await run('list_repeating_tasks',{})).tasks).toEqual([]);
});
it.each([{every:'week',at:'08:00'},{every:'day',at:'25:00'},{every:'week',on:9,at:'08:00'}])('refuses an invalid schedule before writing anything: %j',async fields=>{
 await expect(run('create_repeating_task',{product:'qa',title:'Invalid',...fields})).rejects.toThrow();expect(store.listRepeats()).toEqual([]);
});
it('initializes repeating rules in the default MCP store, without app startup side effects',async()=>{
 tools=buildControlTools({root});
 const rule=await run('create_repeating_task',{product:'qa',title:'Default store',every:'weekday',at:'08:00'});
 expect(rule.every).toBe('weekday');expect(store.listRepeats()).toHaveLength(1);
});
