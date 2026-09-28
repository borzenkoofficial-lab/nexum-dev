import test from "node:test";
import assert from "node:assert/strict";
import { deriveDesignSpec } from "./designSpec.js";
import { componentContracts, validateComponentUsage } from "./componentIntelligence.js";

test("component intelligence enforces contracts",()=>{
 const spec={...deriveDesignSpec({features:["dashboard","modal"]})} as any;
 const contracts=componentContracts(spec);
 assert.ok(contracts.some(x=>x.name==="Table"));
 assert.ok(contracts.some(x=>x.name==="Modal"));
 assert.deepEqual(validateComponentUsage(spec,[{name:"Button",events:["click"],states:["loading"]}]),[]);
 assert.ok(validateComponentUsage(spec,[{name:"Input",events:["submit"]}]).length>0);
});
