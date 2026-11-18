import React, { useCallback, useEffect, useState } from 'react';
import {
  InlineAlert,
  MetadataLine,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
} from '../../design-system/components.tsx';
import { useFieldFussion } from '../../context/FieldFussionContext.tsx';
import {
  ORG_ROLES,
  ORGANISATION_TYPES,
  UGANDA_DISTRICTS,
  type OrgRole,
  type OrganisationInvitationRecord,
  type OrganisationMemberRecord,
  type OrganisationType,
} from '../../shared/types/domain.ts';
import {
  createOrganisationSchema,
  inviteMemberSchema,
} from '../../shared/validation/schemas.ts';

export function OrganisationsPanel() {
  const {
    session,
    activeOrganisation,
    setActiveOrganisationId,
    createOrganisation,
    loadOrganisationMembers,
    inviteMember,
    acceptInvitation,
    updateMember,
    isOnline,
    t,
  } = useFieldFussion();

  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<OrganisationType>('cooperative');
  const [district, setDistrict] = useState('Lira');
  const [regNumber, setRegNumber] = useState('');
  const [creating, setCreating] = useState(false);

  const [members, setMembers] = useState<OrganisationMemberRecord[]>([]);
  const [invitations, setInvitations] = useState<OrganisationInvitationRecord[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviting, setInviting] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchMembers = useCallback(async (orgId: string) => {
    setLoadingMembers(true);
    setError(null);
    try {
      const res = await loadOrganisationMembers(orgId);
      setMembers(res.data.members);
      setInvitations(res.data.invitations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load members.');
    } finally {
      setLoadingMembers(false);
    }
  }, [loadOrganisationMembers]);

  useEffect(() => {
    if (activeOrganisation && isOnline) {
      fetchMembers(activeOrganisation.id);
    } else {
      setMembers([]);
      setInvitations([]);
    }
  }, [activeOrganisation, fetchMembers, isOnline]);

  if (!session) return null;

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    const parsed = createOrganisationSchema.safeParse({
      name: orgName,
      orgType,
      district,
      country: 'UG',
      registrationNumber: regNumber,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid organisation details.');
      return;
    }

    setCreating(true);
    try {
      const created = await createOrganisation(parsed.data);
      setOrgName('');
      setRegNumber('');
      setFeedback(`Registered "${created.name}" with you as Owner.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create organisation.');
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganisation) return;
    setError(null);
    setFeedback(null);

    const parsed = inviteMemberSchema.safeParse({
      inviteeEmail: inviteEmail,
      intendedOrgRole: inviteRole,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid invitation email.');
      return;
    }

    setInviting(true);
    try {
      await inviteMember(activeOrganisation.id, parsed.data);
      setInviteEmail('');
      setFeedback(`Invitation created for ${parsed.data.inviteeEmail}.`);
      await fetchMembers(activeOrganisation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invitation.');
    } finally {
      setInviting(false);
    }
  };

  const handleAcceptInvite = async (invId: string) => {
    setError(null);
    setFeedback(null);
    setAcceptingId(invId);
    try {
      await acceptInvitation(invId);
      setFeedback('Invitation accepted. Organisation added to your account.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation.');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleRoleUpdate = async (memberId: string, newRole: OrgRole) => {
    if (!activeOrganisation) return;
    setError(null);
    setFeedback(null);
    setUpdatingMemberId(memberId);
    try {
      await updateMember(activeOrganisation.id, memberId, { orgRole: newRole });
      setFeedback('Member role updated and logged.');
      await fetchMembers(activeOrganisation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update member.');
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const canManageActiveOrg =
    activeOrganisation &&
    activeOrganisation.membershipStatus === 'active' &&
    (activeOrganisation.membershipRole === 'owner' ||
      activeOrganisation.membershipRole === 'manager');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink">{t.orgs.title}</h2>
        <p className="text-sm text-ink-muted">{t.orgs.subtitle}</p>
      </div>

      {error && <InlineAlert variant="error" message={error} />}
      {feedback && <InlineAlert variant="success" message={feedback} />}

      {session.pendingInvitations.length > 0 && (
        <SurfaceCard className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">
            {t.orgs.pendingInvitesTitle}
          </h3>
          <div className="divide-y divide-border-hairline">
            {session.pendingInvitations.map((inv) => (
              <div
                key={inv.id}
                className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-ink">
                    {inv.organisationName ?? 'Organisation Invitation'}
                  </p>
                  <MetadataLine
                    items={[
                      `Role: ${t.orgs.memberRoles[inv.intendedOrgRole]}`,
                      `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`,
                    ]}
                  />
                </div>
                <PrimaryButton
                  onClick={() => handleAcceptInvite(inv.id)}
                  loading={acceptingId === inv.id}
                  disabled={!isOnline}
                  className="min-h-[40px] text-xs"
                >
                  {t.orgs.acceptInvite}
                </PrimaryButton>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard className="lg:col-span-5 p-5 space-y-4">
          <h3 className="text-base font-semibold text-ink">{t.orgs.createTitle}</h3>
          <form onSubmit={handleCreateOrg} className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink">{t.orgs.nameLabel}</span>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                minLength={3}
                placeholder="e.g. Lira Maize Growers Co-op"
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink">{t.orgs.typeLabel}</span>
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value as OrganisationType)}
                className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
              >
                {ORGANISATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.orgs.types[type]}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-ink">{t.orgs.districtLabel}</span>
                <select
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
                >
                  {UGANDA_DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-ink">{t.orgs.regNumberLabel}</span>
                <input
                  type="text"
                  value={regNumber}
                  onChange={(e) => setRegNumber(e.target.value)}
                  placeholder="UG-COOP-001"
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink font-mono focus:outline-2 focus:outline-forest-900"
                />
              </label>
            </div>

            <PrimaryButton
              type="submit"
              loading={creating}
              disabled={!isOnline}
              className="w-full min-h-[44px]"
            >
              {t.orgs.createButton}
            </PrimaryButton>
          </form>
        </SurfaceCard>

        <div className="lg:col-span-7 space-y-4">
          {session.organisations.length === 0 ? (
            <SurfaceCard className="p-6 text-sm text-ink-muted">
              {t.orgs.emptyState}
            </SurfaceCard>
          ) : (
            <>
              <SurfaceCard className="p-4 space-y-3">
                <p className="text-xs font-medium text-ink-muted">Your Organisations</p>
                <div className="flex flex-wrap gap-2">
                  {session.organisations.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setActiveOrganisationId(org.id)}
                      className={`min-h-[40px] px-3.5 py-2 rounded-lg border text-left text-xs font-medium transition-colors cursor-pointer ${
                        activeOrganisation?.id === org.id
                          ? 'bg-forest-900 text-white border-forest-900'
                          : 'bg-white text-ink border-border-hairline hover:bg-canvas'
                      }`}
                    >
                      {org.name}
                    </button>
                  ))}
                </div>
              </SurfaceCard>

              {activeOrganisation && (
                <SurfaceCard className="p-5 space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-border-hairline">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-ink">
                        {activeOrganisation.name}
                      </h3>
                      <MetadataLine
                        items={[
                          t.orgs.types[activeOrganisation.orgType],
                          activeOrganisation.district,
                          `Your role: ${t.orgs.memberRoles[activeOrganisation.membershipRole]}`,
                          `Verification: ${activeOrganisation.verificationStatus}`,
                        ]}
                      />
                    </div>
                  </div>

                  {canManageActiveOrg && (
                    <form
                      onSubmit={handleInvite}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
                    >
                      <label className="sm:col-span-6 block space-y-1">
                        <span className="text-xs font-medium text-ink">
                          {t.orgs.inviteEmail}
                        </span>
                        <input
                          type="email"
                          required
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="agronomist@example.org"
                          className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
                        />
                      </label>
                      <label className="sm:col-span-3 block space-y-1">
                        <span className="text-xs font-medium text-ink">
                          {t.orgs.inviteRole}
                        </span>
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                          className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
                        >
                          {ORG_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t.orgs.memberRoles[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="sm:col-span-3">
                        <SecondaryButton
                          type="submit"
                          loading={inviting}
                          disabled={!isOnline}
                          className="w-full min-h-[42px] text-xs"
                        >
                          {t.orgs.inviteButton}
                        </SecondaryButton>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-ink-muted">
                      {t.orgs.membersTitle}
                    </h4>
                    {loadingMembers ? (
                      <p className="text-xs text-ink-muted py-3">{t.common.loading}</p>
                    ) : members.length === 0 ? (
                      <p className="text-xs text-ink-muted py-2">
                        No active members loaded.
                      </p>
                    ) : (
                      <div className="divide-y divide-border-hairline">
                        {members.map((member) => (
                          <div
                            key={member.id}
                            className="py-3 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium text-ink">
                                {member.fullName || member.email}
                              </p>
                              <MetadataLine
                                items={[
                                  member.email,
                                  t.orgs.memberRoles[member.orgRole],
                                  member.status,
                                ]}
                              />
                            </div>
                            {canManageActiveOrg && member.userId !== session.user.id && (
                              <select
                                aria-label={`Role for ${member.email}`}
                                value={member.orgRole}
                                disabled={updatingMemberId === member.id}
                                onChange={(e) =>
                                  handleRoleUpdate(member.id, e.target.value as OrgRole)
                                }
                                className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-border-hairline bg-white text-xs text-ink"
                              >
                                {ORG_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {t.orgs.memberRoles[r]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {invitations.length > 0 && (
                      <div className="pt-3 border-t border-border-hairline space-y-1.5">
                        <p className="text-xs font-semibold text-ink-muted">
                          Sent Invitations ({invitations.length})
                        </p>
                        {invitations.map((inv) => (
                          <div
                            key={inv.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted py-1"
                          >
                            <span className="text-ink">{inv.inviteeEmail}</span>
                            <MetadataLine
                              items={[
                                t.orgs.memberRoles[inv.intendedOrgRole],
                                inv.status,
                              ]}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </SurfaceCard>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
