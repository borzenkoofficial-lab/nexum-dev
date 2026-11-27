/**
 * In-process metrics in the Prometheus text exposition format (no dependency).
 * Label values are bounded on purpose (route groups, outcome enums, provider
 * ids) so cardinality cannot grow with user input. Never put user ids, emails,
 * paths with ids or secrets into labels.
 */
type Labels = Record<string, string>;

function key(labels: Labels): string {
  return Object.keys(labels).sort().map((name) => `${name}="${labels[name]!.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`).join(",");
}

class Counter {
  private readonly values = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  inc(labels: Labels = {}, by = 1): void {
    const id = key(labels);
    this.values.set(id, (this.values.get(id) ?? 0) + by);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [labels, value] of this.values) lines.push(`${this.name}${labels ? `{${labels}}` : ""} ${value}`);
    return lines.join("\n");
  }
}

class Histogram {
  private readonly series = new Map<string, { buckets: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly bounds: number[]) {}
  observe(value: number, labels: Labels = {}): void {
    const id = key(labels);
    const entry = this.series.get(id) ?? { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
    this.bounds.forEach((bound, index) => { if (value <= bound) entry.buckets[index]! += 1; });
    entry.sum += value;
    entry.count += 1;
    this.series.set(id, entry);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [labels, entry] of this.series) {
      const prefix = labels ? `${labels},` : "";
      this.bounds.forEach((bound, index) => lines.push(`${this.name}_bucket{${prefix}le="${bound}"} ${entry.buckets[index]}`));
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${entry.count}`);
      lines.push(`${this.name}_sum${labels ? `{${labels}}` : ""} ${Number(entry.sum.toFixed(6))}`);
      lines.push(`${this.name}_count${labels ? `{${labels}}` : ""} ${entry.count}`);
    }
    return lines.join("\n");
  }
}

export const metrics = {
  httpRequests: new Counter("kvard_http_requests_total", "HTTP requests by method, route group and status class."),
  httpDuration: new Histogram("kvard_http_request_duration_seconds", "HTTP request duration by route group.", [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]),
  chatJobs: new Counter("kvard_chat_jobs_total", "Finished Builder jobs by outcome."),
  chatJobDuration: new Histogram("kvard_chat_job_duration_seconds", "Builder job duration from start to terminal state.", [5, 15, 30, 60, 120, 300, 600, 1200]),
  aiGenerations: new Counter("kvard_ai_generations_total", "AI model calls by provider and outcome."),
  sandboxFailures: new Counter("kvard_sandbox_failures_total", "Sandbox provisioning/command infrastructure failures by provider."),
  orphanSandboxes: new Counter("kvard_orphan_sandboxes_total", "Orphaned remote sandboxes handled by the reaper, by result."),
  billingRejections: new Counter("kvard_billing_rejections_total", "Builder jobs refused by plan limits, by code."),
};

/** Groups a request path so labels stay bounded: /api/projects/abc/file -> /api/projects/:id/file. */
export function routeGroup(path: string): string {
  if (!path.startsWith("/api/")) return "web";
  const parts = path.split("/").filter(Boolean).slice(0, 4);
  const known = new Set(["api", "auth", "projects", "chat", "jobs", "ai", "admin", "billing", "preview", "agents", "agent", "business-agents", "organizations", "knowledge", "workforces", "approvals", "runtime", "health", "ready", "build-info", "metrics", "diagnostics", "test", "file", "files", "git", "run", "checkpoints", "diff", "events", "cancel", "state", "select", "archive", "duplicate", "register", "login", "logout", "admin-mfa", "builder", "stream", "models", "providers", "status", "connect-key", "key-status", "local-test", "recent", "history", "profiles"]);
  return "/" + parts.map((part) => (known.has(part) ? part : ":id")).join("/");
}

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

export function renderMetrics(extra: string[] = []): string {
  return [...Object.values(metrics).map((metric) => metric.render()), ...extra].join("\n") + "\n";
}
