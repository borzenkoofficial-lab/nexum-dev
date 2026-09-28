# NEXUM.DEV — Product & UI Design Map

Status: active redesign, September 2026.

## 1. Product principle
NEXUM should feel like a calm professional development workspace, not a terminal, game menu, military dashboard, or generic SaaS admin panel.

Primary UX chain:
Projects → Project → Describe task → Agent works → Preview → Inspect files → Iterate.

The user should understand at every moment:
- what project is open;
- what NEXUM is doing;
- where the result is;
- what the next useful action is.

## 2. Visual direction
- Light neutral canvas.
- White working surfaces.
- Soft gray borders.
- Near-black readable text.
- One restrained violet accent for primary actions and active state.
- No neon green, tactical green, glow-heavy effects, black panels, or decorative gradients.
- Minimal shadows.
- 8–16px radius system.
- Typography prioritizes readability over cinematic styling.

## 3. Workspace anatomy

Desktop:
┌──────────────── Sidebar ───────────────┬──────────── Main workspace ────────────┐
│ NEXUM.DEV                              │ Project header                         │
│ Overview                               ├──────────────────────┬────────────────┤
│ Integrations                            │                      │                │
│ + New project                           │ Chat / Composer      │ Preview        │
│ Projects                                │                      │ Files          │
│   project list                          │                      │ Agent          │
│                                         │                      │                │
│ Settings                                │                      │                │
└─────────────────────────────────────────┴──────────────────────┴────────────────┘

The chat is the primary creation surface. The right panel is the result/tool surface.

## 4. Chat rules
- Conversation scrolls independently.
- Composer stays stable at the bottom of the chat column.
- No fixed overlays over messages.
- No duplicated footer controls.
- Prompt suggestions remain secondary.
- User messages and NEXUM messages are visually distinct but restrained.
- Agent status is compact and contextual, not a large dashboard.
- Attachments stay inside the composer.

## 5. Right panel
Tabs:
1. Preview — default after generation.
2. Files — inspect/edit generated files.
3. Agent — inspect work, errors, plan and repair.

Preview should visually resemble a browser/device surface, not a terminal.

## 6. Navigation
Sidebar is persistent on desktop.
Mobile collapses into a menu.
Project selection must never switch into a workspace before the selected project state is available.

## 7. Interaction hierarchy
Primary:
- New project
- Send
- Preview
- Save

Secondary:
- Attach
- Refresh
- Open agent
- Quick actions

Tertiary:
- Git status
- technical metadata
- connection details

## 8. Color semantics
- Accent: primary action / selected state only.
- Green: successful connection or completed state only.
- Red: errors only.
- Gray: neutral metadata.
No color should be used merely for decoration.

## 9. Motion
Motion is functional:
- short 120–220ms transitions;
- no persistent glow;
- no large cinematic text transitions in the workspace;
- loading states communicate progress without distracting from the task.

## 10. Development order
Phase A — stabilize:
- project navigation;
- black-screen prevention;
- chat geometry;
- preview/files/agent panel sizing.

Phase B — visual system:
- clean token system;
- sidebar;
- header;
- composer;
- conversation;
- right panel;
- responsive states.

Phase C — product UX:
- project creation;
- agent progress;
- preview iteration;
- repair flow;
- files/code workflow.

Phase D — premium polish:
- typography;
- empty states;
- micro-interactions;
- accessibility;
- keyboard navigation;
- responsive QA.

## 11. Hard rule
Do not add another CSS patch for an isolated symptom when the underlying layout model is wrong. Prefer one canonical layout rule per surface.
