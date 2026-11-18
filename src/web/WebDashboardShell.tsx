import React, { useState } from 'react';
import {
  Bot,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  MapPin,
  Shield,
  Smartphone,
  UserCog,
} from 'lucide-react';
import {
  BrandMark,
  InlineAlert,
  MetadataLine,
  SecondaryButton,
  SurfaceCard,
} from '../design-system/components.tsx';
import { useFieldFussion } from '../context/FieldFussionContext.tsx';
import { OnboardingProfileForm } from '../components/workflows/OnboardingProfileForm.tsx';
import { RolesAccessPanel } from '../components/workflows/RolesAccessPanel.tsx';
import { OrganisationsPanel } from '../components/workflows/OrganisationsPanel.tsx';
import { AuditLogPanel } from '../components/workflows/AuditLogPanel.tsx';
import { AiGatewayPanel } from '../components/workflows/AiGatewayPanel.tsx';
import { FarmManagementView } from '../components/farms/FarmManagementView.tsx';
import { SUPPORTED_LANGUAGES } from '../shared/i18n/translations.ts';

type WebTab = 'overview' | 'farms' | 'onboarding' | 'roles' | 'organisations' | 'ai' | 'audit';

export function WebDashboardShell({
  onSwitchToMobile,
}: {
  onSwitchToMobile: () => void;
}) {
  const {
    session,
    sessionSource,
    cachedAt,
    isOnline,
    activeRole,
    setActiveRole,
    activeOrganisation,
    setActiveOrganisationId,
    language,
    setLocalLanguage,
    aiStatus,
    farms,
    farmConflicts,
    signOut,
    t,
  } = useFieldFussion();

  const [tab, setTab] = useState<WebTab>(() =>
    session && !session.user.onboardingCompleted ? 'onboarding' : 'overview'
  );

  if (!session) return null;

  const activeRoles = session.roles.filter((r) => r.status === 'active');
  const totalMappedAcres = farms.reduce((sum, f) => sum + (f.areaAcres ?? 0), 0);

  const navItems: { id: WebTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: t.nav.overview, icon: <LayoutDashboard className="w-4 h-4 shrink-0" /> },
    { id: 'farms', label: t.nav.farms, icon: <MapPin className="w-4 h-4 shrink-0" /> },
    { id: 'onboarding', label: t.nav.onboarding, icon: <UserCog className="w-4 h-4 shrink-0" /> },
    { id: 'roles', label: t.nav.roles, icon: <Shield className="w-4 h-4 shrink-0" /> },
    { id: 'organisations', label: t.nav.organisations, icon: <Building2 className="w-4 h-4 shrink-0" /> },
    { id: 'ai', label: 'AI Gateway', icon: <Bot className="w-4 h-4 shrink-0" /> },
    { id: 'audit', label: t.nav.audit, icon: <ClipboardCheck className="w-4 h-4 shrink-0" /> },
  ];

  const roleWorkspaceSummary: Record<string, { title: string; modules: string[] }> = {
    farmer: {
      title: 'Farmer & Landowner Workspace',
      modules: [
        'Phase 2 Active: Multi-farm registry, remote Kampala-to-Lira search, PostGIS boundaries & revocable manager grants',
        'Phase 3: Crop cycles, planting logs, expenses & UGX financial summaries',
      ],
    },
    coop_manager: {
      title: 'Cooperative & Organisation Workspace',
      modules: [
        'Phase 2 Active: Organisation farms & member-delegated farms with revocable permissions',
        'Phase 4: Permitted member farm portfolio & non-destructive harvest aggregation',
      ],
    },
    buyer: {
      title: 'Produce Buyer Workspace',
      modules: [
        'Phase 4: Verified produce listings, procurement requests & order tracking',
        'Phase 5: Server-verified payment intents & fee transparency',
      ],
    },
    supplier: {
      title: 'Agricultural Supplier Workspace',
      modules: [
        'Phase 4: Certified input catalogue, quotations & order fulfillment',
        'Phase 5: Settlement reconciliation & transaction records',
      ],
    },
    logistics: {
      title: 'Logistics Provider Workspace',
      modules: [
        'Phase 4: Transport requests, collection dispatch & delivery status events',
        'Phase 5: Logistics service fee accounting',
      ],
    },
    expert: {
      title: 'Agricultural Expert Workspace',
      modules: [
        'Phase 6: Knowledge article review, regional validation & farmer consultations',
      ],
    },
    admin: {
      title: 'Platform Administrator Governance',
      modules: [
        'Phase 1 Active: Full-scope append-only audit trail & privileged role controls',
        'Phase 4–7: Organisation verification, subscription entitlements & knowledge publication',
      ],
    },
  };

  const currentRoleInfo = activeRole
    ? roleWorkspaceSummary[activeRole]
    : {
        title: 'Personal Account Ready',
        modules: [
          'Activate one or more agricultural roles under Roles & Access to tailor your workspace.',
        ],
      };

  return (
    <div className="min-h-screen bg-canvas flex flex-col lg:flex-row">
      <aside className="w-full lg:w-[260px] shrink-0 bg-forest-900 text-white flex flex-col justify-between">
        <div className="p-5 space-y-6">
          <div className="flex items-center gap-3">
            <BrandMark size={30} />
            <span className="font-semibold text-base tracking-tight whitespace-nowrap shrink-0">
              {t.brand.name}
            </span>
          </div>

          <nav aria-label="Web Dashboard Navigation" className="space-y-1">
            {navItems.map((item) => {
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-3 min-h-[42px] px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    selected
                      ? 'bg-leaf-600 text-white'
                      : 'text-white/80 hover:bg-forest-800 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-5 border-t border-white/15 space-y-3">
          <div className="space-y-0.5 text-xs text-white/75">
            <p className="font-medium text-white truncate">
              {session.user.fullName || session.user.email}
            </p>
            <p className="truncate">{session.user.email}</p>
            <p className="font-mono text-[11px] text-white/60">
              {session.user.district ?? 'Uganda'} · {session.user.currency}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onSwitchToMobile}
              className="w-full flex items-center justify-center gap-2 min-h-[40px] px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors whitespace-nowrap cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5 shrink-0" />
              {t.surface.mobilePwa}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center justify-center gap-2 min-h-[40px] px-3 py-2 rounded-lg border border-white/20 hover:bg-white/10 text-xs font-medium text-white transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              {t.surface.signOut}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-surface border-b border-border-hairline px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-ink truncate">
              {t.surface.webDashboard}
            </span>
            <span className="text-border-hairline hidden sm:inline">/</span>
            <span className="text-sm text-ink-muted truncate hidden sm:inline">
              {navItems.find((n) => n.id === tab)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeRoles.length > 0 && (
              <select
                aria-label="Active workspace role"
                value={activeRole ?? ''}
                onChange={(e) => setActiveRole((e.target.value || null) as typeof activeRole)}
                className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-border-hairline bg-white text-xs text-ink"
              >
                {activeRoles.map((r) => (
                  <option key={r.id} value={r.role}>
                    {t.roles.names[r.role]}
                  </option>
                ))}
              </select>
            )}

            {session.organisations.length > 0 && (
              <select
                aria-label="Active organisation"
                value={activeOrganisation?.id ?? ''}
                onChange={(e) => setActiveOrganisationId(e.target.value || null)}
                className="hidden md:block min-h-[38px] max-w-[200px] px-2.5 py-1.5 rounded-lg border border-border-hairline bg-white text-xs text-ink truncate"
              >
                {session.organisations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            )}

            <select
              aria-label="Interface language"
              value={language}
              onChange={(e) => setLocalLanguage(e.target.value as typeof language)}
              className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-border-hairline bg-white text-xs text-ink"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </select>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-6xl w-full mx-auto space-y-6">
          {!isOnline && (
            <InlineAlert variant="info" message={t.surface.offlineMode} />
          )}
          {sessionSource === 'offline_cache' && cachedAt && (
            <InlineAlert
              variant="info"
              message={`Showing cached profile from ${new Date(cachedAt).toLocaleString()}.`}
            />
          )}
          {!session.user.onboardingCompleted && tab !== 'onboarding' && (
            <InlineAlert
              variant="info"
              title={t.onboarding.title}
              message="Complete your regional Uganda profile and preferred area unit before starting field workflows."
              onRetry={() => setTab('onboarding')}
              retryLabel="Open Onboarding"
            />
          )}

          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <SurfaceCard className="p-4 space-y-1">
                  <p className="text-xs text-ink-muted">Active Account Roles</p>
                  <p className="text-2xl font-bold text-forest-900 font-mono tabular-nums">
                    {activeRoles.length}
                  </p>
                  <MetadataLine
                    items={
                      activeRoles.length > 0
                        ? activeRoles.map((r) => t.roles.names[r.role])
                        : ['None activated yet']
                    }
                  />
                </SurfaceCard>

                <SurfaceCard className="p-4 space-y-1">
                  <p className="text-xs text-ink-muted">Organisations</p>
                  <p className="text-2xl font-bold text-forest-900 font-mono tabular-nums">
                    {session.organisations.length}
                  </p>
                  <MetadataLine
                    items={[
                      `${session.pendingInvitations.length} pending invitations`,
                    ]}
                  />
                </SurfaceCard>

                <SurfaceCard className="p-4 space-y-1">
                  <p className="text-xs text-ink-muted">Registered &amp; Delegated Farms</p>
                  <p className="text-2xl font-bold text-forest-900 font-mono tabular-nums">
                    {farms.length}
                  </p>
                  <MetadataLine
                    items={[
                      `${totalMappedAcres.toFixed(1)} ac mapped`,
                      farmConflicts.length > 0 ? `${farmConflicts.length} sync conflict(s)` : 'PostGIS verified',
                    ]}
                  />
                </SurfaceCard>

                <SurfaceCard className="p-4 space-y-1">
                  <p className="text-xs text-ink-muted">AI Gateway (Free Mode)</p>
                  <p className="text-lg font-semibold text-ink font-mono">
                    {aiStatus ? aiStatus.activeProvider : 'mock'}
                  </p>
                  <MetadataLine
                    items={[
                      aiStatus ? aiStatus.activeModels.conversational : 'field-fussion-mock-v1',
                      !aiStatus || aiStatus.activeProvider === 'mock'
                        ? 'Simulated output'
                        : 'Live provider',
                      'Human approval required',
                    ]}
                  />
                </SurfaceCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <SurfaceCard className="lg:col-span-7 p-6 space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-leaf-600">
                      {t.phaseRoadmap.phase1Active}
                    </p>
                    <h2 className="text-xl font-semibold text-ink">
                      {currentRoleInfo.title}
                    </h2>
                  </div>

                  <ul className="space-y-2.5 text-sm text-ink-muted">
                    {currentRoleInfo.modules.map((line) => (
                      <li
                        key={line}
                        className="p-3 rounded-lg bg-canvas border border-border-hairline text-ink"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <SecondaryButton onClick={() => setTab('farms')}>
                      Open Farms &amp; Boundaries
                    </SecondaryButton>
                    <SecondaryButton onClick={() => setTab('roles')}>
                      Manage Account Roles
                    </SecondaryButton>
                    <SecondaryButton onClick={() => setTab('organisations')}>
                      Manage Organisations
                    </SecondaryButton>
                  </div>
                </SurfaceCard>

                <SurfaceCard className="lg:col-span-5 p-6 space-y-4">
                  <h3 className="text-base font-semibold text-ink">
                    Architecture &amp; Phase Boundaries
                  </h3>
                  <div className="space-y-3 text-xs text-ink-muted leading-relaxed">
                    <p>
                      <strong className="text-ink">Identity vs. Authorisation:</strong> Firebase Authentication verifies your Google identity; Cloud SQL PostgreSQL stores and enforces all FIELD FUSSION roles, memberships, farm permissions, and audit records.
                    </p>
                    <p>
                      <strong className="text-ink">Spatial Engine:</strong> PostGIS stores GeoJSON boundaries and calculates authoritative land area in acres and hectares.
                    </p>
                    <p>
                      <strong className="text-ink">Upcoming Modules:</strong> {t.phaseRoadmap.opsPlaceholder}
                    </p>
                  </div>
                </SurfaceCard>
              </div>
            </div>
          )}

          {tab === 'farms' && <FarmManagementView />}

          {tab === 'onboarding' && (
            <OnboardingProfileForm onCompleted={() => setTab('overview')} />
          )}

          {tab === 'roles' && <RolesAccessPanel />}

          {tab === 'organisations' && <OrganisationsPanel />}

          {tab === 'ai' && <AiGatewayPanel />}

          {tab === 'audit' && <AuditLogPanel />}
        </main>
      </div>
    </div>
  );
}
