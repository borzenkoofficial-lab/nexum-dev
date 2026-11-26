# КВАРД UI Kit Implementation Plan

> **Execution:** Directly in `main`, as required by the product owner. No feature branches, worktrees, PRs or branch cleanup.

**Goal:** Establish a small, reusable UI Kit that removes the current divergence between user-facing buttons, form fields and status indicators without redesigning every screen at once.

**Architecture:** Build framework-native React primitives under `apps/web/src/components/ui/`, backed by the existing semantic design tokens in `kvard-design-system.css`. Keep native HTML semantics and native form controls. Add focused Node 22 tests using `node:test`; do not add dependencies or a Storybook stack.

**Design basis:** Balanced. Neutral surfaces, restrained purple action color, predictable control geometry, visible focus, clear disabled/loading/error states, full light/dark token support.

## Current Findings

- The application already has semantic light/dark tokens and global focus/transition rules.
- There is no shared user-facing component library for controls.
- `AgentsPage` and `BusinessAgentsPage` contain many repeated primary/secondary buttons and form controls with local class names.
- `BusinessAgentsPage.css` owns its own button and status styles, including local fallbacks; `AgentsPage` uses another set of button/status selectors.
- A full CSS rewrite would create unnecessary risk. This plan introduces primitives first and migrates only selected high-frequency patterns.

## Scope — first UI Kit increment

### Components

1. `KvardButton`
   - Variants: `primary`, `secondary`, `ghost`, `danger`.
   - Sizes: `sm`, `md`, `lg`.
   - States: default, hover, focus-visible, active, disabled, loading.
   - Native button type, disabled semantics, `aria-busy` for loading.
   - Icon-only use requires a meaningful accessible name.
   - Does not invent progress or success; loading is driven by caller state.

2. `KvardField`
   - Label + `htmlFor`, optional hint, error and required indicator.
   - Renders a wrapper around a native input/select/textarea child.
   - Error is linked to the child control with `aria-describedby` only when the child ID is available and the component can safely compose the attributes.
   - Does not own or transform form values.

3. `KvardStatusBadge`
   - Tones: `neutral`, `success`, `warning`, `danger`, `info`.
   - Visible text is mandatory; color alone never communicates status.
   - No live-region role by default; dynamic announcements remain the owning screen's responsibility.

### First integrations

- Migrate the primary/secondary/create buttons in `AgentsPage` and `BusinessAgentsPage` where the semantics match exactly.
- Migrate the status badges in those two pages only where status meaning and tone mapping are explicit.
- Leave specialized icon buttons, approval controls, destructive confirmations and modal layouts untouched until their behavior is reviewed.
- Keep existing domain classes for layout only; remove local visual rules only when the shared primitive fully owns the same concern.

## Global Constraints

- Never edit administrative UI, routes, APIs, MFA, roles or permissions.
- Do not change business logic, event handlers, API payloads, state machines or form submission behavior.
- Do not replace native form controls with custom widgets.
- Do not add a component gallery route, Storybook, new dependencies or fake showcase data in this increment.
- Use existing tokens; do not introduce new hex values in component CSS.
- Recheck current HEAD and every target file SHA before writes. Stop on concurrent edits to a target file.
- Every commit must contain only intended UI Kit files or user-facing integrations.

## TDD and Verification

### Task 1 — shared primitives and tests

- [x] Add failing tests for button variants, native type, disabled/loading semantics and accessible icon-only naming.
- [x] Add tests for field label/hint/error structure and required state.
- [x] Add tests for status badge tones and mandatory visible label.
- [x] Implement the three primitives using native HTML elements.
- [x] Add semantic token-based CSS for all variants and states.
- [x] Run focused tests, Web typecheck and lint.

### Task 2 — integrate in user-facing screens

- [x] Migrate primary/secondary/create buttons in AgentsPage.
- [x] Migrate primary/secondary/create buttons in BusinessAgentsPage.
- [x] Migrate explicit status badges in both pages.
- [x] Remove only the local CSS rules now owned by the shared primitives.
- [x] Confirm handlers, form behavior, loading and disabled states are unchanged.

### Task 3 — verify and record

- [ ] Run brand/UI Kit tests and existing Web runtime tests.
- [x] Run Web typecheck, lint and build.
- [ ] Inspect light/dark, keyboard focus, 320/390/768/1280/1440 widths in a real browser.
- [x] Review commit file lists; confirm no admin paths changed.
- [x] Record verification scope separately: build job passed; E2E is still running, so no E2E pass is claimed.

## Definition of Done

- The shared components are used in both target pages.
- All variants/states have accessible native semantics.
- Existing form and button behavior is preserved.
- No local hardcoded colors were introduced.
- Focused tests, Web typecheck, lint and build pass.
- Browser visual QA is explicitly marked complete only with real screenshots.
- No administrative files or routes changed.

## Execution Notes

- Implemented in `main` through commits `615b711`, `21b3770`, `5eefcf8`, `46e8930`, `ad894be`, `8788fbd`, `aecb0fd`, `045e126`, `f8311dd`.
- CI run `45707760275` build job passed brand tests, UI Kit tests, API typecheck/tests, Web runtime tests, Web typecheck/build/lint, production Docker build and production-container smoke test. E2E is still running.
- Browser visual QA remains open; no screenshot-based approval is claimed.

- Current `main` HEAD at plan creation: `8cc3cd17cda82dad23f205077ad2b10a4b52b1ed`.
- Existing token source: `apps/web/src/kvard-design-system.css`.
- Initial migration targets: `AgentsPage.tsx`, `BusinessAgentsPage.tsx` and their existing styles.
- This is the first UI Kit increment, not a mandate to replace every button or input across the product.


## Task 4 — shared accessible tabs

- [x] Add KvardTabs test cases for tablist semantics, tab/panel link IDs, selected/roving tabindex state, disabled items and accessible badge naming.
- [x] Add keyboard-navigation coverage for ArrowRight wrapping and skipping disabled items.
- [x] Implement the controlled KvardTabs primitive with click and ArrowLeft/ArrowRight/Home/End navigation.
- [x] Export the primitive and its prop/item types from the shared UI barrel.
- [x] Add semantic-token styling, visible focus states and mobile horizontal overflow.
- [x] Replace the five local Business Agents tabs with the shared primitive.
- [x] Connect each active panel using role=tabpanel, aria-labelledby, stable IDs and keyboard focusability.
- [x] Remove superseded .kv-business-tabs rules from the page stylesheet.
- [ ] Run focused UI Kit tests, Web typecheck, lint and build on the final commit.
- [ ] Inspect keyboard interaction and panel behavior in a real browser; no visual/browser QA is claimed yet.

### Task 4 implementation commits

- Tests first: 3f7ac5a (workflow was cancelled before its test job executed).
- Component: 7b1ab0f.
- Shared export: 854c2b9.
- Shared token-based styling: 9db2032.
- Business Agents integration: d9745a4.
- Local style cleanup: 0c46078.
- Test fixture typing: 435741b.

### Verification state

- The latest CI run at plan update is pending; earlier runs were cancelled by subsequent commits before their jobs executed.
- The Vercel status for the latest implementation commit has not completed.
- The new tab implementation has not yet been confirmed by a completed CI run or browser visual QA. Do not mark the increment fully verified until both applicable checks are complete.


### Final accessibility correction

- Persistent tabpanel containers now remain in the DOM for all five tabs; inactive panels use the native hidden attribute. This keeps every aria-controls reference valid while only the active panel content is rendered.
- Commits: 0a6a70d (panel persistence) and 3f0ed2c (knowledge panel markup correction).
- Latest observed GitHub Actions run: 45794376119, status pending with zero jobs returned. No successful test/build result is claimed.
- Latest observed Vercel status: failure due to build-rate-limit; preview/browser visual QA is not available for this revision.


## Task 5 — shared segmented controls

**Purpose:** Standardize compact, mutually exclusive user-facing choices without misusing tab semantics.

- [x] Add focused tests for group labeling, controlled pressed state, disabled items and selection callbacks.
- [x] Implement `KvardSegmentedControl` with native buttons, `role="group"`, and `aria-pressed`.
- [x] Export the component and public prop/item types from the UI barrel.
- [x] Add token-based light/dark styling and visible keyboard focus.
- [x] Integrate the diagnostics event filter without changing filter predicates or data sources.
- [x] Integrate the Builder preview device selector without changing preview sizing state or iframe behavior.
- [x] Remove superseded local selected-state styles and prevent legacy Builder button rules from overriding the shared control.
- [ ] Run focused UI Kit tests, Web typecheck, lint and build on the final commit.
- [ ] Inspect the two integrations in a real browser at desktop and mobile widths; no visual QA is claimed yet.

### Task 5 implementation commits

- Tests first: `bcaef33`.
- Component: `a44f366`.
- Shared export: `6df2406`.
- Token-based styling: `5022258`.
- Diagnostics integration: `c549707`.
- Builder preview integration: `12166a1`.
- Diagnostics style cleanup: `b09f46d`.
- Builder style cleanup: `729e914`.

### Verification boundary

The implementation is committed to `main`. The test-first commit was not executed in a completed CI run before subsequent commits, so a red/green TDD cycle is not claimed. Final focused tests, typecheck, lint and build remain pending CI. No browser screenshots or preview QA are available for this revision.


## Task 6 — shared accessible dialogs

**Purpose:** Replace duplicated modal keyboard/focus behavior with one accessible user-facing primitive, without changing domain behavior or visual direction.

- [x] Add focused tests for modal semantics, Escape propagation, and Tab / Shift+Tab focus wrapping.
- [x] Implement `KvardDialog` with controlled visibility, accessible naming, Escape handling, focus trap, initial focus, and focus restoration.
- [x] Export the component and public prop type from the UI barrel.
- [x] Integrate the New Project modal while preserving form state, validation, submit payload, and callbacks.
- [x] Integrate the Command Palette while preserving filtering, arrow-key selection, and action execution.
- [x] Preserve existing consumer-owned visual classes; no global modal CSS or stacking changes were introduced.
- [x] Document behavior and explicit limitations.
- [ ] Run focused UI Kit tests, Web typecheck, lint and build on the final commit.
- [ ] Inspect both integrations in a real browser at desktop and mobile widths.
- [ ] Manually verify keyboard-only open, traversal, Escape, backdrop close, and focus restoration.

### Task 6 implementation commits

- Tests first: `7ca35ab`.
- Dialog primitive: `7be3671`.
- UI barrel export: `f486687`.
- Command Palette integration: `19e7bd8`.
- Focus-test fixture correction: `3fe9f89`.
- New Project modal integration: `4a3a65c`.
- Design-system documentation: `22ce96c`.

### Verification boundary

Latest observed GitHub Actions run for implementation commit `4a3a65c`: `45797144520`, status pending; the jobs endpoint returned zero jobs. The current documentation commit triggers a newer run, which must be checked against its exact HEAD. Focused tests, typecheck, lint, build, browser screenshots and manual keyboard QA are not yet confirmed. Vercel's previous deployment status was blocked by the account's build-rate limit. No administrative files were changed.


### Task 6 — additional dialog migrations

- [x] Migrate Business Agents / Create AI Employee modal to `KvardDialog`; preserve form submit and API behavior, add initial focus to the agent-name field.
- [x] Migrate Workspace / Application Manager switcher to `KvardDialog`; preserve project/window actions and correct backdrop dismissal so clicks inside the dialog do not close it.
- [x] Keep all existing consumer visual classes and styling.
- [x] Confirm changed-file scope contains no admin paths.
- [ ] Re-run focused UI tests, typecheck, lint and build on the latest implementation commit.
- [ ] Complete browser and keyboard QA for all four dialog consumers.

Additional integration commits:
- Business Agents modal: `b10b2f2`.
- Workspace Application Manager: `fe4009c`.
- Business Agents initial focus: `9366050`.
- Design-system update: `c2faa24`.

Latest verification remains pending; previous Actions runs for this work were cancelled before jobs executed. No passing test/build claim is made.


## Task 7 — shared feedback and empty states

**Purpose:** Standardize inline alerts, global toast presentation and empty-state composition while keeping state and actions owned by existing pages.

- [x] Add focused rendering tests for alert severity/live-region semantics, toast announcement semantics, and labelled empty-state structure.
- [x] Implement `KvardAlert` with semantic tones, accessible live announcements and optional explicit dismissal.
- [x] Implement `KvardToast` as a presentational atomic status region; no timers, queues or implicit state.
- [x] Implement `KvardEmptyState` with a labelled region, title, optional description and optional real action slot.
- [x] Export all three components and prop types from the UI kit barrel.
- [x] Add shared semantic-token styling.
- [x] Migrate Workspace global notice, Business Agents error/success feedback and empty agents/approvals states, plus Agents retryable errors, success feedback and empty saved-agents state.
- [x] Preserve page-owned state, retry and dismiss callbacks, data conditions, API paths and consumer classes.
- [x] Document component semantics and non-goals.
- [ ] Run focused UI Kit tests, Web typecheck, lint and build on the final commit.
- [ ] Inspect toast placement, alert wrapping and empty-state layouts at desktop/mobile breakpoints.
- [ ] Verify screen-reader announcement behavior and keyboard operation in a real browser.

### Task 7 implementation commits

- Tests first: `0d85cbe`.
- KvardAlert: `4def632`.
- KvardToast: `0252bb0`.
- KvardEmptyState: `6d19e82`.
- UI exports: `f486039`.
- Shared styles: `c18737d`.
- Workspace toast integration: `374ec32`.
- Business Agents integration: `74f4e1b`.
- Agents integration: `5286fcc`, `fa38628`.
- Design-system documentation: `94d364c`.

### Verification boundary

The final implementation is committed to `main`. Previous Actions runs were cancelled by subsequent commits before jobs completed; the current documentation commit has a pending run and must be checked against the exact latest HEAD. No tests, typecheck, lint, build, browser visual QA or screen-reader QA are claimed as passing. No administrative files were changed.


## Task 8 — shared surfaces across Workspace and Builder

**Purpose:** Consolidate reusable card/panel/container presentation without moving domain state or changing user workflows.

- [x] Add rendering tests for semantic element selection, variants, spacing and absence of implicit interactive semantics.
- [x] Implement `KvardSurface` with `div` / `section` / `article` elements.
- [x] Add default, subtle, raised and outline variants with none/sm/md/lg spacing.
- [x] Export component and public prop types.
- [x] Add token-driven border, radius, background, shadow and spacing styles.
- [x] Migrate Workspace create-project surface, recent-project list and empty-project surface.
- [x] Migrate Builder chat, preview, files, agent and code surfaces.
- [x] Remove superseded duplicate surface styling while preserving local layout and responsive rules.
- [x] Document the shared surface contract.
- [ ] Run focused UI Kit tests, Web typecheck, lint and build on the final commit.
- [ ] Verify light/dark surfaces, responsive padding and panel overflow in a real browser.
- [ ] Complete keyboard and accessibility regression checks for the affected Builder screens.

### Task 8 implementation commits

- Tests first: `7326dda`.
- KvardSurface primitive: `658f6ba`.
- UI exports: `6d5c218`.
- Shared surface styling: `63b59aa`, `a8c5609`.
- Workspace migration: `4f02e13`, `7089161`, `cce1458`.
- Builder migrations: `c92d11e`, `ad1a214`, `2c88216`.
- Design-system documentation: `5e63032`.

### Verification boundary

The changes are committed to `main`. The final GitHub Actions run must be checked against the final documentation commit; previous runs were cancelled by subsequent commits and did not complete jobs. No tests, typecheck, lint, build, browser visual QA or manual keyboard QA are claimed as passing. No administrative files were changed.


## Task 9 — Builder navigation and responsive project header

**Purpose:** Replace Builder's one-off tool navigation with the existing accessible tab primitive and stabilize the header layout on narrow screens without changing project behavior.

- [x] Extend KvardTabs with an optional consumer class while preserving the shared base class.
- [x] Add a focused test for the shared + consumer class contract.
- [x] Migrate BuilderShell tool navigation to KvardTabs with linked tabpanel semantics.
- [x] Add responsive horizontal scrolling, touch target sizing and visible panel focus styling for narrow screens.
- [x] Preserve existing tool selection callbacks, status display, project actions and content ownership.
- [x] Document the implementation and verification boundary.
- [ ] Run focused UI Kit tests, Web typecheck, lint and build on the final commit.
- [ ] Verify desktop/tablet/mobile layouts and keyboard navigation in a real browser.
- [ ] Confirm the final CI run and ensure no administrative files changed.

Implementation commits: `e6fdbaa`, `c68b307`, `10d577d`, `080efd5`, followed by the final test and documentation commits.

Verification boundary: no local test/build execution is available in this GitHub-only session. CI and Vercel must be checked against the final HEAD; no passing checks or browser QA are claimed.


## Task 10 — Shared page and section headers

- [x] Add a shared header primitive with eyebrow/title/description/action slots.
- [x] Support page-level and section-level heading semantics with explicit accessible associations.
- [x] Preserve consumer classes so existing page-specific visual systems remain authoritative.
- [x] Migrate AI Agents, Business Agents, Integrations, Diagnostics and News.
- [x] Add responsive stacking for narrow viewports.
- [x] Add focused tests and update the design-system rollout log.
- [ ] Run UI Kit tests, typecheck, lint and build on the final commit.
- [ ] Verify all migrated headers at desktop, tablet and mobile sizes, including keyboard focus and long titles.
- [ ] Confirm CI and ensure no administrative files changed.

Implementation commits: `c21f172`, `fedefb8`, `8d2b064`, `60fa35c`, `00a0180`, `3819fe8`, `e0768d6`, `d3b8089`, followed by test and documentation commits.

Verification boundary: no local test/build execution or browser session is available in this GitHub-only workflow. CI and deployment checks must be read from the final commit; no successful build or visual QA is claimed.

## Task 11 — Workspace and internal section heading consistency

**Purpose:** Extend the existing shared header contract into user-facing workspace and operational panels without flattening their page-specific visual hierarchy or changing data/actions.

- [x] Reuse `KvardPageHeader` with `headingLevel="h2"` for Workspace create/recent sections.
- [x] Migrate AI Agents profile, saved-agent and runtime section headings while retaining eyebrow labels, descriptions, real actions and counts.
- [x] Migrate Business Agents agent, knowledge, teams, approvals and usage section headings.
- [x] Migrate Integrations category headings and Diagnostics job/event panel headings.
- [x] Preserve existing consumer classes and update action-slot selectors affected by the shared wrapper.
- [x] Keep the existing event filter, counters, callbacks and data conditions unchanged.
- [x] Keep all changes on `main`; no admin files or routes included.
- [ ] Run focused UI tests, typecheck, lint and build on the final HEAD.
- [ ] Verify light/dark rendering, responsive wrapping, keyboard focus and heading outline in a real browser.
- [ ] Confirm final GitHub Actions and deployment statuses.

Verification boundary: GitHub source and diff review only. No local execution or browser session is available in this workflow; CI/build and visual QA are not claimed as passing.

## Task 12 — Builder project and panel heading hierarchy

**Purpose:** Establish a clear project → tool → panel-content hierarchy across the Builder while preserving all existing workflows and controls.

- [x] Promote the active project name to the Builder page-level `h1` using the shared heading primitive.
- [x] Preserve the return-to-workspace action and KVARD mark in the project header.
- [x] Standardize Chat, Preview, Files, AI Agent and Code panel titles as `h2` headings.
- [x] Demote Chat and Preview empty-state prompts to `h3` to preserve heading order.
- [x] Keep dynamic statuses, save/refresh actions, file controls and agent state in their existing owners and slots.
- [x] Keep the compact project bar in one row on mobile and retain responsive panel-action stacking.
- [x] Avoid nested semantic header landmarks in the Builder top bar.
- [x] Add UI Kit coverage for the `h3` content-level heading variant.
- [x] Add mobile wrapping for Code actions and visible keyboard focus for the project return action.
- [x] Keep all changes in `main`; no admin UI, APIs or business logic changed.
- [ ] Run focused UI tests, typecheck, lint and build against the final HEAD.
- [ ] Verify desktop/tablet/mobile, light/dark, keyboard focus and heading outline in a real browser.
- [ ] Confirm final GitHub Actions and deployment status.

Verification boundary: GitHub source/diff review only. No local test/build or browser session is available in this workflow; no successful verification is claimed.


## Task 13 — Builder responsive layout and overflow hardening

**Purpose:** Make the existing Builder workspace resilient to long content and narrow viewports without changing project workflows, API contracts or the desktop split composition.

- [x] Constrain nested Builder panels and file/editor regions to their available width.
- [x] Allow long conversation messages, agent events, plan details and filenames to wrap within their own surfaces.
- [x] Keep code editors as the intentional horizontal-scroll boundary for long source lines.
- [x] Harden the model picker, Composer controls, panel actions and project header for narrow viewports.
- [x] Align filename emphasis styling with the actual <b> elements rendered in Files and Code.
- [x] Preserve existing semantic theme tokens and add visible focus treatment for Builder controls.
- [x] Keep preview, file save/load, agent execution, navigation, APIs and business logic unchanged.
- [x] Keep all changes in main; no admin UI or admin files included.
- [ ] Run UI tests, typecheck, lint and build against the final HEAD.
- [ ] Verify desktop/tablet/mobile, light/dark, long paths/messages and keyboard focus in a real browser.
- [ ] Confirm final GitHub Actions and deployment status.

Verification boundary: GitHub source/diff review only. CI is pending; no successful test/build or browser visual QA is claimed.


## Task 14 — Builder loading, empty and error states

**Purpose:** Make the Builder's operational states explicit, accessible and safe without fabricating progress or changing API behavior.

- [x] Use the shared alert primitive for Chat task errors while preserving the existing retry callback.
- [x] Distinguish file-list loading/failure, file loading/failure, no files and file-selection guidance.
- [x] Add a targeted retry for file-read failures.
- [x] Preserve unsaved editor content after save failures and explain that the buffer remains available.
- [x] Use shared empty states for pre-build Preview and an empty agent activity history.
- [x] Keep existing API calls, callbacks, status sources and agent execution behavior unchanged.
- [x] Keep all changes in `main`; no admin UI or admin files included.
- [ ] Run UI tests, typecheck, lint and build against final HEAD.
- [ ] Verify loading/error/empty states, retry behavior, light/dark and keyboard focus in a real browser.
- [ ] Confirm final GitHub Actions and deployment status.

Verification boundary: GitHub source/diff review only. No successful tests/build or browser visual QA is claimed.


## Task 15 — Business Agents interaction consistency

**Purpose:** Align compact dismissal controls and responsive action slots with the shared KVARD interaction system without changing Business Agents workflows.

- [x] Give alert-dismiss and modal-close controls a consistent 36px hit area.
- [x] Use shared semantic radius, hover-surface and focus tokens for those controls.
- [x] Constrain header action and modal footer children against intrinsic-width overflow.
- [x] Preserve all existing APIs, modal behavior, alert actions, forms and business-agent workflows.
- [x] Keep all changes in main; no admin UI or admin files included.
- [ ] Run focused UI tests, typecheck, lint and build against final HEAD.
- [ ] Verify light/dark, desktop/mobile and keyboard focus in a real browser.
- [ ] Confirm final GitHub Actions and deployment status.

Verification boundary: GitHub source/diff review only. No successful tests/build or browser visual QA is claimed.


## Task 16 — Integration catalog status truthfulness

**Purpose:** Make the current connector availability explicit and consistent with the shared UI kit without implying that a live OAuth/API connection exists.

- [x] Render connector state with the shared `KvardStatusBadge` primitive.
- [x] Label connectors absent from the configured list as `Не настроено`.
- [x] Clarify that the page is currently a reference catalog and server-side OAuth/API setup is not implemented.
- [x] Keep the existing details modal informational and preserve its disabled action.
- [x] Preserve connector definitions, modal callback, routing and future connected-state contract.
- [x] Keep all changes on `main`; no admin UI or admin files included.
- [ ] Run focused UI tests, typecheck, lint and build against final HEAD.
- [ ] Verify status contrast, responsive cards, light/dark and keyboard interaction in a real browser.
- [ ] Confirm final GitHub Actions and deployment status.

Verification boundary: source and diff review only. No successful tests/build or browser visual QA is claimed.
