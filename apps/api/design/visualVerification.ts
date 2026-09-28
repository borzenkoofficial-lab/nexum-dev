import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readDesignSpec } from "./designSpec.js";

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
    checks.push({name:"button-accessibility",passed:!/<button\b(?![^>]*aria-label)[^>]*>\s*<svg[^>]*>\s*<\/button>/i.test(html),message:"Icon-only buttons have accessible names"});
    checks.push({name:"form-actions",passed:!/<form\b[^>]*>/.test(html)||/<form\b[^>]*(action=|data-nexum-action)/i.test(html)||/<button\b[^>]*type=["']submit["']/i.test(html),message:"Forms expose an executable submit path"});
    checks.push({name:"styles",passed:/<link[^>]+stylesheet|<style\b|\.css(["'])/i.test(html),message:"Visual styling is present"});
    checks.push({name:"design-hooks",passed:/data-nexum-(id|action)=/i.test(html)||/<button\b|<form\b/i.test(html),message:"Runtime design/interaction hooks are available"});
    try {
      const spec=await readDesignSpec(projectRoot);
      checks.push({name:"design-spec",passed:spec.version===1&&spec.components.length>0&&spec.tokens.colors.background.length>0,message:"NEXUM DesignSpec is present"});
      checks.push({name:"interaction-contract",passed:spec.interactions.length>0,message:"Interaction Contract contains executable intents"});
      const domain = String(spec.domain ?? "").toLowerCase();
      const domainSignals:Record<string,RegExp> = {
        construction:/строит|строитель|демонтаж|фасад|подряд|объект|бетон|стяжк|монтаж|кровл|construction|contractor/i,
        automotive:/авто|автомобил|автосервис|диагностик|шиномонтаж|кузов|двигател|тормоз|масл|automotive|auto repair/i,
        delivery:/доставк|курьер|логист|перевоз|delivery|courier|logistics/i,
        restaurant:/ресторан|кафе|меню|блюд|заказ стол|restaurant|menu|reservation/i,
        ecommerce:/магазин|каталог|товар|корзин|оплат|ecommerce|shop|store|catalog/i,
      };
      const requiredSignal=Object.entries(domainSignals).find(([key])=>domain.includes(key))?.[1];
      if(requiredSignal){
        checks.push({
          name:"domain-fidelity",
          passed:requiredSignal.test(html),
          message:"Generated UI contains domain-specific content matching the requested product",
        });
      }
    } catch {
      checks.push({name:"design-spec",passed:false,message:"NEXUM DesignSpec unavailable"});
    }
  } catch {
    checks.push({name:"document",passed:false,message:"index.html unavailable"});
  }
  const passed=checks.filter(x=>x.passed).length;
  return {passed:passed===checks.length&&checks.length>0,checks,score:checks.length?Math.round((passed/checks.length)*100):0};
}
