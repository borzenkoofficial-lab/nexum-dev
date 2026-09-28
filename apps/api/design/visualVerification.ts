import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type VisualVerification = {
  passed:boolean;
  checks:Array<{name:string;passed:boolean;message:string}>;
  score:number;
};

export async function verifyDesign(projectRoot:string):Promise<VisualVerification>{
  const checks:VisualVerification["checks"]=[];
  const index=resolve(projectRoot,"index.html");
  try {
    const html=await readFile(index,"utf8");
    checks.push({name:"document",passed:/<!doctype html>/i.test(html)&&/<body[\s>]/i.test(html),message:"HTML document structure"});
    checks.push({name:"viewport",passed:/name=["']viewport["']/i.test(html),message:"Responsive viewport"});
    checks.push({name:"lang",passed:/<html[^>]+lang=/i.test(html),message:"Document language"});
    checks.push({name:"interactive-controls",passed:/<(button|a|input|form)\b/i.test(html),message:"Interactive controls exist"});
  } catch {
    checks.push({name:"document",passed:false,message:"index.html unavailable"});
  }
  const passed=checks.filter(x=>x.passed).length;
  return {passed:passed===checks.length&&checks.length>0,checks,score:checks.length?Math.round((passed/checks.length)*100):0};
}
