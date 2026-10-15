// A queued dictation must mark its own chat, even when titles or IDs overlap.
import {it,expect} from 'vitest';
import {queueDictation,dictationJobs,dismissDictation} from '../shared/dictation-jobs.mjs';
it('keeps the chat identity through transcription and clears it after delivery',async()=>{
 let finish; const pending=queueDictation({target:'Same title',chatKey:'project:a',transcribe:()=>new Promise(r=>finish=r),deliver:()=>{}});
 expect(dictationJobs().filter(j=>j.running&&j.chatKey==='project:a')).toHaveLength(1);
 expect(dictationJobs().filter(j=>j.running&&j.chatKey==='other:a')).toHaveLength(0);
 finish('words');await pending;expect(dictationJobs()).toHaveLength(0);
});
it('does not show a processing microphone on failed or editable transcripts',async()=>{
 await queueDictation({target:'Chat',chatKey:'p:a',transcribe:async()=>{throw Error('offline')},deliver:()=>{}});
 const job=dictationJobs().at(-1);expect(job.running).toBe(false);dismissDictation(job.id);
});
