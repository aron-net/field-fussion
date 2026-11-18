import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import {
  farmAccessGrants,
  farmBoundaryRevisions,
  farms,
  organisationMemberships,
  organisations,
  users,
} from '../schema.ts';
import {
  SQ_METERS_PER_ACRE,
  SQ_METERS_PER_HECTARE,
  validateGeoJsonBoundaryTopology,
} from '../../shared/geo/area.ts';
import type {
  AreaUnit,
  FarmAccessGrantRecord,
  FarmAccessRole,
  FarmBoundaryRevisionRecord,
  FarmDetailPayload,
  FarmEditSource,
  FarmEffectivePermissions,
  FarmGeoJsonBoundary,
  FarmGranteeType,
  FarmLocationSource,
  FarmOwnershipType,
  FarmRecord,
  OrgRole,
} from '../../shared/types/domain.ts';
import type {
  CreateFarmInput,
  CreateFarmPermissionInput,
  UpdateFarmBoundaryInput,
  UpdateFarmInput,
} from '../../shared/validation/schemas.ts';

export class FarmRepositoryError extends Error {
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
    this.name = 'FarmRepositoryError';
    this.status = status;
    this.code = code;
    this.recoveryAction = recoveryAction;
    this.details = details;
  }
}

interface PostgisMetrics {
  areaSqMeters: number;
  areaAcres: number;
  areaHectares: number;
  centroidLat: number;
  centroidLng: number;
}

type DbExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'execute'>;

async function validateAndComputePostgisBoundary(
  executor: DbExecutor,
  boundary: FarmGeoJsonBoundary
): Promise<PostgisMetrics> {
  const topo = validateGeoJsonBoundaryTopology(boundary);
  if (!topo.valid) {
    throw new FarmRepositoryError(
      400,
      'INVALID_BOUNDARY_TOPOLOGY',
      topo.reason,
      'Adjust polygon points so edges do not cross and at least 3 distinct corners remain.'
    );
  }

  const geojsonString = JSON.stringify(boundary);
  const result = await executor.execute(sql`
    SELECT
      ST_IsValid(ST_GeomFromGeoJSON(${geojsonString})) AS is_valid,
      ST_IsValidReason(ST_GeomFromGeoJSON(${geojsonString})) AS invalid_reason,
      ST_Area(ST_GeomFromGeoJSON(${geojsonString})::geography) AS area_sq_meters,
      ST_Y(ST_Centroid(ST_GeomFromGeoJSON(${geojsonString}))) AS centroid_lat,
      ST_X(ST_Centroid(ST_GeomFromGeoJSON(${geojsonString}))) AS centroid_lng
  `);

  const row = result.rows[0] as
    | {
        is_valid?: boolean;
        invalid_reason?: string;
        area_sq_meters?: number | string;
        centroid_lat?: number | string;
        centroid_lng?: number | string;
      }
    | undefined;

  if (!row || !row.is_valid) {
    throw new FarmRepositoryError(
      400,
      'POSTGIS_INVALID_GEOMETRY',
      `Boundary geometry failed PostGIS validation: ${row?.invalid_reason ?? 'Invalid polygon'}`,
      'Redraw the farm boundary without crossing lines or duplicate points.'
    );
  }

  const areaSqMeters = Math.round(Number(row.area_sq_meters ?? 0) * 100) / 100;
  if (!Number.isFinite(areaSqMeters) || areaSqMeters < 1) {
    throw new FarmRepositoryError(
      400,
      'POSTGIS_ZERO_AREA',
      'Calculated PostGIS farm area must be at least 1 square meter.'
    );
  }

  return {
    areaSqMeters,
    areaAcres: Math.round((areaSqMeters / SQ_METERS_PER_ACRE) * 1000) / 1000,
    areaHectares: Math.round((areaSqMeters / SQ_METERS_PER_HECTARE) * 1000) / 1000,
    centroidLat: Math.round(Number(row.centroid_lat ?? 0) * 1_000_000) / 1_000_000,
    centroidLng: Math.round(Number(row.centroid_lng ?? 0) * 1_000_000) / 1_000_000,
  };
}

function declaredAreaToMetrics(value: number, unit: AreaUnit) {
  const areaSqMeters =
    unit === 'acres' ? value * SQ_METERS_PER_ACRE : value * SQ_METERS_PER_HECTARE;
  return {
    areaSqMeters: Math.round(areaSqMeters * 100) / 100,
    areaAcres: Math.round((areaSqMeters / SQ_METERS_PER_ACRE) * 1000) / 1000,
    areaHectares: Math.round((areaSqMeters / SQ_METERS_PER_HECTARE) * 1000) / 1000,
  };
}

async function getActiveOrgRoleMap(
  executor: DbExecutor,
  userId: string
): Promise<Map<string, OrgRole>> {
  const rows = await executor
    .select({
      organisationId: organisationMemberships.organisationId,
      orgRole: organisationMemberships.orgRole,
    })
    .from(organisationMemberships)
    .where(
      and(
        eq(organisationMemberships.userId, userId),
        eq(organisationMemberships.status, 'active')
      )
    );

  const map = new Map<string, OrgRole>();
  for (const r of rows) {
    map.set(r.organisationId, r.orgRole as OrgRole);
  }
  return map;
}

function computeEffectivePermissions(params: {
  farm: typeof farms.$inferSelect;
  userId: string;
  orgRoles: Map<string, OrgRole>;
  activeGrants: (typeof farmAccessGrants.$inferSelect)[];
}): FarmEffectivePermissions | null {
  const { farm, userId, orgRoles, activeGrants } = params;

  if (farm.ownershipType === 'individual' && farm.ownerUserId === userId) {
    return {
      canView: true,
      canEditMetadata: true,
      canEditBoundary: true,
      canManageOperations: true,
      canManagePermissions: true,
      accessReason: 'individual_owner',
    };
  }

  let canView = false;
  let canEditMetadata = false;
  let canEditBoundary = false;
  let canManageOperations = false;
  let canManagePermissions = false;
  let accessReason: FarmEffectivePermissions['accessReason'] | null = null;

  if (farm.ownershipType === 'organisation' && farm.ownerOrganisationId) {
    const orgRole = orgRoles.get(farm.ownerOrganisationId);
    if (orgRole) {
      canView = true;
      accessReason = 'organisation_member';
      if (orgRole === 'owner' || orgRole === 'manager') {
        canEditMetadata = true;
        canEditBoundary = true;
        canManageOperations = true;
        canManagePermissions = true;
      } else if (orgRole === 'agronomist') {
        canEditMetadata = true;
        canEditBoundary = true;
        canManageOperations = true;
      }
    }
  }

  for (const grant of activeGrants) {
    if (grant.revokedAt) continue;

    if (grant.granteeType === 'user' && grant.granteeUserId === userId) {
      canView = true;
      if (!accessReason) accessReason = 'direct_user_grant';
      if (grant.accessRole === 'manager') canEditMetadata = true;
      if (grant.canEditBoundary) canEditBoundary = true;
      if (grant.canManageOperations) canManageOperations = true;
      if (grant.canManagePermissions) canManagePermissions = true;
    }

    if (grant.granteeType === 'organisation' && grant.granteeOrganisationId) {
      const orgRole = orgRoles.get(grant.granteeOrganisationId);
      if (orgRole) {
        canView = true;
        if (!accessReason) accessReason = 'cooperative_delegation';
        if (orgRole === 'owner' || orgRole === 'manager') {
          if (grant.accessRole === 'manager') canEditMetadata = true;
          if (grant.canEditBoundary) canEditBoundary = true;
          if (grant.canManageOperations) canManageOperations = true;
          if (grant.canManagePermissions) canManagePermissions = true;
        } else if (orgRole === 'agronomist') {
          if (grant.canEditBoundary) canEditBoundary = true;
          if (grant.canManageOperations) canManageOperations = true;
        }
      }
    }
  }

  if (!canView || !accessReason) {
    return null;
  }

  return {
    canView,
    canEditMetadata,
    canEditBoundary,
    canManageOperations,
    canManagePermissions,
    accessReason,
  };
}

async function resolveOwnerLabels(
  executor: DbExecutor,
  farmRows: (typeof farms.$inferSelect)[]
): Promise<{ userLabels: Map<string, string>; orgLabels: Map<string, string> }> {
  const userIds = Array.from(
    new Set(farmRows.map((f) => f.ownerUserId).filter((v): v is string => Boolean(v)))
  );
  const orgIds = Array.from(
    new Set(
      farmRows.map((f) => f.ownerOrganisationId).filter((v): v is string => Boolean(v))
    )
  );

  const userLabels = new Map<string, string>();
  const orgLabels = new Map<string, string>();

  if (userIds.length > 0) {
    const userRows = await executor
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) {
      userLabels.set(u.id, u.fullName || u.email);
    }
  }

  if (orgIds.length > 0) {
    const orgRows = await executor
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(inArray(organisations.id, orgIds));
    for (const o of orgRows) {
      orgLabels.set(o.id, o.name);
    }
  }

  return { userLabels, orgLabels };
}

function mapFarmRow(
  row: typeof farms.$inferSelect,
  effectivePermissions: FarmEffectivePermissions,
  ownerLabel: string
): FarmRecord {
  return {
    id: row.id,
    name: row.name,
    farmCode: row.farmCode,
    ownershipType: row.ownershipType as FarmOwnershipType,
    ownerUserId: row.ownerUserId,
    ownerOrganisationId: row.ownerOrganisationId,
    ownerLabel,
    country: row.country,
    district: row.district,
    subcounty: row.subcounty,
    locationSource: row.locationSource as FarmLocationSource,
    centroidLat: row.centroidLat,
    centroidLng: row.centroidLng,
    boundaryGeojson: row.boundaryGeojson,
    areaSqMeters: row.areaSqMeters,
    areaAcres: row.areaAcres,
    areaHectares: row.areaHectares,
    areaSource: row.areaSource as FarmRecord['areaSource'],
    version: row.version,
    status: row.status as FarmRecord['status'],
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    effectivePermissions,
  };
}

export async function listAccessibleFarmsForUser(
  userId: string,
  filter?: {
    ownership?: 'individual' | 'organisation' | 'delegated';
    organisationId?: string;
  }
): Promise<FarmRecord[]> {
  try {
    const orgRoles = await getActiveOrgRoleMap(db, userId);
    const activeOrgIds = Array.from(orgRoles.keys());

    const grantConditions = [
      and(eq(farmAccessGrants.granteeType, 'user'), eq(farmAccessGrants.granteeUserId, userId)),
    ];
    if (activeOrgIds.length > 0) {
      grantConditions.push(
        and(
          eq(farmAccessGrants.granteeType, 'organisation'),
          inArray(farmAccessGrants.granteeOrganisationId, activeOrgIds)
        )
      );
    }

    const matchingGrants = await db
      .select()
      .from(farmAccessGrants)
      .where(and(isNull(farmAccessGrants.revokedAt), or(...grantConditions)));

    const grantedFarmIds = Array.from(new Set(matchingGrants.map((g) => g.farmId)));

    const farmScopeConditions = [eq(farms.ownerUserId, userId)];
    if (activeOrgIds.length > 0) {
      farmScopeConditions.push(inArray(farms.ownerOrganisationId, activeOrgIds));
    }
    if (grantedFarmIds.length > 0) {
      farmScopeConditions.push(inArray(farms.id, grantedFarmIds));
    }

    const farmRows = await db
      .select()
      .from(farms)
      .where(or(...farmScopeConditions))
      .orderBy(desc(farms.updatedAt));

    if (farmRows.length === 0) return [];

    const grantsByFarm = new Map<string, (typeof farmAccessGrants.$inferSelect)[]>();
    for (const grant of matchingGrants) {
      const list = grantsByFarm.get(grant.farmId) ?? [];
      list.push(grant);
      grantsByFarm.set(grant.farmId, list);
    }

    const { userLabels, orgLabels } = await resolveOwnerLabels(db, farmRows);

    const results: FarmRecord[] = [];
    for (const row of farmRows) {
      const perms = computeEffectivePermissions({
        farm: row,
        userId,
        orgRoles,
        activeGrants: grantsByFarm.get(row.id) ?? [],
      });
      if (!perms) continue;

      if (filter?.ownership === 'individual' && row.ownershipType !== 'individual') continue;
      if (filter?.ownership === 'organisation' && row.ownershipType !== 'organisation') continue;
      if (
        filter?.ownership === 'delegated' &&
        perms.accessReason !== 'direct_user_grant' &&
        perms.accessReason !== 'cooperative_delegation'
      ) {
        continue;
      }
      if (filter?.organisationId) {
        const matchesOwnerOrg = row.ownerOrganisationId === filter.organisationId;
        const matchesDelegatedOrg = (grantsByFarm.get(row.id) ?? []).some(
          (g) => g.granteeOrganisationId === filter.organisationId && !g.revokedAt
        );
        if (!matchesOwnerOrg && !matchesDelegatedOrg) continue;
      }

      const ownerLabel =
        row.ownershipType === 'organisation' && row.ownerOrganisationId
          ? (orgLabels.get(row.ownerOrganisationId) ?? 'Organisation Farm')
          : (row.ownerUserId ? userLabels.get(row.ownerUserId) : undefined) ?? 'Individual Farmer';

      results.push(mapFarmRow(row, perms, ownerLabel));
    }

    return results;
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in listAccessibleFarmsForUser:', error);
    throw new FarmRepositoryError(500, 'FARMS_LIST_FAILED', 'Could not load farms.');
  }
}

async function loadFarmWithAuthorization(
  executor: DbExecutor,
  farmId: string,
  userId: string
): Promise<{
  row: typeof farms.$inferSelect;
  permissions: FarmEffectivePermissions;
  ownerLabel: string;
}> {
  const [farm] = await executor.select().from(farms).where(eq(farms.id, farmId)).limit(1);
  if (!farm) {
    throw new FarmRepositoryError(404, 'FARM_NOT_FOUND', 'Farm record was not found.');
  }

  const orgRoles = await getActiveOrgRoleMap(executor, userId);
  const activeGrants = await executor
    .select()
    .from(farmAccessGrants)
    .where(and(eq(farmAccessGrants.farmId, farmId), isNull(farmAccessGrants.revokedAt)));

  const permissions = computeEffectivePermissions({
    farm,
    userId,
    orgRoles,
    activeGrants,
  });

  if (!permissions) {
    throw new FarmRepositoryError(
      403,
      'FORBIDDEN_FARM_ACCESS',
      'You do not have permission to access this farm.',
      'Ask the farm owner or cooperative manager to grant you access.'
    );
  }

  const { userLabels, orgLabels } = await resolveOwnerLabels(executor, [farm]);
  const ownerLabel =
    farm.ownershipType === 'organisation' && farm.ownerOrganisationId
      ? (orgLabels.get(farm.ownerOrganisationId) ?? 'Organisation Farm')
      : (farm.ownerUserId ? userLabels.get(farm.ownerUserId) : undefined) ?? 'Individual Farmer';

  return { row: farm, permissions, ownerLabel };
}

export async function createFarmRecord(
  userId: string,
  input: CreateFarmInput,
  editSource: FarmEditSource = 'web'
): Promise<FarmRecord> {
  try {
    return await db.transaction(async (tx) => {
      if (input.ownershipType === 'organisation') {
        if (!input.ownerOrganisationId) {
          throw new FarmRepositoryError(
            400,
            'ORG_REQUIRED',
            'Select an owning organisation for an organisation-owned farm.'
          );
        }
        const orgRoles = await getActiveOrgRoleMap(tx, userId);
        const role = orgRoles.get(input.ownerOrganisationId);
        if (!role || !['owner', 'manager', 'agronomist'].includes(role)) {
          throw new FarmRepositoryError(
            403,
            'FORBIDDEN_ORG_FARM_CREATE',
            'Only active organisation owners, managers, or agronomists can register organisation farms.'
          );
        }
      }

      let boundaryMetrics: PostgisMetrics | null = null;
      if (input.boundaryGeojson) {
        boundaryMetrics = await validateAndComputePostgisBoundary(tx, input.boundaryGeojson);
      }

      const centroidLat =
        boundaryMetrics?.centroidLat ??
        (typeof input.centroidLat === 'number' ? input.centroidLat : null);
      const centroidLng =
        boundaryMetrics?.centroidLng ??
        (typeof input.centroidLng === 'number' ? input.centroidLng : null);

      const areaMetrics = boundaryMetrics
        ? {
            areaSqMeters: boundaryMetrics.areaSqMeters,
            areaAcres: boundaryMetrics.areaAcres,
            areaHectares: boundaryMetrics.areaHectares,
            areaSource: 'postgis_boundary' as const,
          }
        : input.declaredAreaValue && input.declaredAreaUnit
          ? {
              ...declaredAreaToMetrics(input.declaredAreaValue, input.declaredAreaUnit),
              areaSource: 'declared_estimate' as const,
            }
          : {
              areaSqMeters: null,
              areaAcres: null,
              areaHectares: null,
              areaSource: 'declared_estimate' as const,
            };

      const centroidSql =
        centroidLat !== null && centroidLng !== null
          ? sql`ST_SetSRID(ST_MakePoint(${centroidLng}, ${centroidLat}), 4326)`
          : null;

      const boundarySql = input.boundaryGeojson
        ? sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(
            input.boundaryGeojson
          )}), 4326))::geometry(MultiPolygon,4326)`
        : null;

      const [inserted] = await tx
        .insert(farms)
        .values({
          name: input.name,
          farmCode: input.farmCode ? input.farmCode : null,
          ownershipType: input.ownershipType,
          ownerUserId: input.ownershipType === 'individual' ? userId : null,
          ownerOrganisationId:
            input.ownershipType === 'organisation' ? (input.ownerOrganisationId ?? null) : null,
          country: input.country,
          district: input.district,
          subcounty: input.subcounty ? input.subcounty : null,
          locationSource: input.locationSource,
          centroidLat,
          centroidLng,
          centroidGeom: centroidSql as unknown as string | null,
          boundaryGeojson: input.boundaryGeojson ?? null,
          boundaryGeom: boundarySql as unknown as string | null,
          areaSqMeters: areaMetrics.areaSqMeters,
          areaAcres: areaMetrics.areaAcres,
          areaHectares: areaMetrics.areaHectares,
          areaSource: areaMetrics.areaSource,
          version: 1,
          status: 'active',
          createdByUserId: userId,
        })
        .returning();

      if (input.boundaryGeojson && boundaryMetrics) {
        await tx.insert(farmBoundaryRevisions).values({
          farmId: inserted.id,
          version: inserted.version,
          boundaryGeojson: input.boundaryGeojson,
          areaSqMeters: boundaryMetrics.areaSqMeters,
          areaAcres: boundaryMetrics.areaAcres,
          areaHectares: boundaryMetrics.areaHectares,
          editedByUserId: userId,
          editSource,
        });
      }

      const loaded = await loadFarmWithAuthorization(tx, inserted.id, userId);
      return mapFarmRow(loaded.row, loaded.permissions, loaded.ownerLabel);
    });
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in createFarmRecord:', error);
    throw new FarmRepositoryError(500, 'FARM_CREATE_FAILED', 'Could not register the farm.');
  }
}

export async function listFarmGrants(
  executor: DbExecutor,
  farmId: string
): Promise<FarmAccessGrantRecord[]> {
  const rows = await executor
    .select()
    .from(farmAccessGrants)
    .where(eq(farmAccessGrants.farmId, farmId))
    .orderBy(desc(farmAccessGrants.grantedAt));

  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(rows.map((r) => r.granteeUserId).filter((v): v is string => Boolean(v)))
  );
  const orgIds = Array.from(
    new Set(rows.map((r) => r.granteeOrganisationId).filter((v): v is string => Boolean(v)))
  );

  const userMap = new Map<string, { name: string; email: string }>();
  if (userIds.length > 0) {
    const uRows = await executor
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of uRows) {
      userMap.set(u.id, { name: u.fullName || u.email, email: u.email });
    }
  }

  const orgMap = new Map<string, { name: string; district: string | null }>();
  if (orgIds.length > 0) {
    const oRows = await executor
      .select({ id: organisations.id, name: organisations.name, district: organisations.district })
      .from(organisations)
      .where(inArray(organisations.id, orgIds));
    for (const o of oRows) {
      orgMap.set(o.id, { name: o.name, district: o.district });
    }
  }

  return rows.map((r) => {
    let granteeLabel = 'Unknown Grantee';
    let granteeSubLabel: string | null = null;
    if (r.granteeType === 'user' && r.granteeUserId) {
      const u = userMap.get(r.granteeUserId);
      granteeLabel = u?.name ?? r.granteeUserId;
      granteeSubLabel = u?.email ?? null;
    } else if (r.granteeType === 'organisation' && r.granteeOrganisationId) {
      const o = orgMap.get(r.granteeOrganisationId);
      granteeLabel = o?.name ?? r.granteeOrganisationId;
      granteeSubLabel = o?.district ? `Cooperative / Org · ${o.district}` : 'Cooperative / Org';
    }

    return {
      id: r.id,
      farmId: r.farmId,
      granteeType: r.granteeType as FarmGranteeType,
      granteeUserId: r.granteeUserId,
      granteeOrganisationId: r.granteeOrganisationId,
      granteeLabel,
      granteeSubLabel,
      accessRole: r.accessRole as FarmAccessRole,
      canEditBoundary: r.canEditBoundary,
      canManageOperations: r.canManageOperations,
      canManagePermissions: r.canManagePermissions,
      grantedByUserId: r.grantedByUserId,
      grantedAt: r.grantedAt.toISOString(),
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      revokedByUserId: r.revokedByUserId,
    };
  });
}

export async function listFarmRevisions(
  executor: DbExecutor,
  farmId: string
): Promise<FarmBoundaryRevisionRecord[]> {
  const rows = await executor
    .select({
      revision: farmBoundaryRevisions,
      editorName: users.fullName,
      editorEmail: users.email,
    })
    .from(farmBoundaryRevisions)
    .leftJoin(users, eq(farmBoundaryRevisions.editedByUserId, users.id))
    .where(eq(farmBoundaryRevisions.farmId, farmId))
    .orderBy(desc(farmBoundaryRevisions.version));

  return rows.map(({ revision, editorName, editorEmail }) => ({
    id: revision.id,
    farmId: revision.farmId,
    version: revision.version,
    boundaryGeojson: revision.boundaryGeojson,
    areaSqMeters: revision.areaSqMeters,
    areaAcres: revision.areaAcres,
    areaHectares: revision.areaHectares,
    editedByUserId: revision.editedByUserId,
    editedByLabel: editorName || editorEmail || 'Field User',
    editSource: revision.editSource as FarmEditSource,
    createdAt: revision.createdAt.toISOString(),
  }));
}

export async function getFarmDetailForUser(
  farmId: string,
  userId: string
): Promise<FarmDetailPayload> {
  try {
    const loaded = await loadFarmWithAuthorization(db, farmId, userId);
    const [grants, revisions] = await Promise.all([
      loaded.permissions.canManagePermissions ? listFarmGrants(db, farmId) : Promise.resolve([]),
      listFarmRevisions(db, farmId),
    ]);

    return {
      farm: mapFarmRow(loaded.row, loaded.permissions, loaded.ownerLabel),
      grants,
      revisions,
    };
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in getFarmDetailForUser:', error);
    throw new FarmRepositoryError(500, 'FARM_LOAD_FAILED', 'Could not load farm details.');
  }
}

export async function getFarmRevisionsForUser(
  farmId: string,
  userId: string
): Promise<FarmBoundaryRevisionRecord[]> {
  await loadFarmWithAuthorization(db, farmId, userId);
  return listFarmRevisions(db, farmId);
}

export async function getFarmPermissionsForUser(
  farmId: string,
  userId: string
): Promise<FarmAccessGrantRecord[]> {
  const loaded = await loadFarmWithAuthorization(db, farmId, userId);
  if (!loaded.permissions.canManagePermissions) {
    throw new FarmRepositoryError(
      403,
      'FORBIDDEN_FARM_PERMISSIONS',
      'Only farm owners or authorised managers can inspect farm permission grants.'
    );
  }
  return listFarmGrants(db, farmId);
}

export async function updateFarmMetadata(
  farmId: string,
  userId: string,
  input: UpdateFarmInput
): Promise<FarmRecord> {
  try {
    return await db.transaction(async (tx) => {
      const loaded = await loadFarmWithAuthorization(tx, farmId, userId);
      if (!loaded.permissions.canEditMetadata) {
        throw new FarmRepositoryError(
          403,
          'FORBIDDEN_FARM_EDIT',
          'You do not have permission to edit metadata for this farm.'
        );
      }

      if (loaded.row.version !== input.expectedVersion) {
        const serverFarm = mapFarmRow(loaded.row, loaded.permissions, loaded.ownerLabel);
        if (input.resolutionStrategy !== 'overwrite_with_server_backup') {
          throw new FarmRepositoryError(
            409,
            'FARM_VERSION_CONFLICT',
            'This farm was modified elsewhere before your update synced.',
            'Review the latest server farm record and choose whether to keep server or overwrite.',
            {
              farmId,
              expectedVersion: input.expectedVersion,
              serverVersion: loaded.row.version,
              serverFarm,
            }
          );
        }
      }

      const nextLat =
        input.centroidLat !== undefined ? input.centroidLat : loaded.row.centroidLat;
      const nextLng =
        input.centroidLng !== undefined ? input.centroidLng : loaded.row.centroidLng;
      const centroidChanged =
        input.centroidLat !== undefined || input.centroidLng !== undefined;

      const centroidSql =
        nextLat !== null && nextLng !== null
          ? sql`ST_SetSRID(ST_MakePoint(${nextLng}, ${nextLat}), 4326)`
          : null;

      const [updated] = await tx
        .update(farms)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.farmCode !== undefined ? { farmCode: input.farmCode } : {}),
          ...(input.country !== undefined ? { country: input.country } : {}),
          ...(input.district !== undefined ? { district: input.district } : {}),
          ...(input.subcounty !== undefined ? { subcounty: input.subcounty } : {}),
          ...(input.locationSource !== undefined
            ? { locationSource: input.locationSource }
            : {}),
          ...(centroidChanged
            ? {
                centroidLat: nextLat,
                centroidLng: nextLng,
                centroidGeom: centroidSql as unknown as string | null,
              }
            : {}),
          version: sql`${farms.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(farms.id, farmId), eq(farms.version, loaded.row.version)))
        .returning();

      if (!updated) {
        throw new FarmRepositoryError(
          409,
          'FARM_VERSION_CONFLICT',
          'Concurrent update detected while saving farm metadata.'
        );
      }

      return mapFarmRow(updated, loaded.permissions, loaded.ownerLabel);
    });
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in updateFarmMetadata:', error);
    throw new FarmRepositoryError(500, 'FARM_UPDATE_FAILED', 'Could not update farm metadata.');
  }
}

export async function updateFarmBoundary(
  farmId: string,
  userId: string,
  input: UpdateFarmBoundaryInput
): Promise<FarmRecord> {
  try {
    return await db.transaction(async (tx) => {
      const loaded = await loadFarmWithAuthorization(tx, farmId, userId);
      if (!loaded.permissions.canEditBoundary) {
        throw new FarmRepositoryError(
          403,
          'FORBIDDEN_BOUNDARY_EDIT',
          'You do not have permission to draw or edit boundaries on this farm.'
        );
      }

      if (loaded.row.version !== input.expectedVersion) {
        const serverFarm = mapFarmRow(loaded.row, loaded.permissions, loaded.ownerLabel);
        if (input.resolutionStrategy !== 'overwrite_with_server_backup') {
          throw new FarmRepositoryError(
            409,
            'FARM_VERSION_CONFLICT',
            'This farm boundary was updated on the server after your offline edit was captured.',
            'Inspect the server boundary versus your local polygon and resolve the conflict explicitly.',
            {
              farmId,
              expectedVersion: input.expectedVersion,
              serverVersion: loaded.row.version,
              serverFarm,
            }
          );
        }

        // Preserve existing server boundary in revision history if not already recorded
        if (
          loaded.row.boundaryGeojson &&
          loaded.row.areaSqMeters !== null &&
          loaded.row.areaAcres !== null &&
          loaded.row.areaHectares !== null
        ) {
          const existingRev = await tx
            .select({ id: farmBoundaryRevisions.id })
            .from(farmBoundaryRevisions)
            .where(
              and(
                eq(farmBoundaryRevisions.farmId, farmId),
                eq(farmBoundaryRevisions.version, loaded.row.version)
              )
            )
            .limit(1);

          if (existingRev.length === 0) {
            await tx.insert(farmBoundaryRevisions).values({
              farmId,
              version: loaded.row.version,
              boundaryGeojson: loaded.row.boundaryGeojson,
              areaSqMeters: loaded.row.areaSqMeters,
              areaAcres: loaded.row.areaAcres,
              areaHectares: loaded.row.areaHectares,
              editedByUserId: loaded.row.createdByUserId,
              editSource: 'conflict_resolution',
            });
          }
        }
      }

      const metrics = await validateAndComputePostgisBoundary(tx, input.boundaryGeojson);

      const centroidSql = sql`ST_SetSRID(ST_MakePoint(${metrics.centroidLng}, ${metrics.centroidLat}), 4326)`;
      const boundarySql = sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(
        input.boundaryGeojson
      )}), 4326))::geometry(MultiPolygon,4326)`;

      const [updated] = await tx
        .update(farms)
        .set({
          centroidLat: metrics.centroidLat,
          centroidLng: metrics.centroidLng,
          centroidGeom: centroidSql as unknown as string,
          boundaryGeojson: input.boundaryGeojson,
          boundaryGeom: boundarySql as unknown as string,
          areaSqMeters: metrics.areaSqMeters,
          areaAcres: metrics.areaAcres,
          areaHectares: metrics.areaHectares,
          areaSource: 'postgis_boundary',
          version: sql`${farms.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(farms.id, farmId), eq(farms.version, loaded.row.version)))
        .returning();

      if (!updated) {
        throw new FarmRepositoryError(
          409,
          'FARM_VERSION_CONFLICT',
          'Concurrent update detected while saving the farm boundary.'
        );
      }

      await tx.insert(farmBoundaryRevisions).values({
        farmId: updated.id,
        version: updated.version,
        boundaryGeojson: input.boundaryGeojson,
        areaSqMeters: metrics.areaSqMeters,
        areaAcres: metrics.areaAcres,
        areaHectares: metrics.areaHectares,
        editedByUserId: userId,
        editSource: input.editSource,
      });

      return mapFarmRow(updated, loaded.permissions, loaded.ownerLabel);
    });
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in updateFarmBoundary:', error);
    throw new FarmRepositoryError(500, 'BOUNDARY_UPDATE_FAILED', 'Could not save farm boundary.');
  }
}

export async function grantFarmPermission(
  farmId: string,
  actorUserId: string,
  input: CreateFarmPermissionInput
): Promise<FarmAccessGrantRecord> {
  try {
    return await db.transaction(async (tx) => {
      const loaded = await loadFarmWithAuthorization(tx, farmId, actorUserId);
      if (!loaded.permissions.canManagePermissions) {
        throw new FarmRepositoryError(
          403,
          'FORBIDDEN_FARM_PERMISSIONS',
          'Only farm owners or permission-enabled managers can delegate farm access.'
        );
      }

      let granteeUserId: string | null = null;
      let granteeOrganisationId: string | null = null;

      if (input.granteeType === 'user') {
        const email = input.granteeEmail?.toLowerCase();
        if (!email) {
          throw new FarmRepositoryError(400, 'VALIDATION_ERROR', 'User email is required.');
        }
        const [targetUser] = await tx
          .select()
          .from(users)
          .where(sql`LOWER(${users.email}) = ${email}`)
          .limit(1);

        if (!targetUser) {
          throw new FarmRepositoryError(
            404,
            'GRANTEE_USER_NOT_FOUND',
            `No registered FIELD FUSSION user found for ${email}. Ask them to sign in once first.`
          );
        }
        granteeUserId = targetUser.id;

        const existing = await tx
          .select()
          .from(farmAccessGrants)
          .where(
            and(
              eq(farmAccessGrants.farmId, farmId),
              eq(farmAccessGrants.granteeType, 'user'),
              eq(farmAccessGrants.granteeUserId, granteeUserId),
              isNull(farmAccessGrants.revokedAt)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          throw new FarmRepositoryError(
            409,
            'ACTIVE_GRANT_EXISTS',
            'This user already has an active access grant on this farm. Revoke the existing grant first.'
          );
        }
      } else {
        if (!input.granteeOrganisationId) {
          throw new FarmRepositoryError(400, 'VALIDATION_ERROR', 'Organisation ID is required.');
        }
        const [targetOrg] = await tx
          .select()
          .from(organisations)
          .where(eq(organisations.id, input.granteeOrganisationId))
          .limit(1);
        if (!targetOrg) {
          throw new FarmRepositoryError(404, 'GRANTEE_ORG_NOT_FOUND', 'Organisation not found.');
        }
        granteeOrganisationId = targetOrg.id;

        const existing = await tx
          .select()
          .from(farmAccessGrants)
          .where(
            and(
              eq(farmAccessGrants.farmId, farmId),
              eq(farmAccessGrants.granteeType, 'organisation'),
              eq(farmAccessGrants.granteeOrganisationId, granteeOrganisationId),
              isNull(farmAccessGrants.revokedAt)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          throw new FarmRepositoryError(
            409,
            'ACTIVE_GRANT_EXISTS',
            'This organisation already has an active delegation on this farm. Revoke the existing grant first.'
          );
        }
      }

      const [inserted] = await tx
        .insert(farmAccessGrants)
        .values({
          farmId,
          granteeType: input.granteeType,
          granteeUserId,
          granteeOrganisationId,
          accessRole: input.accessRole,
          canEditBoundary: input.accessRole === 'viewer' ? false : input.canEditBoundary,
          canManageOperations: input.accessRole === 'viewer' ? false : input.canManageOperations,
          canManagePermissions: input.accessRole === 'manager' ? input.canManagePermissions : false,
          grantedByUserId: actorUserId,
        })
        .returning();

      const all = await listFarmGrants(tx, farmId);
      const match = all.find((g) => g.id === inserted.id);
      if (!match) {
        throw new FarmRepositoryError(500, 'GRANT_CREATE_FAILED', 'Could not hydrate permission grant.');
      }
      return match;
    });
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in grantFarmPermission:', error);
    throw new FarmRepositoryError(500, 'GRANT_CREATE_FAILED', 'Could not grant farm permission.');
  }
}

export async function revokeFarmPermission(
  farmId: string,
  grantId: string,
  actorUserId: string
): Promise<FarmAccessGrantRecord> {
  try {
    return await db.transaction(async (tx) => {
      const loaded = await loadFarmWithAuthorization(tx, farmId, actorUserId);
      if (!loaded.permissions.canManagePermissions) {
        throw new FarmRepositoryError(
          403,
          'FORBIDDEN_FARM_PERMISSIONS',
          'You do not have permission to revoke access on this farm.'
        );
      }

      const [existing] = await tx
        .select()
        .from(farmAccessGrants)
        .where(and(eq(farmAccessGrants.id, grantId), eq(farmAccessGrants.farmId, farmId)))
        .limit(1);

      if (!existing) {
        throw new FarmRepositoryError(404, 'GRANT_NOT_FOUND', 'Farm permission grant not found.');
      }

      if (!existing.revokedAt) {
        await tx
          .update(farmAccessGrants)
          .set({
            revokedAt: new Date(),
            revokedByUserId: actorUserId,
          })
          .where(eq(farmAccessGrants.id, grantId));
      }

      const all = await listFarmGrants(tx, farmId);
      const match = all.find((g) => g.id === grantId);
      if (!match) {
        throw new FarmRepositoryError(404, 'GRANT_NOT_FOUND', 'Farm permission grant not found.');
      }
      return match;
    });
  } catch (error) {
    if (error instanceof FarmRepositoryError) throw error;
    console.error('Database query failed in revokeFarmPermission:', error);
    throw new FarmRepositoryError(500, 'GRANT_REVOKE_FAILED', 'Could not revoke farm permission.');
  }
}
