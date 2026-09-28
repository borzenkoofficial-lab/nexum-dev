import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export type DesignTokens = {
  colors: { background:string; surface:string; text:string; muted:string; primary:string; accent:string; border:string; danger:string; success:string };
  typography: { fontFamily:string; headingWeight:number; bodyWeight:number; baseSize:number; scale:number };
  spacing: { unit:number; section:number; container:number };
  radius: { sm:number; md:number; lg:number; pill:number };
  motion: { enabled:boolean; duration:number };
  breakpoints: { mobile:number; tablet:number; desktop:number };
};

export type DesignSpec = {
  version: 1;
  productType: string;
  visualDirection: string;
  audience: string;
  tokens: DesignTokens;
  components: string[];
  pages: Array<{ id:string; name:string; purpose:string; route:string }>;
  responsive: { strategy:"mobile-first"|"desktop-first"; required:boolean };
  accessibility: { keyboard:boolean; focusVisible:boolean; contrast:boolean; reducedMotion:boolean };
  interactions: Array<{ id:string; component:string; event:"click"|"submit"|"change"|"navigate"; action:string; target?:string }>;
  updatedAt: string;
};

const defaults = (): DesignSpec => ({
  version:1,
  productType:"generic",
  visualDirection:"clean, product-grade, responsive",
  audience:"end users",
  tokens:{
    colors:{background:"#ffffff",surface:"#f7f7f8",text:"#171717",muted:"#6b7280",primary:"#111111",accent:"#f5b800",border:"#e5e7eb",danger:"#dc2626",success:"#16a34a"},
    typography:{fontFamily:"Inter, system-ui, sans-serif",headingWeight:700,bodyWeight:400,baseSize:16,scale:1.25},
    spacing:{unit:4,section:80,container:1200},
    radius:{sm:8,md:14,lg:22,pill:999},
    motion:{enabled:true,duration:180},
    breakpoints:{mobile:640,tablet:768,desktop:1024}
  },
  components:["Button","Input","Form","Card","Modal","Navigation"],
  pages:[{id:"home",name:"Home",purpose:"Primary user flow",route:"/"}],
  responsive:{strategy:"mobile-first",required:true},
  accessibility:{keyboard:true,focusVisible:true,contrast:true,reducedMotion:true},
  interactions:[],
  updatedAt:new Date().toISOString()
});

export async function readDesignSpec(projectRoot:string):Promise<DesignSpec>{
  const file=resolve(projectRoot,".nexum","design.json");
  try {
    const raw=JSON.parse(await readFile(file,"utf8")) as Partial<DesignSpec>;
    return { ...defaults(), ...raw, tokens:{...defaults().tokens,...raw.tokens}, updatedAt:raw.updatedAt ?? new Date().toISOString() };
  } catch { return defaults(); }
}
export async function writeDesignSpec(projectRoot:string, patch:Partial<DesignSpec>):Promise<DesignSpec>{
  const current=await readDesignSpec(projectRoot);
  const next:DesignSpec={...current,...patch,tokens:{...current.tokens,...(patch.tokens??{})},updatedAt:new Date().toISOString()};
  await mkdir(resolve(projectRoot,".nexum"),{recursive:true});
  await writeFile(resolve(projectRoot,".nexum","design.json"),JSON.stringify(next,null,2),"utf8");
  return next;
}

export function deriveDesignSpec(input:{domain?:string;productType?:string;visualDirection?:string;audience?:string;features?:string[]}):Partial<DesignSpec>{
  const domain=input.domain ?? "generic";
  const productType=input.productType ?? domain;
  const visualDirection=input.visualDirection ?? "clean, trustworthy, responsive, production-grade";
  const components=["Button","Input","Form","Card","Navigation"];
  if ((input.features??[]).some(x=>/modal|dialog/i.test(x))) components.push("Modal");
  if ((input.features??[]).some(x=>/table|dashboard/i.test(x))) components.push("Table");
  return {productType,visualDirection,audience:input.audience??"end users",components,interactions:[]};
}
