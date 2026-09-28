# NEXUM Project Rules

## Preserve
- Existing product identity
- Existing working functionality
- Existing security boundaries
- Existing data contracts unless migration is required
- Existing visual language unless redesign is requested

## Change carefully
Authentication, authorization, database/schema contracts, public API contracts, routing, build configuration, dependencies, and environment configuration.

## Verification
Runtime changes require narrow verification and implementation tasks require the final verification gate.

## Do not
- fabricate test/build results;
- silently change domain;
- replace a project with a template;
- remove functionality to make a build pass;
- introduce unnecessary dependencies;
- expose secrets in source, logs, or AI context.
