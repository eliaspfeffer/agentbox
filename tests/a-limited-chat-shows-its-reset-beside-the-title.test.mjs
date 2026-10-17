// Limit holds were only explained inside the chat, leaving the list ambiguous.
import {it,expect} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RowCells,ThreadCells,LimitContext} from '../renderer/src/threads/Pages.tsx';
globalThis.React=React;
const draw=(props={})=>renderToStaticMarkup(React.createElement(RowCells,{title:'Task',where:'Project',priority:1,updatedAt:0,now:1000,...props}));
it('shows the provider and reset time beside a held chat',()=>{const html=draw({limit:{tool:'Claude',until:3600000}});expect(html).toContain('Claude-Limit');expect(html).toContain('Weiter ab');expect(html).toContain('role="img"');});
it('does not invent a reset time and clears the mark when the hold disappears',()=>{expect(draw({limit:{tool:'Claude',until:0}})).toContain('Resetzeit unbekannt');expect(draw()).not.toContain('Claude-Limit');});
it('prioritizes transcription and live work over stale limit snapshots',()=>{expect(draw({live:true,limit:{tool:'Claude',until:3600000}})).not.toContain('Claude-Limit');expect(draw({transcribing:true,limit:{tool:'Claude',until:3600000}})).toContain('Wird transkribiert');expect(draw({transcribing:true,limit:{tool:'Claude',until:3600000}})).not.toContain('Claude-Limit');});

it('uses live supervisor holds on open and blocked threads',()=>{
 const item={id:'limited',product:'demo',status:'open',title:'Task',createdAt:0,updatedAt:0};
 const row=(status)=>renderToStaticMarkup(React.createElement(LimitContext.Provider,{value:{limited:{tool:'Claude',until:3600000}}},React.createElement(ThreadCells,{item:{...item,status},now:1000})));
 expect(row('open')).toContain('Claude-Limit');expect(row('blocked')).toContain('Claude-Limit');expect(row('done')).not.toContain('Claude-Limit');
});
it('does not promise a past reset as a future restart',()=>{expect(draw({limit:{tool:'Claude',until:999}})).toContain('Wiederaufnahme wird geprüft');});
