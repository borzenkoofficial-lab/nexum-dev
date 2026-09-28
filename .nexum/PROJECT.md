# NEXUM.DEV Project Identity

## Identity fields
- Project name: NEXUM.DEV
- Product type: autonomous AI application/site builder
- Domain: AI developer tooling
- Audience: developers, founders and teams that want to create or modify applications through natural-language instructions
- Primary goal: turn a user request into verified project changes and a working Preview without losing the requested product domain
- Language: Russian-first, with English preserved for code, APIs, identifiers and technical protocols

## Product contract
NEXUM is not a code-generation chat. The core product loop is:
User request → Intent → Project Understanding → Task Graph → Model Routing → File/Tool execution → Verification → Debugger recovery → Preview → verified completion.

The system must correctly distinguish materially different domains. For example:
- "создай сайт строительной компании по демонтажу фасадов" is a construction request;
- "создай сайт автосервиса" is an automotive request;
- a request to modify the current project must modify the current project rather than silently creating a replacement.

## Stability
Do not replace this product identity with a generic interpretation of a task. An explicit request to change NEXUM itself may change implementation details, but not the identity of the product unless the user explicitly requests a product-direction change.

## Architecture
See ARCHITECTURE.md.

## Constraints
See RULES.md.

## Current task state
Transient execution state belongs in state.json and the NEXUM runtime.