import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import {
  aiAdvisoryRequestSchema,
  aiConfirmationSchema,
  switchAiProviderSchema,
} from '../../../shared/validation/schemas.ts';
import { appendAuditLog } from '../../../db/repositories/audit.repository.ts';
import { AiGatewayError } from './provider.interface.ts';
import {
  AiGatewayService,
  defaultAiGatewayService,
} from './ai-gateway.service.ts';

export function createAiGatewayRouter(
  gatewayService: AiGatewayService = defaultAiGatewayService
) {
  const router = Router();

  router.get('/status', requireAuth, async (req, res) => {
    try {
      const probe = req.query.probe === 'true';
      const status = await gatewayService.getStatus(probe);
      res.json({ data: status });
    } catch (error) {
      console.error('Failed to read AI gateway status:', error);
      res.status(500).json({
        error: {
          code: 'AI_STATUS_FAILED',
          message: 'Unable to check AI gateway status.',
        },
      });
    }
  });

  router.post('/provider', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = switchAiProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AI_PROVIDER',
          message: 'Select a valid AI provider.',
        },
      });
    }

    try {
      const previousProvider = gatewayService.getActiveProviderId();
      gatewayService.switchProvider(parsed.data.providerId);

      await appendAuditLog({
        actorUserId: req.authContext!.user.id,
        actorEmail: req.authContext!.user.email,
        action: 'ai.provider_switched',
        targetType: 'ai_gateway',
        targetId: parsed.data.providerId,
        metadata: {
          previousProvider,
          nextProvider: parsed.data.providerId,
        },
        ipAddress: req.ip ?? null,
      }).catch((err) => console.error('Audit log error:', err));

      const status = await gatewayService.getStatus(false);
      res.json({ data: status });
    } catch (error) {
      if (error instanceof AiGatewayError) {
        return res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            recoveryAction: error.recoveryAction,
          },
        });
      }
      res.status(500).json({
        error: {
          code: 'AI_PROVIDER_SWITCH_FAILED',
          message: 'Could not switch AI provider.',
        },
      });
    }
  });

  router.post('/advisory', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = aiAdvisoryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid advisory prompt.',
        },
      });
    }

    try {
      const result = await gatewayService.generateAdvisory({
        authContext: req.authContext!,
        prompt: parsed.data.prompt,
        organisationId: parsed.data.organisationId,
        includeDraftSuggestion: parsed.data.includeDraftSuggestion,
      });

      res.json({ data: result });
    } catch (error) {
      if (error instanceof AiGatewayError) {
        return res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            recoveryAction: error.recoveryAction,
          },
        });
      }
      console.error('Unexpected AI gateway failure:', error);
      res.status(500).json({
        error: {
          code: 'AI_GATEWAY_ERROR',
          message: 'AI advisory request failed.',
        },
      });
    }
  });

  router.post(
    '/confirmations/:draftId',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      const parsed = aiConfirmationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Decision must be confirm or dismiss.',
          },
        });
      }

      try {
        const resolved = gatewayService.resolveDraft({
          draftId: req.params.draftId,
          userId: req.authContext!.user.id,
          decision: parsed.data.decision,
        });

        await appendAuditLog({
          actorUserId: req.authContext!.user.id,
          actorEmail: req.authContext!.user.email,
          action:
            resolved.status === 'confirmed'
              ? 'ai.advisory_confirmed'
              : 'ai.advisory_dismissed',
          targetType: 'ai_advisory_draft',
          targetId: resolved.draftId,
          organisationId: resolved.organisationId ?? null,
          metadata: { status: resolved.status },
          ipAddress: req.ip ?? null,
        }).catch((err) => console.error('Audit log error:', err));

        res.json({ data: resolved });
      } catch (error) {
        if (error instanceof AiGatewayError) {
          return res.status(error.status).json({
            error: {
              code: error.code,
              message: error.message,
              recoveryAction: error.recoveryAction,
            },
          });
        }
        res.status(500).json({
          error: {
            code: 'AI_CONFIRMATION_FAILED',
            message: 'Could not resolve AI confirmation.',
          },
        });
      }
    }
  );

  return router;
}

export const aiGatewayRouter = createAiGatewayRouter();
