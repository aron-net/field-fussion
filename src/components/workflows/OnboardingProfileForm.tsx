import React, { useEffect, useState } from 'react';
import {
  InlineAlert,
  PrimaryButton,
  SurfaceCard,
} from '../../design-system/components.tsx';
import { useFieldFussion } from '../../context/FieldFussionContext.tsx';
import {
  PLANNED_REGIONAL_LANGUAGES,
  SUPPORTED_LANGUAGES,
} from '../../shared/i18n/translations.ts';
import {
  UGANDA_DISTRICTS,
  type AreaUnit,
  type CurrencyCode,
  type SupportedLanguage,
} from '../../shared/types/domain.ts';
import { updateProfileSchema } from '../../shared/validation/schemas.ts';

export function OnboardingProfileForm({
  compact = false,
  onCompleted,
}: {
  compact?: boolean;
  onCompleted?: () => void;
}) {
  const { session, updateProfile, t } = useFieldFussion();
  const user = session?.user;

  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [district, setDistrict] = useState(user?.district ?? 'Kampala');
  const [preferredLanguage, setPreferredLanguage] = useState<SupportedLanguage>(
    user?.preferredLanguage ?? 'en'
  );
  const [preferredAreaUnit, setPreferredAreaUnit] = useState<AreaUnit>(
    user?.preferredAreaUnit ?? 'acres'
  );
  const [currency, setCurrency] = useState<CurrencyCode>(user?.currency ?? 'UGX');
  const [researchOptIn, setResearchOptIn] = useState(user?.researchOptIn ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setFullName(user.fullName);
    setPhone(user.phone ?? '');
    setDistrict(user.district ?? 'Kampala');
    setPreferredLanguage(user.preferredLanguage);
    setPreferredAreaUnit(user.preferredAreaUnit);
    setCurrency(user.currency);
    setResearchOptIn(user.researchOptIn);
  }, [user]);

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);

    const parsed = updateProfileSchema.safeParse({
      fullName,
      phone,
      district,
      country: 'UG',
      currency,
      preferredLanguage,
      preferredAreaUnit,
      timezone: 'Africa/Kampala',
      onboardingCompleted: true,
      researchOptIn,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your profile inputs.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await updateProfile(parsed.data);
      setStatusMessage(
        result.queuedOffline
          ? 'Saved locally in offline queue. Will sync to PostgreSQL when back online.'
          : t.onboarding.completedBanner
      );
      onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SurfaceCard className={compact ? 'p-4 sm:p-5' : 'p-6 sm:p-8'}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">{t.onboarding.title}</h2>
          <p className="text-sm text-ink-muted">{t.onboarding.subtitle}</p>
        </div>

        {error && <InlineAlert variant="error" message={error} />}
        {statusMessage && <InlineAlert variant="success" message={statusMessage} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink">{t.onboarding.fullName}</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
              placeholder="e.g. Sarah Namukasa"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink">{t.onboarding.phone}</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink font-mono tabular-nums focus:outline-2 focus:outline-forest-900"
              placeholder="+256 772 000000"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink">{t.onboarding.district}</span>
            <select
              value={UGANDA_DISTRICTS.includes(district) ? district : '__custom'}
              onChange={(e) => {
                if (e.target.value !== '__custom') setDistrict(e.target.value);
              }}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
            >
              {UGANDA_DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              {!UGANDA_DISTRICTS.includes(district) && (
                <option value="__custom">{district}</option>
              )}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink">{t.onboarding.language}</span>
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as SupportedLanguage)}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink focus:outline-2 focus:outline-forest-900"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.englishName})
                </option>
              ))}
            </select>
            <span className="block text-[11px] text-ink-muted">
              Planned regional languages: {PLANNED_REGIONAL_LANGUAGES.join(', ')}
            </span>
          </label>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink block">{t.onboarding.areaUnit}</span>
            <div className="grid grid-cols-2 gap-2">
              {(['acres', 'hectares'] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setPreferredAreaUnit(unit)}
                  className={`min-h-[44px] px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                    preferredAreaUnit === unit
                      ? 'bg-forest-900 text-white border-forest-900'
                      : 'bg-white text-ink border-border-hairline hover:bg-canvas'
                  }`}
                >
                  {unit === 'acres' ? t.common.acres : t.common.hectares}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink">
              {t.onboarding.currency} / {t.onboarding.timezone}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-white text-sm text-ink font-mono focus:outline-2 focus:outline-forest-900"
              >
                <option value="UGX">UGX</option>
                <option value="KES">KES</option>
                <option value="TZS">TZS</option>
                <option value="USD">USD</option>
              </select>
              <input
                type="text"
                value="Africa/Kampala"
                readOnly
                className="flex-1 min-h-[44px] px-3 py-2 rounded-lg border border-border-hairline bg-canvas text-xs text-ink-muted font-mono"
              />
            </div>
          </label>
        </div>

        <label className="flex items-start gap-3 p-3.5 rounded-lg bg-canvas border border-border-hairline cursor-pointer">
          <input
            type="checkbox"
            checked={researchOptIn}
            onChange={(e) => setResearchOptIn(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-forest-900 shrink-0"
          />
          <span className="text-xs text-ink leading-relaxed">
            {t.onboarding.researchOptIn}
          </span>
        </label>

        <div className="flex items-center justify-end gap-3 pt-1">
          <PrimaryButton
            type="submit"
            loading={submitting}
            className="w-full sm:w-auto min-h-[44px]"
          >
            {submitting ? t.onboarding.saving : t.onboarding.submit}
          </PrimaryButton>
        </div>
      </form>
    </SurfaceCard>
  );
}
