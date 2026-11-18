import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile as updateFirebaseProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { ApiClientError, FieldFussionApiClient } from '../shared/api/client.ts';
import { getDictionary, type TranslationDictionary } from '../shared/i18n/translations.ts';
import {
  calculateGeoJsonArea,
  computeGeoJsonCentroid,
  SQ_METERS_PER_ACRE,
  SQ_METERS_PER_HECTARE,
} from '../shared/geo/area.ts';
import { searchUgandaGazetteer } from '../shared/geo/ugandaLocations.ts';
import type {
  AiAdvisoryResponse,
  AiGatewayStatus,
  AiProviderId,
  AuditLogRecord,
  AuthSessionPayload,
  BusinessRole,
  FarmAccessGrantRecord,
  FarmConflictPayload,
  FarmDetailPayload,
  FarmRecord,
  LocationSearchResult,
  MappingRuntimeConfig,
  OrganisationSummary,
  SupportedLanguage,
} from '../shared/types/domain.ts';
import type {
  AiAdvisoryRequestInput,
  CreateFarmInput,
  CreateFarmPermissionInput,
  CreateOrganisationInput,
  InviteMemberInput,
  UpdateFarmBoundaryInput,
  UpdateFarmInput,
  UpdateMemberInput,
  UpdateProfileInput,
} from '../shared/validation/schemas.ts';
import {
  enqueueFarmBoundaryUpdate,
  enqueueFarmCreate,
  enqueueFarmUpdate,
  enqueueProfileUpdate,
  listQueuedMutations,
  loadCachedFarms,
  loadCachedSession,
  markQueuedMutationConflict,
  markQueuedMutationFailed,
  remapTempFarmIdInQueue,
  removeQueuedMutation,
  saveCachedFarms,
  saveCachedSession,
  type QueuedMutation,
} from '../mobile-pwa/offlineDb.ts';
import { useOnlineStatus } from '../mobile-pwa/usePwaStatus.ts';

interface FieldFussionContextValue {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  session: AuthSessionPayload | null;
  sessionSource: 'server' | 'offline_cache';
  cachedAt: string | null;
  loadingSession: boolean;
  sessionError: string | null;
  isOnline: boolean;
  queuedMutations: QueuedMutation[];
  farmConflicts: Extract<QueuedMutation, { type: 'farm_update' | 'farm_boundary_update' }>[];
  syncingQueue: boolean;
  language: SupportedLanguage;
  setLocalLanguage: (lang: SupportedLanguage) => void;
  t: TranslationDictionary;
  activeRole: BusinessRole | null;
  setActiveRole: (role: BusinessRole | null) => void;
  activeOrganisation: OrganisationSummary | null;
  setActiveOrganisationId: (orgId: string | null) => void;
  aiStatus: AiGatewayStatus | null;
  mappingConfig: MappingRuntimeConfig | null;
  farms: FarmRecord[];
  farmsSource: 'server' | 'offline_cache';
  farmsCachedAt: string | null;
  loadingFarms: boolean;
  farmsError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  registerWithEmailPassword: (input: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    termsAccepted: true;
  }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshFarms: () => Promise<void>;
  syncOfflineQueue: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<{ queuedOffline: boolean }>;
  activateRole: (role: BusinessRole) => Promise<void>;
  deactivateRole: (role: BusinessRole) => Promise<void>;
  createOrganisation: (input: CreateOrganisationInput) => Promise<OrganisationSummary>;
  loadOrganisationMembers: (orgId: string) => ReturnType<FieldFussionApiClient['listOrganisationMembers']>;
  inviteMember: (orgId: string, input: InviteMemberInput) => ReturnType<FieldFussionApiClient['inviteOrganisationMember']>;
  acceptInvitation: (invitationId: string) => Promise<void>;
  updateMember: (orgId: string, memberId: string, input: UpdateMemberInput) => ReturnType<FieldFussionApiClient['updateOrganisationMember']>;
  loadAuditLogs: (organisationId?: string) => Promise<AuditLogRecord[]>;
  refreshAiStatus: (probe?: boolean) => Promise<AiGatewayStatus>;
  switchAiProvider: (providerId: AiProviderId) => Promise<AiGatewayStatus>;
  requestAiAdvisory: (input: AiAdvisoryRequestInput) => Promise<AiAdvisoryResponse>;
  resolveAiDraft: (draftId: string, decision: 'confirm' | 'dismiss') => Promise<{ draftId: string; status: 'confirmed' | 'dismissed' }>;
  loadFarmDetail: (farmId: string) => Promise<FarmDetailPayload>;
  createFarm: (input: CreateFarmInput) => Promise<{ farm: FarmRecord; queuedOffline: boolean }>;
  updateFarmMetadata: (farmId: string, input: UpdateFarmInput) => Promise<{ farm: FarmRecord; queuedOffline: boolean }>;
  updateFarmBoundary: (farmId: string, input: UpdateFarmBoundaryInput) => Promise<{ farm: FarmRecord; queuedOffline: boolean }>;
  grantFarmPermission: (farmId: string, input: CreateFarmPermissionInput) => Promise<FarmAccessGrantRecord>;
  revokeFarmPermission: (farmId: string, grantId: string) => Promise<FarmAccessGrantRecord>;
  searchLocations: (query: string, country?: string) => Promise<LocationSearchResult[]>;
  resolveFarmConflict: (
    mutationId: string,
    strategy: 'keep_server' | 'overwrite_with_server_backup'
  ) => Promise<void>;
}

const FieldFussionContext = createContext<FieldFussionContextValue | null>(null);

export function FieldFussionProvider({ children }: { children: React.ReactNode }) {
  const isOnline = useOnlineStatus();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [sessionSource, setSessionSource] = useState<'server' | 'offline_cache'>('server');
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [localLanguage, setLocalLanguage] = useState<SupportedLanguage>('en');
  const [activeRole, setActiveRole] = useState<BusinessRole | null>(null);
  const [activeOrganisationId, setActiveOrganisationId] = useState<string | null>(null);
  const [queuedMutations, setQueuedMutations] = useState<QueuedMutation[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiGatewayStatus | null>(null);
  const [mappingConfig, setMappingConfig] = useState<MappingRuntimeConfig | null>(null);

  const [farms, setFarms] = useState<FarmRecord[]>([]);
  const [farmsSource, setFarmsSource] = useState<'server' | 'offline_cache'>('server');
  const [farmsCachedAt, setFarmsCachedAt] = useState<string | null>(null);
  const [loadingFarms, setLoadingFarms] = useState(false);
  const [farmsError, setFarmsError] = useState<string | null>(null);
  const suppressAutoSessionSyncRef = useRef(false);

  const apiClient = useMemo(
    () =>
      new FieldFussionApiClient('', async () => {
        if (!auth.currentUser) return null;
        return auth.currentUser.getIdToken();
      }),
    []
  );

  const refreshQueueList = useCallback(async () => {
    try {
      const items = await listQueuedMutations();
      setQueuedMutations(items);
    } catch (err) {
      console.error('Failed to read IndexedDB queue:', err);
    }
  }, []);

  const refreshFarms = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setFarms([]);
      return;
    }

    setLoadingFarms(true);
    setFarmsError(null);
    try {
      const res = await apiClient.listFarms();
      setFarms(res.data);
      setFarmsSource('server');
      const savedAt = await saveCachedFarms(currentUser.uid, res.data);
      setFarmsCachedAt(savedAt);
    } catch (err) {
      const cached = await loadCachedFarms(currentUser.uid).catch(() => null);
      if (cached && (!navigator.onLine || !(err instanceof ApiClientError && err.status === 401))) {
        setFarms(cached.farms);
        setFarmsSource('offline_cache');
        setFarmsCachedAt(cached.cachedAt);
        setFarmsError(null);
      } else {
        setFarmsError(err instanceof Error ? err.message : 'Could not load farms.');
      }
    } finally {
      setLoadingFarms(false);
    }
  }, [apiClient]);

  const refreshSession = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setSession(null);
      return;
    }

    setLoadingSession(true);
    setSessionError(null);

    try {
      const response = await apiClient.getAuthSession();
      const payload = response.data;
      setSession(payload);
      setSessionSource('server');
      const savedAt = await saveCachedSession(currentUser.uid, payload);
      setCachedAt(savedAt);
      setLocalLanguage(payload.user.preferredLanguage);

      setActiveRole((prev) => {
        if (prev && payload.roles.some((r) => r.role === prev && r.status === 'active')) {
          return prev;
        }
        return payload.roles.find((r) => r.status === 'active')?.role ?? null;
      });

      setActiveOrganisationId((prev) => {
        if (prev && payload.organisations.some((o) => o.id === prev)) {
          return prev;
        }
        return payload.organisations[0]?.id ?? null;
      });

      apiClient
        .getAiGatewayStatus()
        .then((res) => setAiStatus(res.data))
        .catch(() => {});

      apiClient
        .getMappingConfig()
        .then((res) => setMappingConfig(res.data))
        .catch(() => {});

      await refreshFarms();
    } catch (err) {
      const cached = await loadCachedSession(currentUser.uid).catch(() => null);
      if (cached && (!navigator.onLine || !(err instanceof ApiClientError && err.status === 401))) {
        setSession(cached.payload);
        setSessionSource('offline_cache');
        setCachedAt(cached.cachedAt);
        setLocalLanguage(cached.payload.user.preferredLanguage);
        setSessionError(null);
        await refreshFarms();
      } else {
        const message =
          err instanceof Error ? err.message : 'Unable to connect to FIELD FUSSION server.';
        setSessionError(message);
      }
    } finally {
      setLoadingSession(false);
    }
  }, [apiClient, refreshFarms]);

  const syncOfflineQueue = useCallback(async () => {
    if (!navigator.onLine || !auth.currentUser) return;
    const allQueued = await listQueuedMutations();
    const pending = allQueued.filter((item) => item.status === 'pending');
    if (pending.length === 0) return;

    setSyncingQueue(true);
    try {
      const tempIdMap = new Map<string, { id: string; version: number }>();
      const latestVersionByFarmId = new Map<string, number>();

      for (const item of pending) {
        try {
          if (item.type === 'update_profile') {
            await apiClient.updateMyProfile(item.payload);
            await removeQueuedMutation(item.id);
          } else if (item.type === 'farm_create') {
            const res = await apiClient.createFarm(item.payload);
            tempIdMap.set(item.tempFarmId, { id: res.data.id, version: res.data.version });
            latestVersionByFarmId.set(res.data.id, res.data.version);
            await remapTempFarmIdInQueue(item.tempFarmId, res.data.id, res.data.version);
            await removeQueuedMutation(item.id);
          } else if (item.type === 'farm_update') {
            const mapped = tempIdMap.get(item.farmId);
            const targetFarmId = mapped?.id ?? item.farmId;
            const targetExpected =
              latestVersionByFarmId.get(targetFarmId) ?? mapped?.version ?? item.expectedVersion;
            const updated = await apiClient.updateFarm(targetFarmId, {
              ...item.payload,
              expectedVersion: targetExpected,
            });
            latestVersionByFarmId.set(updated.data.id, updated.data.version);
            if (mapped) {
              tempIdMap.set(item.farmId, { id: updated.data.id, version: updated.data.version });
            }
            await removeQueuedMutation(item.id);
          } else if (item.type === 'farm_boundary_update') {
            const mapped = tempIdMap.get(item.farmId);
            const targetFarmId = mapped?.id ?? item.farmId;
            const targetExpected =
              latestVersionByFarmId.get(targetFarmId) ?? mapped?.version ?? item.expectedVersion;
            const updated = await apiClient.updateFarmBoundary(targetFarmId, {
              ...item.payload,
              expectedVersion: targetExpected,
              editSource: 'pwa_offline_sync',
            });
            latestVersionByFarmId.set(updated.data.id, updated.data.version);
            if (mapped) {
              tempIdMap.set(item.farmId, { id: updated.data.id, version: updated.data.version });
            }
            await removeQueuedMutation(item.id);
          }
        } catch (err) {
          if (
            err instanceof ApiClientError &&
            err.status === 409 &&
            err.code === 'FARM_VERSION_CONFLICT' &&
            (item.type === 'farm_update' || item.type === 'farm_boundary_update')
          ) {
            const serverFarm = (err.details?.serverFarm as FarmRecord | undefined) ?? undefined;
            if (serverFarm) {
              const conflictPayload: FarmConflictPayload = {
                farmId: item.farmId,
                expectedVersion: item.expectedVersion,
                serverVersion: serverFarm.version,
                serverFarm,
              };
              await markQueuedMutationConflict(item, conflictPayload, err.message);
              continue;
            }
          }
          const msg = err instanceof Error ? err.message : 'Sync failed';
          await markQueuedMutationFailed(item, msg);
        }
      }
      await refreshQueueList();
      await refreshSession();
    } finally {
      setSyncingQueue(false);
    }
  }, [apiClient, refreshQueueList, refreshSession]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setSession(null);
        setSessionError(null);
        setActiveRole(null);
        setActiveOrganisationId(null);
        setFarms([]);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authReady && firebaseUser && !suppressAutoSessionSyncRef.current) {
      refreshQueueList();
      refreshSession();
    }
  }, [authReady, firebaseUser, refreshQueueList, refreshSession]);

  useEffect(() => {
    const pendingCount = queuedMutations.filter((m) => m.status === 'pending').length;
    if (isOnline && authReady && firebaseUser && pendingCount > 0) {
      syncOfflineQueue();
    }
  }, [isOnline, authReady, firebaseUser, queuedMutations, syncOfflineQueue]);

  const signInWithGoogle = useCallback(async () => {
    setSessionError(null);
    await signInWithPopup(auth, googleAuthProvider);
  }, []);

  const signInWithEmailPassword = useCallback(async (email: string, password: string) => {
    setSessionError(null);
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const registerWithEmailPassword = useCallback(
    async (input: {
      fullName: string;
      email: string;
      password: string;
      phone?: string;
      termsAccepted: true;
    }) => {
      setSessionError(null);
      suppressAutoSessionSyncRef.current = true;
      try {
        const credential = await createUserWithEmailAndPassword(
          auth,
          input.email.trim(),
          input.password
        );
        await updateFirebaseProfile(credential.user, {
          displayName: input.fullName.trim(),
        });
        await credential.user.getIdToken(true);
        await apiClient.syncRegistrationProfile({
          fullName: input.fullName.trim(),
          phone: input.phone?.trim() || '',
          termsAccepted: true,
        });
      } finally {
        suppressAutoSessionSyncRef.current = false;
      }
      await refreshQueueList();
      await refreshSession();
    },
    [apiClient, refreshQueueList, refreshSession]
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setSession(null);
    setFarms([]);
  }, []);

  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<{ queuedOffline: boolean }> => {
      if (!navigator.onLine && firebaseUser && session) {
        await enqueueProfileUpdate(input);
        await refreshQueueList();
        const optimistic: AuthSessionPayload = {
          ...session,
          user: {
            ...session.user,
            ...input,
            phone: input.phone || null,
            onboardingCompleted: input.onboardingCompleted ?? true,
            updatedAt: new Date().toISOString(),
          },
        };
        setSession(optimistic);
        setSessionSource('offline_cache');
        setLocalLanguage(input.preferredLanguage);
        await saveCachedSession(firebaseUser.uid, optimistic);
        return { queuedOffline: true };
      }

      const res = await apiClient.updateMyProfile(input);
      setLocalLanguage(res.data.preferredLanguage);
      await refreshSession();
      return { queuedOffline: false };
    },
    [apiClient, firebaseUser, refreshQueueList, refreshSession, session]
  );

  const activateRole = useCallback(
    async (role: BusinessRole) => {
      await apiClient.activateRole(role);
      await refreshSession();
      setActiveRole(role);
    },
    [apiClient, refreshSession]
  );

  const deactivateRole = useCallback(
    async (role: BusinessRole) => {
      await apiClient.deactivateRole(role);
      await refreshSession();
    },
    [apiClient, refreshSession]
  );

  const createOrganisation = useCallback(
    async (input: CreateOrganisationInput) => {
      const res = await apiClient.createOrganisation(input);
      await refreshSession();
      setActiveOrganisationId(res.data.id);
      return res.data;
    },
    [apiClient, refreshSession]
  );

  const acceptInvitation = useCallback(
    async (invitationId: string) => {
      await apiClient.acceptInvitation(invitationId);
      await refreshSession();
    },
    [apiClient, refreshSession]
  );

  const loadOrganisationMembers = useCallback(
    (orgId: string) => apiClient.listOrganisationMembers(orgId),
    [apiClient]
  );

  const inviteMember = useCallback(
    (orgId: string, input: InviteMemberInput) =>
      apiClient.inviteOrganisationMember(orgId, input),
    [apiClient]
  );

  const updateMember = useCallback(
    (orgId: string, memberId: string, input: UpdateMemberInput) =>
      apiClient.updateOrganisationMember(orgId, memberId, input),
    [apiClient]
  );

  const loadAuditLogs = useCallback(
    async (organisationId?: string) => {
      const res = await apiClient.listAuditLogs(organisationId);
      return res.data;
    },
    [apiClient]
  );

  const refreshAiStatus = useCallback(
    async (probe = false) => {
      const res = await apiClient.getAiGatewayStatus(probe);
      setAiStatus(res.data);
      return res.data;
    },
    [apiClient]
  );

  const switchAiProvider = useCallback(
    async (providerId: AiProviderId) => {
      const res = await apiClient.switchAiProvider(providerId);
      setAiStatus(res.data);
      return res.data;
    },
    [apiClient]
  );

  const requestAiAdvisory = useCallback(
    async (input: AiAdvisoryRequestInput) => {
      const res = await apiClient.requestAiAdvisory(input);
      return res.data;
    },
    [apiClient]
  );

  const resolveAiDraft = useCallback(
    async (draftId: string, decision: 'confirm' | 'dismiss') => {
      const res = await apiClient.resolveAiDraft(draftId, decision);
      return res.data;
    },
    [apiClient]
  );

  const loadFarmDetail = useCallback(
    async (farmId: string): Promise<FarmDetailPayload> => {
      if (!navigator.onLine || farmId.startsWith('offline-farm-')) {
        const localFarm = farms.find((f) => f.id === farmId);
        if (localFarm) {
          return { farm: localFarm, grants: [], revisions: [] };
        }
      }
      const res = await apiClient.getFarm(farmId);
      return res.data;
    },
    [apiClient, farms]
  );

  const createFarm = useCallback(
    async (input: CreateFarmInput): Promise<{ farm: FarmRecord; queuedOffline: boolean }> => {
      if (!navigator.onLine && firebaseUser && session) {
        const tempFarmId = `offline-farm-${Date.now()}`;
        await enqueueFarmCreate(tempFarmId, input);
        await refreshQueueList();

        const boundaryMetrics = input.boundaryGeojson
          ? calculateGeoJsonArea(input.boundaryGeojson)
          : null;
        const computedCentroid = input.boundaryGeojson
          ? computeGeoJsonCentroid(input.boundaryGeojson)
          : null;
        const declaredSqM =
          input.declaredAreaValue && input.declaredAreaUnit
            ? input.declaredAreaUnit === 'acres'
              ? input.declaredAreaValue * SQ_METERS_PER_ACRE
              : input.declaredAreaValue * SQ_METERS_PER_HECTARE
            : null;

        const now = new Date().toISOString();
        const orgOwner = input.ownerOrganisationId
          ? session.organisations.find((o) => o.id === input.ownerOrganisationId)
          : undefined;

        const optimisticFarm: FarmRecord = {
          id: tempFarmId,
          name: input.name,
          farmCode: input.farmCode || null,
          ownershipType: input.ownershipType,
          ownerUserId: input.ownershipType === 'individual' ? session.user.id : null,
          ownerOrganisationId:
            input.ownershipType === 'organisation' ? (input.ownerOrganisationId ?? null) : null,
          ownerLabel:
            input.ownershipType === 'organisation'
              ? (orgOwner?.name ?? 'Organisation')
              : session.user.fullName || session.user.email,
          country: input.country ?? 'UG',
          district: input.district,
          subcounty: input.subcounty || null,
          locationSource: input.locationSource ?? 'search',
          centroidLat: computedCentroid?.lat ?? input.centroidLat ?? null,
          centroidLng: computedCentroid?.lng ?? input.centroidLng ?? null,
          boundaryGeojson: input.boundaryGeojson ?? null,
          areaSqMeters: boundaryMetrics?.areaSqMeters ?? declaredSqM,
          areaAcres:
            boundaryMetrics?.areaAcres ??
            (declaredSqM ? Math.round((declaredSqM / SQ_METERS_PER_ACRE) * 1000) / 1000 : null),
          areaHectares:
            boundaryMetrics?.areaHectares ??
            (declaredSqM
              ? Math.round((declaredSqM / SQ_METERS_PER_HECTARE) * 1000) / 1000
              : null),
          areaSource: boundaryMetrics ? 'postgis_boundary' : 'declared_estimate',
          version: 1,
          status: 'active',
          createdByUserId: session.user.id,
          createdAt: now,
          updatedAt: now,
          effectivePermissions: {
            canView: true,
            canEditMetadata: true,
            canEditBoundary: true,
            canManageOperations: true,
            canManagePermissions: true,
            accessReason:
              input.ownershipType === 'organisation' ? 'organisation_member' : 'individual_owner',
          },
        };

        const nextFarms = [optimisticFarm, ...farms];
        setFarms(nextFarms);
        setFarmsSource('offline_cache');
        const savedAt = await saveCachedFarms(firebaseUser.uid, nextFarms);
        setFarmsCachedAt(savedAt);
        return { farm: optimisticFarm, queuedOffline: true };
      }

      const res = await apiClient.createFarm(input);
      await refreshFarms();
      return { farm: res.data, queuedOffline: false };
    },
    [apiClient, farms, firebaseUser, refreshFarms, refreshQueueList, session]
  );

  const updateFarmMetadata = useCallback(
    async (
      farmId: string,
      input: UpdateFarmInput
    ): Promise<{ farm: FarmRecord; queuedOffline: boolean }> => {
      if (!navigator.onLine && firebaseUser) {
        await enqueueFarmUpdate(farmId, input.expectedVersion, input);
        await refreshQueueList();
        const existing = farms.find((f) => f.id === farmId);
        if (!existing) {
          throw new Error('Farm not found in offline cache.');
        }
        const updated: FarmRecord = {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.farmCode !== undefined ? { farmCode: input.farmCode } : {}),
          ...(input.district !== undefined ? { district: input.district } : {}),
          ...(input.subcounty !== undefined ? { subcounty: input.subcounty } : {}),
          ...(input.locationSource !== undefined ? { locationSource: input.locationSource } : {}),
          ...(input.centroidLat !== undefined ? { centroidLat: input.centroidLat } : {}),
          ...(input.centroidLng !== undefined ? { centroidLng: input.centroidLng } : {}),
          updatedAt: new Date().toISOString(),
        };
        const nextFarms = farms.map((f) => (f.id === farmId ? updated : f));
        setFarms(nextFarms);
        setFarmsSource('offline_cache');
        const savedAt = await saveCachedFarms(firebaseUser.uid, nextFarms);
        setFarmsCachedAt(savedAt);
        return { farm: updated, queuedOffline: true };
      }

      const res = await apiClient.updateFarm(farmId, input);
      await refreshFarms();
      return { farm: res.data, queuedOffline: false };
    },
    [apiClient, farms, firebaseUser, refreshFarms, refreshQueueList]
  );

  const updateFarmBoundary = useCallback(
    async (
      farmId: string,
      input: UpdateFarmBoundaryInput
    ): Promise<{ farm: FarmRecord; queuedOffline: boolean }> => {
      if (!navigator.onLine && firebaseUser) {
        await enqueueFarmBoundaryUpdate(farmId, input.expectedVersion, input);
        await refreshQueueList();
        const existing = farms.find((f) => f.id === farmId);
        if (!existing) {
          throw new Error('Farm not found in offline cache.');
        }
        const metrics = calculateGeoJsonArea(input.boundaryGeojson);
        const centroid = computeGeoJsonCentroid(input.boundaryGeojson);
        const updated: FarmRecord = {
          ...existing,
          boundaryGeojson: input.boundaryGeojson,
          centroidLat: centroid?.lat ?? existing.centroidLat,
          centroidLng: centroid?.lng ?? existing.centroidLng,
          areaSqMeters: metrics.areaSqMeters,
          areaAcres: metrics.areaAcres,
          areaHectares: metrics.areaHectares,
          areaSource: 'postgis_boundary',
          updatedAt: new Date().toISOString(),
        };
        const nextFarms = farms.map((f) => (f.id === farmId ? updated : f));
        setFarms(nextFarms);
        setFarmsSource('offline_cache');
        const savedAt = await saveCachedFarms(firebaseUser.uid, nextFarms);
        setFarmsCachedAt(savedAt);
        return { farm: updated, queuedOffline: true };
      }

      const res = await apiClient.updateFarmBoundary(farmId, input);
      await refreshFarms();
      return { farm: res.data, queuedOffline: false };
    },
    [apiClient, farms, firebaseUser, refreshFarms, refreshQueueList]
  );

  const grantFarmPermission = useCallback(
    async (farmId: string, input: CreateFarmPermissionInput) => {
      const res = await apiClient.grantFarmPermission(farmId, input);
      return res.data;
    },
    [apiClient]
  );

  const revokeFarmPermission = useCallback(
    async (farmId: string, grantId: string) => {
      const res = await apiClient.revokeFarmPermission(farmId, grantId);
      return res.data;
    },
    [apiClient]
  );

  const searchLocations = useCallback(
    async (query: string, country = 'UG'): Promise<LocationSearchResult[]> => {
      if (!navigator.onLine) {
        return searchUgandaGazetteer(query);
      }
      try {
        const res = await apiClient.searchLocations(query, country);
        return res.data;
      } catch {
        return searchUgandaGazetteer(query);
      }
    },
    [apiClient]
  );

  const resolveFarmConflict = useCallback(
    async (
      mutationId: string,
      strategy: 'keep_server' | 'overwrite_with_server_backup'
    ) => {
      const items = await listQueuedMutations();
      const target = items.find((m) => m.id === mutationId);
      if (!target || (target.type !== 'farm_update' && target.type !== 'farm_boundary_update')) {
        return;
      }

      if (strategy === 'keep_server') {
        await removeQueuedMutation(target.id);
        await refreshQueueList();
        await refreshFarms();
        return;
      }

      if (target.type === 'farm_boundary_update') {
        await apiClient.updateFarmBoundary(target.farmId, {
          ...target.payload,
          expectedVersion: target.conflictPayload?.serverVersion ?? target.expectedVersion,
          editSource: 'conflict_resolution',
          resolutionStrategy: 'overwrite_with_server_backup',
        });
      } else {
        await apiClient.updateFarm(target.farmId, {
          ...target.payload,
          expectedVersion: target.conflictPayload?.serverVersion ?? target.expectedVersion,
          resolutionStrategy: 'overwrite_with_server_backup',
        });
      }

      await removeQueuedMutation(target.id);
      await refreshQueueList();
      await refreshFarms();
    },
    [apiClient, refreshFarms, refreshQueueList]
  );

  const activeOrganisation = useMemo(() => {
    if (!session || !activeOrganisationId) return null;
    return session.organisations.find((o) => o.id === activeOrganisationId) ?? null;
  }, [session, activeOrganisationId]);

  const farmConflicts = useMemo(
    () =>
      queuedMutations.filter(
        (m): m is Extract<QueuedMutation, { type: 'farm_update' | 'farm_boundary_update' }> =>
          m.status === 'conflict' && (m.type === 'farm_update' || m.type === 'farm_boundary_update')
      ),
    [queuedMutations]
  );

  const t = useMemo(() => getDictionary(localLanguage), [localLanguage]);

  const value: FieldFussionContextValue = {
    firebaseUser,
    authReady,
    session,
    sessionSource,
    cachedAt,
    loadingSession,
    sessionError,
    isOnline,
    queuedMutations,
    farmConflicts,
    syncingQueue,
    language: localLanguage,
    setLocalLanguage,
    t,
    activeRole,
    setActiveRole,
    activeOrganisation,
    setActiveOrganisationId,
    aiStatus,
    mappingConfig,
    farms,
    farmsSource,
    farmsCachedAt,
    loadingFarms,
    farmsError,
    signInWithGoogle,
    signInWithEmailPassword,
    registerWithEmailPassword,
    requestPasswordReset,
    signOut,
    refreshSession,
    refreshFarms,
    syncOfflineQueue,
    updateProfile,
    activateRole,
    deactivateRole,
    createOrganisation,
    loadOrganisationMembers,
    inviteMember,
    acceptInvitation,
    updateMember,
    loadAuditLogs,
    refreshAiStatus,
    switchAiProvider,
    requestAiAdvisory,
    resolveAiDraft,
    loadFarmDetail,
    createFarm,
    updateFarmMetadata,
    updateFarmBoundary,
    grantFarmPermission,
    revokeFarmPermission,
    searchLocations,
    resolveFarmConflict,
  };

  return (
    <FieldFussionContext.Provider value={value}>
      {children}
    </FieldFussionContext.Provider>
  );
}

export function useFieldFussion() {
  const ctx = useContext(FieldFussionContext);
  if (!ctx) {
    throw new Error('useFieldFussion must be used inside FieldFussionProvider');
  }
  return ctx;
}
