export function desktopLiveActions({state,open,details,done,reply,later}){
 const screen=current=>{const {rows}=state();return {now:new Date().toISOString(),current:current?{id:current.id,product:current.product,title:current.title,status:current.status,position:rows.findIndex(i=>i.id===current.id)+1,total:rows.length}:null,latestAgentResult:current?.result||current?.note||'',empty:!current}};
 return async a=>{
  const {rows,current}=state();let target=current;
  if(a.action==='read')return screen(target);
  if(a.action==='review'){target=current||rows[0];if(target)open(target);return screen(target)}
  if(a.action==='open'){target=rows.find(i=>i.id===a.id);if(!target)throw Error('Chat not found in the current list.');open(target);return screen(target)}
  if(a.action==='next'||a.action==='previous'){const at=rows.findIndex(i=>i.id===current?.id),step=a.action==='next'?1:-1;target=rows[at+step];if(!target)return {...screen(current),boundary:step===1?'end':'start'};open(target);return screen(target)}
  if(!current)throw Error('Open a chat first.');
  if(a.action==='details')return {...screen(current),details:await details(current)};
  if(a.id!==current.id)throw Error('The displayed chat changed. Read it again before taking action.');
  const next=rows[rows.findIndex(i=>i.id===current.id)+1];
  if(a.action==='done')await done(current);
  else if(a.action==='reply'){if(typeof a.text!=='string'||!a.text.trim()||a.text.length>24000)throw Error('Response text is required.');await reply(current,a.text)}
  else if(a.action==='later'){const minutes=Number(a.text);if(!Number.isFinite(minutes)||minutes<1||minutes>525600)throw Error('Ask when to remind; pass minutes from now (1–525600).');await later(current,minutes)}
  else throw Error('Unsupported desktop action.');
  if(next){open(next);target=next}else {open(null);target=null;}
  return {...screen(target),action:a.action,boundary:next?undefined:'end'};
 };
}
