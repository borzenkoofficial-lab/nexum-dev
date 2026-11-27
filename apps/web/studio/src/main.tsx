import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/kvard-design-system.css";
import "../../src/kvard-ui-kit.css";
import "../../src/builder.css";
import "./studio.css";
import { AuthGate } from "../../src/auth/AuthGate";
import { AppErrorBoundary } from "../../src/components/AppErrorBoundary";
import { nexumRuntime } from "../../src/runtime/Runtime";
import { StudioApp } from "./StudioApp";

// Same theme preference as the Platform (stored per device).
try {
  document.documentElement.dataset.theme = localStorage.getItem("kvard:theme") === "dark" ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

// Studio shares the Platform session (same origin, /studio/), API and runtime.
void nexumRuntime.start().catch(() => undefined).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppErrorBoundary>
        <AuthGate>
          <StudioApp />
        </AuthGate>
      </AppErrorBoundary>
    </StrictMode>,
  );
});
