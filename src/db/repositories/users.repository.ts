import { and, eq, sql } from 'drizzle-orm';
import { db } from '../index.ts';
import { userRoles, users } from '../schema.ts';
import type {
  AreaUnit,
  BusinessRole,
  CurrencyCode,
  RoleStatus,
  SupportedLanguage,
  UserProfile,
  UserRoleRecord,
} from '../../shared/types/domain.ts';
import type {
  RegisterProfileSyncInput,
  UpdateProfileInput,
} from '../../shared/validation/schemas.ts';

export class UserAccountConflictError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'UserAccountConflictError';
    this.code = code;
    this.status = status;
  }
}

function mapUserRow(row: typeof users.$inferSelect): UserProfile {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    phone: row.phone,
    fullName: row.fullName,
    district: row.district,
    country: row.country,
    currency: row.currency as CurrencyCode,
    preferredLanguage: row.preferredLanguage as SupportedLanguage,
    preferredAreaUnit: row.preferredAreaUnit as AreaUnit,
    timezone: row.timezone,
    onboardingCompleted: row.onboardingCompleted,
    researchOptIn: row.researchOptIn,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRoleRow(row: typeof userRoles.$inferSelect): UserRoleRecord {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role as BusinessRole,
    status: row.status as RoleStatus,
    activatedAt: row.activatedAt.toISOString(),
    grantedByUserId: row.grantedByUserId,
  };
}

export async function getOrCreateUserByFirebaseUid(params: {
  firebaseUid: string;
  email: string;
  displayName?: string | null;
  emailVerified?: boolean;
}): Promise<UserProfile> {
  try {
    const normalizedEmail = params.email.trim().toLowerCase();
    const fallbackName =
      params.displayName?.trim() || normalizedEmail.split('@')[0] || 'Farmer';

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, params.firebaseUid))
      .limit(1);

    if (existing.length > 0) {
      const updates: Partial<typeof users.$inferInsert> = {};
      if (existing[0].email.toLowerCase() !== normalizedEmail) {
        updates.email = normalizedEmail;
      }
      if (!existing[0].fullName.trim() && params.displayName?.trim()) {
        updates.fullName = params.displayName.trim();
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        const [updated] = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, existing[0].id))
          .returning();
        return mapUserRow(updated);
      }
      return mapUserRow(existing[0]);
    }

    // One-person, one-account check: never create duplicate profiles for the same email,
    // and never auto-merge an unverified email identity into an existing user account.
    const existingByEmail = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    if (existingByEmail.length > 0) {
      if (!params.emailVerified) {
        throw new UserAccountConflictError(
          'ACCOUNT_LINK_VERIFICATION_REQUIRED',
          'An account with this email already exists. Verify your email or sign in with your original sign-in method before linking.'
        );
      }

      // Verified identity matching an existing email: reuse the single FIELD FUSSION user row
      // without duplicating profile, roles, farms, or organisation memberships.
      const matched = existingByEmail[0];
      const [linked] = await db
        .update(users)
        .set({
          firebaseUid: params.firebaseUid,
          email: normalizedEmail,
          fullName: matched.fullName.trim() ? matched.fullName : fallbackName,
          updatedAt: new Date(),
        })
        .where(eq(users.id, matched.id))
        .returning();
      return mapUserRow(linked);
    }

    const [upserted] = await db
      .insert(users)
      .values({
        firebaseUid: params.firebaseUid,
        email: normalizedEmail,
        fullName: fallbackName,
      })
      .onConflictDoUpdate({
        target: users.firebaseUid,
        set: {
          email: normalizedEmail,
          updatedAt: new Date(),
        },
      })
      .returning();

    return mapUserRow(upserted);
  } catch (error) {
    if (error instanceof UserAccountConflictError) {
      throw error;
    }
    console.error('Database query failed in getOrCreateUserByFirebaseUid:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function syncRegisteredUserProfile(
  userId: string,
  input: RegisterProfileSyncInput
): Promise<UserProfile> {
  try {
    const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) {
      throw new Error('User record not found.');
    }

    const [updated] = await db
      .update(users)
      .set({
        fullName: input.fullName.trim(),
        phone: input.phone ? input.phone.trim() : existing.phone,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return mapUserRow(updated);
  } catch (error) {
    console.error('Database query failed in syncRegisteredUserProfile:', error);
    throw new Error('Failed to synchronize registration profile.', { cause: error });
  }
}

export async function findUserById(userId: string): Promise<UserProfile | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ? mapUserRow(rows[0]) : null;
  } catch (error) {
    console.error('Database query failed in findUserById:', error);
    throw new Error('Failed to fetch user profile.', { cause: error });
  }
}

export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput
): Promise<UserProfile> {
  try {
    const [updated] = await db
      .update(users)
      .set({
        fullName: input.fullName,
        phone: input.phone ? input.phone : null,
        district: input.district,
        country: input.country,
        currency: input.currency,
        preferredLanguage: input.preferredLanguage,
        preferredAreaUnit: input.preferredAreaUnit,
        timezone: input.timezone,
        onboardingCompleted: input.onboardingCompleted ?? true,
        ...(input.researchOptIn !== undefined ? { researchOptIn: input.researchOptIn } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    return mapUserRow(updated);
  } catch (error) {
    console.error('Database query failed in updateUserProfile:', error);
    throw new Error('Failed to update user profile.', { cause: error });
  }
}

export async function listUserRoles(userId: string): Promise<UserRoleRecord[]> {
  try {
    const rows = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    return rows.map(mapRoleRow);
  } catch (error) {
    console.error('Database query failed in listUserRoles:', error);
    throw new Error('Failed to load user roles.', { cause: error });
  }
}

export async function upsertUserRole(params: {
  userId: string;
  role: BusinessRole;
  status?: RoleStatus;
  grantedByUserId?: string | null;
}): Promise<UserRoleRecord> {
  try {
    const [row] = await db
      .insert(userRoles)
      .values({
        userId: params.userId,
        role: params.role,
        status: params.status ?? 'active',
        grantedByUserId: params.grantedByUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [userRoles.userId, userRoles.role],
        set: {
          status: params.status ?? 'active',
          grantedByUserId: params.grantedByUserId ?? null,
          activatedAt: new Date(),
        },
      })
      .returning();

    return mapRoleRow(row);
  } catch (error) {
    console.error('Database query failed in upsertUserRole:', error);
    throw new Error('Failed to activate role.', { cause: error });
  }
}

export async function removeUserRole(
  userId: string,
  role: BusinessRole
): Promise<boolean> {
  try {
    const deleted = await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)))
      .returning({ id: userRoles.id });

    return deleted.length > 0;
  } catch (error) {
    console.error('Database query failed in removeUserRole:', error);
    throw new Error('Failed to deactivate role.', { cause: error });
  }
}
