
import type { RuntimeSnapshot } from "./types.ts";\nimport { failureInjection } from "./FailureInjection.ts";
const KEY="nexum:runtime:snapshot:v1";
export class RuntimePersistence{save(s:RuntimeSnapshot){try{localStorage.setItem(KEY,JSON.stringify(s))}catch{}}load():RuntimeSnapshot|null{try{if(failureInjection.isEnabled("FAIL_STATE_RESTORE")) return null;const p=JSON.parse(localStorage.getItem(KEY)||"null");if(p?.version!==1||typeof p.savedAt!=="number"||!Array.isArray(p.activeTaskIds))return null;return p}catch{return null}}clear(){try{localStorage.removeItem(KEY)}catch{}}}
