import { useRef, useState } from "react";
import type { AIProviderInfo, AIProviderStatus, AgentStage } from "./types";

interface Props {
 message:string; reply:string; stage:AgentStage; apiError:string;
 messages:Array<{id:string;role:"user"|"assistant";content:string;timestamp:number;attachments?:string[]}>;
 attachments:Array<{id:string;name:string;type:string;size:number;file:File}>;
 providers:AIProviderInfo[]; models:string[]; provider:string; model:string; aiStatus:AIProviderStatus|null;
 projectName:string; jobId:string|null;
 onMessageChange:(v:string)=>void; onSubmit:()=>void; onCancel:()=>void; onRetry:()=>void; onQuickTask:(v:string)=>void;
 onFilesSelected:(f:File[])=>void; onRemoveAttachment:(id:string)=>void; onOpenAgent:()=>void; onProviderChange:(id:string)=>void; onModelChange:(v:string)=>void;
}

export function BuilderChat(p:Props){
 const fileRef=useRef<HTMLInputElement>(null); const [modelOpen,setModelOpen]=useState(false);
 const busy=Boolean(p.stage&& !["completed","error"].includes(p.stage)); const selected=p.providers.find(x=>x.id===p.provider);
 const models=p.models.length?p.models:[p.model];
 const send=()=>{if(p.message.trim()&&!busy){setModelOpen(false);p.onSubmit();}};
 return <section className="nx-chat">
   <div className="nx-chat-head"><div><span>BUILD</span><strong>Describe what you want to build</strong></div><button type="button" onClick={p.onOpenAgent}>Agent {p.jobId?"• running":"→"}</button></div>
   <div className="nx-chat-scroll">
    {p.messages.length===0?<div className="nx-chat-empty"><div className="nx-chat-mark">N</div><h1>What are we building?</h1><p>Describe the website, app or product you want. NEXUM will plan it, build it and show the working result in Preview.</p><div className="nx-suggestions">{["Build a landing page","Create a SaaS dashboard","Make a mobile app"].map(x=><button key={x} type="button" onClick={()=>p.onMessageChange(x)}>{x}<span>↗</span></button>)}</div></div>:
    <div className="nx-messages">{p.messages.map(m=><article key={m.id} className={m.role==="user"?"user":""}><small>{m.role==="user"?"You":"NEXUM"} · {new Date(m.timestamp).toLocaleTimeString()}</small><div>{m.content}</div>{m.attachments?.length?<aside>{m.attachments.map(a=><span key={a}>{a}</span>)}</aside>:null}</article>)}</div>}
    {p.reply&&!p.messages.length&&<div className="nx-live-reply">{p.reply}</div>}
    {p.apiError&&<div className="nx-error">{p.apiError}<button type="button" onClick={p.onRetry}>Retry</button></div>}
   </div>
   <form className="nx-composer" onSubmit={e=>{e.preventDefault();send()}}>
    {p.attachments.length>0&&<div className="nx-attachments">{p.attachments.map(a=><span key={a.id}>{a.name}<button type="button" onClick={()=>p.onRemoveAttachment(a.id)}>×</button></span>)}</div>}
    <textarea value={p.message} disabled={busy} onChange={e=>p.onMessageChange(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Ask NEXUM to build or change something…" />
    <div className="nx-composer-row">
      <div className="nx-composer-left"><button type="button" onClick={()=>fileRef.current?.click()} disabled={busy}>＋ Attach</button><input ref={fileRef} hidden type="file" multiple onChange={e=>{if(e.target.files)p.onFilesSelected([...e.target.files]);e.currentTarget.value=""}}/>
      <div className="nx-model"><button type="button" disabled={busy} onClick={()=>setModelOpen(!modelOpen)}><b>{p.model}</b><small>{selected?.name??p.provider}</small><span>⌄</span></button>
      {modelOpen&&<div className="nx-model-pop"><strong>AI model</strong>{p.providers.map(x=><button type="button" key={x.id} className={x.id===p.provider?"selected":""} onClick={()=>p.onProviderChange(x.id)}>{x.name}</button>)}<hr/>{models.map(x=><button type="button" key={x} className={x===p.model?"selected":""} onClick={()=>{p.onModelChange(x);setModelOpen(false)}}>{x}{x===p.model?" ✓":""}</button>)}</div>}</div></div>
      <div className="nx-composer-right">{busy?<button type="button" className="nx-cancel" onClick={p.onCancel}>Stop</button>:<button className="nx-send" type="submit" disabled={!p.message.trim()}>↑</button>}</div>
    </div>
   </form>
   <footer><span>Enter to send · Shift+Enter for a new line</span><button type="button" onClick={()=>p.onQuickTask("Покажи статус Git")}>Git status</button></footer>
 </section>;
}