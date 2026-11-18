import { GoogleGenAI } from '@google/genai';
import {
  AiGatewayError,
  type AiGatewayRequest,
  type AiProvider,
} from '../provider.interface.ts';
import type {
  AiAdvisoryResponse,
  AiProviderHealth,
} from '../../../../shared/types/domain.ts';

export const DEFAULT_GEMINI_FREE_MODEL = 'gemini-3.1-flash-lite' as const;

/**
 * Trusted server-side free-tier eligibility policy.
 * Only models confirmed in Google's official Gemini API free tier belong here.
 * Environment overrides (AI_GEMINI_FREE_ALLOWLIST) may select a subset of this
 * trusted policy, never elevate unverified or paid-only models to free eligibility.
 */
export const VERIFIED_GEMINI_FREE_MODELS = [
  'gemini-3.1-flash-lite',
] as const;

export const VERIFIED_GEMINI_PAID_ONLY_MODELS = [
  'gemini-4-carbon',
  'gemini-4-argon',
  'gemini-3-pro-image',
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
  'gemini-omni-1.2-flash',
  'lyria-3-clip-preview',
  'lyria-3-pro-preview',
] as const;

const TRUSTED_FREE_TIER_MODELS = new Set<string>(VERIFIED_GEMINI_FREE_MODELS);

const PAID_ONLY_MODELS = new Set<string>(VERIFIED_GEMINI_PAID_ONLY_MODELS);

export interface GeminiAllowlistEvaluation {
  allowedFreeModels: readonly string[];
  rejectedUnverifiedModels: readonly string[];
  rejectedPaidModels: readonly string[];
}

export function evaluateGeminiFreeAllowlist(
  rawAllowlist = process.env.AI_GEMINI_FREE_ALLOWLIST,
  trustedFreeModels: readonly string[] = VERIFIED_GEMINI_FREE_MODELS
): GeminiAllowlistEvaluation {
  const trustedSet = new Set<string>(trustedFreeModels);
  const trimmed = rawAllowlist?.trim();
  if (!trimmed) {
    return {
      allowedFreeModels: [...trustedFreeModels],
      rejectedUnverifiedModels: [],
      rejectedPaidModels: [],
    };
  }

  const allowed: string[] = [];
  const rejectedUnverified: string[] = [];
  const rejectedPaid: string[] = [];

  for (const item of trimmed.split(',').map((m) => m.trim()).filter(Boolean)) {
    if (trustedSet.has(item)) {
      if (!allowed.includes(item)) allowed.push(item);
    } else if (PAID_ONLY_MODELS.has(item)) {
      if (!rejectedPaid.includes(item)) rejectedPaid.push(item);
    } else {
      if (!rejectedUnverified.includes(item)) rejectedUnverified.push(item);
    }
  }

  return {
    allowedFreeModels: allowed,
    rejectedUnverifiedModels: rejectedUnverified,
    rejectedPaidModels: rejectedPaid,
  };
}

export function resolveGeminiFreeAllowlist(
  rawAllowlist = process.env.AI_GEMINI_FREE_ALLOWLIST
): readonly string[] {
  return evaluateGeminiFreeAllowlist(rawAllowlist).allowedFreeModels;
}

export type GeminiModelClassification =
  | 'verified_free'
  | 'disabled_by_allowlist'
  | 'paid_only'
  | 'unverified';

export interface GeminiPolicySnapshot extends GeminiAllowlistEvaluation {
  configuredModel: string;
  configuredModelClassification: GeminiModelClassification;
}

export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: { systemInstruction?: string };
    }): Promise<{
      text?: string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    }>;
  };
}

export interface GeminiFreeProviderOptions {
  getApiKey?: () => string | undefined;
  getModel?: () => string;
  getAllowlist?: () => readonly string[];
  getRawAllowlist?: () => string | undefined;
  createClient?: (apiKey: string) => GeminiClientLike;
}

export class GeminiFreeProvider implements AiProvider {
  readonly id = 'gemini_free' as const;
  private readonly getApiKey: () => string | undefined;
  private readonly getModel: () => string;
  private readonly getAllowlistOverride?: () => readonly string[];
  private readonly getRawAllowlist: () => string | undefined;
  private readonly createClient: (apiKey: string) => GeminiClientLike;

  constructor(options: GeminiFreeProviderOptions = {}) {
    this.getApiKey = options.getApiKey ?? (() => process.env.GEMINI_API_KEY);
    this.getModel =
      options.getModel ??
      (() => process.env.AI_GEMINI_FREE_MODEL || DEFAULT_GEMINI_FREE_MODEL);
    this.getAllowlistOverride = options.getAllowlist;
    this.getRawAllowlist =
      options.getRawAllowlist ?? (() => process.env.AI_GEMINI_FREE_ALLOWLIST);
    this.createClient =
      options.createClient ??
      ((apiKey: string) =>
        new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        }));
  }

  getPolicySnapshot(): GeminiPolicySnapshot {
    const configuredModel = this.getModel().trim() || DEFAULT_GEMINI_FREE_MODEL;
    const evaluation = this.getAllowlistOverride
      ? evaluateGeminiFreeAllowlist(this.getAllowlistOverride().join(','))
      : evaluateGeminiFreeAllowlist(this.getRawAllowlist());

    let configuredModelClassification: GeminiModelClassification;
    if (PAID_ONLY_MODELS.has(configuredModel)) {
      configuredModelClassification = 'paid_only';
    } else if (!TRUSTED_FREE_TIER_MODELS.has(configuredModel)) {
      configuredModelClassification = 'unverified';
    } else if (!evaluation.allowedFreeModels.includes(configuredModel)) {
      configuredModelClassification = 'disabled_by_allowlist';
    } else {
      configuredModelClassification = 'verified_free';
    }

    return {
      configuredModel,
      configuredModelClassification,
      ...evaluation,
    };
  }

  getAllowlist(): readonly string[] {
    return this.getPolicySnapshot().allowedFreeModels;
  }

  private resolveValidKey(): string | null {
    const key = this.getApiKey()?.trim();
    if (!key || key === 'MY_GEMINI_API_KEY') {
      return null;
    }
    return key;
  }

  async getHealth(): Promise<AiProviderHealth> {
    const key = this.resolveValidKey();
    const policy = this.getPolicySnapshot();

    if (policy.configuredModelClassification === 'paid_only') {
      return {
        providerId: this.id,
        label: 'Gemini API (Free Tier)',
        tier: 'free_tier',
        configured: false,
        model: policy.configuredModel,
        note: `Model "${policy.configuredModel}" is a paid-only model and is blocked in Free Mode.`,
      };
    }

    if (policy.configuredModelClassification === 'unverified') {
      return {
        providerId: this.id,
        label: 'Gemini API (Free Tier)',
        tier: 'free_tier',
        configured: false,
        model: policy.configuredModel,
        note: `Model "${policy.configuredModel}" is unverified and blocked by the server free-tier policy. Verified free models: ${VERIFIED_GEMINI_FREE_MODELS.join(', ')}.`,
      };
    }

    if (policy.configuredModelClassification === 'disabled_by_allowlist') {
      return {
        providerId: this.id,
        label: 'Gemini API (Free Tier)',
        tier: 'free_tier',
        configured: false,
        model: policy.configuredModel,
        note: `Model "${policy.configuredModel}" is excluded by AI_GEMINI_FREE_ALLOWLIST.`,
      };
    }

    if (!key) {
      return {
        providerId: this.id,
        label: 'Gemini API (Free Tier)',
        tier: 'free_tier',
        configured: false,
        model: policy.configuredModel,
        note: 'Server-side GEMINI_API_KEY is not configured. Mock mode remains active; add a key via Secrets later to activate Gemini Free Tier.',
      };
    }

    return {
      providerId: this.id,
      label: 'Gemini API (Free Tier)',
      tier: 'free_tier',
      configured: true,
      model: policy.configuredModel,
      note: 'Server-side key detected. Uses verified free-tier Gemini model without enabling paid billing.',
    };
  }

  async generateAdvisory(request: AiGatewayRequest): Promise<AiAdvisoryResponse> {
    const started = Date.now();
    const key = this.resolveValidKey();
    if (!key) {
      throw new AiGatewayError(
        503,
        'AI_PROVIDER_NOT_CONFIGURED',
        'Gemini API Free Tier is not configured on the server.',
        'Configure GEMINI_API_KEY in server secrets or switch the AI gateway to Local Ollama or Mock Test mode.'
      );
    }

    const policy = this.getPolicySnapshot();
    const model = policy.configuredModel;

    if (policy.configuredModelClassification === 'paid_only') {
      throw new AiGatewayError(
        400,
        'AI_PAID_MODEL_BLOCKED_IN_FREE_MODE',
        `Model "${model}" is a paid-only model and cannot be invoked under the free-tier provider.`,
        `Set AI_GEMINI_FREE_MODEL to a verified free model (${VERIFIED_GEMINI_FREE_MODELS.join(', ')}).`
      );
    }

    if (policy.configuredModelClassification === 'unverified') {
      throw new AiGatewayError(
        400,
        'AI_UNVERIFIED_MODEL_BLOCKED',
        `Model "${model}" is not in the trusted server-side free-tier model policy and cannot be elevated via environment variables.`,
        `Set AI_GEMINI_FREE_MODEL to a verified free model (${VERIFIED_GEMINI_FREE_MODELS.join(', ')}).`
      );
    }

    if (policy.configuredModelClassification === 'disabled_by_allowlist') {
      throw new AiGatewayError(
        400,
        'AI_MODEL_EXCLUDED_BY_ALLOWLIST',
        `Model "${model}" is not enabled in AI_GEMINI_FREE_ALLOWLIST.`,
        `Enable "${model}" in AI_GEMINI_FREE_ALLOWLIST or select one of: ${policy.allowedFreeModels.join(', ') || 'none'}.`
      );
    }

    const langName =
      request.context.preferredLanguage === 'lg'
        ? 'Luganda'
        : request.context.preferredLanguage === 'sw'
          ? 'Swahili'
          : 'English';

    const systemInstruction = [
      'You are the FIELD FUSSION agricultural advisory assistant for Uganda and East Africa.',
      `Respond clearly in ${langName}.`,
      `Regional context: country=${request.context.country}, district=${request.context.district ?? 'unspecified'}, areaUnit=${request.context.preferredAreaUnit}, role=${request.context.activeRole ?? 'farmer'}.`,
      request.context.organisationScope
        ? `Organisation context: type=${request.context.organisationScope.orgType}, district=${request.context.organisationScope.district ?? 'unspecified'}.`
        : '',
      'Rules: You are strictly advisory. Never claim to execute orders, payments, or farm record edits. Clearly state agronomic uncertainty when local soil or weather data is absent.',
    ]
      .filter(Boolean)
      .join(' ');

    try {
      const client = this.createClient(key);
      const response = await client.models.generateContent({
        model,
        contents: request.prompt,
        config: { systemInstruction },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new AiGatewayError(
          502,
          'AI_EMPTY_RESPONSE',
          'Gemini returned an empty response.'
        );
      }

      return {
        requestId: request.requestId,
        providerId: this.id,
        model,
        isSimulated: false,
        responseSource: 'real_ai_model',
        advisoryText: text,
        uncertaintyNote:
          'Advisory guidance only — verify against local extension advice and actual farm conditions before acting.',
        requiresApproval: Boolean(request.includeDraftSuggestion),
        privacyNotice:
          'Minimized context only (district, language, unit, role). No personal email, phone, or financial records were transmitted.',
        usage: {
          latencyMs: Date.now() - started,
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (error) {
      if (error instanceof AiGatewayError) {
        throw error;
      }

      const rawMessage = error instanceof Error ? error.message : String(error);
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: number }).status)
          : undefined;

      if (
        status === 429 ||
        rawMessage.includes('RESOURCE_EXHAUSTED') ||
        rawMessage.toLowerCase().includes('rate limit') ||
        rawMessage.toLowerCase().includes('quota')
      ) {
        throw new AiGatewayError(
          429,
          'AI_RATE_LIMITED',
          'Gemini API free-tier rate limit or daily quota reached.',
          'Wait a moment and retry, or switch to Local Ollama or Mock Test mode for development.'
        );
      }

      if (
        status === 401 ||
        status === 403 ||
        rawMessage.includes('API_KEY_INVALID') ||
        rawMessage.includes('PERMISSION_DENIED')
      ) {
        throw new AiGatewayError(
          502,
          'AI_CREDENTIALS_REJECTED',
          'Server Gemini API key was rejected by the upstream provider.',
          'Verify GEMINI_API_KEY in server secrets without enabling paid billing.'
        );
      }

      throw new AiGatewayError(
        502,
        'AI_UPSTREAM_ERROR',
        'Gemini Free Tier request could not be completed.',
        'Retry shortly or switch to an alternative provider.'
      );
    }
  }
}
