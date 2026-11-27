import assert from "node:assert/strict";
import { test } from "node:test";
import { metrics, renderMetrics, routeGroup, statusClass } from "./metrics.js";

test("route groups never carry user-controlled ids", () => {
  assert.equal(routeGroup("/api/projects/my-secret-project/file"), "/api/projects/:id/file");
  assert.equal(routeGroup("/api/chat/jobs/7c1c3f1e-1111-4222-8333-444455556666/events"), "/api/chat/jobs/:id");
  assert.equal(routeGroup("/api/auth/login"), "/api/auth/login");
  assert.equal(routeGroup("/projects/anything"), "web");
  assert.equal(routeGroup("/api/whatever-user-typed"), "/api/:id");
  assert.equal(statusClass(404), "4xx");
});

test("metrics render in Prometheus text format with escaped labels", () => {
  metrics.httpRequests.inc({ method: "GET", route: "/api/health", status: "2xx" });
  metrics.httpDuration.observe(0.03, { route: "/api/health" });
  metrics.aiGenerations.inc({ provider: 'we"ird\\', outcome: "error" });
  const text = renderMetrics(["kvard_database_up 1"]);
  assert.match(text, /# TYPE kvard_http_requests_total counter/);
  assert.match(text, /kvard_http_requests_total\{method="GET",route="\/api\/health",status="2xx"\} \d+/);
  assert.match(text, /kvard_http_request_duration_seconds_bucket\{route="\/api\/health",le="0\.05"\} \d+/);
  assert.match(text, /kvard_http_request_duration_seconds_bucket\{route="\/api\/health",le="\+Inf"\} \d+/);
  assert.match(text, /kvard_ai_generations_total\{outcome="error",provider="we\\"ird\\\\"\} 1/);
  assert.ok(text.endsWith("kvard_database_up 1\n"));
});
