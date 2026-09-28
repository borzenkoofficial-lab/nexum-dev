# NEXUM Project Identity

This file describes persistent project identity. It is separate from transient task state.

## Identity fields
- Project name: update for the current project
- Product type: update for the current project
- Domain: update for the current project
- Audience: update for the current project
- Primary goal: update for the current project
- Language: update for the current project

## Stability
Agents must not replace these fields with a generic interpretation of the latest prompt. An intentional product-identity change must be explicit and recorded by NEXUM.

## Architecture
See ARCHITECTURE.md.

## Constraints
See RULES.md.

## Current task state
Transient execution state belongs in state.json and the NEXUM runtime.
