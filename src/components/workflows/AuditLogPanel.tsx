import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  InlineAlert,
  MetadataLine,
  SecondaryButton,
  SurfaceCard,
} from '../../design-system/components.tsx';
import { useFieldFussion } from '../../context/FieldFussionContext.tsx';
import type { AuditLogRecord } from '../../shared/types/domain.ts';

export function AuditLogPanel() {
  const { session, loadAuditLogs, isOnline, t } = useFieldFussion();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!isOnline) return;
    setLoading(true);
    setError(null);
    try {
      const items = await loadAuditLogs(orgFilter || undefined);
      setLogs(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [isOnline, loadAuditLogs, orgFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (!session) return null;

  const manageableOrgs = session.organisations.filter(
    (o) =>
      o.membershipStatus === 'active' &&
      (o.membershipRole === 'owner' || o.membershipRole === 'manager')
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">{t.audit.title}</h2>
          <p className="text-sm text-ink-muted">{t.audit.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {manageableOrgs.length > 0 && (
            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-border-hairline bg-white text-xs text-ink"
            >
              <option value="">All Accessible Scope</option>
              {manageableOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          <SecondaryButton
            onClick={fetchLogs}
            loading={loading}
            disabled={!isOnline}
            className="min-h-[40px] text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </SecondaryButton>
        </div>
      </div>

      {error && <InlineAlert variant="error" message={error} onRetry={fetchLogs} />}

      <SurfaceCard className="overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-6 text-sm text-ink-muted">{t.common.loading}</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-sm text-ink-muted">{t.audit.empty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-hairline bg-canvas text-xs text-ink-muted">
                  <th className="py-2.5 px-4 font-medium">Timestamp</th>
                  <th className="py-2.5 px-4 font-medium">Action</th>
                  <th className="py-2.5 px-4 font-medium">Actor</th>
                  <th className="py-2.5 px-4 font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-hairline text-xs">
                {logs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-canvas/60">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-ink-muted whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-ink whitespace-nowrap">
                      {entry.action}
                    </td>
                    <td className="py-2.5 px-4 text-ink-muted">
                      {entry.actorEmail ?? 'System'}
                    </td>
                    <td className="py-2.5 px-4 text-ink-muted">
                      <MetadataLine
                        items={[
                          entry.targetType,
                          entry.targetId ? entry.targetId.slice(0, 24) : null,
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
