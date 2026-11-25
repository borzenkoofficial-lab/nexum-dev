# КВАРД Brand Mark Implementation Plan

> **For agentic workers:** Execute inline in the current session. Work directly in \`main\` as explicitly required by the product owner; do not create a branch or worktree. Follow TDD for the component and run all available verification.

**Goal:** Replace duplicated text-based КВАРД marks on user-facing surfaces with one accessible, size-configurable React SVG component that reproduces the approved favicon geometry.

**Architecture:** Add a small presentational \`KvardMark\` component using the existing favicon's 64×64 SVG geometry and semantic brand tokens. Migrate the current brand-mark touchpoints without changing layout behavior, routing, authentication, APIs, or application state. Add a Node built-in test for the actual React element output and run it in CI.

**Tech Stack:** React 19, TypeScript, SVG, CSS custom properties, Node 22 \`node:test\`.

**Spec:** \`docs/KVARD_BALANCED_BRAND_ROLLOUT.md\`, \`docs/KVARD_DESIGN_SYSTEM.md\`, \`docs/KVARD_DESIGN_SYSTEM_AND_ROLLOUT.md\`.

## Global Constraints

- Target branch is \`main\`; no feature branches, worktrees, PRs, or branch cleanup.
- Never edit administrative UI, routes, APIs, MFA, roles, permissions, or admin documentation.
- Preserve the existing favicon geometry: viewBox \`0 0 64 64\`; background \`#24213A\`; white K path \`M19 14v36M22 32l24-18M24 31l22 19\`; stroke width \`6.5\`; round caps and joins.
- Use \`--kv-brand-ink\` and \`--kv-on-brand\` with safe SVG fallbacks; do not use the action gradient as a CTA treatment.
- The mark is decorative by default; a supplied label exposes it as an accessible image.
- Keep wordmark text as real text, with exact spelling \`КВАРД\`.
- No new dependencies.
- Recheck HEAD and each file SHA before writes; stop if another commit changes a target file.
- Every commit must contain only the intended plan, test, or user-facing brand files.

## Review Focus

1. Small sizes (16 and 24 px): K remains legible and does not clip.
2. Accessible labeling: decorative SVGs are hidden from assistive technology; labeled SVGs expose role \`img\` and the supplied name.
3. Theme changes: the mark remains legible in light and dark themes through semantic token values.
4. CSS cascade: existing sizing/background rules must not add a second tile or distort the SVG.
5. Regression boundary: no changes to admin paths or product behavior.

---

### Task 1: Add and test the shared KvardMark component

**Files:**
- Create: \`apps/web/src/components/KvardMark.ts\`
- Create: \`apps/web/src/components/KvardMark.test.ts\`
- Modify: \`apps/web/package.json\`
- Modify: \`.github/workflows/ci.yml\`

**Interface:**
- \`KvardMark({ size?: number, label?: string, className?: string }): ReactElement\`
- Default size: 32.
- Default accessibility: \`aria-hidden="true"\`.
- When \`label\` is supplied: \`role="img"\` and \`aria-label={label}\`.
- Test with React element inspection; do not add a rendering or testing dependency.

- [ ] Step 1: Add failing tests for the exact SVG viewBox, 24px dimensions, existing favicon path/shape, decorative accessibility, and labeled accessibility.
- [ ] Step 2: Add \`test:brand\` script using Node 22 \`--experimental-strip-types\` and run the test in CI.
- [ ] Step 3: Run \`npm --prefix apps/web run test:brand\`; expected RED because \`KvardMark.ts\` does not yet exist.
- [ ] Step 4: Implement the minimum component using \`createElement\` and the existing favicon geometry.
- [ ] Step 5: Run \`npm --prefix apps/web run test:brand\`; expected GREEN.
- [ ] Step 6: Run web typecheck and lint.

### Task 2: Migrate user-facing brand mark instances

**Files:**
- Modify: \`apps/web/src/components/Sidebar.tsx\`
- Modify: \`apps/web/src/components/NexumWelcome.tsx\`
- Modify: \`apps/web/src/components/OSSystemChrome.tsx\`
- Modify: \`apps/web/src/components/BuilderShell.tsx\`
- Modify: \`apps/web/src/components/OSDesktop.tsx\`
- Modify: \`apps/web/src/components/BuilderChat.tsx\`
- Modify: \`apps/web/src/components/BuilderHome.tsx\`
- Modify: \`apps/web/src/kvard-design-system.css\`
- Modify: \`apps/web/src/builder.css\`
- Modify: \`apps/web/src/components/nexum-welcome.css\`

**Interface:**
- All instances import the same \`KvardMark\`.
- Keep existing visual dimensions: sidebar 32, Welcome 64/26/104 (mobile 76), system chrome 30, Builder 28, chat 48, home empty state 42.
- The sequence mark uses a real SVG element; remove the CSS-generated letter pseudo-element.
- Remove only obsolete letter/tile styles made redundant by the shared SVG.

- [ ] Step 1: Replace the sidebar, welcome, system chrome, Builder, desktop, chat, and home marks with \`KvardMark\`.
- [ ] Step 2: Remove obsolete duplicate mark backgrounds and pseudo-element text while preserving surrounding layout.
- [ ] Step 3: Run \`npm --prefix apps/web run typecheck\`.
- [ ] Step 4: Run \`npm --prefix apps/web run lint\`.
- [ ] Step 5: Run \`npm --prefix apps/web run test:runtime\` and \`npm --prefix apps/web run test:brand\`.
- [ ] Step 6: Run \`npm --prefix apps/web run build\`.
- [ ] Step 7: Inspect the full diff and verify no admin file changed.

### Task 3: Verify the integrated brand component

- [ ] Step 1: Confirm the CI run for the final commit reports build, E2E, typecheck, runtime tests, brand tests, and lint outcomes.
- [ ] Step 2: Re-fetch the final commit and verify its changed-file list contains only the planned user-facing brand files and test configuration.
- [ ] Step 3: Record browser visual QA as outstanding unless an actual browser session and screenshots are available.

## Execution Notes

- Current verified \`main\` HEAD at plan creation: \`490eada192d410079b901ad24cd28624f1eafbec\`.
- The existing \`apps/web/public/favicon.svg\` is the canonical geometry source.
- The current product UI has duplicated letter marks in Sidebar, Welcome, OSSystemChrome, BuilderShell, OSDesktop, BuilderChat, and BuilderHome.
- The existing \`main\` workflow already runs Node 22 and web build/typecheck/lint/runtime tests; this plan adds only the focused brand test.
- Do not claim browser visual verification from static source or CI alone.
