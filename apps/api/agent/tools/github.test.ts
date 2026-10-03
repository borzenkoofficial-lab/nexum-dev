import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { GitHubTool } from "./github.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function withToken<T>(token: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previousToken = process.env.GITHUB_TOKEN;
  if (token === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = token;

  return callback().finally(() => {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("returns a clear error when GITHUB_TOKEN is missing", async () => {
  const result = await withToken(undefined, () => new GitHubTool(projectRoot).execute("repository"));

  assert.equal(result.success, false);
  assert.equal(result.githubError, "GITHUB_TOKEN is not configured");
  assert.equal(result.error?.code, "TOOL_ERROR");
});

test("uses the origin repository and performs a read-only request", async () => {
  const result = await withToken("unit-test-token", async () => {
    const tool = new GitHubTool(projectRoot, 1000, async (input, init) => {
      assert.equal(String(input), "https://api.github.com/repos/borzenkoofficial-lab/nexum-dev");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer unit-test-token");
      assert.equal(init?.method, "GET");
      return jsonResponse(200, { id: 1, full_name: "borzenkoofficial-lab/nexum-dev" });
    });

    return tool.execute("repository");
  });

  assert.equal(result.success, true);
  assert.equal(result.operation, "repository");
  assert.deepEqual(result.data, { id: 1, full_name: "borzenkoofficial-lab/nexum-dev" });
});

test("maps GitHub HTTP errors without exposing credentials", async () => {
  for (const [status, expected] of [
    [401, "GitHub authentication failed (401)"],
    [403, "GitHub access forbidden or rate limit exceeded (403)"],
    [404, "GitHub repository or resource was not found (404)"],
    [429, "GitHub rate limit exceeded (429)"],
  ] as const) {
    const result = await withToken("unit-test-token", () =>
      new GitHubTool(projectRoot, 1000, async () => jsonResponse(status, {})).execute("repository"),
    );

    assert.equal(result.success, false);
    assert.equal(result.githubError, expected);
    assert.equal(result.error?.message, expected);
    assert.equal(result.output.includes("unit-test-token"), false);
  }
});

test("maps an aborted request to a timeout error", async () => {
  const result = await withToken("unit-test-token", () =>
    new GitHubTool(projectRoot, 5, async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    ).execute("repository"),
  );

  assert.equal(result.success, false);
  assert.equal(result.githubError, "GitHub request timed out");
  assert.equal(result.error?.code, "TIMEOUT");
});
