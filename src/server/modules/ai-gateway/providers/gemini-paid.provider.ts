import {
  AiGatewayError,
  type AiGatewayRequest,
  type AiProvider,
} from '../provider.interface.ts';
import type {
  AiAdvisoryResponse,
  AiProviderHealth,
} from '../../../../shared/types/domain.ts';

/**
 * Future migration adapter for paid Gemini models (e.g., gemini-4-argon,
 * image generation, or high-volume paid billing). Remains strictly disabled
 * unless AI_PAID_ENABLED === 'true' and paid server credentials are supplied.
 */
export class GeminiPaidProvider implements AiProvider {
  readonly id = 'gemini_paid' as const;

  private isPaidEnabled(): boolean {
    return process.env.AI_PAID_ENABLED === 'true';
  }

  async getHealth(): Promise<AiProviderHealth> {
    const enabled = this.isPaidEnabled();
    return {
      providerId: this.id,
      label: 'Gemini API (Paid Tier — Future Migration)',
      tier: enabled ? 'paid_enabled' : 'paid_disabled',
      configured: enabled,
      model: process.env.AI_GEMINI_PAID_MODEL || 'gemini-4-argon',
      note: enabled
        ? 'Paid Gemini tier explicitly enabled via server configuration.'
        : 'Disabled in Free Development Mode. Activate later via server-side configuration only.',
    };
  }

  async generateAdvisory(_request: AiGatewayRequest): Promise<AiAdvisoryResponse> {
    if (!this.isPaidEnabled()) {
      throw new AiGatewayError(
        403,
        'AI_PAID_PROVIDER_DISABLED',
        'Paid AI providers are disabled during Free Development Mode.',
        'Use Gemini API Free Tier, Local Ollama, or Mock Test mode.'
      );
    }

    throw new AiGatewayError(
      501,
      'AI_PAID_PROVIDER_NOT_MIGRATED',
      'Paid Gemini provider migration is intentionally deferred until paid activation is approved.'
    );
  }
}
