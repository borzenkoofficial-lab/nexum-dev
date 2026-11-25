import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AIGateway } from "../ai/gateway.js";
import { NexumAgent, formatConfiguredAgentInstructions } from "./agent.js";

test("configured agents expose only allowlisted tools and reject direct calls outside the allowlist", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "kvard-agent-policy-"));
  try {
    const agent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      { allowedTools: ["readFile"], systemPrompt: "Работай как аналитик." },
    );
    assert.deepEqual(agent.getAvailableTools(), ["readFile"]);
    const result = await agent.executeTool("writeFile", JSON.stringify({ path: "must-not-exist.txt", content: "blocked" }));
    assert.equal(result.success, false);
    assert.match(result.output, /не разрешён|not allowed/i);
    await assert.rejects(() => readFile(join(projectRoot, "must-not-exist.txt"), "utf8"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("configured instructions are clearly lower priority than platform safety", () => {
  const block = formatConfiguredAgentInstructions("Работай как аналитик.");
  assert.match(block, /lower priority than platform safety/);
  assert.match(block, /Работай как аналитик/);
  assert.equal(formatConfiguredAgentInstructions("   "), "");
});


test("writes policy blocks a write until the approval callback approves it", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "kvard-agent-approval-deny-"));
  let approvalCalls = 0;
  try {
    const agent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      {
        allowedTools: ["writeFile"],
        approvalPolicy: "writes",
        requestApproval: async (request) => {
          approvalCalls += 1;
          assert.equal(request.toolName, "writeFile");
          assert.equal(request.risk, "WRITE");
          return "rejected";
        },
      },
    );
    const result = await agent.executeTool("writeFile", JSON.stringify({ path: "blocked.txt", content: "must not be written" }));
    assert.equal(approvalCalls, 1);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "APPROVAL_REJECTED");
    await assert.rejects(() => readFile(join(projectRoot, "blocked.txt"), "utf8"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("writes policy executes the same tool after explicit approval", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "kvard-agent-approval-allow-"));
  let approvalCalls = 0;
  try {
    const agent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      {
        allowedTools: ["writeFile"],
        approvalPolicy: "writes",
        requestApproval: async () => { approvalCalls += 1; return "approved"; },
      },
    );
    const result = await agent.executeTool("writeFile", JSON.stringify({ path: "approved.txt", content: "approved content" }));
    assert.equal(approvalCalls, 1);
    assert.equal(result.success, true);
    assert.equal(await readFile(join(projectRoot, "approved.txt"), "utf8"), "approved content");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("writes policy does not gate READ tools, while always policy does", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "kvard-agent-approval-read-"));
  try {
    await writeFile(join(projectRoot, "notes.txt"), "readable");
    let writesPolicyCalls = 0;
    const writesAgent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      { allowedTools: ["readFile"], approvalPolicy: "writes", requestApproval: async () => { writesPolicyCalls += 1; return "approved"; } },
    );
    const readResult = await writesAgent.executeTool("readFile", JSON.stringify({ path: "notes.txt" }));
    assert.equal(readResult.success, true);
    assert.equal(writesPolicyCalls, 0);

    let alwaysPolicyCalls = 0;
    const alwaysAgent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      { allowedTools: ["readFile"], approvalPolicy: "always", requestApproval: async () => { alwaysPolicyCalls += 1; return "approved"; } },
    );
    const alwaysRead = await alwaysAgent.executeTool("readFile", JSON.stringify({ path: "notes.txt" }));
    assert.equal(alwaysRead.success, true);
    assert.equal(alwaysPolicyCalls, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});


test("autonomous policy blocks a non-READ tool even if it is accidentally allowlisted", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "kvard-agent-autonomous-guard-"));
  let approvalCalls = 0;
  try {
    const agent = new NexumAgent(
      {} as AIGateway,
      projectRoot,
      undefined,
      {},
      {
        allowedTools: ["writeFile"],
        approvalPolicy: "autonomous",
        requestApproval: async () => { approvalCalls += 1; return "approved"; },
      },
    );
    const result = await agent.executeTool("writeFile", JSON.stringify({ path: "must-not-exist.txt", content: "blocked" }));
    assert.equal(result.success, false);
    assert.equal(result.error?.code, "AUTONOMOUS_READ_ONLY");
    assert.equal(approvalCalls, 0);
    await assert.rejects(() => readFile(join(projectRoot, "must-not-exist.txt"), "utf8"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
