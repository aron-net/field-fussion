import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index.ts';
import {
  organisationInvitations,
  organisationMemberships,
  organisations,
  users,
} from '../schema.ts';
import type {
  InvitationStatus,
  MembershipStatus,
  OrgRole,
  OrganisationInvitationRecord,
  OrganisationMemberRecord,
  OrganisationSummary,
  OrganisationType,
  VerificationStatus,
} from '../../shared/types/domain.ts';
import type { CreateOrganisationInput } from '../../shared/validation/schemas.ts';

export async function listOrganisationsForUser(
  userId: string
): Promise<OrganisationSummary[]> {
  try {
    const rows = await db
      .select({
        org: organisations,
        membership: organisationMemberships,
      })
      .from(organisationMemberships)
      .innerJoin(
        organisations,
        eq(organisationMemberships.organisationId, organisations.id)
      )
      .where(eq(organisationMemberships.userId, userId))
      .orderBy(desc(organisations.createdAt));

    return rows.map(({ org, membership }) => ({
      id: org.id,
      name: org.name,
      orgType: org.orgType as OrganisationType,
      country: org.country,
      district: org.district,
      registrationNumber: org.registrationNumber,
      verificationStatus: org.verificationStatus as VerificationStatus,
      createdByUserId: org.createdByUserId,
      createdAt: org.createdAt.toISOString(),
      membershipRole: membership.orgRole as OrgRole,
      membershipStatus: membership.status as MembershipStatus,
    }));
  } catch (error) {
    console.error('Database query failed in listOrganisationsForUser:', error);
    throw new Error('Failed to load organisations.', { cause: error });
  }
}

export async function getOrganisationMembership(
  organisationId: string,
  userId: string
): Promise<{ orgRole: OrgRole; status: MembershipStatus } | null> {
  try {
    const rows = await db
      .select()
      .from(organisationMemberships)
      .where(
        and(
          eq(organisationMemberships.organisationId, organisationId),
          eq(organisationMemberships.userId, userId)
        )
      )
      .limit(1);

    if (!rows[0]) return null;
    return {
      orgRole: rows[0].orgRole as OrgRole,
      status: rows[0].status as MembershipStatus,
    };
  } catch (error) {
    console.error('Database query failed in getOrganisationMembership:', error);
    throw new Error('Failed to verify organisation membership.', { cause: error });
  }
}

export async function createOrganisationWithOwner(
  userId: string,
  input: CreateOrganisationInput
): Promise<OrganisationSummary> {
  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organisations)
        .values({
          name: input.name,
          orgType: input.orgType,
          country: input.country,
          district: input.district,
          registrationNumber: input.registrationNumber ? input.registrationNumber : null,
          createdByUserId: userId,
        })
        .returning();

      const [membership] = await tx
        .insert(organisationMemberships)
        .values({
          organisationId: org.id,
          userId,
          orgRole: 'owner',
          status: 'active',
          invitedByUserId: userId,
        })
        .returning();

      return {
        id: org.id,
        name: org.name,
        orgType: org.orgType as OrganisationType,
        country: org.country,
        district: org.district,
        registrationNumber: org.registrationNumber,
        verificationStatus: org.verificationStatus as VerificationStatus,
        createdByUserId: org.createdByUserId,
        createdAt: org.createdAt.toISOString(),
        membershipRole: membership.orgRole as OrgRole,
        membershipStatus: membership.status as MembershipStatus,
      };
    });
  } catch (error) {
    console.error('Database query failed in createOrganisationWithOwner:', error);
    throw new Error('Failed to create organisation.', { cause: error });
  }
}

export async function listOrganisationMembersAndInvitations(
  organisationId: string
): Promise<{
  members: OrganisationMemberRecord[];
  invitations: OrganisationInvitationRecord[];
}> {
  try {
    const memberRows = await db
      .select({
        membership: organisationMemberships,
        user: users,
      })
      .from(organisationMemberships)
      .innerJoin(users, eq(organisationMemberships.userId, users.id))
      .where(eq(organisationMemberships.organisationId, organisationId));

    const inviteRows = await db
      .select()
      .from(organisationInvitations)
      .where(eq(organisationInvitations.organisationId, organisationId))
      .orderBy(desc(organisationInvitations.createdAt));

    return {
      members: memberRows.map(({ membership, user }) => ({
        id: membership.id,
        organisationId: membership.organisationId,
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        orgRole: membership.orgRole as OrgRole,
        status: membership.status as MembershipStatus,
        joinedAt: membership.joinedAt.toISOString(),
      })),
      invitations: inviteRows.map((inv) => ({
        id: inv.id,
        organisationId: inv.organisationId,
        inviteeEmail: inv.inviteeEmail,
        intendedOrgRole: inv.intendedOrgRole as OrgRole,
        status: inv.status as InvitationStatus,
        invitedByUserId: inv.invitedByUserId,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error('Database query failed in listOrganisationMembersAndInvitations:', error);
    throw new Error('Failed to load organisation members.', { cause: error });
  }
}

export async function createOrganisationInvitation(params: {
  organisationId: string;
  inviteeEmail: string;
  intendedOrgRole: OrgRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}): Promise<OrganisationInvitationRecord> {
  try {
    const [row] = await db
      .insert(organisationInvitations)
      .values({
        organisationId: params.organisationId,
        inviteeEmail: params.inviteeEmail.toLowerCase(),
        intendedOrgRole: params.intendedOrgRole,
        tokenHash: params.tokenHash,
        status: 'pending',
        invitedByUserId: params.invitedByUserId,
        expiresAt: params.expiresAt,
      })
      .returning();

    return {
      id: row.id,
      organisationId: row.organisationId,
      inviteeEmail: row.inviteeEmail,
      intendedOrgRole: row.intendedOrgRole as OrgRole,
      status: row.status as InvitationStatus,
      invitedByUserId: row.invitedByUserId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in createOrganisationInvitation:', error);
    throw new Error('Failed to create invitation.', { cause: error });
  }
}

export async function listPendingInvitationsForEmail(
  email: string
): Promise<OrganisationInvitationRecord[]> {
  try {
    const rows = await db
      .select({
        inv: organisationInvitations,
        orgName: organisations.name,
      })
      .from(organisationInvitations)
      .innerJoin(
        organisations,
        eq(organisationInvitations.organisationId, organisations.id)
      )
      .where(
        and(
          eq(organisationInvitations.inviteeEmail, email.toLowerCase()),
          eq(organisationInvitations.status, 'pending')
        )
      )
      .orderBy(desc(organisationInvitations.createdAt));

    return rows.map(({ inv, orgName }) => ({
      id: inv.id,
      organisationId: inv.organisationId,
      organisationName: orgName,
      inviteeEmail: inv.inviteeEmail,
      intendedOrgRole: inv.intendedOrgRole as OrgRole,
      status: inv.status as InvitationStatus,
      invitedByUserId: inv.invitedByUserId,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Database query failed in listPendingInvitationsForEmail:', error);
    throw new Error('Failed to load pending invitations.', { cause: error });
  }
}

export async function acceptOrganisationInvitation(params: {
  invitationId: string;
  userId: string;
  userEmail: string;
}): Promise<{ organisationId: string; orgRole: OrgRole }> {
  try {
    return await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(organisationInvitations)
        .where(eq(organisationInvitations.id, params.invitationId))
        .limit(1);

      if (!inv) {
        throw new Error('INVITATION_NOT_FOUND');
      }
      if (inv.status !== 'pending') {
        throw new Error('INVITATION_NOT_PENDING');
      }
      if (inv.expiresAt.getTime() < Date.now()) {
        throw new Error('INVITATION_EXPIRED');
      }
      if (inv.inviteeEmail.toLowerCase() !== params.userEmail.toLowerCase()) {
        throw new Error('INVITATION_EMAIL_MISMATCH');
      }

      await tx
        .insert(organisationMemberships)
        .values({
          organisationId: inv.organisationId,
          userId: params.userId,
          orgRole: inv.intendedOrgRole,
          status: 'active',
          invitedByUserId: inv.invitedByUserId,
        })
        .onConflictDoUpdate({
          target: [organisationMemberships.organisationId, organisationMemberships.userId],
          set: {
            orgRole: inv.intendedOrgRole,
            status: 'active',
          },
        });

      await tx
        .update(organisationInvitations)
        .set({ status: 'accepted' })
        .where(eq(organisationInvitations.id, inv.id));

      return {
        organisationId: inv.organisationId,
        orgRole: inv.intendedOrgRole as OrgRole,
      };
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'INVITATION_NOT_FOUND',
        'INVITATION_NOT_PENDING',
        'INVITATION_EXPIRED',
        'INVITATION_EMAIL_MISMATCH',
      ].includes(error.message)
    ) {
      throw error;
    }
    console.error('Database query failed in acceptOrganisationInvitation:', error);
    throw new Error('Failed to accept invitation.', { cause: error });
  }
}

export async function updateOrganisationMemberRecord(params: {
  organisationId: string;
  memberId: string;
  orgRole?: OrgRole;
  status?: MembershipStatus;
}): Promise<OrganisationMemberRecord | null> {
  try {
    const [updated] = await db
      .update(organisationMemberships)
      .set({
        ...(params.orgRole ? { orgRole: params.orgRole } : {}),
        ...(params.status ? { status: params.status } : {}),
      })
      .where(
        and(
          eq(organisationMemberships.id, params.memberId),
          eq(organisationMemberships.organisationId, params.organisationId)
        )
      )
      .returning();

    if (!updated) return null;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, updated.userId))
      .limit(1);

    if (!user) return null;

    return {
      id: updated.id,
      organisationId: updated.organisationId,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      orgRole: updated.orgRole as OrgRole,
      status: updated.status as MembershipStatus,
      joinedAt: updated.joinedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in updateOrganisationMemberRecord:', error);
    throw new Error('Failed to update organisation member.', { cause: error });
  }
}
