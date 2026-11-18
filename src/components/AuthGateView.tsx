import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Globe2,
  Mail,
  Monitor,
  ShieldCheck,
  Smartphone,
  Sprout,
  X,
} from 'lucide-react';
import {
  BrandMark,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SurfaceCard,
} from '../design-system/components.tsx';
import { useFieldFussion } from '../context/FieldFussionContext.tsx';
import { SUPPORTED_LANGUAGES } from '../shared/i18n/translations.ts';
import {
  buildFormattedPhone,
  isValidEmailFormat,
  isValidOptionalPhone,
  mapFirebaseAuthError,
  PHONE_COUNTRY_OPTIONS,
  validatePasswordRules,
  type MappedAuthError,
} from '../lib/auth-helpers.ts';

type AuthViewMode = 'login' | 'register' | 'forgot_password';

type AuthUiState =
  | 'idle'
  | 'validating'
  | 'signing_in'
  | 'registering'
  | 'sending_reset'
  | 'auth_success'
  | 'reset_sent'
  | 'error';

const HERO_FARMLAND_IMAGE_SRC = '/src/assets/images/uganda_farmland_hero_1794943653425.jpg';

function GoogleGMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function AuthGateView({
  preferredSurface,
  onSelectSurface,
}: {
  preferredSurface: 'web' | 'mobile';
  onSelectSurface: (surface: 'web' | 'mobile') => void;
}) {
  const {
    signInWithGoogle,
    signInWithEmailPassword,
    registerWithEmailPassword,
    requestPasswordReset,
    language,
    setLocalLanguage,
    t,
  } = useFieldFussion();

  const [viewMode, setViewMode] = useState<AuthViewMode>('login');
  const [uiState, setUiState] = useState<AuthUiState>('idle');
  const [authError, setAuthError] = useState<MappedAuthError | null>(null);
  const [resetEmailConfirmed, setResetEmailConfirmed] = useState<string | null>(null);
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [legalDocOpen, setLegalDocOpen] = useState<'terms' | 'privacy' | null>(null);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register fields
  const [fullName, setFullName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [phoneDialCode, setPhoneDialCode] = useState('+256');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Forgot password field
  const [resetEmail, setResetEmail] = useState('');

  const isBusy =
    uiState === 'validating' ||
    uiState === 'signing_in' ||
    uiState === 'registering' ||
    uiState === 'sending_reset' ||
    uiState === 'auth_success';

  const passwordRules = useMemo(
    () => validatePasswordRules(registerPassword),
    [registerPassword]
  );

  const passwordsMatch =
    confirmPassword.length > 0 && registerPassword === confirmPassword;

  const switchView = (next: AuthViewMode) => {
    if (isBusy) return;
    setAuthError(null);
    setResetEmailConfirmed(null);
    setUiState('idle');
    if (next === 'forgot_password' && !resetEmail && loginEmail.trim()) {
      setResetEmail(loginEmail.trim());
    }
    if (next === 'login' && resetEmail.trim() && !loginEmail) {
      setLoginEmail(resetEmail.trim());
    }
    setViewMode(next);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;

    setUiState('validating');
    setAuthError(null);

    const emailTrimmed = loginEmail.trim();
    if (!isValidEmailFormat(emailTrimmed)) {
      setUiState('error');
      setAuthError({
        kind: 'invalid_email',
        message: 'Please enter a valid email address.',
        recoveryAction: 'For example: farmer@example.com',
      });
      return;
    }

    if (!loginPassword) {
      setUiState('error');
      setAuthError({
        kind: 'validation_error',
        message: 'Enter your password to sign in.',
      });
      return;
    }

    setUiState('signing_in');
    try {
      await signInWithEmailPassword(emailTrimmed, loginPassword);
      setUiState('auth_success');
    } catch (err) {
      setUiState('error');
      setAuthError(mapFirebaseAuthError(err));
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;

    setUiState('validating');
    setAuthError(null);

    const nameTrimmed = fullName.trim();
    const emailTrimmed = registerEmail.trim();
    const formattedPhone = buildFormattedPhone(phoneDialCode, phoneLocal);

    if (nameTrimmed.length < 2) {
      setUiState('error');
      setAuthError({
        kind: 'validation_error',
        message: 'Enter your full name (at least 2 characters).',
      });
      return;
    }

    if (!isValidEmailFormat(emailTrimmed)) {
      setUiState('error');
      setAuthError({
        kind: 'invalid_email',
        message: 'Please enter a valid email address.',
      });
      return;
    }

    if (!passwordRules.valid) {
      setUiState('error');
      setAuthError({
        kind: 'weak_password',
        message: 'Choose a stronger password before continuing.',
        recoveryAction: 'Use at least 8 characters including both letters and numbers.',
      });
      return;
    }

    if (registerPassword !== confirmPassword) {
      setUiState('error');
      setAuthError({
        kind: 'validation_error',
        message: 'Passwords do not match. Re-enter both password fields carefully.',
      });
      return;
    }

    if (!isValidOptionalPhone(formattedPhone)) {
      setUiState('error');
      setAuthError({
        kind: 'validation_error',
        message: 'Enter a valid phone number (e.g. +256 772 000000) or leave it blank.',
      });
      return;
    }

    if (!termsAccepted) {
      setUiState('error');
      setAuthError({
        kind: 'validation_error',
        message: 'Please accept the Terms of Service and Privacy Policy to create an account.',
      });
      return;
    }

    setUiState('registering');
    try {
      await registerWithEmailPassword({
        fullName: nameTrimmed,
        email: emailTrimmed,
        password: registerPassword,
        phone: formattedPhone,
        termsAccepted: true,
      });
      setUiState('auth_success');
    } catch (err) {
      setUiState('error');
      setAuthError(mapFirebaseAuthError(err));
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;

    setUiState('validating');
    setAuthError(null);
    setResetEmailConfirmed(null);

    const emailTrimmed = resetEmail.trim();
    if (!isValidEmailFormat(emailTrimmed)) {
      setUiState('error');
      setAuthError({
        kind: 'invalid_email',
        message: 'Enter a valid email address to receive your password reset link.',
      });
      return;
    }

    setUiState('sending_reset');
    try {
      await requestPasswordReset(emailTrimmed);
      setUiState('reset_sent');
      setResetEmailConfirmed(emailTrimmed);
    } catch (err) {
      setUiState('error');
      setAuthError(mapFirebaseAuthError(err));
    }
  };

  const handleGoogleAuth = async () => {
    if (isBusy) return;
    setAuthError(null);
    setUiState('signing_in');
    try {
      await signInWithGoogle();
      setUiState('auth_success');
    } catch (err) {
      setUiState('error');
      setAuthError(mapFirebaseAuthError(err));
    }
  };

  const statusText =
    uiState === 'validating'
      ? 'Checking details...'
      : uiState === 'signing_in'
        ? 'Signing in...'
        : uiState === 'registering'
          ? 'Creating account...'
          : uiState === 'sending_reset'
            ? 'Sending reset link...'
            : uiState === 'auth_success'
              ? 'Authentication successful. Opening workspace...'
              : null;

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-between overflow-x-hidden">
      <header className="border-b border-border-hairline bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandMark size={30} />
            <span className="font-semibold text-base tracking-tight text-forest-900 whitespace-nowrap shrink-0">
              {t.brand.name}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Globe2 className="w-4 h-4 text-ink-muted hidden sm:block" />
            <div className="flex items-center gap-1 p-1 bg-canvas rounded-lg border border-border-hairline">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLocalLanguage(lang.code)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                    language === lang.code
                      ? 'bg-forest-900 text-white'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {lang.nativeName}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Compact mobile brand intro (keeps auth card comfortably reachable on 390px screens) */}
          <div className="lg:hidden space-y-1.5 px-1">
            <p className="text-xs font-semibold text-leaf-600">{t.brand.tagline}</p>
            <p className="text-sm text-ink-muted leading-relaxed">
              Manage farms, map land boundaries, and coordinate cooperatives across Uganda and Africa from one account.
            </p>
          </div>

          {/* Desktop two-column left brand showcase */}
          <div className="hidden lg:flex lg:col-span-6 flex-col justify-between gap-6">
            <div className="space-y-5">
              <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden border border-border-hairline bg-forest-900 shadow-sm">
                {!heroImageFailed ? (
                  <img
                    src={HERO_FARMLAND_IMAGE_SRC}
                    alt="Lush terraced green agricultural farmland in Uganda at sunrise"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImageFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-forest-900 via-forest-800 to-leaf-600 flex flex-col items-center justify-center text-white p-6 text-center gap-2">
                    <Sprout className="w-10 h-10 text-white/90" />
                    <p className="text-base font-semibold">FIELD FUSSION Farmland Network</p>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent flex flex-col justify-end p-5 text-white">
                  <p className="text-xs font-medium text-white/85">{t.brand.tagline}</p>
                  <p className="text-base font-semibold leading-snug">
                    Digital land records, cooperative management, and field intelligence for modern growers.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <h1 className="text-3xl font-bold text-forest-900 leading-tight">
                  One connected workspace for every acre you manage.
                </h1>
                <p className="text-sm text-ink-muted leading-relaxed">
                  Register individual, cooperative, or delegated farms, verify parcel boundaries in acres and hectares, and switch seamlessly between Web Dashboard and Mobile Field PWA.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface border border-border-hairline rounded-xl p-4 space-y-1.5">
                <p className="text-sm font-semibold text-ink">One Personal Account</p>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Sign in with Email or Google into the same verified profile, farms, and organisation permissions.
                </p>
              </div>
              <div className="bg-surface border border-border-hairline rounded-xl p-4 space-y-1.5">
                <p className="text-sm font-semibold text-ink">Uganda &amp; Africa Ready</p>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Built for UGX currency, acres and hectares, Africa/Kampala timezone, and English, Luganda, and Swahili.
                </p>
              </div>
            </div>
          </div>

          {/* Right column: Clean authentication card */}
          <div className="lg:col-span-6 flex items-center justify-center">
            <SurfaceCard className="w-full max-w-md p-6 sm:p-8 shadow-sm space-y-5">
              {/* Compact workspace mode selector */}
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-border-hairline">
                <span className="text-xs font-medium text-ink-muted">Workspace</span>
                <div className="inline-flex items-center gap-1 p-1 bg-canvas rounded-lg border border-border-hairline">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onSelectSurface('web')}
                    className={`inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                      preferredSurface === 'web'
                        ? 'bg-forest-900 text-white'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5 shrink-0" />
                    Web
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onSelectSurface('mobile')}
                    className={`inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                      preferredSurface === 'mobile'
                        ? 'bg-forest-900 text-white'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5 shrink-0" />
                    Mobile PWA
                  </button>
                </div>
              </div>

              {/* Status & Error Banners */}
              {uiState === 'auth_success' && statusText && (
                <InlineAlert variant="success" message={statusText} />
              )}

              {uiState === 'reset_sent' && resetEmailConfirmed && (
                <InlineAlert
                  variant="success"
                  title="Password reset email sent"
                  message={`Check ${resetEmailConfirmed} (and your spam folder) for a link to reset your FIELD FUSSION password.`}
                />
              )}

              {authError && (
                <InlineAlert
                  variant="error"
                  message={authError.message}
                  recoveryAction={authError.recoveryAction}
                />
              )}

              {/* LOGIN VIEW */}
              {viewMode === 'login' && (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <h2 className="text-2xl font-bold text-forest-900 leading-snug">
                      Welcome back
                    </h2>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      Sign in to manage your farms, monitor production and grow your agricultural business.
                    </p>
                  </div>

                  <form onSubmit={handleLoginSubmit} noValidate className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="ff-login-email" className="block text-xs font-semibold text-ink">
                        Email address
                      </label>
                      <input
                        id="ff-login-email"
                        type="email"
                        autoComplete="email"
                        required
                        disabled={isBusy}
                        value={loginEmail}
                        onChange={(e) => {
                          setLoginEmail(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="you@example.com"
                        className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="ff-login-password" className="block text-xs font-semibold text-ink">
                          Password
                        </label>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => switchView('forgot_password')}
                          className="text-xs font-medium text-leaf-600 hover:text-forest-900 hover:underline focus-visible:outline-2 focus-visible:outline-forest-900 cursor-pointer disabled:opacity-50"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          id="ff-login-password"
                          type={showLoginPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          required
                          disabled={isBusy}
                          value={loginPassword}
                          onChange={(e) => {
                            setLoginPassword(e.target.value);
                            if (authError) setAuthError(null);
                          }}
                          placeholder="Enter your password"
                          className="w-full min-h-[44px] pl-3.5 pr-12 py-2.5 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword((prev) => !prev)}
                          aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 min-w-[44px] flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer"
                        >
                          {showLoginPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <PrimaryButton
                      type="submit"
                      loading={uiState === 'signing_in' || uiState === 'validating' || uiState === 'auth_success'}
                      disabled={isBusy}
                      className="w-full min-h-[46px]"
                    >
                      {statusText && uiState !== 'reset_sent' ? statusText : 'Sign In'}
                    </PrimaryButton>
                  </form>

                  <div className="relative flex items-center py-1">
                    <div className="flex-grow border-t border-border-hairline" />
                    <span className="px-3 text-[11px] font-semibold tracking-wider text-ink-muted whitespace-nowrap">
                      OR CONTINUE WITH
                    </span>
                    <div className="flex-grow border-t border-border-hairline" />
                  </div>

                  <SecondaryButton
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={isBusy}
                    className="w-full min-h-[46px]"
                  >
                    <GoogleGMark />
                    <span>Continue with Google</span>
                  </SecondaryButton>

                  <div className="pt-1 text-center space-y-2">
                    <p className="text-sm text-ink-muted">
                      Don&apos;t have an account?{' '}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => switchView('register')}
                        className="font-semibold text-forest-900 hover:text-leaf-600 hover:underline cursor-pointer disabled:opacity-50"
                      >
                        Create account
                      </button>
                    </p>
                    <p className="text-xs text-ink-muted">
                      By continuing, you agree to our{' '}
                      <button
                        type="button"
                        onClick={() => setLegalDocOpen('terms')}
                        className="underline hover:text-ink cursor-pointer"
                      >
                        Terms of Service
                      </button>{' '}
                      and{' '}
                      <button
                        type="button"
                        onClick={() => setLegalDocOpen('privacy')}
                        className="underline hover:text-ink cursor-pointer"
                      >
                        Privacy Policy
                      </button>
                      .
                    </p>
                  </div>
                </div>
              )}

              {/* REGISTER VIEW */}
              {viewMode === 'register' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <h2 className="text-2xl font-bold text-forest-900 leading-snug">
                      Create your FIELD FUSSION account
                    </h2>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      One account to manage your agricultural activities and access the FIELD FUSSION ecosystem.
                    </p>
                  </div>

                  <form onSubmit={handleRegisterSubmit} noValidate className="space-y-3.5">
                    <div className="space-y-1">
                      <label htmlFor="ff-reg-name" className="block text-xs font-semibold text-ink">
                        Full name
                      </label>
                      <input
                        id="ff-reg-name"
                        type="text"
                        autoComplete="name"
                        required
                        disabled={isBusy}
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="e.g. Sarah Namukasa"
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="ff-reg-email" className="block text-xs font-semibold text-ink">
                        Email address
                      </label>
                      <input
                        id="ff-reg-email"
                        type="email"
                        autoComplete="email"
                        required
                        disabled={isBusy}
                        value={registerEmail}
                        onChange={(e) => {
                          setRegisterEmail(e.target.value);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="you@example.com"
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="ff-reg-phone" className="block text-xs font-semibold text-ink">
                        Phone number <span className="font-normal text-ink-muted">(Optional)</span>
                      </label>
                      <div className="flex gap-2">
                        <select
                          aria-label="Phone country code"
                          disabled={isBusy}
                          value={phoneDialCode}
                          onChange={(e) => setPhoneDialCode(e.target.value)}
                          className="min-h-[44px] px-2.5 py-2 rounded-lg border border-border-hairline bg-white text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900"
                        >
                          {PHONE_COUNTRY_OPTIONS.map((opt) => (
                            <option key={opt.code} value={opt.dialCode}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <input
                          id="ff-reg-phone"
                          type="tel"
                          autoComplete="tel-national"
                          disabled={isBusy}
                          value={phoneLocal}
                          onChange={(e) => setPhoneLocal(e.target.value)}
                          placeholder="772 000000"
                          className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="ff-reg-password" className="block text-xs font-semibold text-ink">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="ff-reg-password"
                          type={showRegPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          disabled={isBusy}
                          value={registerPassword}
                          onChange={(e) => {
                            setRegisterPassword(e.target.value);
                            if (authError) setAuthError(null);
                          }}
                          placeholder="At least 8 characters"
                          className="w-full min-h-[44px] pl-3.5 pr-12 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPassword((prev) => !prev)}
                          aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 min-w-[44px] flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer"
                        >
                          {showRegPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {registerPassword.length > 0 && (
                        <div className="pt-1 space-y-1 text-[11px] text-ink-muted">
                          <div className="flex items-center justify-between">
                            <span>Password strength</span>
                            <span
                              className={`font-semibold ${
                                passwordRules.strengthLabel === 'Strong'
                                  ? 'text-leaf-600'
                                  : passwordRules.strengthLabel === 'Fair'
                                    ? 'text-forest-900'
                                    : 'text-amber-700'
                              }`}
                            >
                              {passwordRules.strengthLabel}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span className={passwordRules.minLength ? 'text-leaf-600 font-medium' : ''}>
                              {passwordRules.minLength ? '✓' : '·'} 8+ chars
                            </span>
                            <span className={passwordRules.hasLetter ? 'text-leaf-600 font-medium' : ''}>
                              {passwordRules.hasLetter ? '✓' : '·'} Letter
                            </span>
                            <span className={passwordRules.hasNumber ? 'text-leaf-600 font-medium' : ''}>
                              {passwordRules.hasNumber ? '✓' : '·'} Number
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="ff-reg-confirm" className="block text-xs font-semibold text-ink">
                        Confirm password
                      </label>
                      <div className="relative">
                        <input
                          id="ff-reg-confirm"
                          type={showConfirmPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          disabled={isBusy}
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (authError) setAuthError(null);
                          }}
                          placeholder="Re-enter password"
                          className="w-full min-h-[44px] pl-3.5 pr-12 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((prev) => !prev)}
                          aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                          className="absolute inset-y-0 right-0 min-w-[44px] flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {confirmPassword.length > 0 && (
                        <p
                          className={`text-[11px] flex items-center gap-1 ${
                            passwordsMatch ? 'text-leaf-600 font-medium' : 'text-red-700'
                          }`}
                        >
                          {passwordsMatch ? (
                            <>
                              <Check className="w-3 h-3 shrink-0" />
                              Passwords match
                            </>
                          ) : (
                            'Passwords do not match yet'
                          )}
                        </p>
                      )}
                    </div>

                    <label className="flex items-start gap-2.5 pt-1 text-xs text-ink-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={termsAccepted}
                        disabled={isBusy}
                        onChange={(e) => {
                          setTermsAccepted(e.target.checked);
                          if (authError) setAuthError(null);
                        }}
                        className="mt-0.5 w-4 h-4 rounded border-border-hairline text-forest-900 focus:ring-forest-900"
                      />
                      <span className="leading-relaxed">
                        I accept the FIELD FUSSION{' '}
                        <button
                          type="button"
                          onClick={() => setLegalDocOpen('terms')}
                          className="font-medium text-forest-900 underline cursor-pointer"
                        >
                          Terms of Service
                        </button>{' '}
                        and{' '}
                        <button
                          type="button"
                          onClick={() => setLegalDocOpen('privacy')}
                          className="font-medium text-forest-900 underline cursor-pointer"
                        >
                          Privacy Policy
                        </button>
                        .
                      </span>
                    </label>

                    <PrimaryButton
                      type="submit"
                      loading={uiState === 'registering' || uiState === 'validating' || uiState === 'auth_success'}
                      disabled={isBusy}
                      className="w-full min-h-[46px]"
                    >
                      {statusText && uiState !== 'reset_sent' ? statusText : 'Create Account'}
                    </PrimaryButton>
                  </form>

                  <div className="relative flex items-center py-0.5">
                    <div className="flex-grow border-t border-border-hairline" />
                    <span className="px-3 text-[11px] font-semibold tracking-wider text-ink-muted whitespace-nowrap">
                      OR CONTINUE WITH
                    </span>
                    <div className="flex-grow border-t border-border-hairline" />
                  </div>

                  <SecondaryButton
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={isBusy}
                    className="w-full min-h-[46px]"
                  >
                    <GoogleGMark />
                    <span>Sign up with Google</span>
                  </SecondaryButton>

                  <p className="text-sm text-center text-ink-muted pt-1">
                    Already have an account?{' '}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => switchView('login')}
                      className="font-semibold text-forest-900 hover:text-leaf-600 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      Sign in
                    </button>
                  </p>
                </div>
              )}

              {/* FORGOT PASSWORD VIEW */}
              {viewMode === 'forgot_password' && (
                <div className="space-y-5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => switchView('login')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-forest-900 cursor-pointer disabled:opacity-50"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Sign In
                  </button>

                  <div className="space-y-1.5">
                    <h2 className="text-2xl font-bold text-forest-900 leading-snug">
                      Reset your password
                    </h2>
                    <p className="text-sm text-ink-muted leading-relaxed">
                      Enter the email address associated with your FIELD FUSSION account and we will send a password reset link.
                    </p>
                  </div>

                  <form onSubmit={handleResetSubmit} noValidate className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="ff-reset-email" className="block text-xs font-semibold text-ink">
                        Email address
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="ff-reset-email"
                          type="email"
                          autoComplete="email"
                          required
                          disabled={isBusy}
                          value={resetEmail}
                          onChange={(e) => {
                            setResetEmail(e.target.value);
                            if (authError) setAuthError(null);
                          }}
                          placeholder="you@example.com"
                          className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 rounded-lg border border-border-hairline bg-white text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-900/20 focus:border-forest-900 transition-colors duration-150 disabled:opacity-60"
                        />
                      </div>
                    </div>

                    <PrimaryButton
                      type="submit"
                      loading={uiState === 'sending_reset' || uiState === 'validating'}
                      disabled={isBusy}
                      className="w-full min-h-[46px]"
                    >
                      {uiState === 'sending_reset' ? 'Sending reset link...' : 'Send Reset Link'}
                    </PrimaryButton>
                  </form>
                </div>
              )}

              <div className="flex items-start gap-2 pt-3 border-t border-border-hairline text-xs text-ink-muted">
                <ShieldCheck className="w-4 h-4 text-leaf-600 shrink-0 mt-0.5" />
                <span>
                  Firebase verifies identity; FIELD FUSSION enforces account roles, permissions, and farm access on the server.
                </span>
              </div>
            </SurfaceCard>
          </div>
        </div>
      </main>

      <footer className="border-t border-border-hairline bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
          <span>FIELD FUSSION · {t.brand.tagline}</span>
          <span>{t.surface.prototypeNotice}</span>
        </div>
      </footer>

      {legalDocOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ff-legal-modal-title"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <SurfaceCard className="w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b border-border-hairline pb-3">
              <h3 id="ff-legal-modal-title" className="text-lg font-bold text-forest-900">
                {legalDocOpen === 'terms'
                  ? 'FIELD FUSSION — Terms of Service'
                  : 'FIELD FUSSION — Privacy Policy'}
              </h3>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setLegalDocOpen(null)}
                className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-canvas cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {legalDocOpen === 'terms' ? (
              <div className="space-y-3 text-xs text-ink-muted leading-relaxed">
                <p>
                  <strong className="text-ink">1. One Personal Account:</strong> Your FIELD FUSSION account represents one verified person across web and mobile workspaces. Standard roles (Farmer, Cooperative Manager, Buyer, Supplier, Logistics, Expert) are self-managed; platform administrator access is restricted and cannot be self-assigned.
                </p>
                <p>
                  <strong className="text-ink">2. Farm &amp; Organisation Authority:</strong> You are responsible for maintaining accurate farm location, boundary, and cooperative delegation records. Explicit permissions granted to managers or cooperatives remain revocable at any time.
                </p>
                <p>
                  <strong className="text-ink">3. Acceptable Use:</strong> Do not attempt to bypass server authorisation, falsify spatial boundaries, or abuse public mapping services.
                </p>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-ink-muted leading-relaxed">
                <p>
                  <strong className="text-ink">1. Identity &amp; Credentials:</strong> Authentication is handled by Firebase Authentication. FIELD FUSSION never stores plain-text passwords in application databases or audit logs.
                </p>
                <p>
                  <strong className="text-ink">2. Profile &amp; Farm Data Isolation:</strong> Your personal profile, optional phone number, farm boundaries, and organisation memberships are isolated strictly by verified user identity and membership permissions.
                </p>
                <p>
                  <strong className="text-ink">3. Voluntary Research Opt-In:</strong> Sharing anonymised agronomic insights for agricultural research is disabled by default and strictly opt-in during onboarding.
                </p>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <PrimaryButton onClick={() => setLegalDocOpen(null)} className="min-h-[40px]">
                Close
              </PrimaryButton>
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}
