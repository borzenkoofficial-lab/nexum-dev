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
