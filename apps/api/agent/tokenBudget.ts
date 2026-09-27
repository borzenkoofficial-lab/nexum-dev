export type AdaptiveRole = "planner" | "coder" | "reviewer" | "debugger" | "tester" | "finalizer" | "general";

export interface AdaptiveTokenBudgetOptions {
  legacyHardCap?: number;
}

export interface AdaptiveTokenBudgetSnapshot {
  tier: "micro" | "small" | "medium" | "large";
  hardCap: number;
  reserved: number;
  remaining: number;
  calls: number;
}

const LIMITS = {
  micro: { hardCap: 3_000, perCall: { planner: 0, coder: 1_200, reviewer: 0, debugger: 1_200, tester: 800, finalizer: 300, general: 700 } },
  small: { hardCap: 7_000, perCall: { planner: 900, coder: 2_500, reviewer: 700, debugger: 1_800, tester: 900, finalizer: 400, general: 900 } },
  medium: { hardCap: 14_000, perCall: { planner: 1_200, coder: 4_000, reviewer: 1_000, debugger: 2_500, tester: 1_000, finalizer: 600, general: 1_000 } },
  large: { hardCap: 18_000, perCall: { planner: 1_200, coder: 5_000, reviewer: 1_200, debugger: 3_000, tester: 1_200, finalizer: 700, general: 900 } },
} as const;

function classifyTask(task: string): keyof typeof LIMITS {
  const text = task.toLowerCase();
  const words = text.trim().split(/\s+/).length;
  if (/поменяй цвет|цвет кнопки|удали footer|remove footer|change color|rename|переименуй|опечатк|typo/.test(text) && words < 20) return "micro";
  if (/создай|разработай|build|create|сделай|приложени|website|web app|saas|dashboard|crm|marketplace|авторизац|authentication|личн.*кабинет/.test(text)) {
    return /crm|marketplace|saas|архитектур|полноцен|с нуля|from scratch|несколько страниц|backend|api|база данных/.test(text) ? "large" : "medium";
  }
  return words > 80 ? "medium" : "small";
}

export class AdaptiveTokenBudget {
  private reservedTokens = 0;
  private calls = 0;
  readonly tier: keyof typeof LIMITS;
  readonly hardCap: number;

  constructor(task: string, options: AdaptiveTokenBudgetOptions = {}) {
    this.tier = classifyTask(task);
    this.hardCap = Math.min(options.legacyHardCap ?? Number.MAX_SAFE_INTEGER, LIMITS[this.tier].hardCap);
  }

  reserve(role: AdaptiveRole, requested?: number): number {
    if (this.remaining <= 0) return 0;
    const roleCap = LIMITS[this.tier].perCall[role];
    if (roleCap <= 0) return 0;
    const desired = requested && requested > 0 ? Math.min(requested, roleCap) : roleCap;
    const grant = Math.min(desired, this.remaining);
    if (grant > 0) {
      this.reservedTokens += grant;
      this.calls += 1;
    }
    return grant;
  }

  get remaining(): number {
    return Math.max(0, this.hardCap - this.reservedTokens);
  }

  snapshot(): AdaptiveTokenBudgetSnapshot {
    return { tier: this.tier, hardCap: this.hardCap, reserved: this.reservedTokens, remaining: this.remaining, calls: this.calls };
  }
}

export function createAdaptiveTokenBudget(task: string, options?: AdaptiveTokenBudgetOptions): AdaptiveTokenBudget {
  return new AdaptiveTokenBudget(task, options);
}
