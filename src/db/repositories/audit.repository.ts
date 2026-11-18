import { desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '../index.ts';
import { auditLogs } from '../schema.ts';
import type { AuditLogRecord } from '../../shared/types/domain.ts';

export interface AppendAuditLogInput {
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  organisationId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

function mapAuditRow(row: typeof auditLogs.$inferSelect): AuditLogRecord {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    organisationId: row.organisationId,
    metadata: row.metadata ?? {},
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Append-only audit repository.
 * Intentionally provides INSERT and SELECT operations only—never UPDATE or DELETE.
 */
export async function appendAuditLog(input: AppendAuditLogInput): Promise<AuditLogRecord> {
  try {
    const [inserted] = await db
      .insert(auditLogs)
      .values({
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        organisationId: input.organisationId ?? null,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress ?? null,
      })
      .returning();

    return mapAuditRow(inserted);
  } catch (error) {
    console.error('Database query failed in appendAuditLog:', error);
    throw new Error('Failed to record audit entry.', { cause: error });
  }
}

export async function listAuditLogsForScope(params: {
  actorUserId: string;
  isAdmin: boolean;
  managedOrganisationIds: string[];
  requestedOrganisationId?: string;
  limit?: number;
}): Promise<AuditLogRecord[]> {
  try {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

    if (params.requestedOrganisationId) {
      const canReadOrg =
        params.isAdmin ||
        params.managedOrganisationIds.includes(params.requestedOrganisationId);

      if (!canReadOrg) {
        return [];
      }

      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organisationId, params.requestedOrganisationId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);

      return rows.map(mapAuditRow);
    }

    if (params.isAdmin) {
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);

      return rows.map(mapAuditRow);
    }

    const conditions = [eq(auditLogs.actorUserId, params.actorUserId)];
    if (params.managedOrganisationIds.length > 0) {
      conditions.push(inArray(auditLogs.organisationId, params.managedOrganisationIds));
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(or(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return rows.map(mapAuditRow);
  } catch (error) {
    console.error('Database query failed in listAuditLogsForScope:', error);
    throw new Error('Failed to load audit logs.', { cause: error });
  }
}
