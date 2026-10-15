// A failed resume was shown as Thinking, then Queued, throughout a reconnect loop.
import {it,expect} from 'vitest';
import {liveLine,shortWord} from '../renderer/src/live-line.ts';
const item={id:'demo',status:'open'};
it('shows starting until Codex accepts the turn',()=>{expect(liveLine(item,{session:{startedAt:Date.now(),starting:true}}).state).toBe('starting');expect(shortWord('starting')).toBe('Starting')});
it('shows reconnecting instead of a free-slot queue',()=>{expect(liveLine(item,{inProgress:true,queued:['demo'],retrying:{demo:true}}).state).toBe('retrying')});
it('keeps an accepted turn working even while another connection retries',()=>{expect(liveLine(item,{session:{startedAt:Date.now(),starting:false},retrying:{demo:true}}).state).toBe('working')});
