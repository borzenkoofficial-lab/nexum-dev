# КВАРД UI Kit Implementation Plan

> **Execution:** Directly in \`main\`, as required by the product owner. No feature branches, worktrees, PRs or branch cleanup.

**Goal:** Establish a small, reusable UI Kit that removes the current divergence between user-facing buttons, form fields and status indicators without redesigning every screen at once.

**Architecture:** Build framework-native React primitives under \`apps/web/src/components/ui/\`, backed by the existing semantic design tokens in \`kvard-design-system.css\`. Keep native HTML semantics and native form controls. Add focused Node 22 tests using \`node:test\`; do not add dependencies or a Storybook stack.

**Design basis:** Balanced. Neutral surfaces, restrained purple action color, predictable control geometry, visible focus, clear disabled/loading/error states, full light/dark token support.

## Current Findings

- The application already has semantic light/dark tokens and global focus/transition rules.
- There is no shared user-facing component library for controls.
- \`AgentsPage\` and \`BusinessAgentsPage\` contain many repeated primary/secondary buttons and form controls with local class names.
- \`BusinessAgentsPage.css\` owns its own button and status styles, including local fallbacks; \`AgentsPage\` uses another set of button/status selectors.
- A full CSS rewrite would create unnecessary risk. This plan introduces primitives first and migrates only selected high-frequency patterns.

## Scope — first UI Kit increment

### Components

1. \`KvardButton\`
   - Variants: \`primary\`, \`secondary\`, \`ghost\`, \`danger\`.
   - Sizes: \`sm\`, \`md\`, \`lg\`.
   - States: default, hover, focus-visible, active, disabled, loading.
   - Native button type, disabled semantics, \`aria-busy\` for loading.
   - Icon-only use requires a meaningful accessible name.
   - Does not invent progress or success; loading is driven by caller state.

2. \`KvardField\`
   - Label + \`htmlFor\`, optional hint, error and required indicator.
   - Renders a wrapper around a native input/select/textarea child.
   - Error is linked to the child control with \`aria-describedby\` only when the child ID is available and the component can safely compose the attributes.
   - Does not own or transform form values.

3. \`KvardStatusBadge\`
   - Tones: \`neutral\`, \`success\`, \`warning\`, \`danger\`, \`info\`.
   - Visible text is mandatory; color alone never communicates status.
   - No live-region role by default; dynamic announcements remain the owning screen's responsibility.

### First integrations

- Migrate the primary/secondary/create buttons in \`AgentsPage\` and \`BusinessAgentsPage\` where the semantics match exactly.
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

- [ ] Add failing tests for button variants, native type, disabled/loading semantics and accessible icon-only naming.
- [ ] Add tests for field label/hint/error structure and required state.
- [ ] Add tests for status badge tones and mandatory visible label.
- [ ] Implement the three primitives using native HTML elements.
- [ ] Add semantic token-based CSS for all variants and states.
- [ ] Run focused tests, Web typecheck and lint.

### Task 2 — integrate in user-facing screens

- [ ] Migrate primary/secondary/create buttons in AgentsPage.
- [ ] Migrate primary/secondary/create buttons in BusinessAgentsPage.
- [ ] Migrate explicit status badges in both pages.
- [ ] Remove only the local CSS rules now owned by the shared primitives.
- [ ] Confirm handlers, form behavior, loading and disabled states are unchanged.

### Task 3 — verify and record

- [ ] Run brand/UI Kit tests and existing Web runtime tests.
- [ ] Run Web typecheck, lint and build.
- [ ] Inspect light/dark, keyboard focus, 320/390/768/1280/1440 widths in a real browser.
- [ ] Review commit file lists; confirm no admin paths changed.
- [ ] Record any unrelated CI/API/E2E failures separately; do not attribute them to UI Kit without evidence.

## Definition of Done

- The shared components are used in both target pages.
- All variants/states have accessible native semantics.
- Existing form and button behavior is preserved.
- No local hardcoded colors were introduced.
- Focused tests, Web typecheck, lint and build pass.
- Browser visual QA is explicitly marked complete only with real screenshots.
- No administrative files or routes changed.

## Execution Notes

- Current \`main\` HEAD at plan creation: \`8cc3cd17cda82dad23f205077ad2b10a4b52b1ed\`.
- Existing token source: \`apps/web/src/kvard-design-system.css\`.
- Initial migration targets: \`AgentsPage.tsx\`, \`BusinessAgentsPage.tsx\` and their existing styles.
- This is the first UI Kit increment, not a mandate to replace every button or input across the product.
