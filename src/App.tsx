import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  FieldFussionProvider,
  useFieldFussion,
} from './context/FieldFussionContext.tsx';
import { AuthGateView } from './components/AuthGateView.tsx';
import { WebDashboardShell } from './web/WebDashboardShell.tsx';
import { MobilePwaShell } from './mobile-pwa/MobilePwaShell.tsx';
import { InlineAlert, SecondaryButton } from './design-system/components.tsx';

function getInitialSurface(): 'web' | 'mobile' {
  if (typeof window !== 'undefined') {
    if (window.location.pathname.startsWith('/mobile')) {
      return 'mobile';
    }
    if (window.innerWidth < 768) {
      return 'mobile';
    }
  }
  return 'web';
}

function AppRouter() {
  const {
    firebaseUser,
    authReady,
    session,
    loadingSession,
    sessionError,
    refreshSession,
    signOut,
    t,
  } = useFieldFussion();
  const [surface, setSurface] = useState<'web' | 'mobile'>(getInitialSurface);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const targetPath = surface === 'mobile' ? '/mobile' : '/web';
    if (!window.location.pathname.startsWith(targetPath)) {
      window.history.replaceState(null, '', targetPath);
    }
  }, [surface]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <Loader2 className="w-5 h-5 animate-spin text-forest-900" />
          <span>{t.surface.authenticating}</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <AuthGateView
        preferredSurface={surface}
        onSelectSurface={setSurface}
      />
    );
  }

  if (loadingSession && !session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <Loader2 className="w-5 h-5 animate-spin text-forest-900" />
          <span>{t.common.loading}</span>
        </div>
      </div>
    );
  }

  if (sessionError && !session) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4">
          <InlineAlert
            variant="error"
            title="Unable to load account session"
            message={sessionError}
            onRetry={refreshSession}
            retryLabel={t.common.retry}
          />
          <SecondaryButton onClick={signOut} className="w-full">
            {t.surface.signOut}
          </SecondaryButton>
        </div>
      </div>
    );
  }

  return surface === 'mobile' ? (
    <MobilePwaShell onSwitchToWeb={() => setSurface('web')} />
  ) : (
    <WebDashboardShell onSwitchToMobile={() => setSurface('mobile')} />
  );
}

export default function App() {
  return (
    <FieldFussionProvider>
      <AppRouter />
    </FieldFussionProvider>
  );
}
