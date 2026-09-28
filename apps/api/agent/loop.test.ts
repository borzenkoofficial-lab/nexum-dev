test("routes final test failures through bounded Debugger recovery", async () => {
  let testAttempts = 0;
  let debuggerFixes = 0;
  const runtime: AgentRuntime = {
    getAvailableTools: () => ["listFiles", "writeFile", "testProject"],
    plan: () => ({ tool: "", input: "", done: true, finalResponse: "fallback" }),
    planWithAI: async (_task, previousResults, options) => {
      const hasWrites = previousResults.filter((item) => item.tool === "writeFile" && item.result.success).length;
      const testFailed = previousResults.some((item) => item.tool === "testProject" && !item.result.success);
      if (testFailed && debuggerFixes === 0) {
        debuggerFixes += 1;
        assert.equal(options?.role, "debugger");
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: "src/App.tsx",
            content: "Строительная компания. Демонтаж фасадов. Исправление.",
          }),
        };
      }
      if (testAttempts === 0 && hasWrites >= 2) {
        return { tool: "testProject", input: "." };
      }
      if (hasWrites < 2) {
        return {
          tool: "writeFile",
          input: JSON.stringify({
            path: hasWrites === 0 ? "src/App.tsx" : "src/App.css",
            content: hasWrites === 0
              ? "Строительная компания. Демонтаж фасадов."
              : ".construction-site { display: block; }",
          }),
        };
      }
      return { tool: "", input: "", done: true, finalResponse: "Готово" };
    },
    executeTool: async (tool) => {
      if (tool === "listFiles") return { success: true, output: "src/App.tsx
src/App.css" };
      if (tool === "writeFile") return { success: true, output: "written" };
      testAttempts += 1;
      return testAttempts === 1
        ? { success: false, output: "TypeScript error: src/App.tsx:42" }
        : { success: true, output: "tests passed" };
    },
  };

  const result = await new AgentLoop(runtime, gateway, 10).run(
    "Создай сайт строительной компании по демонтажу фасадов",
  );

  assert.equal(result.success, true);
  assert.equal(debuggerFixes, 1);
  assert.equal(testAttempts, 2);
});