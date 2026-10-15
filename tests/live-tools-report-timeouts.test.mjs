import {it,expect,vi} from 'vitest';
import {createToolHandler} from '../renderer/src/live/live-actions.js';
it('reports an unresolved operation and refuses overlapping retries',async()=>{
 vi.useFakeTimers();try{const sent=[],execute=vi.fn(()=>new Promise(()=>{}));const handle=createToolHandler(execute,e=>sent.push(e));
 const call=id=>handle({type:'response.event',event:{type:'response.output_item.done',item:{type:'function_call',call_id:id,name:'agentbox_action',arguments:'{"action":"read"}'}}});
 call('a');await vi.advanceTimersByTimeAsync(30001);
 expect(JSON.parse(sent[0].item.output).error).toMatch(/30 Sekunden/);
 call('b');await vi.advanceTimersByTimeAsync(1);expect(execute).toHaveBeenCalledTimes(1);
 expect(JSON.parse(sent[1].item.output).error).toMatch(/läuft noch/);
 }finally{vi.useRealTimers()}
});
