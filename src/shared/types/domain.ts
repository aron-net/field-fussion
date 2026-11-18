export type SupportedLanguage = 'en' | 'lg' | 'sw';
export type AreaUnit = 'acres' | 'hectares';
export type CurrencyCode = 'UGX' | 'KES' | 'TZS' | 'USD';

export const BUSINESS_ROLES = [
  'farmer',
  'coop_manager',
  'buyer',
  'supplier',
  'logistics',
  'expert',
  'admin',
] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

/**
 * Roles a user may self-activate on their personal account.
 * 'admin' is strictly excluded and can only be granted server-side by an existing admin.
 */
export const SELF_ACTIVATABLE_ROLES: readonly BusinessRole[] = [
  'farmer',
  'coop_manager',
  'buyer',
  'supplier',
  'logistics',
  'expert',
] as const;

export type RoleStatus = 'active' | 'pending_verification' | 'suspended';

export const ORGANISATION_TYPES = [
  'cooperative',
  'commercial_farm',
  'buyer_business',
  'supplier_business',
  'logistics_company',
  'advisory_agency',
] as const;

export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

export const ORG_ROLES = [
  'owner',
  'manager',
  'agronomist',
  'finance_officer',
  'member',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export type VerificationStatus = 'unverified' | 'pending' | 'verified';
export type MembershipStatus = 'active' | 'suspended';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface UserProfile {
  id: string;
  firebaseUid: string;
  email: string;
  phone: string | null;
  fullName: string;
  district: string | null;
  country: string;
  currency: CurrencyCode;
  preferredLanguage: SupportedLanguage;
  preferredAreaUnit: AreaUnit;
  timezone: string;
  onboardingCompleted: boolean;
  researchOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserRoleRecord {
  id: string;
  userId: string;
  role: BusinessRole;
  status: RoleStatus;
  activatedAt: string;
  grantedByUserId: string | null;
}

export interface OrganisationSummary {
  id: string;
  name: string;
  orgType: OrganisationType;
  country: string;
  district: string | null;
  registrationNumber: string | null;
  verificationStatus: VerificationStatus;
  createdByUserId: string;
  createdAt: string;
  membershipRole: OrgRole;
  membershipStatus: MembershipStatus;
}

export interface OrganisationMemberRecord {
  id: string;
  organisationId: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  orgRole: OrgRole;
  status: MembershipStatus;
  joinedAt: string;
}

export interface OrganisationInvitationRecord {
  id: string;
  organisationId: string;
  organisationName?: string;
  inviteeEmail: string;
  intendedOrgRole: OrgRole;
  status: InvitationStatus;
  invitedByUserId: string;
  expiresAt: string;
  createdAt: string;
  acceptToken?: string;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  organisationId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuthSessionPayload {
  user: UserProfile;
  roles: UserRoleRecord[];
  organisations: OrganisationSummary[];
  pendingInvitations: OrganisationInvitationRecord[];
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  recoveryAction?: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    cachedAt?: string;
    source?: 'server' | 'offline_cache';
  };
}

export interface ApiErrorEnvelope {
  error: ApiErrorPayload;
}

export const AI_PROVIDER_IDS = [
  'gemini_free',
  'ollama_local',
  'mock',
  'gemini_paid',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderHealth {
  providerId: AiProviderId;
  label: string;
  tier: 'free_tier' | 'local_dev' | 'mock_test' | 'paid_disabled' | 'paid_enabled';
  configured: boolean;
  reachable?: boolean;
  model: string;
  note: string;
}

export interface AiGatewayLogEntry {
  id: string;
  timestamp: string;
  providerId: AiProviderId;
  model: string;
  status: 'success' | 'rate_limited' | 'unconfigured' | 'unreachable' | 'error' | 'blocked';
  latencyMs: number;
  promptCharCount: number;
  errorCode?: string;
}

export interface AiProposedDraft {
  draftId: string;
  actionType: 'advisory_note' | 'preferred_unit_suggestion';
  summary: string;
  status: 'pending_confirmation' | 'confirmed' | 'dismissed';
}

export interface AiAdvisoryResponse {
  requestId: string;
  providerId: AiProviderId;
  model: string;
  isSimulated: boolean;
  responseSource: 'simulated' | 'real_ai_model';
  simulatedNotice?: string;
  advisoryText: string;
  uncertaintyNote: string;
  requiresApproval: boolean;
  proposedDraft?: AiProposedDraft;
  privacyNotice: string;
  usage: {
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AiModelClassification {
  verifiedFreeModels: readonly string[];
  unverifiedModels: readonly string[];
  paidOnlyModels: readonly string[];
}

export interface AiSimulationStatus {
  isSimulatedMode: boolean;
  responseMode: 'simulated' | 'real_ai_model';
  description: string;
}

export interface AiGatewayStatus {
  phase: 'free_development_mode' | 'paid_enabled';
  activeProvider: AiProviderId;
  providers: AiProviderHealth[];
  verifiedFreeGeminiModels: readonly string[];
  modelPolicy: AiModelClassification;
  simulationStatus: AiSimulationStatus;
  activeModels: {
    conversational: string;
    vision: string;
    speechTranscribe: string;
    tts: string;
  };
  safetyRules: {
    advisoryOnly: boolean;
    requiresHumanApproval: boolean;
    researchOptInSeparated: boolean;
    knowledgePublicationAdminControlled: boolean;
    piiStrippedBeforeExternalCalls: boolean;
  };
  recentLogs: AiGatewayLogEntry[];
}

export const UGANDA_DISTRICTS: readonly string[] = [
  'Kampala',
  'Wakiso',
  'Mukono',
  'Lira',
  'Gulu',
  'Mbale',
  'Jinja',
  'Mbarara',
  'Masaka',
  'Hoima',
  'Fort Portal (Kabarole)',
  'Soroti',
  'Arua',
  'Kabale',
  'Iganga',
  'Tororo',
  'Kasese',
  'Masindi',
  'Luweero',
  'Mityana',
] as const;

export const FARM_OWNERSHIP_TYPES = ['individual', 'organisation'] as const;
export type FarmOwnershipType = (typeof FARM_OWNERSHIP_TYPES)[number];

export const FARM_LOCATION_SOURCES = [
  'search',
  'map_pin',
  'manual_coords',
  'gps_opt_in',
] as const;
export type FarmLocationSource = (typeof FARM_LOCATION_SOURCES)[number];

export const FARM_ACCESS_ROLES = ['manager', 'agronomist', 'viewer'] as const;
export type FarmAccessRole = (typeof FARM_ACCESS_ROLES)[number];

export const FARM_GRANTEE_TYPES = ['user', 'organisation'] as const;
export type FarmGranteeType = (typeof FARM_GRANTEE_TYPES)[number];

export const FARM_EDIT_SOURCES = [
  'web',
  'pwa_online',
  'pwa_offline_sync',
  'conflict_resolution',
] as const;
export type FarmEditSource = (typeof FARM_EDIT_SOURCES)[number];

export type GeoJsonPosition = [number, number]; // [lng, lat]

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: GeoJsonPosition[][];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: GeoJsonPosition[][][];
}

export type FarmGeoJsonBoundary = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface FarmEffectivePermissions {
  canView: boolean;
  canEditMetadata: boolean;
  canEditBoundary: boolean;
  canManageOperations: boolean;
  canManagePermissions: boolean;
  accessReason:
    | 'individual_owner'
    | 'organisation_member'
    | 'direct_user_grant'
    | 'cooperative_delegation';
}

export interface FarmRecord {
  id: string;
  name: string;
  farmCode: string | null;
  ownershipType: FarmOwnershipType;
  ownerUserId: string | null;
  ownerOrganisationId: string | null;
  ownerLabel: string;
  country: string;
  district: string;
  subcounty: string | null;
  locationSource: FarmLocationSource;
  centroidLat: number | null;
  centroidLng: number | null;
  boundaryGeojson: FarmGeoJsonBoundary | null;
  areaSqMeters: number | null;
  areaAcres: number | null;
  areaHectares: number | null;
  areaSource: 'postgis_boundary' | 'declared_estimate';
  version: number;
  status: 'active' | 'archived';
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  effectivePermissions: FarmEffectivePermissions;
}

export interface FarmAccessGrantRecord {
  id: string;
  farmId: string;
  granteeType: FarmGranteeType;
  granteeUserId: string | null;
  granteeOrganisationId: string | null;
  granteeLabel: string;
  granteeSubLabel: string | null;
  accessRole: FarmAccessRole;
  canEditBoundary: boolean;
  canManageOperations: boolean;
  canManagePermissions: boolean;
  grantedByUserId: string;
  grantedAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface FarmBoundaryRevisionRecord {
  id: string;
  farmId: string;
  version: number;
  boundaryGeojson: FarmGeoJsonBoundary;
  areaSqMeters: number;
  areaAcres: number;
  areaHectares: number;
  editedByUserId: string;
  editedByLabel: string;
  editSource: FarmEditSource;
  createdAt: string;
}

export interface FarmDetailPayload {
  farm: FarmRecord;
  grants: FarmAccessGrantRecord[];
  revisions: FarmBoundaryRevisionRecord[];
}

export interface FarmConflictPayload {
  farmId: string;
  expectedVersion: number;
  serverVersion: number;
  serverFarm: FarmRecord;
}

export interface LocationSearchResult {
  id: string;
  label: string;
  district: string;
  country: string;
  lat: number;
  lng: number;
  source: 'uganda_gazetteer' | 'osm_nominatim' | 'custom_geocoder';
  boundingBox?: [number, number, number, number]; // [south, north, west, east]
}

export type LocationSearchProviderId = 'osm_nominatim' | 'gazetteer_only' | 'custom_http';

export interface MappingRuntimeConfig {
  locationProvider: LocationSearchProviderId;
  locationProviderLabel: string;
  autocompleteProhibited: boolean;
  rateLimitNote: string;
  basemaps: {
    streetEnabled: boolean;
    streetTileUrl: string;
    streetAttribution: string;
    satelliteEnabled: boolean;
    satelliteTileUrl: string;
    satelliteAttribution: string;
    satelliteLicenseNote: string;
  };
  offlinePolicyNote: string;
}
