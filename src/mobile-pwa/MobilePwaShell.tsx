import React, { useState } from 'react';
import {
  Building2,
  Download,
  Home,
  LogOut,
  Map,
  Monitor,
  RefreshCw,
  UserCircle2,
  WifiOff,
} from 'lucide-react';
import {
  BrandMark,
  InlineAlert,
  MetadataLine,
  PrimaryButton,
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
import { usePWAInstall } from './usePwaStatus.ts';
import { SUPPORTED_LANGUAGES } from '../shared/i18n/translations.ts';

type MobileTab = 'home' | 'farms' | 'orgs' | 'account';

export function MobilePwaShell({
  onSwitchToWeb,
}: {
  onSwitchToWeb: () => void;
}) {
  const {
    session,
    sessionSource,
    cachedAt,
    isOnline,
    queuedMutations,
    syncingQueue,
    syncOfflineQueue,
    activeRole,
    setActiveRole,
    farms,
    farmConflicts,
    language,
    setLocalLanguage,
    signOut,
    t,
  } = useFieldFussion();

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [tab, setTab] = useState<MobileTab>(() =>
    session && !session.user.onboardingCompleted ? 'account' : 'home'
  );
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [accountSection, setAccountSection] = useState<'profile' | 'roles' | 'ai' | 'audit'>('profile');

  if (!session) return null;

  const activeRoles = session.roles.filter((r) => r.status === 'active');
  const totalMappedAcres = farms.reduce((sum, f) => sum + (f.areaAcres ?? 0), 0);

  return (
    <div className="min-h-screen bg-canvas flex flex-col pb-20">
      <header className="sticky top-0 z-30 h-14 bg-forest-900 text-white px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark size={26} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{t.brand.name}</p>
            <p className="text-[11px] text-white/75 leading-tight truncate">
              {t.surface.mobilePwa}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={install}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-lg bg-leaf-600 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Install
            </button>
          )}
          {!isInstalled && !isInstallable && isIOS && (
            <button
              type="button"
              onClick={() => setShowIosGuide(true)}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-lg bg-white/15 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              Install iOS
            </button>
          )}
          <button
            type="button"
            onClick={onSwitchToWeb}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-lg border border-white/25 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
          >
            <Monitor className="w-3.5 h-3.5" />
            Web
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
          <span>{t.surface.prototypeNotice}</span>
          <span>
            {session.user.district ?? 'Uganda'} · {session.user.preferredAreaUnit} · {session.user.currency}
          </span>
        </div>

        {!isOnline && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>{t.surface.offlineMode}</span>
            </div>
            <span className="font-mono tabular-nums">{queuedMutations.length} queued</span>
          </div>
        )}

        {isOnline && queuedMutations.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-950">
            <span>
              {queuedMutations.length} offline update(s) ready to sync.
            </span>
            <SecondaryButton
              onClick={syncOfflineQueue}
              loading={syncingQueue}
              className="min-h-[36px] px-3 py-1 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync Now
            </SecondaryButton>
          </div>
        )}

        {sessionSource === 'offline_cache' && cachedAt && (
          <p className="text-xs text-ink-muted">
            Offline cache timestamp: {new Date(cachedAt).toLocaleString()}
          </p>
        )}

        {tab === 'home' && (
          <div className="space-y-4">
            <SurfaceCard className="p-4 sm:p-5 space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-leaf-600">{t.phaseRoadmap.phase1Active}</p>
                <h1 className="text-xl font-bold text-ink">
                  {session.user.fullName || session.user.email}
                </h1>
                <MetadataLine
                  items={[
                    session.user.district ?? 'Uganda',
                    `${activeRoles.length} active roles`,
                    `${session.organisations.length} organisations`,
                  ]}
                />
              </div>

              {activeRoles.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {activeRoles.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setActiveRole(r.role)}
                      className={`min-h-[44px] px-3.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        activeRole === r.role
                          ? 'bg-forest-900 text-white border-forest-900'
                          : 'bg-white text-ink border-border-hairline'
                      }`}
                    >
                      {t.roles.names[r.role]}
                    </button>
                  ))}
                </div>
              )}
            </SurfaceCard>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SurfaceCard className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ink">
                    Farms &amp; PostGIS Boundaries
                  </h2>
                  <span className="font-mono text-xs font-semibold text-forest-900 tabular-nums">
                    {farms.length} farms · {totalMappedAcres.toFixed(1)} ac
                  </span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {t.phaseRoadmap.farmsPlaceholder}
                </p>
                {farmConflicts.length > 0 && (
                  <p className="text-xs font-medium text-amber-800">
                    {farmConflicts.length} offline sync conflict(s) awaiting your review.
                  </p>
                )}
                <PrimaryButton onClick={() => setTab('farms')} className="min-h-[44px] w-full">
                  Open Farms &amp; Map
                </PrimaryButton>
              </SurfaceCard>
              <SurfaceCard className="p-4 space-y-2">
                <h2 className="text-sm font-semibold text-ink">AI &amp; Field Operations</h2>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {t.phaseRoadmap.opsPlaceholder} {t.phaseRoadmap.aiNotice}
                </p>
              </SurfaceCard>
            </div>

            {!session.user.onboardingCompleted && (
              <InlineAlert
                variant="info"
                title={t.onboarding.title}
                message="Finish setting your district, language, and acres/hectares preference."
                onRetry={() => {
                  setAccountSection('profile');
                  setTab('account');
                }}
                retryLabel="Complete Onboarding"
              />
            )}
          </div>
        )}

        {tab === 'farms' && <FarmManagementView compact />}

        {tab === 'orgs' && <OrganisationsPanel />}

        {tab === 'account' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-1 bg-white rounded-lg border border-border-hairline">
                <button
                  type="button"
                  onClick={() => setAccountSection('profile')}
                  className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                    accountSection === 'profile'
                      ? 'bg-forest-900 text-white'
                      : 'text-ink-muted'
                  }`}
                >
                  Profile
                </button>
                <button
                  type="button"
                  onClick={() => setAccountSection('roles')}
                  className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                    accountSection === 'roles'
                      ? 'bg-forest-900 text-white'
                      : 'text-ink-muted'
                  }`}
                >
                  {t.nav.roles}
                </button>
                <button
                  type="button"
                  onClick={() => setAccountSection('ai')}
                  className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                    accountSection === 'ai'
                      ? 'bg-forest-900 text-white'
                      : 'text-ink-muted'
                  }`}
                >
                  AI
                </button>
                <button
                  type="button"
                  onClick={() => setAccountSection('audit')}
                  className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                    accountSection === 'audit'
                      ? 'bg-forest-900 text-white'
                      : 'text-ink-muted'
                  }`}
                >
                  {t.nav.audit}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Language"
                  value={language}
                  onChange={(e) => setLocalLanguage(e.target.value as typeof language)}
                  className="min-h-[40px] px-2.5 py-1.5 rounded-lg border border-border-hairline bg-white text-xs text-ink"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.nativeName}
                    </option>
                  ))}
                </select>
                <SecondaryButton onClick={signOut} className="min-h-[40px] text-xs">
                  <LogOut className="w-3.5 h-3.5" />
                  {t.surface.signOut}
                </SecondaryButton>
              </div>
            </div>

            {accountSection === 'profile' && <OnboardingProfileForm compact />}
            {accountSection === 'roles' && <RolesAccessPanel />}
            {accountSection === 'ai' && <AiGatewayPanel />}
            {accountSection === 'audit' && <AuditLogPanel />}
          </div>
        )}
      </main>

      <nav
        aria-label="Mobile Bottom Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-border-hairline grid grid-cols-4 items-center"
      >
        {(
          [
            { id: 'home', label: t.nav.mobileHome, icon: Home },
            { id: 'farms', label: t.nav.mobileFarms, icon: Map },
            { id: 'orgs', label: t.nav.organisations, icon: Building2 },
            { id: 'account', label: t.nav.mobileAccount, icon: UserCircle2 },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                active ? 'text-forest-900' : 'text-ink-muted'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="truncate max-w-[80px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {showIosGuide && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <SurfaceCard className="w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-ink">Install on iPhone / iPad</h3>
            <p className="text-sm text-ink-muted leading-relaxed">
              1. Tap the Share button in Safari.
              <br />
              2. Select <strong>Add to Home Screen</strong> to install the FIELD FUSSION Mobile Field PWA.
            </p>
            <PrimaryButton onClick={() => setShowIosGuide(false)} className="w-full min-h-[44px]">
              Close
            </PrimaryButton>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}
