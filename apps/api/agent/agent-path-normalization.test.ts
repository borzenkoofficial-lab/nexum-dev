import assert from "node:assert/strict";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import { MockProvider } from "../ai/providers/mock.js";
import { NexumAgent } from "./agent.js";

test("Builder planner treats ./entry paths as already inspected", () => {
  const agent = new NexumAgent(new AIGateway([new MockProvider()]));
  const previousResults = [
    { iteration: 1, tool: "listFiles", input: ".", result: { success: true, output: "src/App.jsx\nsrc/styles.css\npackage.json" } },
    { iteration: 2, tool: "scaffoldProject", input: "autocenter", result: { success: true, output: "React/Vite scaffold created" } },
    { iteration: 3, tool: "readFile", input: "./src/App.jsx", result: { success: true, output: "export default function App() {}" } },
    { iteration: 4, tool: "writeFile", input: JSON.stringify({ path: "src/App.jsx", content: "export default function App() {}" }), result: { success: true, output: "written" } },
    { iteration: 5, tool: "writeFile", input: JSON.stringify({ path: "src/styles.css", content: "body {}" }), result: { success: true, output: "written" } },
    { iteration: 6, tool: "runCommand", input: "npm run build", result: { success: true, output: "build passed" } },
    { iteration: 7, tool: "testProject", input: ".", result: { success: true, output: "tests passed" } },
    { iteration: 8, tool: "readFile", input: "./src/styles.css", result: { success: true, output: "body {}" } },
  ];
  assert.equal(agent.plan("Создай сайт автосервиса с диагностикой и ремонтом автомобилей", previousResults), null);
});
