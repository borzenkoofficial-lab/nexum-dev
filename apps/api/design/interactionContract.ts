export type InteractionEvent = {
  projectId:string;
  type:"click"|"submit"|"change"|"navigate"|"input"|"focus";
  target:string;
  action?:string;
  value?:string;
  timestamp:number;
};

export function interactionScript(projectId:string):string {
  return `(()=> {
    const projectId=${JSON.stringify(projectId)};
    const send=(payload)=>{try{parent.postMessage({source:"nexum-preview",projectId,...payload},"*")}catch{}};
    const describe=(el)=>{
      if(!(el instanceof Element)) return "unknown";
      return el.getAttribute("data-nexum-id") || el.id || el.getAttribute("name") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0,80) || el.tagName.toLowerCase();
    };
    document.addEventListener("click",e=>{const el=e.target?.closest?.("[data-nexum-action],button,a,[role=button]");if(!el)return;send({kind:"interaction",eventType:"click",target:describe(el),action:el.getAttribute("data-nexum-action")||undefined})},true);
    document.addEventListener("submit",e=>{const el=e.target;send({kind:"interaction",eventType:"submit",target:describe(el),action:el.getAttribute("data-nexum-action")||undefined})},true);
    document.addEventListener("change",e=>{const el=e.target;if(!(el instanceof Element))return;send({kind:"interaction",eventType:"change",target:describe(el)})},true);
    window.addEventListener("popstate",()=>send({kind:"interaction",eventType:"navigate",target:location.pathname}));
    window.addEventListener("hashchange",()=>send({kind:"interaction",eventType:"navigate",target:location.hash}));
    send({kind:"preview-ready",eventType:"ready",target:location.pathname});
    window.addEventListener("message",e=>{if(e.data?.source!=="nexum-host"||e.data.projectId!==projectId)return;if(e.data.type==="refresh"){location.reload();}if(e.data.type==="navigate"&&typeof e.data.url==="string"){location.href=e.data.url;}});
  })();`;
}
