import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("Vercel Services exposes only the confirmed web and api services", () => {
  assert.deepEqual(Object.keys(config.services).sort(), ["api", "web"]);
  assert.deepEqual(config.services.api, {
    root: "apps/api",
    framework: "express",
  });
  assert.equal(config.services.web.root, "apps/web");
  assert.equal(config.services.web.framework, "vite");
});

test("Vercel public rewrites send API requests to api before the web catch-all", () => {
  assert.deepEqual(config.rewrites, [
    { source: "/api/(.*)", destination: { service: "api" } },
    { source: "/(.*)", destination: { service: "web" } },
  ]);
});

test("Vite deep links fall back to the web service index document", () => {
  assert.deepEqual(config.services.web.rewrites, [
    { source: "/(.*)", destination: "/index.html" },
  ]);
});

test("root Docker container is not registered as a Vercel service", () => {
  assert.equal(Object.values(config.services).some((service) => service.root === "." || service.runtime === "container"), false);
});
