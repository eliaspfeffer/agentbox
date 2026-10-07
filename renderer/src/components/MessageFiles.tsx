import {useEffect,useState} from 'react';
import {api} from '../api';
import {docKind} from '../doc-pane';
import {fileGlance,type Glance} from '../file-glance';
import {ArtifactThumbnail} from './ArtifactThumbnail';
import './message-files.css';

export type TileLook='page'|'card'|'frame'|'strip';

type Read={state:'reading'|'missing'|'ok'}&Partial<Glance>;

/** Read a file once to learn whether it opens at all and what it calls
 * itself. A file nothing can read gets no tile: the message still names it. */
function useGlance(product:string,path:string,revision:number):Read {
  const [read,setRead]=useState<Read>({state:'reading'});
  useEffect(()=>{
    let live=true;
    setRead({state:'reading'});
    const kind=docKind(path);
    const done=(r:Read)=>{if(live)setRead(r);};
    if (kind==='markdown' || kind==='html') api.readDoc({product,src:path}).then(r=>r.ok?done({state:'ok',...fileGlance(r.text??'',kind)}):done({state:'missing'})).catch(()=>done({state:'missing'}));
    else if (kind==='code') api.codeChange({product,src:path}).then(r=>done({state:r.ok&&r.change?'ok':'missing',title:'Code changes'})).catch(()=>done({state:'missing'}));
    else api.resolveDoc({product,src:path}).then(r=>done({state:r.ok?'ok':'missing'})).catch(()=>done({state:'missing'}));
    return ()=>{live=false;};
  },[product,path,revision]);
  return read;
}

const KIND_LABEL={html:'Design',image:'Picture',markdown:'Document',code:'Code'} as const;

/** Every file a message names, as small tiles side by side. */
export function MessageFiles({look,product,paths,revision,openDoc,onOpen}:{look:TileLook;product:string;paths:string[];revision:number;openDoc?:string|null;onOpen:(path:string)=>void}) {
  if (!paths.length) return null;
  const ticks=typeof localStorage!=='undefined' ? localStorage.getItem('zero.frameTicks') ?? undefined : undefined;
  return <div className="message-files" data-look={look} data-ticks={ticks} aria-label="Files">
    {paths.map(path=><MessageFile key={path} look={look} product={product} path={path} revision={revision} open={openDoc===path} onOpen={()=>onOpen(path)}/>)}
  </div>;
}

function MessageFile({look,product,path,revision,open,onOpen}:{look:TileLook;product:string;path:string;revision:number;open:boolean;onOpen:()=>void}) {
  const read=useGlance(product,path,revision);
  if (read.state!=='ok') return null;
  const name=path.split('/').pop() ?? path;
  const kind=docKind(path);
  const label=kind ? KIND_LABEL[kind] : 'File';
  const picture=kind==='html' || kind==='image';
  const title=read.title || name;
  const face=picture
    ? <ArtifactThumbnail product={product} path={path} revision={revision}/>
    : <MiniPage title={title} blocks={read.blocks ?? []}/>;
  const tag=<span className="message-file-kind">{label}</span>;
  if (look==='card') return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    {tag}<strong className="message-file-title">{title}</strong>{read.line ? <span className="message-file-line">{read.line}</span> : null}<span className="message-file-name">{name}</span>
  </button>;
  if (look==='strip') return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    <span className="message-file-face">{face}</span>
    <span className="message-file-text">{tag}<strong className="message-file-title">{title}</strong><span className="message-file-name">{name}</span></span>
  </button>;
  if (look==='frame') return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    <span className="message-file-face">{face}<i className="tick tl"/><i className="tick tr"/><i className="tick bl"/><i className="tick br"/></span>
    <span className="message-file-foot"><span className="message-file-name">{name}</span>{tag}</span>
  </button>;
  return <button type="button" className="message-file" aria-pressed={open} title={`Open ${name}`} onClick={onOpen}>
    <span className="message-file-face">{face}</span>
    <span className="message-file-foot"><span className="message-file-name">{name}</span>{tag}</span>
  </button>;
}

/** A document drawn as a small page: its title and opening lines, set as
 * text, so it reads like the page it opens into rather than its source. */
function MiniPage({title,blocks}:{title:string;blocks:Glance['blocks']}) {
  return <span className="message-file-page" aria-hidden="true">
    <b>{title}</b>
    {blocks.map((b,i)=>b.heading ? <em key={i}>{b.text}</em> : <span key={i}>{b.text}</span>)}
  </span>;
}
