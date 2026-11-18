import type {
  AiAdvisoryResponse,
  AiProviderHealth,
  AiProviderId,
  AreaUnit,
  BusinessRole,
  OrganisationType,
  SupportedLanguage,
} from '../../../shared/types/domain.ts';

/**
 * Strictly minimized context sent to AI providers.
 * Never includes email, phone, fullName, firebaseUid, IP address, or financial records.
 */
export interface SanitizedFarmContext {
  country: string;
  district: string | null;
  preferredLanguage: SupportedLanguage;
  preferredAreaUnit: AreaUnit;
  activeRole: BusinessRole | null;
  researchOptIn: boolean;
  organisationScope?: {
    orgType: OrganisationType;
    district: string | null;
  };
}

export interface AiGatewayRequest {
  requestId: string;
  prompt: string;
  context: SanitizedFarmContext;
  includeDraftSuggestion?: boolean;
}

export class AiGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly recoveryAction?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    recoveryAction?: string
  ) {
    super(message);
    this.name = 'AiGatewayError';
    this.status = status;
    this.code = code;
    this.recoveryAction = recoveryAction;
  }
}

export interface AiProvider {
  readonly id: AiProviderId;
  getHealth(checkReachability?: boolean): Promise<AiProviderHealth>;
  generateAdvisory(request: AiGatewayRequest): Promise<AiAdvisoryResponse>;
}
