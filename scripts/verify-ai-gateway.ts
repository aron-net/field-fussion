import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp } from '../src/server/app.ts';
import { AiGatewayError } from '../src/server/modules/ai-gateway/provider.interface.ts';
import { AiGatewayService } from '../src/server/modules/ai-gateway/ai-gateway.service.ts';
import {
  DEFAULT_GEMINI_FREE_MODEL,
  GeminiFreeProvider,
  VERIFIED_GEMINI_FREE_MODELS,
  VERIFIED_GEMINI_PAID_ONLY_MODELS,
  evaluateGeminiFreeAllowlist,
} from '../src/server/modules/ai-gateway/providers/gemini-free.provider.ts';
import { OllamaLocalProvider } from '../src/server/modules/ai-gateway/providers/ollama-local.provider.ts';
import { MockAiProvider } from '../src/server/modules/ai-gateway/providers/mock.provider.ts';
import type { FieldFussionAuthContext } from '../src/server/middleware/auth.guard.ts';

function createSampleAuthContext(): FieldFussionAuthContext {
  return {
    firebaseToken: { uid: 'fb-uid-secret-123' } as FieldFussionAuthContext['firebaseToken'],
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      firebaseUid: 'fb-uid-secret-123',
      email: 'private-farmer@example.org',
      phone: '+256772999888',
      fullName: 'Secret Farmer Name',
      district: 'Lira',
      country: 'UG',
      currency: 'UGX',
      preferredLanguage: 'lg',
      preferredAreaUnit: 'acres',
      timezone: 'Africa/Kampala',
      onboardingCompleted: true,
      researchOptIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    roles: [
      {
        id: 'role-1',
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'farmer',
        status: 'active',
        activatedAt: new Date().toISOString(),
        grantedByUserId: null,
      },
    ],
    organisations: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Lira Growers Co-op',
        orgType: 'cooperative',
        country: 'UG',
        district: 'Lira',
        registrationNumber: null,
        verificationStatus: 'unverified',
        createdByUserId: '11111111-1111-4111-8111-111111111111',
        createdAt: new Date().toISOString(),
        membershipRole: 'member',
        membershipStatus: 'active',
      },
    ],
  };
}

async function runTests() {
  const ctx = createSampleAuthContext();

  // 1. Mock AI Provider + PII stripping + Confirmation Gate + Safe Logs
  const gateway = new AiGatewayService({
    initialProvider: 'mock',
    providers: { mock: new MockAiProvider() },
  });

  const secretPrompt = 'Should I plant Longe 5 maize in Lira this week?';
  const mockRes = await gateway.generateAdvisory({
    authContext: ctx,
    prompt: secretPrompt,
    organisationId: '22222222-2222-4222-8222-222222222222',
    includeDraftSuggestion: true,
  });

  assert.equal(mockRes.providerId, 'mock');
  assert.equal(mockRes.isSimulated, true);
  assert.equal(mockRes.responseSource, 'simulated');
  assert.ok(mockRes.simulatedNotice && mockRes.simulatedNotice.toLowerCase().includes('simulated'));
  assert.equal(mockRes.requiresApproval, true);
  assert.ok(mockRes.proposedDraft?.draftId);
  assert.equal(mockRes.proposedDraft?.status, 'pending_confirmation');

  // Wrong user cannot confirm draft
  await assert.rejects(
    async () =>
      gateway.resolveDraft({
        draftId: mockRes.proposedDraft!.draftId,
        userId: '99999999-9999-4999-8999-999999999999',
        decision: 'confirm',
      }),
    (err: unknown) => err instanceof AiGatewayError && err.status === 403
  );

  // Owning user confirms draft
  const confirmed = gateway.resolveDraft({
    draftId: mockRes.proposedDraft!.draftId,
    userId: ctx.user.id,
    decision: 'confirm',
  });
  assert.equal(confirmed.status, 'confirmed');

  // Unauthorized organisation context rejected with 403
  await assert.rejects(
    () =>
      gateway.generateAdvisory({
        authContext: ctx,
        prompt: 'Check org data',
        organisationId: '33333333-3333-4333-8333-333333333333',
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 403 &&
      err.code === 'FORBIDDEN_ORG_ACCESS'
  );

  // Logs must never retain prompt text or PII; status must classify models & simulation accurately
  const statusSnapshot = await gateway.getStatus(false);
  assert.equal(statusSnapshot.phase, 'free_development_mode');
  assert.deepEqual([...statusSnapshot.verifiedFreeGeminiModels], ['gemini-3.1-flash-lite']);
  assert.deepEqual([...statusSnapshot.modelPolicy.verifiedFreeModels], ['gemini-3.1-flash-lite']);
  assert.deepEqual(statusSnapshot.modelPolicy.unverifiedModels, []);
  assert.deepEqual([...statusSnapshot.modelPolicy.paidOnlyModels], [...VERIFIED_GEMINI_PAID_ONLY_MODELS]);
  assert.equal(statusSnapshot.simulationStatus.isSimulatedMode, true);
  assert.equal(statusSnapshot.simulationStatus.responseMode, 'simulated');
  const serializedLogs = JSON.stringify(statusSnapshot.recentLogs);
  assert.equal(serializedLogs.includes('Longe 5'), false, 'Prompt text must never be logged');
  assert.equal(serializedLogs.includes('private-farmer@example.org'), false, 'PII must never be logged');
  console.log('✓ Test 1: Mock provider, simulated marker, model classification, PII minimization, org RBAC & safe logs passed');

  // 2. Gemini Free Provider: missing key, paid model blocked, rate limit (429), and valid mocked SDK call
  const missingKeyGemini = new GeminiFreeProvider({
    getApiKey: () => undefined,
  });
  const missingHealth = await missingKeyGemini.getHealth();
  assert.equal(missingHealth.configured, false);
  await assert.rejects(
    () =>
      missingKeyGemini.generateAdvisory({
        requestId: 'req-1',
        prompt: 'Maize advice',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 503 &&
      err.code === 'AI_PROVIDER_NOT_CONFIGURED'
  );

  const paidModelBlockedGemini = new GeminiFreeProvider({
    getApiKey: () => 'fake-test-key-never-exposed',
    getModel: () => 'gemini-4-argon',
  });
  await assert.rejects(
    () =>
      paidModelBlockedGemini.generateAdvisory({
        requestId: 'req-2',
        prompt: 'Maize advice',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 400 &&
      err.code === 'AI_PAID_MODEL_BLOCKED_IN_FREE_MODE'
  );

  assert.equal(DEFAULT_GEMINI_FREE_MODEL, 'gemini-3.1-flash-lite');
  assert.deepEqual([...VERIFIED_GEMINI_FREE_MODELS], ['gemini-3.1-flash-lite']);

  const rateLimitedGemini = new GeminiFreeProvider({
    getApiKey: () => 'fake-test-key-never-exposed',
    getModel: () => 'gemini-3.1-flash-lite',
    createClient: () => ({
      models: {
        async generateContent() {
          const e = new Error('RESOURCE_EXHAUSTED: quota exceeded') as Error & { status?: number };
          e.status = 429;
          throw e;
        },
      },
    }),
  });
  await assert.rejects(
    () =>
      rateLimitedGemini.generateAdvisory({
        requestId: 'req-3',
        prompt: 'Maize advice',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 429 &&
      err.code === 'AI_RATE_LIMITED'
  );

  let capturedSystemInstruction = '';
  const workingGemini = new GeminiFreeProvider({
    getApiKey: () => 'super-secret-gemini-key-xyz',
    getModel: () => 'gemini-3.1-flash-lite',
    createClient: () => ({
      models: {
        async generateContent(params) {
          capturedSystemInstruction = params.config?.systemInstruction ?? '';
          return {
            text: 'Check topsoil moisture at 10cm depth before sowing.',
            usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 15 },
          };
        },
      },
    }),
  });
  const geminiRes = await workingGemini.generateAdvisory({
    requestId: 'req-4',
    prompt: 'When to sow beans?',
    context: gateway.sanitizeContext(ctx),
  });
  assert.equal(geminiRes.providerId, 'gemini_free');
  assert.equal(geminiRes.model, 'gemini-3.1-flash-lite');
  assert.equal(geminiRes.isSimulated, false);
  assert.equal(geminiRes.responseSource, 'real_ai_model');
  assert.equal(geminiRes.simulatedNotice, undefined);
  assert.equal(capturedSystemInstruction.includes('private-farmer@example.org'), false);
  assert.equal(capturedSystemInstruction.includes('+256772999888'), false);
  assert.equal(capturedSystemInstruction.includes('Secret Farmer Name'), false);

  // Unverified or deprecated model IDs (including gemini-4-hydrogen) must be blocked as AI_UNVERIFIED_MODEL_BLOCKED
  for (const unverifiedModel of [
    'gemini-4-hydrogen',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'unverified-model-id',
  ]) {
    const unverifiedGemini = new GeminiFreeProvider({
      getApiKey: () => 'fake-test-key-never-exposed',
      getModel: () => unverifiedModel,
    });
    await assert.rejects(
      () =>
        unverifiedGemini.generateAdvisory({
          requestId: `req-unverified-${unverifiedModel}`,
          prompt: 'Maize advice',
          context: gateway.sanitizeContext(ctx),
        }),
      (err: unknown) =>
        err instanceof AiGatewayError &&
        err.status === 400 &&
        err.code === 'AI_UNVERIFIED_MODEL_BLOCKED'
    );
  }

  // Env allowlist (AI_GEMINI_FREE_ALLOWLIST) CANNOT elevate unverified or paid-only models
  // beyond the trusted server-side policy.
  const evaluated = evaluateGeminiFreeAllowlist(
    'gemini-3.1-flash-lite, gemini-4-hydrogen, gemini-4-argon, custom-unverified'
  );
  assert.deepEqual(evaluated.allowedFreeModels, ['gemini-3.1-flash-lite']);
  assert.deepEqual(evaluated.rejectedUnverifiedModels, [
    'gemini-4-hydrogen',
    'custom-unverified',
  ]);
  assert.deepEqual(evaluated.rejectedPaidModels, ['gemini-4-argon']);

  const bypassAttemptGemini = new GeminiFreeProvider({
    getApiKey: () => 'fake-test-key-never-exposed',
    getModel: () => 'custom-unverified',
    getRawAllowlist: () => 'gemini-3.1-flash-lite, gemini-4-hydrogen, custom-unverified',
  });
  await assert.rejects(
    () =>
      bypassAttemptGemini.generateAdvisory({
        requestId: 'req-bypass-attempt',
        prompt: 'Bean storage tips',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 400 &&
      err.code === 'AI_UNVERIFIED_MODEL_BLOCKED'
  );

  const policyCheckGateway = new AiGatewayService({
    initialProvider: 'mock',
    providers: { gemini_free: bypassAttemptGemini },
  });
  const policyStatus = await policyCheckGateway.getStatus(false);
  assert.deepEqual([...policyStatus.modelPolicy.verifiedFreeModels], ['gemini-3.1-flash-lite']);
  assert.deepEqual(policyStatus.modelPolicy.unverifiedModels, [
    'gemini-4-hydrogen',
    'custom-unverified',
  ]);
  assert.equal(policyStatus.simulationStatus.isSimulatedMode, true);
  console.log('✓ Test 2: Gemini Free Tier (gemini-3.1-flash-lite default), unverified/paid model blocks, non-bypassable policy & PII-free SDK invocation passed');

  // 3. Ollama Local Provider: unreachable, cloud localhost block, 404 model missing, and valid HTTP response
  const cloudLocalhostOllama = new OllamaLocalProvider({
    getBaseUrl: () => 'http://127.0.0.1:11434',
    isDeployedRuntime: () => true,
  });
  const cloudHealth = await cloudLocalhostOllama.getHealth(true);
  assert.equal(cloudHealth.configured, false);
  await assert.rejects(
    () =>
      cloudLocalhostOllama.generateAdvisory({
        requestId: 'req-5',
        prompt: 'Coffee pruning tips',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 503 &&
      err.code === 'AI_OLLAMA_LOCALHOST_IN_CLOUD'
  );

  const unreachableOllama = new OllamaLocalProvider({
    isDeployedRuntime: () => false,
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    },
  });
  await assert.rejects(
    () =>
      unreachableOllama.generateAdvisory({
        requestId: 'req-6',
        prompt: 'Coffee pruning tips',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 503 &&
      err.code === 'AI_OLLAMA_UNREACHABLE'
  );

  const missingModelOllama = new OllamaLocalProvider({
    isDeployedRuntime: () => false,
    getModel: () => 'nonexistent-model',
    fetchImpl: async () => new Response('model not found', { status: 404 }),
  });
  await assert.rejects(
    () =>
      missingModelOllama.generateAdvisory({
        requestId: 'req-7',
        prompt: 'Coffee pruning tips',
        context: gateway.sanitizeContext(ctx),
      }),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 404 &&
      err.code === 'AI_OLLAMA_MODEL_NOT_FOUND'
  );

  const workingOllama = new OllamaLocalProvider({
    isDeployedRuntime: () => false,
    getModel: () => 'llama3.2',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: { content: 'Prune suckers after main harvest in Lira.' },
          prompt_eval_count: 18,
          eval_count: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
  });
  const ollamaRes = await workingOllama.generateAdvisory({
    requestId: 'req-8',
    prompt: 'Coffee pruning tips',
    context: gateway.sanitizeContext(ctx),
  });
  assert.equal(ollamaRes.providerId, 'ollama_local');
  assert.equal(ollamaRes.model, 'llama3.2');
  console.log('✓ Test 3: Local Ollama cloud-guard, ECONNREFUSED, 404 model error & valid HTTP response passed');

  // 4. Provider switching & paid provider gate + secret redaction check
  const switchGateway = new AiGatewayService({
    initialProvider: 'mock',
    providers: {
      gemini_free: workingGemini,
      ollama_local: workingOllama,
      mock: new MockAiProvider(),
    },
  });

  switchGateway.switchProvider('gemini_free');
  const switched1 = await switchGateway.generateAdvisory({
    authContext: ctx,
    prompt: 'Bean spacing',
  });
  assert.equal(switched1.providerId, 'gemini_free');

  switchGateway.switchProvider('ollama_local');
  const switched2 = await switchGateway.generateAdvisory({
    authContext: ctx,
    prompt: 'Coffee spacing',
  });
  assert.equal(switched2.providerId, 'ollama_local');

  assert.throws(
    () => switchGateway.switchProvider('gemini_paid'),
    (err: unknown) =>
      err instanceof AiGatewayError &&
      err.status === 403 &&
      err.code === 'AI_PAID_PROVIDER_DISABLED'
  );

  const statusJson = JSON.stringify(await switchGateway.getStatus(false));
  assert.equal(
    statusJson.includes('super-secret-gemini-key-xyz'),
    false,
    'Server API key must never appear in AI gateway status payload'
  );
  console.log('✓ Test 4: Provider switching, paid-tier gate & server-side secret protection passed');

  // 5. Express HTTP auth protection on new AI gateway endpoints
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    for (const ep of [
      { method: 'GET', path: '/api/v1/ai/status' },
      { method: 'POST', path: '/api/v1/ai/provider', body: { providerId: 'mock' } },
      { method: 'POST', path: '/api/v1/ai/advisory', body: { prompt: 'Test prompt' } },
      { method: 'POST', path: '/api/v1/ai/confirmations/draft-1', body: { decision: 'confirm' } },
    ]) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assert.equal(res.status, 401, `${ep.method} ${ep.path} must require auth`);
    }
    console.log('✓ Test 5: HTTP AI gateway endpoints enforce 401 authentication');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }

  console.log('\nAll 5 AI Gateway verification suites passed.');
}

runTests().catch((err) => {
  console.error('AI Gateway verification failed:', err);
  process.exit(1);
});
