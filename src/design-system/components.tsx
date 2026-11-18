import React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="512" height="512" rx="112" fill="#163D31" />
      <path
        d="M128 340C128 214 224 136 376 136C376 288 298 376 172 376H128V340Z"
        fill="#2D8A51"
      />
      <path
        d="M172 332C216 270 278 218 352 178"
        stroke="#F5F7F1"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <circle cx="172" cy="332" r="18" fill="#F5F7F1" />
    </svg>
  );
}

export function SurfaceCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-surface border border-border-hairline rounded-xl ${className}`}
    >
      {children}
    </section>
  );
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled = false,
  loading = false,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-lg bg-forest-900 text-white text-sm font-medium hover:bg-forest-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer ${className}`}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  type = 'button',
  disabled = false,
  loading = false,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 rounded-lg bg-white border border-border-hairline text-ink text-sm font-medium hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer ${className}`}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {children}
    </button>
  );
}

export function InlineAlert({
  variant,
  title,
  message,
  recoveryAction,
  onRetry,
  retryLabel = 'Try Again',
}: {
  variant: 'error' | 'success' | 'info';
  title?: string;
  message: string;
  recoveryAction?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const styles =
    variant === 'error'
      ? 'bg-red-50 border-red-200 text-red-900'
      : variant === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
        : 'bg-white border-border-hairline text-ink';

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${styles}`}
    >
      <div className="flex items-start gap-3">
        {variant === 'error' ? (
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-leaf-600 shrink-0 mt-0.5" />
        )}
        <div className="space-y-1">
          {title && <p className="font-semibold">{title}</p>}
          <p className="leading-relaxed">{message}</p>
          {recoveryAction && (
            <p className="text-xs opacity-85">{recoveryAction}</p>
          )}
        </div>
      </div>
      {onRetry && (
        <SecondaryButton onClick={onRetry} className="text-xs min-h-[34px] px-3 py-1.5">
          {retryLabel}
        </SecondaryButton>
      )}
    </div>
  );
}

export function MetadataLine({ items }: { items: (string | null | undefined)[] }) {
  const filtered = items.filter((item): item is string => Boolean(item && item.trim()));
  if (filtered.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
      {filtered.map((item, idx) => (
        <React.Fragment key={`${item}-${idx}`}>
          {idx > 0 && <span aria-hidden="true">·</span>}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
