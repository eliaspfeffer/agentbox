import {useEffect,useState} from 'react';
import {api} from '../api';
import {docKind} from '../doc-pane';
import {fileGlance} from '../file-glance';
import {ArtifactThumbnail} from './ArtifactThumbnail';
import './message-files.css';

export type FileLook='rows'|'chips'|'tiles'|'none';

type Glance={state:'reading'|'missing'|'ok';title?:string|null;line?:string|null};

/** Read a file once to learn whether it opens at all and what it calls
 * itself. A file nothing can read gets no card: the message still names it. */
function useGlance(product:string,path:string,revision:number):Glance {
  const [glance,setGlance]=useState<Glance>({state:'reading'});
  useEffect(()=>{
    let live=true;
    setGlance({state:'reading'});
    const kind=docKind(path);
    const done=(g:Glance)=>{if(live)setGlance(g);};
    if (kind==='markdown') api.readDoc({product,src:path}).then(r=>r.ok?done({state:'ok',...fileGlance(r.text??'')}):done({state:'missing'})).catch(()=>done({state:'missing'}));
    else if (kind==='code') api.codeChange({product,src:path}).then(r=>done({state:r.ok&&r.change?'ok':'missing',title:'Code changes'})).catch(()=>done({state:'missing'}));
    else api.resolveDoc({product,src:path}).then(r=>done({state:r.ok?'ok':'missing'})).catch(()=>done({state:'missing'}));
    return ()=>{live=false;};
  },[product,path,revision]);
  return glance;
}

/** Every file a message names, drawn small enough to read past. */
export function MessageFiles({look,product,paths,revision,openDoc,onOpen}:{look:FileLook;product:string;paths:string[];revision:number;openDoc?:string|null;onOpen:(path:string)=>void}) {
  if (look==='none' || !paths.length) return null;
  return <div className="message-files" data-look={look} aria-label="Files">
    {paths.map(path=><MessageFile key={path} look={look} product={product} path={path} revision={revision} open={openDoc===path} onOpen={()=>onOpen(path)}/>)}
  </div>;
}

function MessageFile({look,product,path,revision,open,onOpen}:{look:FileLook;product:string;path:string;revision:number;open:boolean;onOpen:()=>void}) {
  const glance=useGlance(product,path,revision);
  if (glance.state!=='ok') return null;
  const name=path.split('/').pop() ?? path;
  const kind=docKind(path);
  const picture=kind==='html' || kind==='image';
  const title=glance.title || name;
  const line=glance.line ?? null;
  if (look==='chips') return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    <FileIcon kind={kind}/><span className="message-file-name">{name}</span>
  </button>;
  if (look==='tiles') return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    <div className="message-file-face">{picture ? <ArtifactThumbnail product={product} path={path} revision={revision}/> : <><strong>{title}</strong>{line && <p>{line}</p>}</>}</div>
    <div className="message-file-foot"><FileIcon kind={kind}/><span className="message-file-name">{name}</span></div>
  </button>;
  return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    {picture ? <span className="message-file-thumb"><ArtifactThumbnail product={product} path={path} revision={revision}/></span> : <span className="message-file-icon"><FileIcon kind={kind}/></span>}
    <span className="message-file-text"><span className="message-file-title">{title}</span><span className="message-file-line">{title===name ? line ?? '' : line ? `${name} · ${line}` : name}</span></span>
    <OpenIcon/>
  </button>;
}

function FileIcon({kind}:{kind:ReturnType<typeof docKind>}) {
  return <svg className="message-file-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">{kind==='html'||kind==='image'
    ? <><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/></>
    : kind==='code' ? <path d="M6 5 3 8l3 3M10 5l3 3-3 3"/>
    : <><path d="M4 2h5l3 3v9H4z"/><path d="M6 8h4M6 10.5h4"/></>}</svg>;
}

function OpenIcon() {
  return <svg className="message-file-open" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4h6v6M12 4l-7 7"/></svg>;
}
