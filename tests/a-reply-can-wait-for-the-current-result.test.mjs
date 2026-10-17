// Deferring must not steer at a tool boundary or lose replies behind the final result.
import {it,expect,vi} from 'vitest';
import {submitReply,queuedReplyText} from '../main/live-replies.mjs';
it('saves a deferred reply without steering or interrupting the active turn',async()=>{
 const child={steer:vi.fn(),interrupt:vi.fn()},session={product:'p',engine:'claude',child};
 const sup={sessions:new Map([['w',session]]),runNow:vi.fn()};const item={id:'w',product:'p',answer:'later'};
 await submitReply(sup,{...item,afterTurn:true},()=>item);
 expect(child.steer).not.toHaveBeenCalled();expect(child.interrupt).not.toHaveBeenCalled();expect(sup.runNow).not.toHaveBeenCalled();
});
it('retains every queued message when the result is written after them',()=>{
 const item={answer:'second',wrote:{answer:{ts:3}}};
 const history=[{ts:1,patch:{result:'previous'}},{ts:2,source:'founder',patch:{answer:'first'}},{ts:3,source:'founder',patch:{answer:'second'}},{ts:4,patch:{result:'current result'}}];
 expect(queuedReplyText(item,history,()=>false)).toBe('first\n\nsecond');
});
it('starts immediately if the turn has already ended',async()=>{const sup={sessions:new Map(),runNow:vi.fn()};await submitReply(sup,{product:'p',id:'w',answer:'next',afterTurn:true},()=>({product:'p',id:'w',answer:'next'}));expect(sup.runNow).toHaveBeenCalledWith('p','w')});
it('drains saved replies once after a held remote conversation finishes',async()=>{
 const {flushAfterTurnReplies}=await import('../main/live-replies.mjs');
 const item={id:'w',product:'p',answer:'second',wrote:{answer:{ts:3}}};
 const steer=vi.fn().mockResolvedValue(undefined),session={itemId:'w',product:'p',remoteIdle:true,queuedAfterTurn:true,child:{steer}};
 const sup={sessions:new Map([['w',session]]),store:{readItem:()=>item,readHistory:()=>[{ts:2,source:'founder',patch:{answer:'first'}},{ts:3,source:'founder',patch:{answer:'second'}},{ts:4,patch:{result:'finished'}}]},_answerDelivered:()=>false,_handledAnswers:new Set(),_answerKey:()=> 'key',_saveState:()=>{}};
 await flushAfterTurnReplies(sup,session);await flushAfterTurnReplies(sup,session);
 expect(steer).toHaveBeenCalledOnce();expect(steer).toHaveBeenCalledWith('first\n\nsecond');expect(sup._handledAnswers.has('key')).toBe(true);
});
it('includes previously deferred words when a later message interrupts now',async()=>{
 const old={id:'w',product:'p',answer:'later',wrote:{answer:{ts:2}}};
 const child={steer:vi.fn().mockResolvedValue(),interrupt:vi.fn()},session={product:'p',queuedAfterTurn:true,child};
 const sup={sessions:new Map([['w',session]]),store:{readItem:()=>old,readHistory:()=>[{ts:2,source:'founder',patch:{answer:'later'}}]},_answerDelivered:()=>false,_handledAnswers:new Set(),_answerKey:()=> 'key',_saveState:()=>{}};
 await submitReply(sup,{product:'p',id:'w',answer:'now',now:true},()=>({...old,answer:'now'}));
 expect(child.steer.mock.calls[0][0]).toContain('later\n\nnow');expect(child.interrupt).toHaveBeenCalledOnce();expect(session.queuedAfterTurn).toBeUndefined();
});
