import crypto from 'node:crypto';
import type {
  AiAdvisoryResponse,
  AiGatewayLogEntry,
  AiGatewayStatus,
  AiProposedDraft,
  AiProviderId,
} from '../../../shared/types/domain.ts';
import type { FieldFussionAuthContext } from '../../middleware/auth.guard.ts';
import {
  AiGatewayError,
  type AiProvider,
  type SanitizedFarmContext,
} from './provider.interface.ts';
import {
  DEFAULT_GEMINI_FREE_MODEL,
  GeminiFreeProvider,
  VERIFIED_GEMINI_PAID_ONLY_MODELS,
  evaluateGeminiFreeAllowlist,
} from './providers/gemini-free.provider.ts';
import { OllamaLocalProvider } from './providers/ollama-local.provider.ts';
import { MockAiProvider } from './providers/mock.provider.ts';
import { GeminiPaidProvider } from './providers/gemini-paid.provider.ts';

interface StoredDraft {
  draft: AiProposedDraft;
  userId: string;
  organisationId?: string;
  createdAt: number;
}

export interface AiGatewayServiceOptions {
  providers?: Partial<Record<AiProviderId, AiProvider>>;
  initialProvider?: AiProviderId;
}

function resolveInitialProvider(): AiProviderId {
  const configured = process.env.AI_PROVIDER?.trim() as AiProviderId | undefined;
  if (
    configured === 'gemini_free' ||
    configured === 'ollama_local' ||
    configured === 'mock' ||
    configured === 'gemini_paid'
  ) {
    if (configured === 'gemini_paid' && process.env.AI_PAID_ENABLED !== 'true') {
      return 'mock';
    }
    return configured;
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (key && key !== 'MY_GEMINI_API_KEY') {
    return 'gemini_free';
  }
  return 'mock';
}

export class AiGatewayService {
  private readonly providers: Record<AiProviderId, AiProvider>;
  private activeProviderId: AiProviderId;
  private readonly logs: AiGatewayLogEntry[] = [];
  private readonly drafts = new Map<string, StoredDraft>();

  constructor(options: AiGatewayServiceOptions = {}) {
    this.providers = {
      gemini_free: options.providers?.gemini_free ?? new GeminiFreeProvider(),
      ollama_local: options.providers?.ollama_local ?? new OllamaLocalProvider(),
      mock: options.providers?.mock ?? new MockAiProvider(),
      gemini_paid: options.providers?.gemini_paid ?? new GeminiPaidProvider(),
    };
    this.activeProviderId = options.initialProvider ?? resolveInitialProvider();
  }

  getActiveProviderId(): AiProviderId {
    return this.activeProviderId;
  }

  switchProvider(providerId: AiProviderId): void {
    if (providerId === 'gemini_paid' && process.env.AI_PAID_ENABLED !== 'true') {
      throw new AiGatewayError(
        403,
        'AI_PAID_PROVIDER_DISABLED',
        'Paid AI providers cannot be activated in Free Development Mode.',
        'Use gemini_free, ollama_local, or mock.'
      );
    }
    if (!this.providers[providerId]) {
      throw new AiGatewayError(400, 'AI_UNKNOWN_PROVIDER', `Unknown provider: ${providerId}`);
    }
    this.activeProviderId = providerId;
  }

  private recordLog(entry: AiGatewayLogEntry) {
    this.logs.unshift(entry);
    if (this.logs.length > 50) {
      this.logs.length = 50;
    }
  }

  getLogs(): AiGatewayLogEntry[] {
    return [...this.logs];
  }

  /**
   * Enforces organisation membership before pulling org metadata and strips all PII.
   */
  sanitizeContext(
    authContext: FieldFussionAuthContext,
    organisationId?: string
  ): SanitizedFarmContext {
    let organisationScope: SanitizedFarmContext['organisationScope'];

    if (organisationId) {
      const membership = authContext.organisations.find(
        (org) => org.id === organisationId && org.membershipStatus === 'active'
      );
      if (!membership) {
        throw new AiGatewayError(
          403,
          'FORBIDDEN_ORG_ACCESS',
          'You do not have permission to retrieve context for this organisation.'
        );
      }
      organisationScope = {
        orgType: membership.orgType,
        district: membership.district,
      };
    }

    const activeRole =
      authContext.roles.find((r) => r.status === 'active')?.role ?? null;

    return {
      country: authContext.user.country,
      district: authContext.user.district,
      preferredLanguage: authContext.user.preferredLanguage,
      preferredAreaUnit: authContext.user.preferredAreaUnit,
      activeRole,
      researchOptIn: authContext.user.researchOptIn,
      ...(organisationScope ? { organisationScope } : {}),
    };
  }

  async getStatus(checkReachability = false): Promise<AiGatewayStatus> {
    const providerHealth = await Promise.all([
      this.providers.gemini_free.getHealth(checkReachability),
      this.providers.ollama_local.getHealth(checkReachability),
      this.providers.mock.getHealth(checkReachability),
      this.providers.gemini_paid.getHealth(checkReachability),
    ]);

    const activeHealth =
      providerHealth.find((p) => p.providerId === this.activeProviderId) ??
      providerHealth[2];

    const paidEnabled = process.env.AI_PAID_ENABLED === 'true';

    const geminiFreeProvider = this.providers.gemini_free;
    const policySnapshot =
      geminiFreeProvider instanceof GeminiFreeProvider
        ? geminiFreeProvider.getPolicySnapshot()
        : {
            configuredModel:
              process.env.AI_GEMINI_FREE_MODEL || DEFAULT_GEMINI_FREE_MODEL,
            configuredModelClassification: 'verified_free' as const,
            ...evaluateGeminiFreeAllowlist(),
          };

    const unverifiedModels = Array.from(
      new Set([
        ...policySnapshot.rejectedUnverifiedModels,
        ...(policySnapshot.configuredModelClassification === 'unverified'
          ? [policySnapshot.configuredModel]
          : []),
      ])
    );

    const paidOnlyModels = Array.from(
      new Set([
        ...VERIFIED_GEMINI_PAID_ONLY_MODELS,
        ...policySnapshot.rejectedPaidModels,
        ...(policySnapshot.configuredModelClassification === 'paid_only'
          ? [policySnapshot.configuredModel]
          : []),
      ])
    );

    const isSimulatedMode = this.activeProviderId === 'mock';

    return {
      phase: paidEnabled ? 'paid_enabled' : 'free_development_mode',
      activeProvider: this.activeProviderId,
      providers: providerHealth,
      verifiedFreeGeminiModels: policySnapshot.allowedFreeModels,
      modelPolicy: {
        verifiedFreeModels: policySnapshot.allowedFreeModels,
        unverifiedModels,
        paidOnlyModels,
      },
      simulationStatus: {
        isSimulatedMode,
        responseMode: isSimulatedMode ? 'simulated' : 'real_ai_model',
        description: isSimulatedMode
          ? 'Responses are simulated by MockAiProvider (not generated by a real AI model).'
          : `Responses are routed to live provider (${this.activeProviderId}).`,
      },
      activeModels: {
        conversational: activeHealth.model,
        vision: isSimulatedMode
          ? 'field-fussion-mock-v1'
          : policySnapshot.configuredModel,
        speechTranscribe: process.env.AI_MODEL_TRANSCRIBE || 'gemini-3.5-transcribe',
        tts: process.env.AI_MODEL_TTS || 'gemini-3.8-flash-lite-tts',
      },
      safetyRules: {
        advisoryOnly: true,
        requiresHumanApproval: true,
        researchOptInSeparated: true,
        knowledgePublicationAdminControlled: true,
        piiStrippedBeforeExternalCalls: true,
      },
      recentLogs: this.getLogs(),
    };
  }

  async generateAdvisory(params: {
    authContext: FieldFussionAuthContext;
    prompt: string;
    organisationId?: string;
    includeDraftSuggestion?: boolean;
  }): Promise<AiAdvisoryResponse> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const provider = this.providers[this.activeProviderId];
    const health = await provider.getHealth(false);
    const context = this.sanitizeContext(params.authContext, params.organisationId);

    try {
      const response = await provider.generateAdvisory({
        requestId,
        prompt: params.prompt,
        context,
        includeDraftSuggestion: params.includeDraftSuggestion,
      });

      if (params.includeDraftSuggestion) {
        const draftId = crypto.randomUUID();
        const draft: AiProposedDraft = {
          draftId,
          actionType: 'advisory_note',
          summary: `Draft advisory plan for ${context.district ?? 'Uganda'} (${context.preferredAreaUnit}) awaiting user confirmation.`,
          status: 'pending_confirmation',
        };
        this.drafts.set(draftId, {
          draft,
          userId: params.authContext.user.id,
          organisationId: params.organisationId,
          createdAt: Date.now(),
        });
        response.proposedDraft = draft;
        response.requiresApproval = true;
      }

      this.recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        providerId: this.activeProviderId,
        model: response.model,
        status: 'success',
        latencyMs: response.usage.latencyMs,
        promptCharCount: params.prompt.length,
      });

      return response;
    } catch (error) {
      const gwErr =
        error instanceof AiGatewayError
          ? error
          : new AiGatewayError(502, 'AI_GATEWAY_FAILURE', 'AI request failed.');

      const statusCategory: AiGatewayLogEntry['status'] =
        gwErr.code === 'AI_RATE_LIMITED'
          ? 'rate_limited'
          : gwErr.code === 'AI_PROVIDER_NOT_CONFIGURED'
            ? 'unconfigured'
            : gwErr.code === 'AI_OLLAMA_UNREACHABLE' ||
                gwErr.code === 'AI_OLLAMA_LOCALHOST_IN_CLOUD'
              ? 'unreachable'
              : gwErr.code === 'AI_PAID_PROVIDER_DISABLED' ||
                  gwErr.code === 'AI_PAID_MODEL_BLOCKED_IN_FREE_MODE'
                ? 'blocked'
                : 'error';

      this.recordLog({
        id: requestId,
        timestamp: new Date().toISOString(),
        providerId: this.activeProviderId,
        model: health.model,
        status: statusCategory,
        latencyMs: Date.now() - started,
        promptCharCount: params.prompt.length,
        errorCode: gwErr.code,
      });

      throw gwErr;
    }
  }

  resolveDraft(params: {
    draftId: string;
    userId: string;
    decision: 'confirm' | 'dismiss';
  }): { draftId: string; status: 'confirmed' | 'dismissed'; organisationId?: string } {
    const stored = this.drafts.get(params.draftId);
    if (!stored) {
      throw new AiGatewayError(404, 'AI_DRAFT_NOT_FOUND', 'Advisory draft not found.');
    }
    if (stored.userId !== params.userId) {
      throw new AiGatewayError(
        403,
        'FORBIDDEN_DRAFT_ACCESS',
        'You cannot approve or dismiss another user’s advisory draft.'
      );
    }

    const nextStatus = params.decision === 'confirm' ? 'confirmed' : 'dismissed';
    stored.draft.status = nextStatus;

    return {
      draftId: params.draftId,
      status: nextStatus,
      organisationId: stored.organisationId,
    };
  }
}

export const defaultAiGatewayService = new AiGatewayService();
