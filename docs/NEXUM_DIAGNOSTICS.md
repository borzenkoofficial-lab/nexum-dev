# NEXUM Diagnostics

Bounded staging observability for browser runtime, console errors/warnings, failed HTTP requests, route/project/job context and session metadata.

Endpoints:
- POST /api/diagnostics/events
- GET /api/diagnostics/session/:sessionId
- GET /api/diagnostics/latest

The store is in-memory and bounded. It is intended for staging/development, not permanent analytics.

Never send API keys, passwords, cookies, Authorization headers, full prompts, generated source files or secrets. The server redacts common credential fields and bearer/API-key patterns.

A public staging URL exposes HTTP-accessible pages and diagnostics; it does not by itself provide interactive browser click/control capabilities.
