import {it,expect,vi} from 'vitest';
import {desktopLiveActions} from '../shared/desktop-live-actions.mjs';
import {appendLiveLog} from '../renderer/src/live/live-actions.js';
it('searches completed chats and opens them without adding todos to the reading list',async()=>{
 const old={id:'old',product:'p',title:'Earlier planning',status:'done'},todo={id:'todo',product:'p',title:'Earlier todo',start:'manual'};let current=null;
 const run=desktopLiveActions({state:()=>({rows:[],all:[old,todo],current}),open:i=>current=i});
 expect((await run({action:'search',text:'earlier'})).matches.map(i=>i.id)).toEqual(['old']);
 expect((await run({action:'open',id:'old',product:'p'})).current.id).toBe('old');
});
it('creates only the requested todo through the existing callback',async()=>{
 const createTodo=vi.fn(async()=>({id:'todo'}));const run=desktopLiveActions({state:()=>({rows:[],current:null}),createTodo});
 await expect(run({action:'todo',product:'p',text:'Buy bread'})).resolves.toMatchObject({created:{id:'todo'}});
 expect(createTodo).toHaveBeenCalledWith('p','Buy bread');
 await expect(run({action:'todo',product:'p',text:''})).rejects.toThrow();
});
it('retains only the newest 2000 characters',()=>{
 expect(appendLiveLog('a'.repeat(2000),'b'.repeat(1500))).toBe('a'.repeat(500)+'b'.repeat(1500));
 expect(appendLiveLog('', 'z'.repeat(9000))).toHaveLength(2000);
});
