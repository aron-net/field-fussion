import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import { hasActiveBusinessRole } from '../../middleware/rbac.guard.ts';
import { listAuditLogsForScope } from '../../../db/repositories/audit.repository.ts';

export const auditRouter = Router();

/**
 * Read-only audit log endpoint.
 * No PATCH, PUT, or DELETE routes exist by design.
 */
auditRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = req.authContext!;
    const isAdmin = hasActiveBusinessRole(req, ['admin']);
    const requestedOrgId =
      typeof req.query.organisationId === 'string' && req.query.organisationId.trim()
        ? req.query.organisationId.trim()
        : undefined;

    const managedOrganisationIds = ctx.organisations
      .filter(
        (org) =>
          org.membershipStatus === 'active' &&
          (org.membershipRole === 'owner' || org.membershipRole === 'manager')
      )
      .map((org) => org.id);

    if (
      requestedOrgId &&
      !isAdmin &&
      !managedOrganisationIds.includes(requestedOrgId)
    ) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_AUDIT_SCOPE',
          message:
            'Only organisation owners, managers, or platform administrators can inspect organisation audit logs.',
        },
      });
    }

    const logs = await listAuditLogsForScope({
      actorUserId: ctx.user.id,
      isAdmin,
      managedOrganisationIds,
      requestedOrganisationId: requestedOrgId,
      limit: 80,
    });

    res.json({ data: logs, meta: { total: logs.length } });
  } catch (error) {
    console.error('Failed to query audit logs:', error);
    res.status(500).json({
      error: {
        code: 'AUDIT_LOAD_FAILED',
        message: 'Could not load audit trail.',
      },
    });
  }
});
