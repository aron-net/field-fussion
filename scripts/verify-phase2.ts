import 'dotenv/config';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  auditLogs,
  farmBoundaryRevisions,
  farms,
  organisations,
  users,
} from '../src/db/schema.ts';
import { createOrganisationWithOwner } from '../src/db/repositories/organisations.repository.ts';
import {
  createFarmRecord,
  FarmRepositoryError,
  getFarmDetailForUser,
  grantFarmPermission,
  listAccessibleFarmsForUser,
  revokeFarmPermission,
  updateFarmBoundary,
  updateFarmMetadata,
} from '../src/db/repositories/farms.repository.ts';
import { createApiApp } from '../src/server/app.ts';
import { getMappingRuntimeConfig } from '../src/server/modules/locations/locations.router.ts';
import {
  calculateGeoJsonArea,
  validateGeoJsonBoundaryTopology,
} from '../src/shared/geo/area.ts';
import { searchUgandaGazetteer } from '../src/shared/geo/ugandaLocations.ts';
import { createFarmSchema } from '../src/shared/validation/schemas.ts';
import type { FarmGeoJsonBoundary } from '../src/shared/types/domain.ts';

// ~1km x 1km square near Lira, Uganda (~100 hectares / ~247 acres)
const LIRA_SQUARE_BOUNDARY: FarmGeoJsonBoundary = {
  type: 'Polygon',
  coordinates: [
    [
      [32.895, 2.245],
      [32.904, 2.245],
      [32.904, 2.254],
      [32.895, 2.254],
      [32.895, 2.245],
    ],
  ],
};

// Smaller nested parcel (~25 hectares / ~61 acres)
const LIRA_UPDATED_BOUNDARY: FarmGeoJsonBoundary = {
  type: 'Polygon',
  coordinates: [
    [
      [32.895, 2.245],
      [32.9, 2.245],
      [32.9, 2.25],
      [32.895, 2.25],
      [32.895, 2.245],
    ],
  ],
};

// Self-intersecting bowtie polygon (must fail topology validation)
const BOWTIE_INVALID_BOUNDARY: FarmGeoJsonBoundary = {
  type: 'Polygon',
  coordinates: [
    [
      [32.89, 2.24],
      [32.9, 2.25],
      [32.9, 2.24],
      [32.89, 2.25],
      [32.89, 2.24],
    ],
  ],
};

async function runTests() {
  let passed = 0;

  // 1. GeoJSON area math, topology checks, Uganda gazetteer, runtime provider switching & Zod validation
  const metrics = calculateGeoJsonArea(LIRA_SQUARE_BOUNDARY);
  assert.ok(
    metrics.areaHectares > 95 && metrics.areaHectares < 105,
    `Expected ~100 ha, got ${metrics.areaHectares}`
  );
  assert.ok(
    metrics.areaAcres > 235 && metrics.areaAcres < 260,
    `Expected ~247 ac, got ${metrics.areaAcres}`
  );

  assert.equal(validateGeoJsonBoundaryTopology(LIRA_SQUARE_BOUNDARY).valid, true);
  assert.equal(
    validateGeoJsonBoundaryTopology(BOWTIE_INVALID_BOUNDARY).valid,
    false,
    'Self-intersecting polygon must be rejected'
  );

  const liraHits = searchUgandaGazetteer('Lira');
  assert.ok(liraHits.length >= 1 && liraHits[0]?.district === 'Lira');

  const orgFarmValidation = createFarmSchema.safeParse({
    name: 'Org Plot Without ID',
    ownershipType: 'organisation',
    district: 'Lira',
  });
  assert.equal(
    orgFarmValidation.success,
    false,
    'Organisation farm without ownerOrganisationId must fail'
  );

  // Runtime mapping provider switching without rebuild
  const prevLocProvider = process.env.LOCATION_SEARCH_PROVIDER;
  const prevSatEnabled = process.env.MAP_SATELLITE_ENABLED;
  const prevStreetUrl = process.env.MAP_STREET_TILE_URL;
  const prevStreetAttr = process.env.MAP_STREET_ATTRIBUTION;
  try {
    process.env.LOCATION_SEARCH_PROVIDER = 'gazetteer_only';
    process.env.MAP_SATELLITE_ENABLED = 'false';
    process.env.MAP_STREET_TILE_URL = 'https://tiles.example.test/{z}/{x}/{y}.png';
    process.env.MAP_STREET_ATTRIBUTION = '&copy; Example Custom Tiles';
    const switchedCfg = getMappingRuntimeConfig();
    assert.equal(switchedCfg.locationProvider, 'gazetteer_only');
    assert.equal(switchedCfg.basemaps.satelliteEnabled, false);
    assert.equal(switchedCfg.basemaps.satelliteTileUrl, '');
    assert.equal(switchedCfg.basemaps.streetEnabled, true);
    assert.equal(
      switchedCfg.basemaps.streetTileUrl,
      'https://tiles.example.test/{z}/{x}/{y}.png'
    );
    assert.equal(switchedCfg.basemaps.streetAttribution, '&copy; Example Custom Tiles');
    assert.equal(switchedCfg.autocompleteProhibited, true);
  } finally {
    if (prevLocProvider === undefined) delete process.env.LOCATION_SEARCH_PROVIDER;
    else process.env.LOCATION_SEARCH_PROVIDER = prevLocProvider;
    if (prevSatEnabled === undefined) delete process.env.MAP_SATELLITE_ENABLED;
    else process.env.MAP_SATELLITE_ENABLED = prevSatEnabled;
    if (prevStreetUrl === undefined) delete process.env.MAP_STREET_TILE_URL;
    else process.env.MAP_STREET_TILE_URL = prevStreetUrl;
    if (prevStreetAttr === undefined) delete process.env.MAP_STREET_ATTRIBUTION;
    else process.env.MAP_STREET_ATTRIBUTION = prevStreetAttr;
  }

  // Verify satellite imagery defaults to false when MAP_SATELLITE_ENABLED is unset
  const savedSat = process.env.MAP_SATELLITE_ENABLED;
  try {
    delete process.env.MAP_SATELLITE_ENABLED;
    assert.equal(getMappingRuntimeConfig().basemaps.satelliteEnabled, false);
  } finally {
    if (savedSat === undefined) delete process.env.MAP_SATELLITE_ENABLED;
    else process.env.MAP_SATELLITE_ENABLED = savedSat;
  }

  passed += 1;
  console.log(
    '✓ Test 1: Shared GeoJSON area math, topology checks, Uganda gazetteer, runtime provider switching & Zod schemas pass'
  );

  // 2. Live PostgreSQL + PostGIS acceptance & security scenarios
  const testRunSuffix = crypto.randomUUID().slice(0, 8);
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  try {
    const [farmerA] = await db
      .insert(users)
      .values({
        firebaseUid: `verify_p2_farmer_${testRunSuffix}`,
        email: `farmer_${testRunSuffix}@example.test`,
        fullName: 'Kampala Farmer Remote',
        district: 'Kampala',
        onboardingCompleted: true,
      })
      .returning();
    createdUserIds.push(farmerA.id);

    const [managerB] = await db
      .insert(users)
      .values({
        firebaseUid: `verify_p2_manager_${testRunSuffix}`,
        email: `manager_${testRunSuffix}@example.test`,
        fullName: 'Lira Field Manager',
        district: 'Lira',
        onboardingCompleted: true,
      })
      .returning();
    createdUserIds.push(managerB.id);

    // 2a. Farmer A in Kampala creates individual farm in Lira remotely + another in Mbale
    const liraFarm = await createFarmRecord(farmerA.id, {
      name: `Lira Remote Block ${testRunSuffix}`,
      ownershipType: 'individual',
      country: 'UG',
      district: 'Lira',
      locationSource: 'search',
      centroidLat: 2.2499,
      centroidLng: 32.8998,
    });
    assert.equal(liraFarm.district, 'Lira');
    assert.equal(liraFarm.ownershipType, 'individual');
    assert.equal(liraFarm.version, 1);

    const mbaleFarm = await createFarmRecord(farmerA.id, {
      name: `Mbale Coffee Plot ${testRunSuffix}`,
      ownershipType: 'individual',
      country: 'UG',
      district: 'Mbale',
      locationSource: 'search',
      centroidLat: 1.0821,
      centroidLng: 34.175,
    });
    assert.equal(mbaleFarm.district, 'Mbale');

    // 2b. Save PostGIS GeoJSON boundary and verify SRID 4326 + PostGIS vs JS spherical area parity (< 0.5% delta)
    const boundedFarm = await updateFarmBoundary(liraFarm.id, farmerA.id, {
      expectedVersion: 1,
      boundaryGeojson: LIRA_SQUARE_BOUNDARY,
      editSource: 'web',
    });
    assert.equal(boundedFarm.version, 2);
    assert.equal(boundedFarm.areaSource, 'postgis_boundary');
    const postgisDiffPct =
      Math.abs((boundedFarm.areaSqMeters ?? 0) - metrics.areaSqMeters) /
      metrics.areaSqMeters;
    assert.ok(
      postgisDiffPct < 0.005,
      `PostGIS spheroid vs spherical preview delta expected < 0.5%, got ${(
        postgisDiffPct * 100
      ).toFixed(3)}%`
    );

    const spatialCheck = await db.execute(sql`
      SELECT
        ST_SRID(boundary_geom) AS boundary_srid,
        ST_SRID(centroid_geom) AS centroid_srid,
        ST_IsValid(boundary_geom) AS is_valid
      FROM farms
      WHERE id = ${liraFarm.id}
    `);
    const spatialRow = spatialCheck.rows[0] as {
      boundary_srid?: number;
      centroid_srid?: number;
      is_valid?: boolean;
    };
    assert.equal(spatialRow.boundary_srid, 4326);
    assert.equal(spatialRow.centroid_srid, 4326);
    assert.equal(spatialRow.is_valid, true);

    // 2c. Edit farm metadata & verify persisted reload
    const updatedMeta = await updateFarmMetadata(liraFarm.id, farmerA.id, {
      expectedVersion: 2,
      name: `Lira Remote Block Renamed ${testRunSuffix}`,
      subcounty: 'Adyel Division',
    });
    assert.equal(updatedMeta.version, 3);
    assert.equal(updatedMeta.subcounty, 'Adyel Division');

    // 2d. Cross-organisation data isolation (Org A vs Org B)
    const orgA = await createOrganisationWithOwner(farmerA.id, {
      name: `Kampala Growers Org ${testRunSuffix}`,
      orgType: 'cooperative',
      district: 'Kampala',
      country: 'UG',
    });
    createdOrgIds.push(orgA.id);

    const coopOrgB = await createOrganisationWithOwner(managerB.id, {
      name: `Lira Verification Coop ${testRunSuffix}`,
      orgType: 'cooperative',
      district: 'Lira',
      country: 'UG',
    });
    createdOrgIds.push(coopOrgB.id);

    const orgFarmB = await createFarmRecord(managerB.id, {
      name: `Coop B Nucleus Estate ${testRunSuffix}`,
      ownershipType: 'organisation',
      ownerOrganisationId: coopOrgB.id,
      country: 'UG',
      district: 'Lira',
      locationSource: 'search',
      centroidLat: 2.25,
      centroidLng: 32.9,
      boundaryGeojson: LIRA_UPDATED_BOUNDARY,
    });
    assert.equal(orgFarmB.ownershipType, 'organisation');

    // Farmer A cannot list Org B's farms or query Org B filter
    const crossOrgList = await listAccessibleFarmsForUser(farmerA.id, {
      organisationId: coopOrgB.id,
    });
    assert.equal(crossOrgList.length, 0, 'Cross-organisation query must return zero farms');

    await assert.rejects(
      () => getFarmDetailForUser(orgFarmB.id, farmerA.id),
      (err: unknown) =>
        err instanceof FarmRepositoryError &&
        err.status === 403 &&
        err.code === 'FORBIDDEN_FARM_ACCESS'
    );

    // 2e. Unauthorized access check (Manager B cannot view/edit Farmer A's farm before grant)
    await assert.rejects(
      () => getFarmDetailForUser(liraFarm.id, managerB.id),
      (err: unknown) =>
        err instanceof FarmRepositoryError &&
        err.status === 403 &&
        err.code === 'FORBIDDEN_FARM_ACCESS'
    );

    // 2f. Direct manager grant + boundary edit + revocation
    const directGrant = await grantFarmPermission(liraFarm.id, farmerA.id, {
      granteeType: 'user',
      granteeEmail: managerB.email,
      accessRole: 'manager',
      canEditBoundary: true,
      canManageOperations: true,
      canManagePermissions: false,
    });

    const managerDetail = await getFarmDetailForUser(liraFarm.id, managerB.id);
    assert.equal(managerDetail.farm.effectivePermissions.accessReason, 'direct_user_grant');
    assert.equal(managerDetail.farm.effectivePermissions.canEditBoundary, true);

    const editedByManager = await updateFarmBoundary(liraFarm.id, managerB.id, {
      expectedVersion: 3,
      boundaryGeojson: LIRA_UPDATED_BOUNDARY,
      editSource: 'pwa_online',
    });
    assert.equal(editedByManager.version, 4);

    await revokeFarmPermission(liraFarm.id, directGrant.id, farmerA.id);
    await assert.rejects(
      () => getFarmDetailForUser(liraFarm.id, managerB.id),
      (err: unknown) =>
        err instanceof FarmRepositoryError &&
        err.status === 403 &&
        err.code === 'FORBIDDEN_FARM_ACCESS'
    );

    // 2g. Member-owned farm managed by Cooperative Delegation + revocation
    const coopGrant = await grantFarmPermission(mbaleFarm.id, farmerA.id, {
      granteeType: 'organisation',
      granteeOrganisationId: coopOrgB.id,
      accessRole: 'agronomist',
      canEditBoundary: true,
      canManageOperations: true,
      canManagePermissions: false,
    });
    const delegatedDetail = await getFarmDetailForUser(mbaleFarm.id, managerB.id);
    assert.equal(
      delegatedDetail.farm.effectivePermissions.accessReason,
      'cooperative_delegation'
    );

    await revokeFarmPermission(mbaleFarm.id, coopGrant.id, farmerA.id);
    await assert.rejects(
      () => getFarmDetailForUser(mbaleFarm.id, managerB.id),
      (err: unknown) => err instanceof FarmRepositoryError && err.status === 403
    );

    // 2h. Optimistic concurrency 409 conflict & non-destructive backup overwrite
    await assert.rejects(
      () =>
        updateFarmBoundary(liraFarm.id, farmerA.id, {
          expectedVersion: 1, // stale! server is at v4
          boundaryGeojson: LIRA_SQUARE_BOUNDARY,
          editSource: 'pwa_offline_sync',
        }),
      (err: unknown) =>
        err instanceof FarmRepositoryError &&
        err.status === 409 &&
        err.code === 'FARM_VERSION_CONFLICT'
    );

    const resolvedFarm = await updateFarmBoundary(liraFarm.id, farmerA.id, {
      expectedVersion: 1,
      boundaryGeojson: LIRA_SQUARE_BOUNDARY,
      editSource: 'conflict_resolution',
      resolutionStrategy: 'overwrite_with_server_backup',
    });
    assert.equal(resolvedFarm.version, 5);

    const finalDetail = await getFarmDetailForUser(liraFarm.id, farmerA.id);
    assert.ok(
      finalDetail.revisions.length >= 3,
      'Boundary revision history must preserve all versions across edits and conflict resolution'
    );

    const isAppendOnlyError = (err: unknown) => {
      if (!(err instanceof Error)) return false;
      const causeMsg = err.cause instanceof Error ? err.cause.message : '';
      return /append-only/i.test(`${err.message} ${causeMsg}`);
    };

    // 2i. PostgreSQL immutability trigger verification on farm_boundary_revisions
    await assert.rejects(
      () =>
        db
          .update(farmBoundaryRevisions)
          .set({ areaAcres: 9999 })
          .where(eq(farmBoundaryRevisions.farmId, liraFarm.id)),
      isAppendOnlyError,
      'Direct UPDATE on farm_boundary_revisions must be blocked by PostgreSQL trigger'
    );

    await assert.rejects(
      () =>
        db
          .delete(farmBoundaryRevisions)
          .where(eq(farmBoundaryRevisions.farmId, liraFarm.id)),
      isAppendOnlyError,
      'Direct DELETE on farm_boundary_revisions must be blocked by PostgreSQL trigger'
    );

    // Check audit_logs immutability trigger too
    const [sampleAudit] = await db.select({ id: auditLogs.id }).from(auditLogs).limit(1);
    if (sampleAudit) {
      await assert.rejects(
        () =>
          db
            .update(auditLogs)
            .set({ action: 'tampered' })
            .where(eq(auditLogs.id, sampleAudit.id)),
        isAppendOnlyError,
        'Direct UPDATE on audit_logs must be blocked by PostgreSQL trigger'
      );
      await assert.rejects(
        () => db.delete(auditLogs).where(eq(auditLogs.id, sampleAudit.id)),
        isAppendOnlyError,
        'Direct DELETE on audit_logs must be blocked by PostgreSQL trigger'
      );
    }

    const isDeniedOrAppendOnly = (err: unknown) => {
      if (!(err instanceof Error)) return false;
      const causeMsg = err.cause instanceof Error ? err.cause.message : '';
      return /append-only|permission denied|must be owner/i.test(
        `${err.message} ${causeMsg}`
      );
    };

    await assert.rejects(
      () => db.execute(sql`TRUNCATE TABLE audit_logs`),
      isDeniedOrAppendOnly,
      'TRUNCATE on audit_logs must be rejected'
    );

    await assert.rejects(
      () => db.execute(sql`TRUNCATE TABLE farm_boundary_revisions`),
      isDeniedOrAppendOnly,
      'TRUNCATE on farm_boundary_revisions must be rejected'
    );

    await assert.rejects(
      () => db.execute(sql`ALTER TABLE audit_logs DISABLE TRIGGER ALL`),
      isDeniedOrAppendOnly,
      'Runtime app role must not be allowed to disable audit_logs triggers'
    );

    passed += 1;
    console.log(
      '✓ Test 2: Live PostgreSQL + PostGIS ownership, cross-org isolation, grant/revoke, 409 conflict safety & DB immutability triggers pass'
    );
  } finally {
    // Cleanup temporary verification rows (deleting farms cascades boundary revisions cleanly)
    if (createdOrgIds.length > 0) {
      await db.delete(farms).where(inArray(farms.ownerOrganisationId, createdOrgIds));
      await db.delete(organisations).where(inArray(organisations.id, createdOrgIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(farms).where(inArray(farms.createdByUserId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  }

  // 3. Express API route guards, health check & Free Dev Mode check
  assert.equal(process.env.AI_PROVIDER ?? 'mock', 'mock');
  assert.notEqual(process.env.AI_PAID_ENABLED, 'true');

  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { data: { phase: number } };
    assert.equal(healthJson.data.phase, 2);

    const protectedRoutes = [
      { method: 'GET', path: '/api/v1/farms' },
      { method: 'POST', path: '/api/v1/farms' },
      { method: 'PUT', path: '/api/v1/farms/00000000-0000-0000-0000-000000000000/boundary' },
      { method: 'POST', path: '/api/v1/farms/00000000-0000-0000-0000-000000000000/permissions' },
      { method: 'GET', path: '/api/v1/locations/search?q=Lira' },
      { method: 'GET', path: '/api/v1/locations/config' },
    ];

    for (const ep of protectedRoutes) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${ep.method} ${ep.path} must return 401 without auth`);
    }

    passed += 1;
    console.log(
      '✓ Test 3: Phase 2 Express API endpoints enforce 401 auth guards, report phase 2, and preserve Free Development Mode'
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }

  console.log(`\nAll ${passed} Phase 2 acceptance verification suites passed.`);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Phase 2 verification failed:', err);
  process.exit(1);
});
