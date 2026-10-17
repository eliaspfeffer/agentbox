// Claude emits a synthetic API error before an empty result. Keep the limit
// as a failure so the supervisor retries after reset instead of asking the user.
import {it,expect} from 'vitest';
import {captureStream} from '../main/harnesses/claude-stream.mjs';
import {desktopLiveRows,desktopLiveActions} from '../shared/desktop-live-actions.mjs';
it('preserves a structured usage rejection across an empty result',()=>{
 const s={};captureStream(s,JSON.stringify({type:'assistant',isApiErrorMessage:true,apiError:'usage_limit_reached',message:{content:[{type:'text',text:"You've hit your session limit · resets 1:10am (Europe/Berlin)"}]}}));
 expect(s.resultIsError).toBe(true);
 captureStream(s,JSON.stringify({type:'result',result:'',is_error:false}));
 expect(s.resultIsError).toBe(true);expect(s.result).toContain('session limit');
});
it('does not classify an ordinary assistant mention as a failure',()=>{const s={};captureStream(s,JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'usage limit'}]}}));captureStream(s,JSON.stringify({type:'result',result:'Finished',is_error:false}));expect(s.resultIsError).toBe(false)});
it('skips limit-paused chats in Live, including the focused chat and search',async()=>{
 const held={id:'held',product:'p',status:'blocked',title:'Paused'},ready={id:'ready',product:'p',status:'open',title:'Ready'};
 const atLimit={held:{tool:'Claude',until:Date.now()+60000}};
 expect(desktopLiveRows([held],[ready],atLimit)).toEqual([ready]);
 const execute=desktopLiveActions({state:()=>({current:held,rows:[held,ready],all:[held,ready],atLimit}),open:()=>{}});
 expect((await execute({action:'read'})).current).toBeNull();
 expect((await execute({action:'search',text:'Paused'})).matches).toEqual([]);
});
