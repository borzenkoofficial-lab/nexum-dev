# КВАРД — Design System 1.0

Статус: базовая спецификация продукта. Утверждённое направление: Premium Technology.

## Brand
- Название продукта: КВАРД.
- Образ: профессиональная интеллектуальная инженерная платформа.
- Основной знак: геометрическая буква «К» в компактном квадратном контейнере.
- Светлая тема — по умолчанию; тёмная — дополнительная.
- Плотность интерфейса — сбалансированная.

## Visual principles
1. Сдержанная премиальность через типографику, сетку и точность, а не эффекты.
2. Светлый нейтральный canvas, белые рабочие поверхности, тонкие границы.
3. Фиолетовый — функциональный акцент действий и текущего выбора.
4. Состояния имеют цвет, подпись и/или пиктограмму; цвет не единственный носитель смысла.
5. Без стеклянных панелей, декоративных свечений, частиц и бесцельных градиентов.

## Tokens
Семантические CSS tokens находятся в `apps/web/src/kvard-design-system.css`.
- Canvas: `#F6F7F9`
- Surface: `#FFFFFF`
- Text: `#191923`
- Secondary text: `#666A78`
- Border: `#E5E6EB`
- Action: `#7040D8`
- Action hover: `#6032C5`
- Action soft: `#F1EBFF`

Dark theme is independently tuned under `:root[data-theme="dark"]`.

## Type and geometry
- UI font: system-first sans stack with Inter fallback.
- Monospace: use for source code, logs, identifiers and technical values.
- Base spacing: 4px; common gaps 8/12/16/24/32px.
- Radius: 6px compact, 8px controls, 12px panels, 16px large containers.
- Standard controls target 40–44px height.

## Information architecture
- Workspace home and projects.
- Studio: AI task chat, project files, preview, agent activity, code.
- Agents and agent teams as dedicated product areas when the backing functionality is available.
- Visual workflow builder.
- Runtime, integrations, knowledge and monitoring as distinct operational areas.
- Settings and account controls.

## Product invariants
- Design changes must preserve auth, API contracts, routing, state, project creation, chat execution, preview and file operations.
- Do not present planned features as already implemented.
- All data and statuses shown in monitoring must be grounded in real sources.
- Theme preference is stored locally and defaults to light.

## Responsive behavior
- Desktop: persistent navigation and split work areas.
- Medium screens: collapse secondary panels as needed.
- Mobile: switch Studio panels rather than forcing a three-column layout.
- Preserve 320px reflow, keyboard access, visible focus and reduced-motion support.

## Component states
Interactive components define default, hover, focus-visible, active, disabled and loading states. Data-driven controls also define success, warning and error states.

## Implementation sequence
1. Foundation tokens and brand shell.
2. Core components and navigation.
3. Studio work surface.
4. Agent builder and runtime views.
5. Responsive, accessibility and regression verification.


## Workspace home implementation
The home screen uses a persistent left navigation rail on desktop and a compact horizontal navigation on narrow screens.
- Primary action: create a project from a natural-language brief.
- Quick-start prompts are inserted into the same composer; they do not create projects until the user submits.
- Recent projects are rendered from the existing project collection and open the existing Studio/agent flow.
- Empty state directs the user to the task composer rather than showing fabricated activity.
- Sidebar project shortcuts are limited to active projects and use the existing project-open callback.
- Keyboard shortcut hint is shown for Ctrl/⌘ + Enter; the primary action remains available as a button.
- A skip link provides direct keyboard access to the main workspace content.
