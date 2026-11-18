import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  getOrCreateUserByFirebaseUid,
  listUserRoles,
  upsertUserRole,
  UserAccountConflictError,
} from '../../db/repositories/users.repository.ts';
import { listOrganisationsForUser } from '../../db/repositories/organisations.repository.ts';
import { appendAuditLog } from '../../db/repositories/audit.repository.ts';
import type {
  OrganisationSummary,
  UserProfile,
  UserRoleRecord,
} from '../../shared/types/domain.ts';

export interface FieldFussionAuthContext {
  firebaseToken: DecodedIdToken;
  user: UserProfile;
  roles: UserRoleRecord[];
  organisations: OrganisationSummary[];
}

export interface AuthenticatedRequest extends Request {
  authContext?: FieldFussionAuthContext;
}

function getPlatformAdminAllowlist(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Identity verification + FIELD FUSSION authorization context loader.
 * Firebase verifies identity (uid, email). PostgreSQL owns all business roles,
 * organisation memberships, and permissions.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_MISSING_TOKEN',
        message: 'Authentication required. Missing Bearer ID token.',
        recoveryAction: 'Sign in with your Google account to continue.',
      },
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_EMPTY_TOKEN',
        message: 'Authentication token is empty.',
        recoveryAction: 'Sign in again to refresh your session.',
      },
    });
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_INVALID_TOKEN',
        message: 'Your session is invalid or has expired.',
        recoveryAction: 'Sign in again to obtain a fresh session token.',
      },
    });
  }

  const email = decoded.email;
  if (!email) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_MISSING_EMAIL',
        message: 'Verified account email is required.',
      },
    });
  }

  try {
    const user = await getOrCreateUserByFirebaseUid({
      firebaseUid: decoded.uid,
      email,
      displayName: typeof decoded.name === 'string' ? decoded.name : null,
      emailVerified: decoded.email_verified === true,
    });

    let roles = await listUserRoles(user.id);

    // Optional server-side admin allowlist bootstrap (configured strictly via server env)
    const allowlist = getPlatformAdminAllowlist();
    if (
      allowlist.includes(email.toLowerCase()) &&
      !roles.some((r) => r.role === 'admin' && r.status === 'active')
    ) {
      await upsertUserRole({
        userId: user.id,
        role: 'admin',
        status: 'active',
        grantedByUserId: null,
      });
      await appendAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'role.admin_bootstrapped',
        targetType: 'user_role',
        targetId: `${user.id}:admin`,
        metadata: { source: 'PLATFORM_ADMIN_EMAILS' },
        ipAddress: req.ip ?? null,
      });
      roles = await listUserRoles(user.id);
    }

    const organisations = await listOrganisationsForUser(user.id);

    req.authContext = {
      firebaseToken: decoded,
      user,
      roles,
      organisations,
    };

    next();
  } catch (error) {
    if (error instanceof UserAccountConflictError) {
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          recoveryAction: 'Sign in using your original method or verify your email address first.',
        },
      });
    }
    console.error('Failed to resolve FIELD FUSSION auth context:', error);
    return res.status(500).json({
      error: {
        code: 'AUTH_CONTEXT_FAILURE',
        message: 'Unable to load your account permissions right now.',
        recoveryAction: 'Retry in a moment or verify database connectivity.',
      },
    });
  }
}
