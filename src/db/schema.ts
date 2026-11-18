import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FarmGeoJsonBoundary } from '../shared/types/domain.ts';

const postgisPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Point,4326)';
  },
});

const postgisMultiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(MultiPolygon,4326)';
  },
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  firebaseUid: text('firebase_uid').notNull().unique(),
  email: text('email').notNull(),
  phone: text('phone'),
  fullName: text('full_name').notNull().default(''),
  district: text('district'),
  country: text('country').notNull().default('UG'),
  currency: text('currency').notNull().default('UGX'),
  preferredLanguage: text('preferred_language').notNull().default('en'),
  preferredAreaUnit: text('preferred_area_unit').notNull().default('acres'),
  timezone: text('timezone').notNull().default('Africa/Kampala'),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  researchOptIn: boolean('research_opt_in').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('user_roles_user_role_idx').on(table.userId, table.role)]
);

export const organisations = pgTable('organisations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  orgType: text('org_type').notNull(),
  country: text('country').notNull().default('UG'),
  district: text('district'),
  registrationNumber: text('registration_number'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const organisationMemberships = pgTable(
  'organisation_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgRole: text('org_role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('org_memberships_org_user_idx').on(table.organisationId, table.userId),
  ]
);

export const organisationInvitations = pgTable('organisation_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  inviteeEmail: text('invitee_email').notNull(),
  intendedOrgRole: text('intended_org_role').notNull().default('member'),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull().default('pending'),
  invitedByUserId: uuid('invited_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Append-only audit trail.
 * Application repositories expose INSERT and SELECT only (no UPDATE/DELETE).
 * Production DB deployments should also apply src/db/sql/audit_immutability.sql
 * to enforce REVOKE UPDATE, DELETE and trigger-level immutability.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  organisationId: uuid('organisation_id').references(() => organisations.id, {
    onDelete: 'set null',
  }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
  memberships: many(organisationMemberships),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
}));

export const organisationsRelations = relations(organisations, ({ many }) => ({
  memberships: many(organisationMemberships),
  invitations: many(organisationInvitations),
}));

export const organisationMembershipsRelations = relations(
  organisationMemberships,
  ({ one }) => ({
    organisation: one(organisations, {
      fields: [organisationMemberships.organisationId],
      references: [organisations.id],
    }),
    user: one(users, {
      fields: [organisationMemberships.userId],
      references: [users.id],
    }),
  })
);

export const farms = pgTable(
  'farms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    farmCode: text('farm_code'),
    ownershipType: text('ownership_type').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    ownerOrganisationId: uuid('owner_organisation_id').references(
      () => organisations.id,
      { onDelete: 'restrict' }
    ),
    country: text('country').notNull().default('UG'),
    district: text('district').notNull(),
    subcounty: text('subcounty'),
    locationSource: text('location_source').notNull().default('search'),
    centroidLat: doublePrecision('centroid_lat'),
    centroidLng: doublePrecision('centroid_lng'),
    centroidGeom: postgisPoint('centroid_geom'),
    boundaryGeojson: jsonb('boundary_geojson').$type<FarmGeoJsonBoundary | null>(),
    boundaryGeom: postgisMultiPolygon('boundary_geom'),
    areaSqMeters: doublePrecision('area_sq_meters'),
    areaAcres: doublePrecision('area_acres'),
    areaHectares: doublePrecision('area_hectares'),
    areaSource: text('area_source').notNull().default('declared_estimate'),
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('active'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'farms_ownership_check',
      sql`(${table.ownershipType} = 'individual' AND ${table.ownerUserId} IS NOT NULL) OR (${table.ownershipType} = 'organisation' AND ${table.ownerOrganisationId} IS NOT NULL)`
    ),
    index('farms_owner_user_idx').on(table.ownerUserId),
    index('farms_owner_org_idx').on(table.ownerOrganisationId),
    index('farms_centroid_geom_idx').using('gist', table.centroidGeom),
    index('farms_boundary_geom_idx').using('gist', table.boundaryGeom),
  ]
);

export const farmAccessGrants = pgTable(
  'farm_access_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id, { onDelete: 'cascade' }),
    granteeType: text('grantee_type').notNull(),
    granteeUserId: uuid('grantee_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    granteeOrganisationId: uuid('grantee_organisation_id').references(
      () => organisations.id,
      { onDelete: 'cascade' }
    ),
    accessRole: text('access_role').notNull(),
    canEditBoundary: boolean('can_edit_boundary').notNull().default(false),
    canManageOperations: boolean('can_manage_operations').notNull().default(true),
    canManagePermissions: boolean('can_manage_permissions').notNull().default(false),
    grantedByUserId: uuid('granted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check(
      'farm_grants_grantee_check',
      sql`(${table.granteeType} = 'user' AND ${table.granteeUserId} IS NOT NULL) OR (${table.granteeType} = 'organisation' AND ${table.granteeOrganisationId} IS NOT NULL)`
    ),
    index('farm_grants_farm_idx').on(table.farmId),
    index('farm_grants_user_idx').on(table.granteeUserId),
    index('farm_grants_org_idx').on(table.granteeOrganisationId),
  ]
);

export const farmBoundaryRevisions = pgTable(
  'farm_boundary_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    boundaryGeojson: jsonb('boundary_geojson').$type<FarmGeoJsonBoundary>().notNull(),
    areaSqMeters: doublePrecision('area_sq_meters').notNull(),
    areaAcres: doublePrecision('area_acres').notNull(),
    areaHectares: doublePrecision('area_hectares').notNull(),
    editedByUserId: uuid('edited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    editSource: text('edit_source').notNull().default('web'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('farm_revisions_farm_idx').on(table.farmId)]
);

export const farmsRelations = relations(farms, ({ one, many }) => ({
  ownerUser: one(users, {
    fields: [farms.ownerUserId],
    references: [users.id],
  }),
  ownerOrganisation: one(organisations, {
    fields: [farms.ownerOrganisationId],
    references: [organisations.id],
  }),
  grants: many(farmAccessGrants),
  revisions: many(farmBoundaryRevisions),
}));

export const farmAccessGrantsRelations = relations(farmAccessGrants, ({ one }) => ({
  farm: one(farms, {
    fields: [farmAccessGrants.farmId],
    references: [farms.id],
  }),
  granteeUser: one(users, {
    fields: [farmAccessGrants.granteeUserId],
    references: [users.id],
  }),
  granteeOrganisation: one(organisations, {
    fields: [farmAccessGrants.granteeOrganisationId],
    references: [organisations.id],
  }),
}));

export const farmBoundaryRevisionsRelations = relations(
  farmBoundaryRevisions,
  ({ one }) => ({
    farm: one(farms, {
      fields: [farmBoundaryRevisions.farmId],
      references: [farms.id],
    }),
  })
);
