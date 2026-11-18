import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import { requireBusinessRole } from '../../middleware/rbac.guard.ts';
import {
  activateRoleSchema,
  selfActivateRoleSchema,
  updateProfileSchema,
} from '../../../shared/validation/schemas.ts';
import {
  findUserById,
  removeUserRole,
  updateUserProfile,
  upsertUserRole,
} from '../../../db/repositories/users.repository.ts';
import { appendAuditLog } from '../../../db/repositories/audit.repository.ts';
import { BUSINESS_ROLES, type BusinessRole } from '../../../shared/types/domain.ts';

export const usersRouter = Router();

usersRouter.patch('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid profile input.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const updated = await updateUserProfile(ctx.user.id, parsed.data);

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: ctx.user.onboardingCompleted ? 'user.profile_updated' : 'user.onboarding_completed',
      targetType: 'user',
      targetId: ctx.user.id,
      metadata: {
        district: updated.district,
        preferredLanguage: updated.preferredLanguage,
        preferredAreaUnit: updated.preferredAreaUnit,
        researchOptIn: updated.researchOptIn,
      },
      ipAddress: req.ip ?? null,
    });

    res.json({ data: updated });
  } catch (error) {
    console.error('Failed to update user profile:', error);
    res.status(500).json({
      error: {
        code: 'PROFILE_UPDATE_FAILED',
        message: 'Could not save your profile changes.',
      },
    });
  }
});

/**
 * Self-service role activation on a user's personal account.
 * Explicitly blocks self-granting privileged roles (such as 'admin').
 */
usersRouter.post('/me/roles', requireAuth, async (req: AuthenticatedRequest, res) => {
  const ctx = req.authContext!;
  const requestedRaw = activateRoleSchema.safeParse(req.body);

  if (!requestedRaw.success) {
    return res.status(400).json({
      error: {
        code: 'INVALID_ROLE',
        message: 'The requested role is not recognised.',
      },
    });
  }

  const requestedRole = requestedRaw.data.role;

  // Safeguard #1: Ordinary users MUST NEVER be able to grant themselves platform admin.
  if (requestedRole === 'admin') {
    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'role.self_escalation_blocked',
      targetType: 'user_role',
      targetId: `${ctx.user.id}:admin`,
      metadata: { attemptedRole: 'admin' },
      ipAddress: req.ip ?? null,
    }).catch((err) => console.error('Audit log error:', err));

    return res.status(403).json({
      error: {
        code: 'PRIVILEGED_ROLE_RESTRICTED',
        message:
          'Platform administrator privileges cannot be self-activated. Only an existing platform administrator can grant admin access.',
        recoveryAction: 'Select a standard operational role such as Farmer, Cooperative Manager, Buyer, Supplier, Logistics, or Expert.',
      },
    });
  }

  const selfParsed = selfActivateRoleSchema.safeParse({ role: requestedRole });
  if (!selfParsed.success) {
    return res.status(403).json({
      error: {
        code: 'ROLE_NOT_SELF_ACTIVATABLE',
        message: 'This role cannot be self-activated.',
      },
    });
  }

  try {
    const roleRecord = await upsertUserRole({
      userId: ctx.user.id,
      role: selfParsed.data.role,
      status: 'active',
      grantedByUserId: ctx.user.id,
    });

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'role.activated',
      targetType: 'user_role',
      targetId: `${ctx.user.id}:${roleRecord.role}`,
      metadata: { role: roleRecord.role, status: roleRecord.status },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ data: roleRecord });
  } catch (error) {
    console.error('Failed to activate role:', error);
    res.status(500).json({
      error: {
        code: 'ROLE_ACTIVATION_FAILED',
        message: 'Could not activate the requested role.',
      },
    });
  }
});

usersRouter.delete('/me/roles/:role', requireAuth, async (req: AuthenticatedRequest, res) => {
  const ctx = req.authContext!;
  const roleParam = req.params.role as BusinessRole;

  if (!BUSINESS_ROLES.includes(roleParam)) {
    return res.status(400).json({
      error: { code: 'INVALID_ROLE', message: 'Invalid role identifier.' },
    });
  }

  if (roleParam === 'admin') {
    return res.status(403).json({
      error: {
        code: 'PRIVILEGED_ROLE_RESTRICTED',
        message: 'Platform administrator role changes must be performed by an administrator.',
      },
    });
  }

  try {
    const removed = await removeUserRole(ctx.user.id, roleParam);
    if (removed) {
      await appendAuditLog({
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: 'role.deactivated',
        targetType: 'user_role',
        targetId: `${ctx.user.id}:${roleParam}`,
        metadata: { role: roleParam },
        ipAddress: req.ip ?? null,
      });
    }

    res.json({ data: { role: roleParam, removed } });
  } catch (error) {
    console.error('Failed to deactivate role:', error);
    res.status(500).json({
      error: {
        code: 'ROLE_DEACTIVATION_FAILED',
        message: 'Could not deactivate role.',
      },
    });
  }
});

/**
 * Admin-only privileged role grant endpoint.
 */
usersRouter.post(
  '/admin/:userId/roles',
  requireAuth,
  requireBusinessRole('admin'),
  async (req: AuthenticatedRequest, res) => {
    const parsed = activateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'INVALID_ROLE', message: 'Invalid role.' },
      });
    }

    try {
      const targetUser = await findUserById(req.params.userId);
      if (!targetUser) {
        return res.status(404).json({
          error: { code: 'USER_NOT_FOUND', message: 'Target user not found.' },
        });
      }

      const roleRecord = await upsertUserRole({
        userId: targetUser.id,
        role: parsed.data.role,
        status: 'active',
        grantedByUserId: req.authContext!.user.id,
      });

      await appendAuditLog({
        actorUserId: req.authContext!.user.id,
        actorEmail: req.authContext!.user.email,
        action: 'role.granted_by_admin',
        targetType: 'user_role',
        targetId: `${targetUser.id}:${roleRecord.role}`,
        metadata: { targetUserId: targetUser.id, role: roleRecord.role },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json({ data: roleRecord });
    } catch (error) {
      console.error('Admin role grant failed:', error);
      res.status(500).json({
        error: { code: 'ADMIN_ROLE_GRANT_FAILED', message: 'Failed to grant role.' },
      });
    }
  }
);
