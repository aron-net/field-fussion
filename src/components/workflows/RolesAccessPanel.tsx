import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import {
  InlineAlert,
  MetadataLine,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
} from '../../design-system/components.tsx';
import { useFieldFussion } from '../../context/FieldFussionContext.tsx';
import { BUSINESS_ROLES, type BusinessRole } from '../../shared/types/domain.ts';

export function RolesAccessPanel() {
  const {
    session,
    activateRole,
    deactivateRole,
    activeRole,
    setActiveRole,
    isOnline,
    t,
  } = useFieldFussion();
  const [pendingRole, setPendingRole] = useState<BusinessRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!session) return null;

  const handleToggle = async (role: BusinessRole, isActive: boolean) => {
    setError(null);
    setFeedback(null);
    setPendingRole(role);
    try {
      if (isActive) {
        await deactivateRole(role);
        setFeedback(`${t.roles.names[role]} deactivated on your account.`);
      } else {
        await activateRole(role);
        setFeedback(`${t.roles.names[role]} activated on your account.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update role.');
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink">{t.roles.title}</h2>
        <p className="text-sm text-ink-muted">{t.roles.subtitle}</p>
      </div>

      {!isOnline && (
        <InlineAlert
          variant="info"
          message="Role changes require an active connection so permissions are verified and audited on the server."
        />
      )}
      {error && <InlineAlert variant="error" message={error} />}
      {feedback && <InlineAlert variant="success" message={feedback} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {BUSINESS_ROLES.map((role) => {
          const existing = session.roles.find((r) => r.role === role);
          const isActive = existing?.status === 'active';
          const isRestrictedAdmin = role === 'admin';
          const isSelectedWorkspace = activeRole === role;

          return (
            <SurfaceCard key={role} className="p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-ink">
                      {t.roles.names[role]}
                    </h3>
                    <MetadataLine
                      items={[
                        isActive ? t.roles.activeLabel : t.roles.inactiveLabel,
                        existing?.activatedAt
                          ? `Since ${new Date(existing.activatedAt).toLocaleDateString()}`
                          : null,
                        isSelectedWorkspace ? 'Current workspace' : null,
                      ]}
                    />
                  </div>
                  {isRestrictedAdmin && (
                    <Lock className="w-4 h-4 text-ink-muted shrink-0 mt-1" />
                  )}
                </div>
                <p className="text-sm text-ink-muted leading-relaxed">
                  {t.roles.descriptions[role]}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-hairline">
                {isRestrictedAdmin && !isActive ? (
                  <span className="text-xs text-ink-muted">
                    {t.roles.restrictedNotice}
                  </span>
                ) : (
                  <>
                    {isActive && !isSelectedWorkspace && (
                      <SecondaryButton
                        onClick={() => setActiveRole(role)}
                        className="min-h-[40px] text-xs"
                      >
                        Switch Workspace
                      </SecondaryButton>
                    )}
                    {!isRestrictedAdmin && (
                      isActive ? (
                        <SecondaryButton
                          onClick={() => handleToggle(role, true)}
                          loading={pendingRole === role}
                          disabled={!isOnline}
                          className="min-h-[40px] text-xs ml-auto"
                        >
                          {t.roles.deactivate}
                        </SecondaryButton>
                      ) : (
                        <PrimaryButton
                          onClick={() => handleToggle(role, false)}
                          loading={pendingRole === role}
                          disabled={!isOnline}
                          className="min-h-[40px] text-xs ml-auto"
                        >
                          {t.roles.activate}
                        </PrimaryButton>
                      )
                    )}
                  </>
                )}
              </div>
            </SurfaceCard>
          );
        })}
      </div>
    </div>
  );
}
