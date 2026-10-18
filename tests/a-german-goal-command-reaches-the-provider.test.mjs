// /ziel was absent from both menus and reached neither provider's goal operation.
import {it,expect} from 'vitest';
import {providerCommand} from '../shared/provider-commands.mjs';
import {commandPrompt} from '../shared/claude-commands.mjs';
import {slashRows,commandBeingWritten} from '../renderer/src/slash-menu';
it.each(['claude-code','codex'])('recognizes /ziel on %s without losing its objective',engine=>{
 expect(providerCommand('/ziel Finish the page\nand test it',engine)).toMatchObject({name:'goal',args:'Finish the page\nand test it'});
});
it.each([true,false])('offers the goal command for the German prefix (Claude=%s)',claude=>{
 expect(slashRows('zie',false,claude)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'command',cmd:expect.objectContaining({name:'goal'})})]));
 expect(commandBeingWritten('/ziel Finish it',claude,[])?.name).toBe('goal');
});
it('sends the canonical Claude command and does not intercept prose or a different word',()=>{
 expect(commandPrompt('/ZIEL Finish it\nwith tests')).toBe('/goal Finish it\nwith tests');
 expect(commandPrompt('please /ziel Finish it')).toBeNull();
 expect(providerCommand('/zielsetzung test','codex').route).toBe('unavailable');
});
import {vi} from 'vitest';
import {createCodexWorker} from '../main/codex-session.mjs';
import {captureCodexEvent} from '../main/codex.mjs';
const settle=()=>new Promise(r=>setImmediate(r));
it('sets a native goal under a tracked worker, watches continuations, and releases only after completion',async()=>{
 let handlers;
 const server={startThread:vi.fn(async(p,h)=>{handlers=h;return {threadId:'test-thread'};}),request:vi.fn(async()=>({goal:{status:'active'}})),startTurn:vi.fn(),unwatch:vi.fn()};
 const worker=createCodexWorker({server,turnParams:{goal:{objective:'Finish the test'}}});
 const exit=vi.fn();worker.on('exit',exit);
 await settle();
 expect(server.request).toHaveBeenCalledWith('thread/goal/set',{threadId:'test-thread',objective:'Finish the test',status:'active',origin:'user'});
 expect(server.startTurn).not.toHaveBeenCalled();
 const notify=(m,p)=>handlers.onNotification(m,{threadId:'test-thread',...p});
 notify('thread/goal/updated',{goal:{status:'active'}});
 notify('turn/started',{turn:{id:'a'}});
 notify('turn/completed',{turn:{id:'a',status:'completed'}});
 expect(exit).not.toHaveBeenCalled();
 notify('turn/started',{turn:{id:'b'}});
 notify('thread/goal/updated',{goal:{status:'complete'}});
 expect(exit).not.toHaveBeenCalled();
 notify('turn/completed',{turn:{id:'b',status:'completed'}});
 expect(exit).toHaveBeenCalledOnce();
 expect(server.unwatch).toHaveBeenCalledWith('test-thread');
});
it('does not retain the preceding goal turn’s final answer',()=>{
 const session={result:'old',codexFinalAnswer:true,resultIsError:true};
 captureCodexEvent(session,'turn/started',{turn:{id:'next'}});
 expect(session.result).toBeUndefined();expect(session.codexFinalAnswer).toBeUndefined();
});
it('reattaches an active goal after restart without submitting a duplicate turn',async()=>{
 let handlers;
 const server={resumeThread:vi.fn(async(p,h)=>{handlers=h;return {thread:{id:p.threadId,status:{type:'idle'},turns:[]}}}),request:vi.fn(async()=>({goal:{status:'active'}})),startTurn:vi.fn(),unwatch:vi.fn()};
 const worker=createCodexWorker({server,resumeThreadId:'existing',turnParams:{additionalContext:{agentbox_resume:{kind:'application',value:'resume'}}}});
 const exit=vi.fn();worker.on('exit',exit);await settle();
 expect(server.request).toHaveBeenCalledWith('thread/goal/get',{threadId:'existing'});
 expect(server.startTurn).not.toHaveBeenCalled();
 handlers.onNotification('turn/started',{threadId:'existing',turn:{id:'resumed'}});
 handlers.onNotification('turn/completed',{threadId:'existing',turn:{id:'resumed',status:'completed'}});
 expect(exit).not.toHaveBeenCalled();
 handlers.onNotification('thread/goal/updated',{threadId:'existing',goal:{status:'paused'}});
 expect(exit).toHaveBeenCalledOnce();
});

import {Supervisor} from '../main/supervisor.mjs';
it('preserves the selected reasoning effort for autonomous goal turns',()=>{
 const sup=Object.assign(Object.create(Supervisor.prototype),{config:{},_codexHome:()=>'/fixture',_codexModelWord:()=>'',codexModelRefusal:()=>null,codexEffortRefusal:()=>null,effectiveCodexMode:()=>null});
 expect(sup.codexThreadParamsFor({goal:{objective:'Test'},effort:'high'},'/tmp',[],null).config.model_reasoning_effort).toBe('high');
});
