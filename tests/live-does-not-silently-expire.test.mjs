// Long dictations used to stop silently at two minutes, regardless of audio size.
import {it,expect,vi} from 'vitest';
import React from 'react';
import {DictationButtons} from '../renderer/src/components/Dictation.tsx';
import {queueDictation} from '../shared/dictation-jobs.mjs';
vi.mock('react',async importOriginal=>({...await importOriginal(),useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect:fn=>fn()}));
vi.mock('../shared/dictation-jobs.mjs',()=>({queueDictation:vi.fn(),dictationJobs:()=>[],watchDictations:()=>()=>{},retryDictation:vi.fn(),editDictation:vi.fn(),sendDictation:vi.fn(),dismissDictation:vi.fn()}));
it('keeps recording beyond two minutes and transcribes with notice at the size boundary',async()=>{
 let recorder;class Recorder extends EventTarget{state='inactive';mimeType='audio/webm';constructor(){super();recorder=this}start(){this.state='recording'}stop(){this.state='inactive';this.dispatchEvent(new Event('stop'))}}
 const notice=vi.fn(),track={stop:vi.fn()},stream={getTracks:()=>[track],getAudioTracks:()=>[]};
 vi.useFakeTimers();vi.stubGlobal('React',React);vi.stubGlobal('window',{zero:{transcribeAudio:vi.fn()}});vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>stream}});
 try{const element=DictationButtons({target:'Example',onDraft:()=>{},onSend:()=>{},onNotice:notice});element.props.children.props.onClick();await vi.advanceTimersByTimeAsync(121000);expect(recorder.state).toBe('recording');expect(queueDictation).not.toHaveBeenCalled();
 const event=new Event('dataavailable');event.data=new Blob([new Uint8Array(17*1024*1024)]);recorder.dispatchEvent(event);
 expect(recorder.state).toBe('inactive');expect(queueDictation).toHaveBeenCalledTimes(1);expect(notice).toHaveBeenCalledWith(expect.stringContaining('Dateigrößengrenze'));expect(track.stop).toHaveBeenCalled();
 }finally{vi.useRealTimers();vi.unstubAllGlobals()}
});
