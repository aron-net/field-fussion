import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Clock,
  Compass,
  History,
  Lock,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { ApiClientError } from '../../shared/api/client.ts';
import {
  InlineAlert,
  MetadataLine,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
} from '../../design-system/components.tsx';
import { useFieldFussion } from '../../context/FieldFussionContext.tsx';
import {
  calculateGeoJsonArea,
  geoJsonBoundaryToLatLngPoints,
  latLngPointsToGeoJsonPolygon,
  validateGeoJsonBoundaryTopology,
} from '../../shared/geo/area.ts';
import { UGANDA_GAZETTEER } from '../../shared/geo/ugandaLocations.ts';
import {
  UGANDA_DISTRICTS,
  type AreaUnit,
  type FarmAccessGrantRecord,
  type FarmAccessRole,
  type FarmBoundaryRevisionRecord,
  type FarmConflictPayload,
  type FarmGeoJsonBoundary,
  type FarmLocationSource,
  type FarmOwnershipType,
  type FarmRecord,
  type LocationSearchResult,
} from '../../shared/types/domain.ts';
import { InteractiveFarmMap, type LatLngPoint } from './InteractiveFarmMap.tsx';

type OwnershipFilter = 'all' | 'individual' | 'organisation' | 'delegated';
type DetailTab = 'boundary' | 'details' | 'access';

function formatOwnershipBadge(farm: FarmRecord): string {
  switch (farm.effectivePermissions.accessReason) {
    case 'individual_owner':
      return 'Individual Owner';
    case 'organisation_member':
      return 'Organisation Farm';
    case 'direct_user_grant':
      return 'Direct Manager Grant';
    case 'cooperative_delegation':
      return 'Cooperative Delegation';
  }
}

export function FarmManagementView({ compact = false }: { compact?: boolean }) {
  const {
    session,
    isOnline,
    farms,
    farmsSource,
    farmsCachedAt,
    loadingFarms,
    farmsError,
    farmConflicts,
    mappingConfig,
    refreshFarms,
    loadFarmDetail,
    createFarm,
    updateFarmMetadata,
    updateFarmBoundary,
    grantFarmPermission,
    revokeFarmPermission,
    searchLocations,
    resolveFarmConflict,
    t,
  } = useFieldFussion();

  const [filter, setFilter] = useState<OwnershipFilter>('all');
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('boundary');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Selected farm detail state
  const [grants, setGrants] = useState<FarmAccessGrantRecord[]>([]);
  const [revisions, setRevisions] = useState<FarmBoundaryRevisionRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    variant: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Boundary editor state
  const [editingPoints, setEditingPoints] = useState<LatLngPoint[]>([]);
  const [savingBoundary, setSavingBoundary] = useState(false);
  const [previewRevision, setPreviewRevision] = useState<FarmBoundaryRevisionRecord | null>(null);
  const [manualCoordLat, setManualCoordLat] = useState('');
  const [manualCoordLng, setManualCoordLng] = useState('');
  const [showCoordTable, setShowCoordTable] = useState(false);

  // Details editor state
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editDistrict, setEditDistrict] = useState('');
  const [editSubcounty, setEditSubcounty] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [editLocationSource, setEditLocationSource] = useState<FarmLocationSource>('search');
  const [editLocationQuery, setEditLocationQuery] = useState('');
  const [editLocationHits, setEditLocationHits] = useState<LocationSearchResult[]>([]);
  const [savingDetails, setSavingDetails] = useState(false);

  // Permission grant state
  const [grantType, setGrantType] = useState<'user' | 'organisation'>('user');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantOrgId, setGrantOrgId] = useState('');
  const [grantRole, setGrantRole] = useState<FarmAccessRole>('manager');
  const [grantCanEditBoundary, setGrantCanEditBoundary] = useState(true);
  const [grantCanManageOps, setGrantCanManageOps] = useState(true);
  const [grantCanManagePerms, setGrantCanManagePerms] = useState(false);
  const [savingGrant, setSavingGrant] = useState(false);

  // Create farm state
  const [newOwnership, setNewOwnership] = useState<FarmOwnershipType>('individual');
  const [newOwnerOrgId, setNewOwnerOrgId] = useState('');
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDistrict, setNewDistrict] = useState(session?.user.district || 'Kampala');
  const [newSubcounty, setNewSubcounty] = useState('');
  const [newLocationSource, setNewLocationSource] = useState<FarmLocationSource>('search');
  const [newPin, setNewPin] = useState<LatLngPoint>({ lat: 0.3476, lng: 32.5825 });
  const [newDeclaredArea, setNewDeclaredArea] = useState('');
  const [newDeclaredUnit, setNewDeclaredUnit] = useState<AreaUnit>(
    session?.user.preferredAreaUnit ?? 'acres'
  );
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<LocationSearchResult[]>([]);
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);
  const [creatingFarm, setCreatingFarm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Conflict modal state (supports both offline queue conflicts and live online 409 collisions)
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [liveBoundaryConflict, setLiveBoundaryConflict] = useState<{
    conflict: FarmConflictPayload;
    localBoundary: FarmGeoJsonBoundary;
  } | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const manageableOrgs = useMemo(
    () =>
      (session?.organisations ?? []).filter((o) =>
        ['owner', 'manager', 'agronomist'].includes(o.membershipRole)
      ),
    [session?.organisations]
  );

  const filteredFarms = useMemo(() => {
    return farms.filter((farm) => {
      if (filter === 'all') return true;
      if (filter === 'individual') return farm.ownershipType === 'individual';
      if (filter === 'organisation') return farm.ownershipType === 'organisation';
      return (
        farm.effectivePermissions.accessReason === 'direct_user_grant' ||
        farm.effectivePermissions.accessReason === 'cooperative_delegation'
      );
    });
  }, [farms, filter]);

  const selectedFarm = useMemo(
    () => farms.find((f) => f.id === selectedFarmId) ?? filteredFarms[0] ?? null,
    [farms, filteredFarms, selectedFarmId]
  );

  const hydrateDetailForFarm = useCallback(
    async (farm: FarmRecord) => {
      setEditingPoints(geoJsonBoundaryToLatLngPoints(farm.boundaryGeojson));
      setPreviewRevision(null);
      setEditName(farm.name);
      setEditCode(farm.farmCode ?? '');
      setEditDistrict(farm.district);
      setEditSubcounty(farm.subcounty ?? '');
      setEditLat(farm.centroidLat !== null ? String(farm.centroidLat) : '');
      setEditLng(farm.centroidLng !== null ? String(farm.centroidLng) : '');
      setEditLocationSource(farm.locationSource);

      setLoadingDetail(true);
      setDetailError(null);
      try {
        const detail = await loadFarmDetail(farm.id);
        setGrants(detail.grants);
        setRevisions(detail.revisions);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Could not load farm details.');
      } finally {
        setLoadingDetail(false);
      }
    },
    [loadFarmDetail]
  );

  useEffect(() => {
    if (selectedFarm) {
      if (selectedFarm.id !== selectedFarmId) {
        setSelectedFarmId(selectedFarm.id);
      }
      hydrateDetailForFarm(selectedFarm);
    } else {
      setGrants([]);
      setRevisions([]);
      setEditingPoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFarm?.id, selectedFarm?.version]);

  useEffect(() => {
    if (manageableOrgs.length > 0 && !newOwnerOrgId) {
      setNewOwnerOrgId(manageableOrgs[0]!.id);
    }
    if ((session?.organisations.length ?? 0) > 0 && !grantOrgId) {
      setGrantOrgId(session!.organisations[0]!.id);
    }
  }, [manageableOrgs, newOwnerOrgId, session, grantOrgId]);

  const handleSearchLocations = async (query: string, target: 'create' | 'edit') => {
    setSearchingLocation(true);
    try {
      const hits = await searchLocations(query, 'UG');
      if (target === 'create') {
        setLocationResults(hits);
      } else {
        setEditLocationHits(hits);
      }
    } finally {
      setSearchingLocation(false);
    }
  };

  const applyLocationSelection = (loc: LocationSearchResult, target: 'create' | 'edit') => {
    if (target === 'create') {
      setNewDistrict(loc.district);
      setNewPin({ lat: loc.lat, lng: loc.lng });
      setNewLocationSource('search');
      setLocationQuery(loc.label);
      setLocationResults([]);
    } else {
      setEditDistrict(loc.district);
      setEditLat(String(loc.lat));
      setEditLng(String(loc.lng));
      setEditLocationSource('search');
      setEditLocationQuery(loc.label);
      setEditLocationHits([]);
    }
  };

  const handleUseCurrentGps = (target: 'create' | 'edit') => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation is not supported on this device. Search by district instead.');
      return;
    }
    setGpsStatus('Requesting current GPS coordinates...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1_000_000) / 1_000_000;
        const lng = Math.round(pos.coords.longitude * 1_000_000) / 1_000_000;
        if (target === 'create') {
          setNewPin({ lat, lng });
          setNewLocationSource('gps_opt_in');
        } else {
          setEditLat(String(lat));
          setEditLng(String(lng));
          setEditLocationSource('gps_opt_in');
        }
        setGpsStatus(`GPS captured (${lat}, ${lng}). You can still adjust on the map.`);
      },
      (err) => {
        setGpsStatus(`GPS unavailable (${err.message}). Use remote district search instead.`);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleCreateFarm = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatingFarm(true);
    try {
      const parsedArea = newDeclaredArea.trim() ? Number(newDeclaredArea) : undefined;
      const res = await createFarm({
        name: newName,
        farmCode: newCode || undefined,
        ownershipType: newOwnership,
        ownerOrganisationId: newOwnership === 'organisation' ? newOwnerOrgId : undefined,
        country: 'UG',
        district: newDistrict,
        subcounty: newSubcounty || undefined,
        locationSource: newLocationSource,
        centroidLat: newPin.lat,
        centroidLng: newPin.lng,
        declaredAreaValue: parsedArea && Number.isFinite(parsedArea) ? parsedArea : undefined,
        declaredAreaUnit: parsedArea ? newDeclaredUnit : undefined,
      });

      setShowCreateModal(false);
      setNewName('');
      setNewCode('');
      setNewSubcounty('');
      setNewDeclaredArea('');
      setSelectedFarmId(res.farm.id);
      setDetailTab('boundary');
      setActionNotice({
        variant: res.queuedOffline ? 'info' : 'success',
        message: res.queuedOffline
          ? `Farm "${res.farm.name}" saved offline and queued for sync.`
          : `Farm "${res.farm.name}" registered in ${res.farm.district}. Draw its boundary below.`,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to register farm.');
    } finally {
      setCreatingFarm(false);
    }
  };

  const boundaryValidation = useMemo(() => {
    const poly = latLngPointsToGeoJsonPolygon(editingPoints);
    if (!poly) {
      return {
        polygon: null,
        valid: false,
        reason: 'Add at least 3 corner points on the map to form a closed farm boundary.',
        area: null,
      };
    }
    const check = validateGeoJsonBoundaryTopology(poly);
    const area = calculateGeoJsonArea(poly);
    return {
      polygon: poly,
      valid: check.valid,
      reason: check.valid ? null : check.reason,
      area,
    };
  }, [editingPoints]);

  const handleSaveBoundary = async () => {
    if (!selectedFarm || !boundaryValidation.polygon || !boundaryValidation.valid) return;
    setSavingBoundary(true);
    setActionNotice(null);
    try {
      const res = await updateFarmBoundary(selectedFarm.id, {
        expectedVersion: selectedFarm.version,
        boundaryGeojson: boundaryValidation.polygon,
        editSource: compact ? 'pwa_online' : 'web',
      });
      setActionNotice({
        variant: res.queuedOffline ? 'info' : 'success',
        message: res.queuedOffline
          ? `Boundary update for "${res.farm.name}" queued offline (v${selectedFarm.version}).`
          : `PostGIS boundary saved (v${res.farm.version}): ${res.farm.areaAcres?.toFixed(2)} ac / ${res.farm.areaHectares?.toFixed(2)} ha.`,
      });
      if (!res.queuedOffline) {
        await hydrateDetailForFarm(res.farm);
      }
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.status === 409 &&
        err.code === 'FARM_VERSION_CONFLICT' &&
        err.details?.serverFarm
      ) {
        const serverFarm = err.details.serverFarm as FarmRecord;
        setLiveBoundaryConflict({
          conflict: {
            farmId: selectedFarm.id,
            expectedVersion: selectedFarm.version,
            serverVersion: serverFarm.version,
            serverFarm,
          },
          localBoundary: boundaryValidation.polygon,
        });
        return;
      }
      setActionNotice({
        variant: 'error',
        message: err instanceof Error ? err.message : 'Could not save farm boundary.',
      });
    } finally {
      setSavingBoundary(false);
    }
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFarm) return;
    setSavingDetails(true);
    setActionNotice(null);
    try {
      const latNum = editLat.trim() ? Number(editLat) : null;
      const lngNum = editLng.trim() ? Number(editLng) : null;
      const res = await updateFarmMetadata(selectedFarm.id, {
        expectedVersion: selectedFarm.version,
        name: editName,
        farmCode: editCode.trim() ? editCode.trim() : null,
        district: editDistrict,
        subcounty: editSubcounty.trim() ? editSubcounty.trim() : null,
        locationSource: editLocationSource,
        centroidLat: latNum !== null && Number.isFinite(latNum) ? latNum : null,
        centroidLng: lngNum !== null && Number.isFinite(lngNum) ? lngNum : null,
      });
      setActionNotice({
        variant: res.queuedOffline ? 'info' : 'success',
        message: res.queuedOffline
          ? 'Farm details saved offline and queued for sync.'
          : `Updated farm details (v${res.farm.version}).`,
      });
    } catch (err) {
      setActionNotice({
        variant: 'error',
        message: err instanceof Error ? err.message : 'Could not update farm details.',
      });
    } finally {
      setSavingDetails(false);
    }
  };

  const handleGrantPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFarm) return;
    setSavingGrant(true);
    setActionNotice(null);
    try {
      await grantFarmPermission(selectedFarm.id, {
        granteeType: grantType,
        granteeEmail: grantType === 'user' ? grantEmail : undefined,
        granteeOrganisationId: grantType === 'organisation' ? grantOrgId : undefined,
        accessRole: grantRole,
        canEditBoundary: grantRole === 'viewer' ? false : grantCanEditBoundary,
        canManageOperations: grantRole === 'viewer' ? false : grantCanManageOps,
        canManagePermissions: grantRole === 'manager' ? grantCanManagePerms : false,
      });
      setGrantEmail('');
      await hydrateDetailForFarm(selectedFarm);
      setActionNotice({
        variant: 'success',
        message: 'Farm access permission granted and logged.',
      });
    } catch (err) {
      setActionNotice({
        variant: 'error',
        message: err instanceof Error ? err.message : 'Could not grant access.',
      });
    } finally {
      setSavingGrant(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!selectedFarm) return;
    setActionNotice(null);
    try {
      await revokeFarmPermission(selectedFarm.id, grantId);
      await hydrateDetailForFarm(selectedFarm);
      setActionNotice({
        variant: 'success',
        message: 'Access revoked immediately.',
      });
    } catch (err) {
      setActionNotice({
        variant: 'error',
        message: err instanceof Error ? err.message : 'Could not revoke access.',
      });
    }
  };

  const activeConflict = useMemo(
    () => farmConflicts.find((c) => c.id === activeConflictId) ?? farmConflicts[0] ?? null,
    [farmConflicts, activeConflictId]
  );

  const handleResolveConflict = async (
    strategy: 'keep_server' | 'overwrite_with_server_backup'
  ) => {
    if (liveBoundaryConflict && selectedFarm) {
      setResolvingConflict(true);
      try {
        if (strategy === 'keep_server') {
          await refreshFarms();
          setLiveBoundaryConflict(null);
          setActionNotice({
            variant: 'success',
            message: 'Loaded latest server boundary and discarded conflicting local draft.',
          });
        } else {
          const res = await updateFarmBoundary(selectedFarm.id, {
            expectedVersion: liveBoundaryConflict.conflict.serverVersion,
            boundaryGeojson: liveBoundaryConflict.localBoundary,
            editSource: 'conflict_resolution',
            resolutionStrategy: 'overwrite_with_server_backup',
          });
          setLiveBoundaryConflict(null);
          await hydrateDetailForFarm(res.farm);
          setActionNotice({
            variant: 'success',
            message: 'Applied your boundary edit while preserving the server revision in history.',
          });
        }
      } catch (err) {
        setActionNotice({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Conflict resolution failed.',
        });
      } finally {
        setResolvingConflict(false);
      }
      return;
    }

    if (!activeConflict) return;
    setResolvingConflict(true);
    try {
      await resolveFarmConflict(activeConflict.id, strategy);
      setActiveConflictId(null);
      setActionNotice({
        variant: 'success',
        message:
          strategy === 'keep_server'
            ? 'Kept latest server boundary and discarded conflicting offline edit.'
            : 'Saved your offline edit while preserving the server boundary in revision history.',
      });
    } catch (err) {
      setActionNotice({
        variant: 'error',
        message: err instanceof Error ? err.message : 'Conflict resolution failed.',
      });
    } finally {
      setResolvingConflict(false);
    }
  };

  const mapCenter: LatLngPoint = useMemo(() => {
    if (selectedFarm?.centroidLat !== null && selectedFarm?.centroidLat !== undefined && selectedFarm.centroidLng !== null) {
      return { lat: selectedFarm.centroidLat, lng: selectedFarm.centroidLng };
    }
    const districtHit = UGANDA_GAZETTEER.find(
      (g) => g.district.toLowerCase() === (selectedFarm?.district ?? '').toLowerCase()
    );
    return districtHit
      ? { lat: districtHit.lat, lng: districtHit.lng }
      : { lat: 0.3476, lng: 32.5825 };
  }, [selectedFarm]);

  const preferredUnit = session?.user.preferredAreaUnit ?? 'acres';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h1 className="text-xl sm:text-2xl font-bold text-ink">{t.farms.title}</h1>
          <p className="text-sm text-ink-muted">{t.farms.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SecondaryButton onClick={refreshFarms} loading={loadingFarms} className="min-h-[44px]">
            Refresh
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
            className="min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            {t.farms.registerButton}
          </PrimaryButton>
        </div>
      </div>

      {/* Offline & Conflict Banners */}
      {farmsSource === 'offline_cache' && farmsCachedAt && (
        <InlineAlert
          variant="info"
          message={`Showing offline cached farms synced at ${new Date(farmsCachedAt).toLocaleString()}. Previously synced boundaries remain viewable and editable offline.`}
        />
      )}

      {farmsError && (
        <InlineAlert variant="error" message={farmsError} onRetry={refreshFarms} />
      )}

      {farmConflicts.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-amber-950">
                {t.farms.conflictTitle} ({farmConflicts.length})
              </p>
              <p className="text-xs text-amber-900">
                An offline boundary or metadata edit collided with a newer server version. No data was overwritten.
              </p>
            </div>
          </div>
          <PrimaryButton
            onClick={() => setActiveConflictId(farmConflicts[0]!.id)}
            className="min-h-[40px] bg-amber-800 hover:bg-amber-900"
          >
            Review &amp; Resolve Conflict
          </PrimaryButton>
        </div>
      )}

      {actionNotice && (
        <InlineAlert variant={actionNotice.variant} message={actionNotice.message} />
      )}

      {/* Ownership Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-white rounded-lg border border-border-hairline">
          {(
            [
              { id: 'all', label: `All Accessible (${farms.length})` },
              {
                id: 'individual',
                label: `Individual (${farms.filter((f) => f.ownershipType === 'individual').length})`,
              },
              {
                id: 'organisation',
                label: `Organisation (${farms.filter((f) => f.ownershipType === 'organisation').length})`,
              },
              {
                id: 'delegated',
                label: `Delegated (${
                  farms.filter(
                    (f) =>
                      f.effectivePermissions.accessReason === 'direct_user_grant' ||
                      f.effectivePermissions.accessReason === 'cooperative_delegation'
                  ).length
                })`,
              },
            ] as const
          ).map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setFilter(tabItem.id)}
              className={`min-h-[38px] px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                filter === tabItem.id
                  ? 'bg-forest-900 text-white'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>

        <span className="text-xs text-ink-muted">
          Display priority: <strong className="text-ink">{preferredUnit}</strong> · WGS84 / PostGIS
        </span>
      </div>

      {/* Empty State */}
      {!loadingFarms && filteredFarms.length === 0 ? (
        <SurfaceCard className="p-8 text-center space-y-4">
          <MapPin className="w-8 h-8 text-leaf-600 mx-auto" />
          <div className="space-y-1 max-w-lg mx-auto">
            <h2 className="text-base font-semibold text-ink">No Farms in This View</h2>
            <p className="text-sm text-ink-muted">{t.farms.emptyState}</p>
          </div>
          <PrimaryButton onClick={() => setShowCreateModal(true)} className="min-h-[44px]">
            <Plus className="w-4 h-4" />
            {t.farms.registerButton}
          </PrimaryButton>
        </SurfaceCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Farm List */}
          <div className="lg:col-span-4 space-y-2.5">
            {filteredFarms.map((farm) => {
              const selected = selectedFarm?.id === farm.id;
              const primaryArea =
                farm.areaAcres !== null && farm.areaHectares !== null
                  ? preferredUnit === 'acres'
                    ? `${farm.areaAcres.toFixed(2)} ac`
                    : `${farm.areaHectares.toFixed(2)} ha`
                  : 'Area pending boundary';

              return (
                <button
                  key={farm.id}
                  type="button"
                  onClick={() => setSelectedFarmId(farm.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer space-y-2 ${
                    selected
                      ? 'bg-white border-forest-900 ring-1 ring-forest-900'
                      : 'bg-white border-border-hairline hover:bg-canvas/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{farm.name}</p>
                      <p className="text-xs text-ink-muted truncate">{farm.ownerLabel}</p>
                    </div>
                    <span className="shrink-0 px-2 py-0.5 rounded bg-canvas border border-border-hairline text-[11px] font-mono tabular-nums text-ink">
                      v{farm.version}
                    </span>
                  </div>

                  <MetadataLine
                    items={[
                      farm.district,
                      primaryArea,
                      formatOwnershipBadge(farm),
                    ]}
                  />

                  <div className="flex items-center justify-between text-[11px] text-ink-muted pt-1 border-t border-border-hairline/70">
                    <span>
                      {farm.boundaryGeojson ? 'PostGIS boundary saved' : 'Boundary not drawn'}
                    </span>
                    {farm.id.startsWith('offline-farm-') && (
                      <span className="text-amber-700 font-medium">Queued offline</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Farm Detail Workspace */}
          {selectedFarm && (
            <SurfaceCard className="lg:col-span-8 p-4 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-hairline pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-ink">{selectedFarm.name}</h2>
                    {selectedFarm.farmCode && (
                      <span className="px-2 py-0.5 rounded bg-canvas border border-border-hairline font-mono text-xs text-ink-muted">
                        {selectedFarm.farmCode}
                      </span>
                    )}
                  </div>
                  <MetadataLine
                    items={[
                      selectedFarm.ownerLabel,
                      selectedFarm.district,
                      selectedFarm.subcounty,
                      formatOwnershipBadge(selectedFarm),
                    ]}
                  />
                </div>

                {/* Authoritative Area Readout */}
                <div className="text-left sm:text-right">
                  <p className="text-[11px] uppercase tracking-wide text-ink-muted">
                    {t.farms.areaLabel}
                  </p>
                  {selectedFarm.areaAcres !== null && selectedFarm.areaHectares !== null ? (
                    <p className="text-base font-bold text-forest-900 font-mono tabular-nums">
                      {selectedFarm.areaAcres.toFixed(2)} ac · {selectedFarm.areaHectares.toFixed(2)} ha
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-ink-muted">Draw boundary to compute</p>
                  )}
                </div>
              </div>

              {/* Detail Sub-tabs */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border-hairline pb-3">
                {(
                  [
                    { id: 'boundary', label: t.farms.drawBoundaryTitle },
                    { id: 'details', label: 'Location & Details' },
                    { id: 'access', label: 'Permissions & Revisions' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDetailTab(item.id)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                      detailTab === item.id
                        ? 'bg-forest-900 text-white'
                        : 'bg-canvas text-ink-muted hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {detailError && <InlineAlert variant="error" message={detailError} />}

              {detailTab === 'boundary' && (
                <div className="space-y-4">
                  {!selectedFarm.effectivePermissions.canEditBoundary && (
                    <InlineAlert
                      variant="info"
                      message="Read-only boundary view: your current role or grant does not permit modifying this farm's boundaries."
                    />
                  )}

                  {previewRevision && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950">
                      <span>
                        Overlaying historical boundary <strong>v{previewRevision.version}</strong> ({previewRevision.areaAcres.toFixed(2)} ac)
                      </span>
                      <button
                        type="button"
                        onClick={() => setPreviewRevision(null)}
                        className="font-semibold underline cursor-pointer"
                      >
                        Hide Overlay
                      </button>
                    </div>
                  )}

                  <InteractiveFarmMap
                    center={mapCenter}
                    points={editingPoints}
                    onChangePoints={
                      selectedFarm.effectivePermissions.canEditBoundary
                        ? setEditingPoints
                        : undefined
                    }
                    mode="draw_boundary"
                    editable={selectedFarm.effectivePermissions.canEditBoundary}
                    secondaryBoundary={previewRevision?.boundaryGeojson ?? null}
                    secondaryLabel={
                      previewRevision ? `Revision v${previewRevision.version}` : undefined
                    }
                    isOnline={isOnline}
                    mappingConfig={mappingConfig}
                  />

                  {/* Topology feedback + Area summary */}
                  <div className="rounded-xl border border-border-hairline bg-canvas p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-ink-muted">
                          Vertices: <strong className="text-ink font-mono tabular-nums">{editingPoints.length}</strong>
                          {boundaryValidation.area && (
                            <>
                              {' '}· Live Spherical Area:{' '}
                              <strong className="text-forest-900 font-mono tabular-nums">
                                {boundaryValidation.area.areaAcres.toFixed(3)} ac ({boundaryValidation.area.areaHectares.toFixed(3)} ha)
                              </strong>
                            </>
                          )}
                        </p>
                        {!boundaryValidation.valid && boundaryValidation.reason && (
                          <p className="text-xs text-red-700">{boundaryValidation.reason}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <SecondaryButton
                          onClick={() => setShowCoordTable((v) => !v)}
                          className="min-h-[40px] text-xs"
                        >
                          {showCoordTable ? 'Hide Corner List' : 'Manual Coordinates'}
                        </SecondaryButton>

                        {selectedFarm.effectivePermissions.canEditBoundary && (
                          <PrimaryButton
                            onClick={handleSaveBoundary}
                            loading={savingBoundary}
                            disabled={!boundaryValidation.valid}
                            className="min-h-[44px]"
                          >
                            <Check className="w-4 h-4" />
                            {t.farms.saveBoundaryButton}
                          </PrimaryButton>
                        )}
                      </div>
                    </div>

                    {showCoordTable && (
                      <div className="pt-3 border-t border-border-hairline space-y-3">
                        {selectedFarm.effectivePermissions.canEditBoundary && (
                          <div className="flex flex-wrap items-end gap-2">
                            <div>
                              <label className="block text-[11px] text-ink-muted mb-1">
                                Latitude
                              </label>
                              <input
                                type="number"
                                step="0.000001"
                                value={manualCoordLat}
                                onChange={(e) => setManualCoordLat(e.target.value)}
                                placeholder="e.g. 2.2499"
                                className="min-h-[38px] w-36 px-2.5 rounded-lg border border-border-hairline bg-white text-xs font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-ink-muted mb-1">
                                Longitude
                              </label>
                              <input
                                type="number"
                                step="0.000001"
                                value={manualCoordLng}
                                onChange={(e) => setManualCoordLng(e.target.value)}
                                placeholder="e.g. 32.8998"
                                className="min-h-[38px] w-36 px-2.5 rounded-lg border border-border-hairline bg-white text-xs font-mono"
                              />
                            </div>
                            <SecondaryButton
                              onClick={() => {
                                const lat = Number(manualCoordLat);
                                const lng = Number(manualCoordLng);
                                if (
                                  Number.isFinite(lat) &&
                                  Number.isFinite(lng) &&
                                  lat >= -90 &&
                                  lat <= 90 &&
                                  lng >= -180 &&
                                  lng <= 180
                                ) {
                                  setEditingPoints([...editingPoints, { lat, lng }]);
                                  setManualCoordLat('');
                                  setManualCoordLng('');
                                }
                              }}
                              className="min-h-[38px] text-xs"
                            >
                              Add Corner
                            </SecondaryButton>
                          </div>
                        )}

                        {editingPoints.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                            {editingPoints.map((pt, idx) => (
                              <div
                                key={`${idx}-${pt.lat}-${pt.lng}`}
                                className="flex items-center justify-between px-2.5 py-1.5 rounded bg-white border border-border-hairline text-xs font-mono tabular-nums"
                              >
                                <span>
                                  #{idx + 1}: {pt.lat.toFixed(6)}, {pt.lng.toFixed(6)}
                                </span>
                                {selectedFarm.effectivePermissions.canEditBoundary && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingPoints(editingPoints.filter((_, i) => i !== idx))
                                    }
                                    className="text-red-700 hover:underline font-sans text-[11px] cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {detailTab === 'details' && (
                <form onSubmit={handleSaveDetails} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-ink">
                      Relocate Farm by Search (Independent of Your GPS)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <div className="relative flex-1 min-w-[220px]">
                        <Search className="w-4 h-4 text-ink-muted absolute left-3 top-3" />
                        <input
                          type="text"
                          value={editLocationQuery}
                          onChange={(e) => setEditLocationQuery(e.target.value)}
                          placeholder={t.farms.searchLocationPlaceholder}
                          disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                          className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-border-hairline bg-white text-sm"
                        />
                      </div>
                      <SecondaryButton
                        onClick={() => handleSearchLocations(editLocationQuery, 'edit')}
                        loading={searchingLocation}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="min-h-[42px]"
                      >
                        Search Location
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => handleUseCurrentGps('edit')}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="min-h-[42px]"
                      >
                        <Compass className="w-4 h-4" />
                        {t.farms.useGpsButton}
                      </SecondaryButton>
                    </div>

                    {editLocationHits.length > 0 && (
                      <div className="rounded-lg border border-border-hairline bg-white divide-y divide-border-hairline max-h-44 overflow-y-auto">
                        {editLocationHits.map((hit) => (
                          <button
                            key={hit.id}
                            type="button"
                            onClick={() => applyLocationSelection(hit, 'edit')}
                            className="w-full text-left px-3 py-2 hover:bg-canvas text-xs flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <span className="font-medium text-ink">{hit.label}</span>
                            <span className="font-mono text-ink-muted shrink-0">
                              {hit.lat.toFixed(3)}, {hit.lng.toFixed(3)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">Farm Name</label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">
                        Farm Code (Optional)
                      </label>
                      <input
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">District</label>
                      <input
                        type="text"
                        list="uganda-district-options"
                        required
                        value={editDistrict}
                        onChange={(e) => setEditDistrict(e.target.value)}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">
                        Subcounty / Parish (Optional)
                      </label>
                      <input
                        type="text"
                        value={editSubcounty}
                        onChange={(e) => setEditSubcounty(e.target.value)}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">
                        Center Latitude
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        value={editLat}
                        onChange={(e) => {
                          setEditLat(e.target.value);
                          setEditLocationSource('manual_coords');
                        }}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">
                        Center Longitude
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        value={editLng}
                        onChange={(e) => {
                          setEditLng(e.target.value);
                          setEditLocationSource('manual_coords');
                        }}
                        disabled={!selectedFarm.effectivePermissions.canEditMetadata}
                        className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm font-mono"
                      />
                    </div>
                  </div>

                  {selectedFarm.effectivePermissions.canEditMetadata && (
                    <PrimaryButton type="submit" loading={savingDetails} className="min-h-[44px]">
                      {t.common.save}
                    </PrimaryButton>
                  )}
                </form>
              )}

              {detailTab === 'access' && (
                <div className="space-y-6">
                  {/* Permissions Panel */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-leaf-600" />
                      <h3 className="text-sm font-semibold text-ink">
                        {t.farms.permissionsTitle}
                      </h3>
                    </div>

                    {!selectedFarm.effectivePermissions.canManagePermissions ? (
                      <div className="rounded-lg border border-border-hairline bg-canvas p-4 text-xs text-ink-muted flex items-center gap-2">
                        <Lock className="w-4 h-4 shrink-0" />
                        Only the farm owner or a manager with permission rights can delegate or revoke access.
                      </div>
                    ) : (
                      <>
                        <form
                          onSubmit={handleGrantPermission}
                          className="rounded-xl border border-border-hairline bg-canvas p-4 space-y-3"
                        >
                          <p className="text-xs font-semibold text-ink flex items-center gap-1.5">
                            <UserPlus className="w-3.5 h-3.5 text-forest-900" />
                            Grant Manager or Cooperative Access
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                                Grantee Type
                              </label>
                              <select
                                value={grantType}
                                onChange={(e) =>
                                  setGrantType(e.target.value as 'user' | 'organisation')
                                }
                                className="w-full min-h-[40px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs"
                              >
                                <option value="user">Individual User (Email)</option>
                                <option value="organisation">Cooperative / Organisation</option>
                              </select>
                            </div>

                            {grantType === 'user' ? (
                              <div>
                                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                                  User Email
                                </label>
                                <input
                                  type="email"
                                  required
                                  value={grantEmail}
                                  onChange={(e) => setGrantEmail(e.target.value)}
                                  placeholder="manager@example.com"
                                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs"
                                />
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                                  Cooperative / Organisation
                                </label>
                                <select
                                  value={grantOrgId}
                                  onChange={(e) => setGrantOrgId(e.target.value)}
                                  className="w-full min-h-[40px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs"
                                >
                                  {session?.organisations.map((org) => (
                                    <option key={org.id} value={org.id}>
                                      {org.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            <div>
                              <label className="block text-[11px] font-medium text-ink-muted mb-1">
                                Access Role
                              </label>
                              <select
                                value={grantRole}
                                onChange={(e) => {
                                  const nextRole = e.target.value as FarmAccessRole;
                                  setGrantRole(nextRole);
                                  if (nextRole === 'viewer') {
                                    setGrantCanEditBoundary(false);
                                    setGrantCanManageOps(false);
                                    setGrantCanManagePerms(false);
                                  } else if (nextRole === 'agronomist') {
                                    setGrantCanEditBoundary(true);
                                    setGrantCanManageOps(true);
                                    setGrantCanManagePerms(false);
                                  } else {
                                    setGrantCanEditBoundary(true);
                                    setGrantCanManageOps(true);
                                  }
                                }}
                                className="w-full min-h-[40px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs"
                              >
                                <option value="manager">Manager</option>
                                <option value="agronomist">Agronomist</option>
                                <option value="viewer">Read-Only Viewer</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-4 text-xs text-ink">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={grantCanEditBoundary}
                                disabled={grantRole === 'viewer'}
                                onChange={(e) => setGrantCanEditBoundary(e.target.checked)}
                              />
                              Can Edit Boundary
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={grantCanManageOps}
                                disabled={grantRole === 'viewer'}
                                onChange={(e) => setGrantCanManageOps(e.target.checked)}
                              />
                              Can Manage Operations
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={grantCanManagePerms}
                                disabled={grantRole !== 'manager'}
                                onChange={(e) => setGrantCanManagePerms(e.target.checked)}
                              />
                              Can Manage Permissions
                            </label>
                          </div>

                          <PrimaryButton
                            type="submit"
                            loading={savingGrant}
                            disabled={
                              grantType === 'organisation' &&
                              (session?.organisations.length ?? 0) === 0
                            }
                            className="min-h-[40px] text-xs"
                          >
                            Grant Revocable Access
                          </PrimaryButton>
                        </form>

                        {loadingDetail ? (
                          <p className="text-xs text-ink-muted">{t.common.loading}</p>
                        ) : grants.length === 0 ? (
                          <p className="text-xs text-ink-muted">
                            No external managers or cooperatives have been delegated access to this farm yet.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {grants.map((grant) => {
                              const isRevoked = Boolean(grant.revokedAt);
                              return (
                                <div
                                  key={grant.id}
                                  className={`p-3 rounded-lg border flex flex-wrap items-center justify-between gap-3 ${
                                    isRevoked
                                      ? 'bg-canvas/60 border-border-hairline opacity-70'
                                      : 'bg-white border-border-hairline'
                                  }`}
                                >
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      {grant.granteeType === 'organisation' && (
                                        <Building2 className="w-3.5 h-3.5 text-forest-900" />
                                      )}
                                      <p className="text-sm font-medium text-ink">
                                        {grant.granteeLabel}
                                      </p>
                                      <span className="px-1.5 py-0.5 rounded bg-canvas border border-border-hairline text-[11px] font-medium text-ink">
                                        {grant.accessRole}
                                      </span>
                                    </div>
                                    <MetadataLine
                                      items={[
                                        grant.granteeSubLabel,
                                        grant.canEditBoundary ? 'Boundary edit' : 'Boundary read-only',
                                        grant.canManageOperations ? 'Operations' : null,
                                        isRevoked
                                          ? `Revoked ${new Date(grant.revokedAt!).toLocaleDateString()}`
                                          : 'Active',
                                      ]}
                                    />
                                  </div>

                                  {!isRevoked && (
                                    <SecondaryButton
                                      onClick={() => handleRevokeGrant(grant.id)}
                                      className="min-h-[36px] px-3 text-xs text-red-700 border-red-200 hover:bg-red-50"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                      Revoke
                                    </SecondaryButton>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Boundary Revision History */}
                  <div className="space-y-3 pt-4 border-t border-border-hairline">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-forest-900" />
                      <h3 className="text-sm font-semibold text-ink">
                        {t.farms.revisionsTitle}
                      </h3>
                    </div>

                    {revisions.length === 0 ? (
                      <p className="text-xs text-ink-muted">
                        No saved PostGIS boundary revisions yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {revisions.map((rev) => (
                          <div
                            key={rev.id}
                            className="p-3 rounded-lg border border-border-hairline bg-white flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="space-y-0.5">
                              <p className="font-semibold text-ink font-mono tabular-nums">
                                Version v{rev.version} · {rev.areaAcres.toFixed(2)} ac ({rev.areaHectares.toFixed(2)} ha)
                              </p>
                              <MetadataLine
                                items={[
                                  rev.editedByLabel,
                                  rev.editSource,
                                  new Date(rev.createdAt).toLocaleString(),
                                ]}
                              />
                            </div>
                            <SecondaryButton
                              onClick={() => {
                                setPreviewRevision(rev);
                                setDetailTab('boundary');
                              }}
                              className="min-h-[34px] px-3 text-xs"
                            >
                              Overlay on Map
                            </SecondaryButton>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </SurfaceCard>
          )}
        </div>
      )}

      {/* Register New Farm Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
          <SurfaceCard className="w-full max-w-2xl p-5 sm:p-6 space-y-4 my-8">
            <div className="flex items-center justify-between gap-3 border-b border-border-hairline pb-3">
              <div>
                <h2 className="text-lg font-bold text-ink">{t.farms.registerButton}</h2>
                <p className="text-xs text-ink-muted">
                  Search any Ugandan district or town remotely—no need to be physically on the farm.
                </p>
              </div>
              <SecondaryButton
                onClick={() => setShowCreateModal(false)}
                className="min-h-[36px] px-3 text-xs"
              >
                Close
              </SecondaryButton>
            </div>

            {createError && <InlineAlert variant="error" message={createError} />}

            <form onSubmit={handleCreateFarm} className="space-y-4">
              {/* Ownership selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Farm Ownership
                  </label>
                  <select
                    value={newOwnership}
                    onChange={(e) => setNewOwnership(e.target.value as FarmOwnershipType)}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                  >
                    <option value="individual">Individual-Owned Farm</option>
                    <option value="organisation" disabled={manageableOrgs.length === 0}>
                      Organisation-Owned Farm
                    </option>
                  </select>
                </div>

                {newOwnership === 'organisation' && (
                  <div>
                    <label className="block text-xs font-medium text-ink mb-1">
                      Owning Organisation
                    </label>
                    <select
                      value={newOwnerOrgId}
                      onChange={(e) => setNewOwnerOrgId(e.target.value)}
                      required
                      className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                    >
                      {manageableOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name} ({org.membershipRole})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">Farm Name</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Lira Block B Maize Farm"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Farm Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="e.g. LRA-04"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm font-mono"
                  />
                </div>
              </div>

              {/* Remote location search */}
              <div className="rounded-xl border border-border-hairline bg-canvas p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-ink">
                    Locate Farm Remotely (GPS-Independent)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleUseCurrentGps('create')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-forest-900 hover:underline cursor-pointer"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    {t.farms.useGpsButton}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-ink-muted absolute left-3 top-3" />
                    <input
                      type="text"
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      placeholder={t.farms.searchLocationPlaceholder}
                      className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-border-hairline bg-white text-sm"
                    />
                  </div>
                  <SecondaryButton
                    onClick={() => handleSearchLocations(locationQuery, 'create')}
                    loading={searchingLocation}
                    className="min-h-[42px]"
                  >
                    Search
                  </SecondaryButton>
                </div>

                {gpsStatus && <p className="text-xs text-ink-muted">{gpsStatus}</p>}

                {locationResults.length > 0 && (
                  <div className="rounded-lg border border-border-hairline bg-white divide-y divide-border-hairline max-h-40 overflow-y-auto">
                    {locationResults.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => applyLocationSelection(hit, 'create')}
                        className="w-full text-left px-3 py-2 hover:bg-canvas text-xs flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="font-medium text-ink">{hit.label}</span>
                        <span className="font-mono text-ink-muted shrink-0">
                          {hit.source === 'osm_nominatim' ? 'OSM' : 'Gazetteer'} · {hit.lat.toFixed(3)}, {hit.lng.toFixed(3)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <InteractiveFarmMap
                  center={newPin}
                  points={[]}
                  mode="pin"
                  onSelectPin={(lat, lng) => {
                    setNewPin({ lat, lng });
                    setNewLocationSource('map_pin');
                  }}
                  isOnline={isOnline}
                  mappingConfig={mappingConfig}
                  heightClass="h-[220px]"
                />
                <p className="text-[11px] text-ink-muted">
                  Location search: {mappingConfig?.locationProviderLabel ?? 'Uganda Gazetteer + OSM Nominatim'} (manual search only; geocoding data &copy; OpenStreetMap contributors when OSM is active).
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      District
                    </label>
                    <input
                      type="text"
                      list="uganda-district-options"
                      required
                      value={newDistrict}
                      onChange={(e) => setNewDistrict(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      Subcounty
                    </label>
                    <input
                      type="text"
                      value={newSubcounty}
                      onChange={(e) => setNewSubcounty(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      value={newPin.lat}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          setNewPin((p) => ({ ...p, lat: v }));
                          setNewLocationSource('manual_coords');
                        }
                      }}
                      className="w-full min-h-[38px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      value={newPin.lng}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          setNewPin((p) => ({ ...p, lng: v }));
                          setNewLocationSource('manual_coords');
                        }
                      }}
                      className="w-full min-h-[38px] px-2.5 rounded-lg border border-border-hairline bg-white text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Declared Estimated Area (Optional)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={newDeclaredArea}
                    onChange={(e) => setNewDeclaredArea(e.target.value)}
                    placeholder="e.g. 12.5"
                    className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">Unit</label>
                  <select
                    value={newDeclaredUnit}
                    onChange={(e) => setNewDeclaredUnit(e.target.value as AreaUnit)}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-border-hairline bg-white text-sm"
                  >
                    <option value="acres">{t.common.acres}</option>
                    <option value="hectares">{t.common.hectares}</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <SecondaryButton
                  onClick={() => setShowCreateModal(false)}
                  className="min-h-[44px]"
                >
                  {t.common.cancel}
                </SecondaryButton>
                <PrimaryButton type="submit" loading={creatingFarm} className="min-h-[44px]">
                  Create Farm &amp; Open Boundary Map
                </PrimaryButton>
              </div>
            </form>
          </SurfaceCard>
        </div>
      )}

      {/* 409 Sync / Concurrent Edit Conflict Resolution Modal */}
      {((activeConflict && activeConflict.conflictPayload) || liveBoundaryConflict) && (() => {
        const conflict = liveBoundaryConflict?.conflict ?? activeConflict!.conflictPayload!;
        const localBoundary =
          liveBoundaryConflict?.localBoundary ??
          (activeConflict?.type === 'farm_boundary_update'
            ? activeConflict.payload.boundaryGeojson
            : null);

        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
            <SurfaceCard className="w-full max-w-3xl p-5 sm:p-6 space-y-4 my-8">
              <div className="flex items-start justify-between gap-3 border-b border-border-hairline pb-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-lg font-bold text-ink">{t.farms.conflictTitle}</h2>
                    <p className="text-xs text-ink-muted">
                      {conflict.serverFarm.name}: your edit expected v{conflict.expectedVersion}, while server is now at v{conflict.serverVersion}.
                    </p>
                  </div>
                </div>
                <SecondaryButton
                  onClick={() => {
                    setActiveConflictId(null);
                    setLiveBoundaryConflict(null);
                  }}
                  className="min-h-[36px] px-3 text-xs"
                >
                  Later
                </SecondaryButton>
              </div>

              {localBoundary && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                      <p className="font-semibold text-amber-950">
                        Server Boundary (v{conflict.serverVersion}) — Dashed Amber
                      </p>
                      <p className="font-mono tabular-nums text-amber-900">
                        {conflict.serverFarm.areaAcres?.toFixed(2) ?? '0.00'} ac /{' '}
                        {conflict.serverFarm.areaHectares?.toFixed(2) ?? '0.00'} ha
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50">
                      <p className="font-semibold text-emerald-950">
                        Your Draft (from v{conflict.expectedVersion}) — Solid Green
                      </p>
                      {(() => {
                        const localArea = calculateGeoJsonArea(localBoundary);
                        return (
                          <p className="font-mono tabular-nums text-emerald-900">
                            {localArea.areaAcres.toFixed(2)} ac / {localArea.areaHectares.toFixed(2)} ha
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  <InteractiveFarmMap
                    center={{
                      lat: conflict.serverFarm.centroidLat ?? 0.3476,
                      lng: conflict.serverFarm.centroidLng ?? 32.5825,
                    }}
                    points={geoJsonBoundaryToLatLngPoints(localBoundary)}
                    secondaryBoundary={conflict.serverFarm.boundaryGeojson}
                    secondaryLabel={`Server v${conflict.serverVersion}`}
                    primaryLabel="Your Draft Edit"
                    mode="view"
                    editable={false}
                    isOnline={isOnline}
                    mappingConfig={mappingConfig}
                    heightClass="h-[280px]"
                  />
                </div>
              )}

              {activeConflict && (
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <Clock className="w-3.5 h-3.5" />
                  Queued at {new Date(activeConflict.queuedAt).toLocaleString()}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-border-hairline">
                <SecondaryButton
                  onClick={() => handleResolveConflict('keep_server')}
                  loading={resolvingConflict}
                  className="min-h-[44px]"
                >
                  Keep Server Version (Discard Draft)
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => handleResolveConflict('overwrite_with_server_backup')}
                  loading={resolvingConflict}
                  className="min-h-[44px]"
                >
                  Apply My Edit (Backup Server Revision)
                </PrimaryButton>
              </div>
            </SurfaceCard>
          </div>
        );
      })()}

      <datalist id="uganda-district-options">
        {UGANDA_DISTRICTS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}
