import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import { requireOrganisationRole } from '../../middleware/rbac.guard.ts';
import {
  createOrganisationSchema,
  inviteMemberSchema,
  updateMemberSchema,
} from '../../../shared/validation/schemas.ts';
import {
  acceptOrganisationInvitation,
  createOrganisationInvitation,
  createOrganisationWithOwner,
  listOrganisationMembersAndInvitations,
  listOrganisationsForUser,
  updateOrganisationMemberRecord,
} from '../../../db/repositories/organisations.repository.ts';
import { appendAuditLog } from '../../../db/repositories/audit.repository.ts';

export const organisationsRouter = Router();

organisationsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const orgs = await listOrganisationsForUser(req.authContext!.user.id);
    res.json({ data: orgs, meta: { total: orgs.length } });
  } catch (error) {
    console.error('Failed to list organisations:', error);
    res.status(500).json({
      error: {
        code: 'ORG_LIST_FAILED',
        message: 'Could not load your organisations.',
      },
    });
  }
});

organisationsRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = createOrganisationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid organisation details.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const created = await createOrganisationWithOwner(ctx.user.id, parsed.data);

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'org.created',
      targetType: 'organisation',
      targetId: created.id,
      organisationId: created.id,
      metadata: {
        name: created.name,
        orgType: created.orgType,
        district: created.district,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    console.error('Failed to create organisation:', error);
    res.status(500).json({
      error: {
        code: 'ORG_CREATE_FAILED',
        message: 'Could not register the organisation.',
      },
    });
  }
});

organisationsRouter.get(
  '/:orgId/members',
  requireAuth,
  requireOrganisationRole(['owner', 'manager', 'agronomist', 'finance_officer', 'member']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await listOrganisationMembersAndInvitations(req.params.orgId);
      res.json({ data: result });
    } catch (error) {
      console.error('Failed to list organisation members:', error);
      res.status(500).json({
        error: {
          code: 'ORG_MEMBERS_LOAD_FAILED',
          message: 'Could not load organisation members.',
        },
      });
    }
  }
);

organisationsRouter.post(
  '/:orgId/invitations',
  requireAuth,
  requireOrganisationRole(['owner', 'manager']),
  async (req: AuthenticatedRequest, res) => {
    const parsed = inviteMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid invitation details.',
        },
      });
    }

    try {
      const ctx = req.authContext!;
      const rawToken = crypto.randomBytes(24).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const invitation = await createOrganisationInvitation({
        organisationId: req.params.orgId,
        inviteeEmail: parsed.data.inviteeEmail,
        intendedOrgRole: parsed.data.intendedOrgRole,
        tokenHash,
        invitedByUserId: ctx.user.id,
        expiresAt,
      });

      await appendAuditLog({
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: 'org.member_invited',
        targetType: 'organisation_invitation',
        targetId: invitation.id,
        organisationId: req.params.orgId,
        metadata: {
          inviteeEmail: invitation.inviteeEmail,
          intendedOrgRole: invitation.intendedOrgRole,
        },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json({ data: invitation });
    } catch (error) {
      console.error('Failed to create invitation:', error);
      res.status(500).json({
        error: {
          code: 'ORG_INVITE_FAILED',
          message: 'Could not send organisation invitation.',
        },
      });
    }
  }
);

organisationsRouter.patch(
  '/:orgId/members/:memberId',
  requireAuth,
  requireOrganisationRole(['owner', 'manager']),
  async (req: AuthenticatedRequest, res) => {
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.orgRole && !parsed.data.status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Provide a valid orgRole or status update.',
        },
      });
    }

    try {
      const updated = await updateOrganisationMemberRecord({
        organisationId: req.params.orgId,
        memberId: req.params.memberId,
        orgRole: parsed.data.orgRole,
        status: parsed.data.status,
      });

      if (!updated) {
        return res.status(404).json({
          error: {
            code: 'MEMBER_NOT_FOUND',
            message: 'Organisation member record was not found.',
          },
        });
      }

      await appendAuditLog({
        actorUserId: req.authContext!.user.id,
        actorEmail: req.authContext!.user.email,
        action: 'org.member_updated',
        targetType: 'organisation_membership',
        targetId: updated.id,
        organisationId: req.params.orgId,
        metadata: {
          targetUserId: updated.userId,
          orgRole: updated.orgRole,
          status: updated.status,
        },
        ipAddress: req.ip ?? null,
      });

      res.json({ data: updated });
    } catch (error) {
      console.error('Failed to update member:', error);
      res.status(500).json({
        error: {
          code: 'ORG_MEMBER_UPDATE_FAILED',
          message: 'Could not update member permissions.',
        },
      });
    }
  }
);

export const invitationsRouter = Router();

invitationsRouter.post('/:invitationId/accept', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = req.authContext!;
    const result = await acceptOrganisationInvitation({
      invitationId: req.params.invitationId,
      userId: ctx.user.id,
      userEmail: ctx.user.email,
    });

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'org.invitation_accepted',
      targetType: 'organisation_invitation',
      targetId: req.params.invitationId,
      organisationId: result.organisationId,
      metadata: { assignedOrgRole: result.orgRole },
      ipAddress: req.ip ?? null,
    });

    res.json({ data: { accepted: true, organisationId: result.organisationId } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVITATION_ACCEPT_FAILED';
    const status =
      code === 'INVITATION_NOT_FOUND'
        ? 404
        : code === 'INVITATION_EMAIL_MISMATCH'
          ? 403
          : code === 'INVITATION_EXPIRED' || code === 'INVITATION_NOT_PENDING'
            ? 400
            : 500;

    res.status(status).json({
      error: {
        code,
        message:
          code === 'INVITATION_EMAIL_MISMATCH'
            ? 'This invitation was issued for a different email address.'
            : code === 'INVITATION_EXPIRED'
              ? 'This invitation has expired.'
              : code === 'INVITATION_NOT_FOUND'
                ? 'Invitation not found.'
                : 'Could not accept this invitation.',
      },
    });
  }
});
