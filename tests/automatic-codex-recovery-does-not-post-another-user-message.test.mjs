// Repeated transport failures posted the same recovery note as user messages eight times.
import {it,expect,vi} from 'vitest';
import {Supervisor} from '../main/supervisor.mjs';
import {createCodexWorker} from '../main/codex-session.mjs';
const sup=Object.create(Supervisor.prototype);
it('resumes with application context and no extra user message',()=>{
 const params=sup.codexTurnParamsFor({recovery:true,prompt:'Carry on from the interrupted step.',effort:'high'});
 expect(params.input).toEqual([]);
 expect(params.additionalContext.agentbox_resume).toEqual({kind:'application',value:'Carry on from the interrupted step.'});
 expect(params.effort).toBe('high');
});
it('keeps an actual new message and its images as user input',()=>{
 const params=sup.codexTurnParamsFor({prompt:'Change the heading',pictures:['/tmp/example.png']});
 expect(params.input).toEqual([{type:'text',text:'Change the heading'},{type:'localImage',path:'/tmp/example.png'}]);
 expect(params.additionalContext).toBeUndefined();
});
it('keeps attached images available during recovery',()=>{
 const params=sup.codexTurnParamsFor({recovery:true,prompt:'Read the attached picture',pictures:['/tmp/example.png']});
 expect(params.input).toEqual([{type:'localImage',path:'/tmp/example.png'}]);
});
it('reattaches to an already running recovery turn rather than steering it again',async()=>{
 let handlers;const server={resumeThread:vi.fn(async(_p,h)=>{handlers=h;return {thread:{turns:[{id:'live',status:'inProgress'}]}}}),startTurn:vi.fn(),unwatch:vi.fn()};
 const worker=createCodexWorker({server,resumeThreadId:'thread',turnParams:{input:[],additionalContext:{agentbox_resume:{kind:'application',value:'Continue'}}}});
 await new Promise(r=>setImmediate(r));
 expect(server.startTurn).not.toHaveBeenCalled();expect(worker.turnId).toBe('live');
 handlers.onNotification('turn/completed',{turn:{id:'live',status:'completed'}});
});
it('resumes without downloading the entire conversation and reads only the live turn summary',async()=>{
 const server={resumeThread:vi.fn(async()=>({thread:{status:{type:'active'},turns:[]}})),request:vi.fn(async()=>({data:[{id:'live',status:'inProgress'}]})),startTurn:vi.fn(),unwatch:vi.fn()};
 const worker=createCodexWorker({server,resumeThreadId:'thread',turnParams:{input:[],additionalContext:{agentbox_resume:{kind:'application',value:'Continue'}}}});
 await new Promise(r=>setImmediate(r));
 expect(server.resumeThread.mock.calls[0][0].excludeTurns).toBe(true);
 expect(server.request).toHaveBeenCalledWith('thread/turns/list',{threadId:'thread',limit:1,sortDirection:'desc',itemsView:'summary'});
 expect(server.startTurn).not.toHaveBeenCalled();expect(worker.turnId).toBe('live');
});
it('reports the transport failure ahead of unrelated diagnostic output',async()=>{
 let handlers;const server={resumeThread:vi.fn(async(_p,h)=>{handlers=h;return {thread:{turns:[]}}}),startTurn:vi.fn(),unwatch:vi.fn()};
 const worker=createCodexWorker({server,resumeThreadId:'thread'});const lines=[];worker.stderr.on('data',line=>lines.push(line));
 await new Promise(r=>setImmediate(r));
 handlers.onClosed({reason:'protocol',note:'a frame passed the limit',stderr:'unrelated warning '.repeat(100)});
 expect(lines[0]).toMatch(/^Codex connection stopped: protocol: a frame passed the limit/);
});
