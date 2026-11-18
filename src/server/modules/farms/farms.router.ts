import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import {
  createFarmPermissionSchema,
  createFarmSchema,
  updateFarmBoundarySchema,
  updateFarmSchema,
} from '../../../shared/validation/schemas.ts';
import {
  createFarmRecord,
  FarmRepositoryError,
  getFarmDetailForUser,
  getFarmPermissionsForUser,
  getFarmRevisionsForUser,
  grantFarmPermission,
  listAccessibleFarmsForUser,
  revokeFarmPermission,
  updateFarmBoundary,
  updateFarmMetadata,
} from '../../../db/repositories/farms.repository.ts';
import { appendAuditLog } from '../../../db/repositories/audit.repository.ts';

export const farmsRouter = Router();

const uuidParamSchema = z.string().uuid();

function validateUuidParam(res: Response, value: string, label: string): boolean {
  if (!uuidParamSchema.safeParse(value).success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Invalid ${label} identifier.`,
      },
    });
    return false;
  }
  return true;
}

function sendFarmError(res: Response, error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof FarmRepositoryError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.recoveryAction ? { recoveryAction: error.recoveryAction } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }
  console.error(`${fallbackCode}:`, error);
  return res.status(500).json({
    error: {
      code: fallbackCode,
      message: fallbackMessage,
    },
  });
}

farmsRouter.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rawOwnership = typeof req.query.ownership === 'string' ? req.query.ownership : undefined;
    const ownership =
      rawOwnership === 'individual' ||
      rawOwnership === 'organisation' ||
      rawOwnership === 'delegated'
        ? rawOwnership
        : undefined;
    const organisationId =
      typeof req.query.organisationId === 'string' ? req.query.organisationId : undefined;

    const items = await listAccessibleFarmsForUser(req.authContext!.user.id, {
      ownership,
      organisationId,
    });
    res.json({ data: items, meta: { total: items.length } });
  } catch (error) {
    sendFarmError(res, error, 'FARMS_LIST_FAILED', 'Could not load your accessible farms.');
  }
});

farmsRouter.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = createFarmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid farm registration payload.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const created = await createFarmRecord(ctx.user.id, parsed.data, 'web');

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'farm.created',
      targetType: 'farm',
      targetId: created.id,
      organisationId: created.ownerOrganisationId,
      metadata: {
        name: created.name,
        ownershipType: created.ownershipType,
        district: created.district,
        locationSource: created.locationSource,
        areaAcres: created.areaAcres,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ data: created });
  } catch (error) {
    sendFarmError(res, error, 'FARM_CREATE_FAILED', 'Could not register farm.');
  }
});

farmsRouter.get('/:farmId', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
  try {
    const detail = await getFarmDetailForUser(req.params.farmId, req.authContext!.user.id);
    res.json({ data: detail });
  } catch (error) {
    sendFarmError(res, error, 'FARM_LOAD_FAILED', 'Could not load farm record.');
  }
});

farmsRouter.patch('/:farmId', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
  const parsed = updateFarmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid farm update payload.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const updated = await updateFarmMetadata(req.params.farmId, ctx.user.id, parsed.data);

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'farm.updated',
      targetType: 'farm',
      targetId: updated.id,
      organisationId: updated.ownerOrganisationId,
      metadata: {
        version: updated.version,
        district: updated.district,
        resolutionStrategy: parsed.data.resolutionStrategy ?? 'strict',
      },
      ipAddress: req.ip ?? null,
    });

    res.json({ data: updated });
  } catch (error) {
    sendFarmError(res, error, 'FARM_UPDATE_FAILED', 'Could not update farm metadata.');
  }
});

farmsRouter.put('/:farmId/boundary', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
  const parsed = updateFarmBoundarySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid GeoJSON boundary payload.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const updated = await updateFarmBoundary(req.params.farmId, ctx.user.id, parsed.data);

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'farm.boundary_updated',
      targetType: 'farm',
      targetId: updated.id,
      organisationId: updated.ownerOrganisationId,
      metadata: {
        version: updated.version,
        areaSqMeters: updated.areaSqMeters,
        areaAcres: updated.areaAcres,
        areaHectares: updated.areaHectares,
        editSource: parsed.data.editSource,
      },
      ipAddress: req.ip ?? null,
    });

    res.json({ data: updated });
  } catch (error) {
    sendFarmError(res, error, 'BOUNDARY_UPDATE_FAILED', 'Could not save farm boundary.');
  }
});

farmsRouter.get('/:farmId/revisions', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
  try {
    const revisions = await getFarmRevisionsForUser(req.params.farmId, req.authContext!.user.id);
    res.json({ data: revisions, meta: { total: revisions.length } });
  } catch (error) {
    sendFarmError(res, error, 'FARM_REVISIONS_FAILED', 'Could not load boundary history.');
  }
});

farmsRouter.get('/:farmId/permissions', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
  try {
    const grants = await getFarmPermissionsForUser(req.params.farmId, req.authContext!.user.id);
    res.json({ data: grants, meta: { total: grants.length } });
  } catch (error) {
    sendFarmError(res, error, 'FARM_PERMISSIONS_FAILED', 'Could not load farm permissions.');
  }
});

farmsRouter.post('/:farmId/permissions', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
  const parsed = createFarmPermissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid farm permission payload.',
        details: { issues: parsed.error.issues },
      },
    });
  }

  try {
    const ctx = req.authContext!;
    const grant = await grantFarmPermission(req.params.farmId, ctx.user.id, parsed.data);

    await appendAuditLog({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'farm.permission_granted',
      targetType: 'farm_access_grant',
      targetId: grant.id,
      organisationId: grant.granteeOrganisationId,
      metadata: {
        farmId: req.params.farmId,
        granteeType: grant.granteeType,
        granteeLabel: grant.granteeLabel,
        accessRole: grant.accessRole,
        canEditBoundary: grant.canEditBoundary,
        canManageOperations: grant.canManageOperations,
        canManagePermissions: grant.canManagePermissions,
      },
      ipAddress: req.ip ?? null,
    });

    res.status(201).json({ data: grant });
  } catch (error) {
    sendFarmError(res, error, 'GRANT_CREATE_FAILED', 'Could not grant farm access.');
  }
});

farmsRouter.post(
  '/:farmId/permissions/:grantId/revoke',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    if (!validateUuidParam(res, req.params.farmId, 'farm')) return;
    if (!validateUuidParam(res, req.params.grantId, 'grant')) return;
    try {
      const ctx = req.authContext!;
      const revoked = await revokeFarmPermission(
        req.params.farmId,
        req.params.grantId,
        ctx.user.id
      );

      await appendAuditLog({
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: 'farm.permission_revoked',
        targetType: 'farm_access_grant',
        targetId: revoked.id,
        organisationId: revoked.granteeOrganisationId,
        metadata: {
          farmId: req.params.farmId,
          granteeType: revoked.granteeType,
          granteeLabel: revoked.granteeLabel,
        },
        ipAddress: req.ip ?? null,
      });

      res.json({ data: revoked });
    } catch (error) {
      sendFarmError(res, error, 'GRANT_REVOKE_FAILED', 'Could not revoke farm access.');
    }
  }
);
