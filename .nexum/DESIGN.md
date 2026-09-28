# NEXUM Design Contract

NEXUM must treat design as executable product specification, not decoration.

## Design → Build
Before implementing a UI-heavy request, derive or update .nexum/design.json.
The DesignSpec defines tokens, responsive rules, accessibility, components, pages and interaction contracts.

## Interaction rule
Every visible control that implies an action must have a real behavior:
- button: click handler and observable result;
- form: validation + submit behavior;
- navigation: route/state transition;
- input: state update;
- modal/menu: open/close state;
- async action: loading/success/error state.

Do not generate inert buttons merely to satisfy visual composition.

## Live Preview
Preview is a runtime surface. Runtime exceptions, rejected promises and interaction events are sent to the NEXUM host.
When a runtime error is reported, Debugger recovery must inspect the current project and make the smallest verified fix.

## Visual QA
A build passing TypeScript is not sufficient for UI completion. Verify document structure, viewport, language, interactive controls, responsive behavior and accessibility contracts. Future visual verification may add screenshot/vision comparison.

## Domain fidelity
Visual language and copy must remain aligned with the user's requested product domain. Never replace a construction, automotive, delivery or other explicit domain with generic AI/SaaS content.

## Hot update
The host may request a Preview refresh through the nexum-host postMessage contract. Prefer targeted/live updates when available; use a controlled reload as a safe fallback.


## Executable state
- .nexum/state-spec.json is the persistent UI state contract.
- State covers form values, filters, route state, loading/success/error transitions and must be considered during implementation.
- Agents must not replace the project runtime state file .nexum/state.json; that file belongs to project execution/state tracking.


## Live preview
- Workspace preview subscribes to project-scoped Server-Sent Events for revision changes.
- CSS-only build changes are hot-swapped in the iframe when possible.
- JS/HTML/app-shell changes fall back to a controlled preview reload.
- Runtime errors and interaction telemetry are sent back to the host and remain project/user scoped.
