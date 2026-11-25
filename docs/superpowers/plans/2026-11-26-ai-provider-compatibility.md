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
- Produces `AIContentPart`, `AIMessage`, expanded `AIRequest`, `AIUsage`, `AIResponse`, `AIProvider.generateRequest?(request: AIRequest): Promise<AIResponse>`.
- Produces `validateCanonicalRequest(request: AIRequest): void`, `getRequiredCapabilities(request: AIRequest): Partial<AIModelCapabilities>`, `normalizeAIResponse(response: AIResponse, providerId: string, model: string): AIResponse`.
- Canonical request version is `1`. Existing string-content messages remain valid.
- Usage source enum: `provider_reported | estimated | unavailable`. Missing usage is unavailable; partial usage remains partial and must not be filled with zero values.

- [ ] **Step 1: Write tests first** for valid text request, mixed content, invalid empty messages/model, malformed image part, capability extraction, normalization of provider/model, missing and partial usage.
- [ ] **Step 2: Run** `npm --prefix apps/api test -- ai/canonical.test.ts` (or repository-supported equivalent); confirm failures are caused by missing contract functions/types.
- [ ] **Step 3: Implement** canonical types and pure runtime validation/normalization in the files above. Keep existing AIRequest/AIResponse property compatibility.
- [ ] **Step 4: Run** focused tests, then `npm --prefix apps/api run typecheck`.
- [ ] **Step 5: Commit** `feat(ai): add canonical provider request and response contract`.

### Task 2: Strict legacy adapter bridge

**Files:**
- Create: `apps/api/ai/legacyProviderAdapter.ts`
- Create: `apps/api/ai/legacyProviderAdapter.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces `generateWithLegacyProvider(provider: AIProvider, request: AIRequest): Promise<AIResponse>`.
- Accept only request v1, text-only content, supported text roles, no tools, no streaming, responseFormat=text, and no unsupported options.
- Preserve message order and role boundaries when converting canonical messages to legacy prompt.
- Pass maxTokens, temperature and AbortSignal to legacy `generate`.
- Return content, provider/model, finishReason if inferable, and `usageSource: "unavailable"` when provider has not reported usage.
- Reject unsupported features with typed `NexumError` before calling provider.generate.

- [ ] **Step 1: Write failing tests** for text conversion, option forwarding, unsupported image/tool/stream/json/developer/tool-role requests, and ensuring provider is not called after rejection.
- [ ] **Step 2: Run** focused legacy adapter tests and verify expected RED.
- [ ] **Step 3: Implement** strict bridge.
- [ ] **Step 4: Run** focused tests and API typecheck.
- [ ] **Step 5: Commit** `feat(ai): add strict legacy provider bridge`.

### Task 3: Canonical gateway entry point

**Files:**
- Modify: `apps/api/ai/gateway.ts`
- Modify: `apps/api/ai/gateway.test.ts`
- Modify: `apps/api/package.json` only if a new test file is needed.

**Interfaces:**
- Produces `AIGateway.generateRequest(request: AIRequest, options?: { provider?: string; fallback?: boolean }): Promise<AIResponse>`.
- Select provider by explicit options.provider, otherwise gateway default; reject unknown provider.
- Validate canonical request and model-level capabilities before provider invocation.
- Prefer provider.generateRequest(request) when available; otherwise use strict legacy bridge.
- Native adapter response is normalized with actual provider id/model; do not overwrite provider-reported model with requested model if adapter reports a different actual model.
- Preserve AbortSignal through request options.
- No new fallback behavior. Existing `generate` and `generateWithMetadata` semantics remain unchanged.
- Do not call provider listModels over network on each generation.

- [ ] **Step 1: Write failing tests** for native adapter routing, legacy routing, model-level capability override, unsupported capability rejection before call, unknown provider, actual model identity and signal forwarding.
- [ ] **Step 2: Run** gateway tests and verify expected RED.
- [ ] **Step 3: Implement** canonical gateway method without changing existing generate methods.
- [ ] **Step 4: Run** all gateway and canonical/legacy tests, then API typecheck.
- [ ] **Step 5: Commit** `feat(ai): route canonical requests through gateway adapters`.

### Task 4: Provider adapter conformance suite

**Files:**
- Create: `apps/api/ai/providerConformance.test.ts`
- Modify: `apps/api/package.json`
- Modify: `docs/KVARD_AI_PROVIDER_ADAPTER_CONTRACT.md`
- Modify: `docs/KVARD_ADMIN_PANEL_CHECKLIST.md`

**Interfaces:**
- Add reusable test harness that runs the same canonical contract checks against a provider fixture implementing native generateRequest.
- Required assertions: provider/model identity, request cancellation, partial/missing usage semantics, capability rejection, safe error surface, deterministic content mapping.
- Keep network-free tests deterministic. Real provider sandbox checks remain a separate pre-production gate and are not simulated by CI.

- [ ] **Step 1: Write failing conformance tests** for native fixture and negative capability cases.
- [ ] **Step 2: Run** focused conformance tests and verify RED.
- [ ] **Step 3: Implement** the conformance harness and register test.
- [ ] **Step 4: Update** provider contract doc with implemented-vs-pending matrix; update checklist with exact statuses.
- [ ] **Step 5: Run** full API test suite and typecheck; run repo CI and inspect every job.
- [ ] **Step 6: Commit** `test(ai): add provider adapter conformance suite`.

## Completion Criteria

- Existing string Gateway behavior and tests remain unchanged.
- New canonical API is covered by RED→GREEN tests.
- Legacy adapters cannot silently claim unsupported tools/vision/streaming/JSON.
- Missing/partial usage is explicit and never falsified.
- API tests and typecheck pass.
- Latest GitHub Actions run for final main commit is completed successfully; canceled/in-progress runs are not counted.
- Checklist accurately distinguishes implemented contract foundation from provider features still pending.
