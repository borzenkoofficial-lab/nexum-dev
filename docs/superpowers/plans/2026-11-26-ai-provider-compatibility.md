# КВАРД AI Provider Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ввести реальный канонический контракт запросов/ответов КВАРД и безопасный legacy bridge, чтобы новые provider adapters подключались без изменений продуктовых модулей.

**Architecture:** Существующий AIGateway остаётся единой точкой входа. AIProvider сохраняет строковый generate() и получает optional generateRequest() для нативных адаптеров. Gateway валидирует capabilities, направляет canonical request в native adapter либо в строгий text-only legacy bridge, нормализует AIResponse и не меняет текущую fallback-семантику.

**Tech Stack:** TypeScript, Node.js built-in test runner (node:test), существующие AIGateway/NexumError/provider adapters. Новые runtime dependencies не добавлять.

**Spec:** `docs/superpowers/specs/2026-11-26-ai-provider-compatibility-design.md`

## Global Constraints

- Работать только в `main`, без создания дополнительных веток.
- Не выполнять production deploy, production migrations, provider purchases/top-ups или изменение secrets.
- Сохранить обратную совместимость существующих вызовов `generate(message)`.
- Не заявлять capabilities, которых нет в реализации адаптера.
- Не превращать отсутствующий usage в нулевой расход.
- Не делать скрытый fallback на другую модель/провайдера.
- Секреты и API-key fragments не должны попадать в нормализованные ошибки.
- Не добавлять зависимости без технической необходимости.
- Каждый production-code шаг начинается с теста, который сначала должен упасть.
- Не отмечать задачу выполненной без свежего запуска тестов и typecheck.

## Review Focus

- Запрос содержит role=tool или developer, который legacy string provider не умеет представлять точно: bridge должен отклонить неподдерживаемый payload, а не терять семантику.
- Capability provider говорит true, но model-level getCapabilities(model) говорит false: приоритет model-level значения.
- Provider возвращает частичный usage (например, только inputTokens): источник остаётся unavailable/partial, отсутствующие значения не подставляются нулями.
- AbortSignal уже отменён до вызова или отменяется во время вызова: сигнал должен быть передан без retries/fallback.
- Provider выбрасывает ошибку, содержащую секретоподобный API key: публичная нормализованная ошибка не должна раскрывать credential.

---

### Task 1: Canonical AI contract types and validation

**Files:**
- Modify: `apps/api/ai/types.ts`
- Create: `apps/api/ai/canonical.ts`
- Create: `apps/api/ai/canonical.test.ts`
- Modify: `apps/api/package.json` (register test file)

**Interfaces:**
- Produces `AIContentPart`, `AIToolCall`, `AIMessage` (including assistant tool-call history), expanded `AIRequest`, `AIUsage`, `AIResponse`, `AIProvider.generateRequest?(request: AIRequest): Promise<AIResponse>`.
- Produces `validateCanonicalRequest(request: AIRequest): void`, `getRequiredCapabilities(request: AIRequest): Partial<AIModelCapabilities>`, `normalizeAIResponse(response: AIResponse, providerId: string, model: string): AIResponse`.
- Canonical request version is `1`. Existing string-content messages remain valid.
- Usage source enum: `provider_reported | estimated | unavailable`. Missing usage is unavailable; partial usage remains partial and must not be filled with zero values.

- [x] **Step 1: Write tests first** for valid text request, mixed content, invalid empty messages/model, malformed image part, capability extraction, normalization of provider/model, missing and partial usage.
- [x] **Step 2: Run** `npm --prefix apps/api test -- ai/canonical.test.ts` (or repository-supported equivalent); confirm failures are caused by missing contract functions/types.
- [x] **Step 3: Implement** canonical types and pure runtime validation/normalization in the files above. Keep existing AIRequest/AIResponse property compatibility.
- [x] **Step 4: Run** focused tests, then `npm --prefix apps/api run typecheck`.
- [x] **Step 5: Commit** `feat(ai): add canonical provider request and response contract`.

### Task 2: Strict legacy adapter bridge

**Files:**
- Create: `apps/api/ai/legacyProviderAdapter.ts`
- Create: `apps/api/ai/legacyProviderAdapter.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `generateWithLegacyProvider(provider: AIProvider, request: AIRequest): Promise<AIResponse>`.
- Accept only request v1, text-only content, supported text roles, no tools or assistant tool-call history, no streaming, responseFormat=text, and no unsupported options.
- Preserve message order and role boundaries when converting canonical messages to legacy prompt.
- Pass maxTokens, temperature and AbortSignal to legacy `generate`.
- Return content, provider/model, finishReason if inferable, and `usageSource: "unavailable"` when provider has not reported usage.
- Reject unsupported features with typed `NexumError` before calling provider.generate.

- [x] **Step 1: Write failing tests** for text conversion, option forwarding, unsupported image/tool/stream/json/developer/tool-role requests, and ensuring provider is not called after rejection.
- [x] **Step 2: Run** focused legacy adapter tests and verify expected RED.
- [x] **Step 3: Implement** strict bridge.
- [x] **Step 4: Run** focused tests and API typecheck.
- [x] **Step 5: Commit** `feat(ai): add strict legacy provider bridge`.

### Task 3: Canonical gateway entry point

**Files:**
- Modify: `apps/api/ai/gateway.ts`
- Modify: `apps/api/ai/gateway.test.ts`
- Modify: `apps/api/package.json` only if a new test file is needed.

**Interfaces:**
- Produces `AIGateway.generateRequest(request: AIRequest, options?: { provider?: string; fallback?: boolean }): Promise<AIResponse>`.
- Select provider by explicit options.provider, otherwise gateway default; reject unknown provider. The canonical gateway options currently expose provider selection only; no new fallback option is introduced.
- Validate canonical request and model-level capabilities before provider invocation.
- Prefer provider.generateRequest(request) when available; otherwise use strict legacy bridge.
- Native adapter response is normalized with actual provider id/model; do not overwrite provider-reported model with requested model if adapter reports a different actual model.
- Preserve AbortSignal through request options.
- No new fallback behavior. Existing `generate` and `generateWithMetadata` semantics remain unchanged.
- Do not call provider listModels over network on each generation.

- [x] **Step 1: Write failing tests** for native adapter routing, legacy routing, model-level capability override, unsupported capability rejection before call, unknown provider, actual model identity and signal forwarding.
- [x] **Step 2: Run** gateway tests and verify expected RED.
- [x] **Step 3: Implement** canonical gateway method without changing existing generate methods.
- [x] **Step 4: Run** all gateway and canonical/legacy tests, then API typecheck.
- [x] **Step 5: Commit** `feat(ai): route canonical requests through gateway adapters`.

### Task 4: Provider adapter conformance suite

**Files:**
- Create: `apps/api/ai/providerConformance.test.ts`
- Modify: `apps/api/package.json`
- Modify: `docs/KVARD_AI_PROVIDER_ADAPTER_CONTRACT.md`
- Modify: `docs/KVARD_ADMIN_PANEL_CHECKLIST.md`

**Interfaces:**
- Add reusable test harness that runs the same canonical contract checks against a provider fixture implementing native generateRequest.
- Required assertions: provider/model identity, request cancellation, partial/missing usage semantics, integer token validation, assistant tool-call history, capability rejection, safe error surface (including typed NexumError userSafeMessage), deterministic content mapping. The dedicated workflow runs API typecheck and all API tests independently of browser E2E.
- Keep network-free tests deterministic. Real provider sandbox checks remain a separate pre-production gate and are not simulated by CI.

- [x] **Step 1: Write failing conformance tests** for native fixture and negative capability cases.
- [x] **Step 2: Run** focused conformance tests and verify RED.
- [x] **Step 3: Implement** the conformance harness and register test.
- [x] **Step 4: Update** provider contract doc with implemented-vs-pending matrix; update checklist with exact statuses.
- [x] **Step 5: Run** full API test suite and typecheck; run repo CI and inspect every job.
- [x] **Step 6: Commit** `test(ai): add provider adapter conformance suite`.

## Completion Criteria

- Existing string Gateway behavior and tests remain unchanged.
- New canonical API is covered by RED→GREEN tests.
- Legacy adapters cannot silently claim unsupported tools/vision/streaming/JSON.
- Missing/partial usage is explicit and never falsified.
- API tests and typecheck pass.
- Dedicated AI Provider Contract workflow completed successfully with API typecheck and full API suite. Main CI build job is green; any separate Runtime E2E failure is recorded and tracked independently, not misreported as an AI provider-contract failure.
- Checklist accurately distinguishes implemented contract foundation from provider features still pending.


## Verification record — 2026-11-26

- Dedicated workflow `45705059762` passed on commit `9f4e9992c017a94409834c8f238926cbe09fceab`: API typecheck passed; 238/238 API tests passed (0 failed).
- Main CI workflow `45704112563`: build job passed all API/Web/Docker steps. Runtime E2E job had 40 passed, 1 failed, 3 skipped. The single failure is the existing Runtime cancellation ownership assertion in `e2e/tests/runtime-phase-2-5.spec.ts:129` (`runtimeData.resources` expected 0, received 1); it remains a separate Runtime issue.
- Production deployment, production migration, real provider credentials, paid provider calls and top-ups were not performed.


### Follow-up review verification — 2026-11-26

- Added canonical assistant tool-call history and strict legacy rejection.
- Tightened usage normalization: token counts must be non-negative integers; absent/malformed/contradictory usage is unavailable; estimated stays estimated.
- Extended credential redaction to typed NexumError userSafeMessage and technicalDetails.
- Dedicated workflow `45705690934` passed on `53e0be5392fce43a3b623623ab63aa32022d9891`: API typecheck passed; 241/241 API tests passed.
