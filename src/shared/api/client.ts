import type {
  AiAdvisoryResponse,
  AiGatewayStatus,
  AiProviderId,
  ApiEnvelope,
  ApiErrorEnvelope,
  AuditLogRecord,
  AuthSessionPayload,
  BusinessRole,
  FarmAccessGrantRecord,
  FarmBoundaryRevisionRecord,
  FarmDetailPayload,
  FarmRecord,
  LocationSearchResult,
  MappingRuntimeConfig,
  OrganisationInvitationRecord,
  OrganisationMemberRecord,
  OrganisationSummary,
  UserProfile,
  UserRoleRecord,
} from '../types/domain.ts';
import type {
  AiAdvisoryRequestInput,
  CreateFarmInput,
  CreateFarmPermissionInput,
  CreateOrganisationInput,
  InviteMemberInput,
  RegisterProfileSyncInput,
  UpdateFarmBoundaryInput,
  UpdateFarmInput,
  UpdateMemberInput,
  UpdateProfileInput,
} from '../validation/schemas.ts';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly recoveryAction?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    recoveryAction?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.recoveryAction = recoveryAction;
    this.details = details;
  }
}

export type TokenProvider = () => Promise<string | null>;

export class FieldFussionApiClient {
  private readonly baseUrl: string;
  private readonly getToken: TokenProvider;

  constructor(baseUrl: string, getToken: TokenProvider) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const body = (await response.json().catch(() => null)) as
      | ApiEnvelope<T>
      | ApiErrorEnvelope
      | null;

    if (!response.ok) {
      const err = body && 'error' in body ? body.error : null;
      throw new ApiClientError(
        response.status,
        err?.code ?? 'REQUEST_FAILED',
        err?.message ?? `Request failed with status ${response.status}`,
        err?.recoveryAction,
        err?.details
      );
    }

    if (!body || !('data' in body)) {
      throw new ApiClientError(response.status, 'INVALID_RESPONSE', 'Unexpected API response format');
    }

    return body;
  }

  getAuthSession() {
    return this.request<AuthSessionPayload>('/api/v1/auth/me');
  }

  syncRegistrationProfile(payload: RegisterProfileSyncInput) {
    return this.request<UserProfile>('/api/v1/auth/register-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateMyProfile(payload: UpdateProfileInput) {
    return this.request<UserProfile>('/api/v1/users/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  activateRole(role: BusinessRole) {
    return this.request<UserRoleRecord>('/api/v1/users/me/roles', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  deactivateRole(role: BusinessRole) {
    return this.request<{ role: BusinessRole; removed: boolean }>(
      `/api/v1/users/me/roles/${encodeURIComponent(role)}`,
      { method: 'DELETE' }
    );
  }

  listOrganisations() {
    return this.request<OrganisationSummary[]>('/api/v1/organisations');
  }

  createOrganisation(payload: CreateOrganisationInput) {
    return this.request<OrganisationSummary>('/api/v1/organisations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  listOrganisationMembers(orgId: string) {
    return this.request<{
      members: OrganisationMemberRecord[];
      invitations: OrganisationInvitationRecord[];
    }>(`/api/v1/organisations/${encodeURIComponent(orgId)}/members`);
  }

  inviteOrganisationMember(orgId: string, payload: InviteMemberInput) {
    return this.request<OrganisationInvitationRecord>(
      `/api/v1/organisations/${encodeURIComponent(orgId)}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  acceptInvitation(invitationId: string, token?: string) {
    return this.request<{ accepted: boolean; organisationId: string }>(
      `/api/v1/invitations/${encodeURIComponent(invitationId)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify({ token }),
      }
    );
  }

  updateOrganisationMember(orgId: string, memberId: string, payload: UpdateMemberInput) {
    return this.request<OrganisationMemberRecord>(
      `/api/v1/organisations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  listAuditLogs(organisationId?: string) {
    const query = organisationId ? `?organisationId=${encodeURIComponent(organisationId)}` : '';
    return this.request<AuditLogRecord[]>(`/api/v1/audit-logs${query}`);
  }

  getAiGatewayStatus(checkReachability = false) {
    const query = checkReachability ? '?probe=true' : '';
    return this.request<AiGatewayStatus>(`/api/v1/ai/status${query}`);
  }

  switchAiProvider(providerId: AiProviderId) {
    return this.request<AiGatewayStatus>('/api/v1/ai/provider', {
      method: 'POST',
      body: JSON.stringify({ providerId }),
    });
  }

  requestAiAdvisory(payload: AiAdvisoryRequestInput) {
    return this.request<AiAdvisoryResponse>('/api/v1/ai/advisory', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  resolveAiDraft(draftId: string, decision: 'confirm' | 'dismiss') {
    return this.request<{ draftId: string; status: 'confirmed' | 'dismissed' }>(
      `/api/v1/ai/confirmations/${encodeURIComponent(draftId)}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }
    );
  }

  listFarms(filter?: {
    ownership?: 'individual' | 'organisation' | 'delegated';
    organisationId?: string;
  }) {
    const params = new URLSearchParams();
    if (filter?.ownership) params.set('ownership', filter.ownership);
    if (filter?.organisationId) params.set('organisationId', filter.organisationId);
    const qs = params.toString();
    return this.request<FarmRecord[]>(`/api/v1/farms${qs ? `?${qs}` : ''}`);
  }

  createFarm(payload: CreateFarmInput) {
    return this.request<FarmRecord>('/api/v1/farms', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getFarm(farmId: string) {
    return this.request<FarmDetailPayload>(`/api/v1/farms/${encodeURIComponent(farmId)}`);
  }

  updateFarm(farmId: string, payload: UpdateFarmInput) {
    return this.request<FarmRecord>(`/api/v1/farms/${encodeURIComponent(farmId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  updateFarmBoundary(farmId: string, payload: UpdateFarmBoundaryInput) {
    return this.request<FarmRecord>(
      `/api/v1/farms/${encodeURIComponent(farmId)}/boundary`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  }

  listFarmRevisions(farmId: string) {
    return this.request<FarmBoundaryRevisionRecord[]>(
      `/api/v1/farms/${encodeURIComponent(farmId)}/revisions`
    );
  }

  listFarmPermissions(farmId: string) {
    return this.request<FarmAccessGrantRecord[]>(
      `/api/v1/farms/${encodeURIComponent(farmId)}/permissions`
    );
  }

  grantFarmPermission(farmId: string, payload: CreateFarmPermissionInput) {
    return this.request<FarmAccessGrantRecord>(
      `/api/v1/farms/${encodeURIComponent(farmId)}/permissions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  revokeFarmPermission(farmId: string, grantId: string) {
    return this.request<FarmAccessGrantRecord>(
      `/api/v1/farms/${encodeURIComponent(farmId)}/permissions/${encodeURIComponent(grantId)}/revoke`,
      { method: 'POST' }
    );
  }

  searchLocations(query: string, country = 'UG') {
    const params = new URLSearchParams({ q: query, country });
    return this.request<LocationSearchResult[]>(`/api/v1/locations/search?${params.toString()}`);
  }

  getMappingConfig() {
    return this.request<MappingRuntimeConfig>('/api/v1/locations/config');
  }
}
