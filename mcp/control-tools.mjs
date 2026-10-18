// Founder controls share the app's disk write path; stdio stays scoped to the configured account.
import path from 'node:path';
import {z} from 'zod';
import {Store} from '../main/store.mjs';
import {loadStore} from '../main/store-modules.mjs';
import {Repeats} from '../main/repeats.mjs';
import {nextRunAt} from '../shared/repeats.mjs';
import {readCodexThreads} from '../main/codex-threads.mjs';
const json=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
export function buildControlTools(account,{storeFactory=async()=>{const store=new Store({accountRoot:account.root,storeRoot:path.dirname(path.dirname(account.root)),products:[],personalProducts:[]});store.modules=await loadStore();store.repeats=new Repeats(store.modules);return store}}={}){
 let pending;const store=()=>pending??=storeFactory();
 const address={product:z.string(),id:z.string()};
 const fields={product:z.string(),title:z.string().min(1),body:z.string().optional(),engine:z.enum(['codex','claude']).optional(),model:z.string().optional()};
 const schedule={every:z.enum(['day','weekday','week']),at:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),on:z.number().int().min(0).max(6).optional().describe('Weekly day: Sunday=0, Monday=1, ..., Saturday=6')};
 const repeatFields={title:fields.title.optional(),body:fields.body,engine:fields.engine,model:fields.model,priority:z.number().int().min(0).max(10).optional(),every:schedule.every.optional(),at:schedule.at.optional(),on:schedule.on};
 const getRepeat=async args=>{const s=await store();if(!s.listRepeats().some(r=>r.product===args.product&&r.id===args.id))throw Error('No such repeating task.');return s};
 const create=async(args,start)=>{const s=await store();return json(s.composeItem(args.product,{...args,start}))};
 const get=async(args)=>{const s=await store();const row=s.readItem(args.product,args.id);if(!row)throw Error('No such chat.');return {s,row}};
 return [
  {name:'list_repeating_tasks',description:'List active recurring Agentbox tasks and their next run time. Schedules use the computer’s local timezone. Check before creating a rule to avoid duplicates. Runs start while Agentbox is running; missed periods are coalesced into one catch-up run.',schema:{product:z.string().optional()},run:async args=>{const s=await store();return json({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,tasks:s.listRepeats().filter(r=>!args.product||r.product===args.product).map(r=>({...r,nextRunAt:nextRunAt(r)}))})}},
  {name:'create_repeating_task',description:'Create an explicitly user-authorized recurring Agentbox task (daily, weekdays, or weekly). The existing scheduler executes it automatically with the chosen provider/model. Times are local to this computer, not UTC. A newly created rule may immediately catch up its latest period. Put the complete instructions and any authorized notification recipient in body; this tool itself sends no email.',schema:{...fields,...schedule,priority:repeatFields.priority},run:async args=>{const s=await store();return json(s.composeRepeat(args.product,args))}},
  {name:'update_repeating_task',description:'Edit an existing recurring task’s instructions, schedule or provider/model. Changing a rule affects future runs; it does not interrupt an active run.',schema:{...address,...repeatFields},run:async({product,id,...patch})=>{const s=await getRepeat({product,id});return json(s.setRepeat(product,id,patch))}},
  {name:'end_repeating_task',description:'Stop future runs of a recurring task, preserving past runs and any active conversation.',schema:address,run:async args=>{const s=await getRepeat(args);return json(s.endRepeat(args.product,args.id))}},
  {name:'create_chat',description:'Start a new Agentbox chat in an existing project using the chosen installed provider.',schema:fields,run:args=>create(args,'now')},
  {name:'save_todo',description:'Save a personal reminder in Needs You without starting an agent.',schema:fields,run:args=>create(args,'manual')},
  {name:'convert_to_todo',description:'Explicitly hold an existing idle chat as a personal todo in Needs You. Pending context and history are preserved.',schema:address,run:async args=>{const {s}=await get(args);s.threadEdit(args.product,args.id,{start:'manual'});return json(s.answerItem(args.product,args.id,{status:'blocked'}))}},
  {name:'read_agentbox_chat',description:'Read the stored conversation for an Agentbox task.',schema:address,run:async args=>{const {s}=await get(args);return json(s.readThread(args.product,args.id))}},
  {name:'start_chat',description:'Explicitly start a saved personal task or continue an idle chat. Does not kill a running worker.',schema:{...address,message:z.string().optional()},run:async args=>{const {s,row}=await get(args);if(row.status==='done'||row.status==='cancelled')throw Error('This chat is closed.');s.threadEdit(args.product,args.id,{start:'now'});return json(s.answerItem(args.product,args.id,{answer:args.message||'Continue this task from its existing context.',status:'open'}))}},
  {name:'reply_to_chat',description:'Append a user reply using the existing conversation; running agents retain pending follow-up context.',schema:{...address,message:z.string().min(1)},run:async args=>{const {s}=await get(args);return json(s.answerItem(args.product,args.id,{answer:args.message}))}},
  {name:'find_codex_chats',description:'Find local existing Codex chats by title, including older named conversations.',schema:{query:z.string().min(2).max(160)},run:async args=>json(readCodexThreads({query:args.query}).threads)},
  {name:'import_codex_chat',description:'Import a trusted local Codex conversation by its discovered ID and title search into an Agentbox project. Does not start it.',schema:{product:z.string(),id:z.string(),query:z.string().min(2).max(160)},run:async args=>{const thread=readCodexThreads({query:args.query}).threads.find(t=>t.id===args.id);if(!thread)throw Error('No matching local chat.');const s=await store();return json(s.importCodexThreads(args.product,[thread]))}},
 ];
}
