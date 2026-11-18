import type { NextFunction, Response } from 'express';
import type { BusinessRole, OrgRole } from '../../shared/types/domain.ts';
import type { AuthenticatedRequest } from './auth.guard.ts';

export function hasActiveBusinessRole(
  req: AuthenticatedRequest,
  allowedRoles: readonly BusinessRole[]
): boolean {
  const roles = req.authContext?.roles ?? [];
  return roles.some(
    (entry) => entry.status === 'active' && allowedRoles.includes(entry.role)
  );
}

export function requireBusinessRole(...allowedRoles: BusinessRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authContext) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }

    if (!hasActiveBusinessRole(req, allowedRoles)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_ROLE_REQUIRED',
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
          recoveryAction: 'Request the appropriate role or switch to an authorised workspace.',
        },
      });
    }

    next();
  };
}

export function requireOrganisationRole(allowedOrgRoles: readonly OrgRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authContext) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }

    const orgId = req.params.orgId;
    if (!orgId) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Missing organisation identifier.' },
      });
    }

    const membership = req.authContext.organisations.find((org) => org.id === orgId);

    if (!membership || membership.membershipStatus !== 'active') {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_ORG_ACCESS',
          message: 'You do not have active membership in this organisation.',
        },
      });
    }

    if (!allowedOrgRoles.includes(membership.membershipRole)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN_ORG_ROLE',
          message: `This action requires ${allowedOrgRoles.join(' or ')} permission inside the organisation.`,
        },
      });
    }

    next();
  };
}
