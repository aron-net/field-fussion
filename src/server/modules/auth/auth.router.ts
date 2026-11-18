import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import { listPendingInvitationsForEmail } from '../../../db/repositories/organisations.repository.ts';
import { syncRegisteredUserProfile } from '../../../db/repositories/users.repository.ts';
import { appendAuditLog } from '../../../db/repositories/audit.repository.ts';
import { registerProfileSyncSchema } from '../../../shared/validation/schemas.ts';

export const authRouter = Router();

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = req.authContext!;
    const pendingInvitations = await listPendingInvitationsForEmail(ctx.user.email);

    res.json({
      data: {
        user: ctx.user,
        roles: ctx.roles,
        organisations: ctx.organisations,
        pendingInvitations,
      },
      meta: { source: 'server' },
    });
  } catch (error) {
    console.error('Failed to build /auth/me payload:', error);
    res.status(500).json({
      error: {
        code: 'SESSION_LOAD_FAILED',
        message: 'Could not load user session details.',
      },
    });
  }
});

authRouter.post('/register-profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = registerProfileSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid registration profile input.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const updatedUser = await syncRegisteredUserProfile(ctx.user.id, parsed.data);

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'user.registered_profile_synced',
      targetType: 'user',
      targetId: ctx.user.id,
      metadata: {
        signInProvider: ctx.firebaseToken.firebase?.sign_in_provider ?? 'password',
        hasPhone: Boolean(parsed.data.phone),
        termsAccepted: true,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(200).json({ data: updatedUser });
  } catch (error) {
    console.error('Failed to synchronize registered profile:', error);
    res.status(500).json({
      error: {
        code: 'REGISTRATION_SYNC_FAILED',
        message: 'Account created, but profile synchronization could not complete right now.',
      },
    });
  }
});
