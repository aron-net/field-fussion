export type AuthUiErrorKind =
  | 'invalid_email'
  | 'incorrect_password'
  | 'account_not_found'
  | 'email_already_registered'
  | 'weak_password'
  | 'network_error'
  | 'google_cancelled'
  | 'account_conflict'
  | 'rate_limited'
  | 'provider_disabled'
  | 'validation_error'
  | 'unknown';

export interface MappedAuthError {
  kind: AuthUiErrorKind;
  message: string;
  recoveryAction?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailFormat(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export interface PasswordValidationResult {
  valid: boolean;
  minLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  strengthLabel: 'Weak' | 'Fair' | 'Strong';
}

export function validatePasswordRules(password: string): PasswordValidationResult {
  const minLength = password.length >= 8;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbolOrUpper = /[^A-Za-z0-9]/.test(password) || (/[A-Z]/.test(password) && /[a-z]/.test(password));
  const valid = minLength && hasLetter && hasNumber;

  let strengthLabel: 'Weak' | 'Fair' | 'Strong' = 'Weak';
  if (valid && password.length >= 10 && hasSymbolOrUpper) {
    strengthLabel = 'Strong';
  } else if (valid) {
    strengthLabel = 'Fair';
  }

  return {
    valid,
    minLength,
    hasLetter,
    hasNumber,
    strengthLabel,
  };
}

export const PHONE_COUNTRY_OPTIONS = [
  { code: 'UG', dialCode: '+256', label: 'Uganda (+256)' },
  { code: 'KE', dialCode: '+254', label: 'Kenya (+254)' },
  { code: 'TZ', dialCode: '+255', label: 'Tanzania (+255)' },
  { code: 'RW', dialCode: '+250', label: 'Rwanda (+250)' },
  { code: 'INTL', dialCode: '+', label: 'Other (+)' },
] as const;

export function buildFormattedPhone(dialCode: string, localInput: string): string {
  const trimmed = localInput.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return trimmed.replace(/\s+/g, ' ');
  }
  const normalizedLocal = trimmed.replace(/^0+/, '').replace(/\s+/g, '');
  if (!normalizedLocal) return '';
  if (dialCode === '+') {
    return `+${normalizedLocal}`;
  }
  return `${dialCode}${normalizedLocal}`;
}

export function isValidOptionalPhone(formattedPhone: string): boolean {
  if (!formattedPhone) return true;
  return /^\+?[0-9\s-]{7,20}$/.test(formattedPhone.trim());
}

/**
 * Maps Firebase Authentication error codes and API errors to safe, user-friendly UI messages.
 * Never surfaces tokens, credentials, stack traces, or raw internal exception strings.
 */
export function mapFirebaseAuthError(error: unknown): MappedAuthError {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';

  switch (code) {
    case 'auth/invalid-email':
      return {
        kind: 'invalid_email',
        message: 'Please enter a valid email address.',
        recoveryAction: 'Check for typos such as missing "@" or domain names.',
      };
    case 'auth/wrong-password':
      return {
        kind: 'incorrect_password',
        message: 'Incorrect password. Please try again.',
        recoveryAction: 'Use the Forgot password link if you need to set a new password.',
      };
    case 'auth/user-not-found':
      return {
        kind: 'account_not_found',
        message: 'No account was found with that email address.',
        recoveryAction: 'Check the email spelling or create a new FIELD FUSSION account.',
      };
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return {
        kind: 'incorrect_password',
        message: 'The email or password you entered is incorrect.',
        recoveryAction: 'Double-check your credentials, try Google Sign-In, or reset your password.',
      };
    case 'auth/email-already-in-use':
      return {
        kind: 'email_already_registered',
        message: 'This email address is already registered.',
        recoveryAction: 'Sign in with your existing account or reset your password.',
      };
    case 'auth/weak-password':
      return {
        kind: 'weak_password',
        message: 'Your password is too weak.',
        recoveryAction: 'Choose at least 8 characters combining letters and numbers.',
      };
    case 'auth/network-request-failed':
      return {
        kind: 'network_error',
        message: 'Network error while contacting authentication servers.',
        recoveryAction: 'Check your internet connection and try again.',
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        kind: 'google_cancelled',
        message: 'Google sign-in was cancelled before completion.',
        recoveryAction: 'Click Continue with Google whenever you are ready to try again.',
      };
    case 'auth/popup-blocked':
      return {
        kind: 'google_cancelled',
        message: 'The Google sign-in window was blocked by your browser.',
        recoveryAction: 'Allow popups for this site and try again.',
      };
    case 'auth/account-exists-with-different-credential':
    case 'ACCOUNT_LINK_VERIFICATION_REQUIRED':
      return {
        kind: 'account_conflict',
        message: 'An account with this email already exists using a different sign-in method.',
        recoveryAction: 'Sign in with your original method first so your account stays linked safely.',
      };
    case 'auth/too-many-requests':
      return {
        kind: 'rate_limited',
        message: 'Too many sign-in attempts detected. Access is temporarily paused for safety.',
        recoveryAction: 'Wait a few minutes or use Forgot password to reset your credentials.',
      };
    case 'auth/operation-not-allowed':
      return {
        kind: 'provider_disabled',
        message: 'Email and password sign-in is not currently enabled in Firebase Authentication.',
        recoveryAction: 'Use Continue with Google or enable Email/Password provider in Firebase Console.',
      };
    case 'auth/user-disabled':
      return {
        kind: 'account_conflict',
        message: 'This account has been disabled.',
        recoveryAction: 'Contact your organisation administrator or FIELD FUSSION support.',
      };
    default:
      if (
        error instanceof Error &&
        error.name === 'ApiClientError' &&
        error.message &&
        !/firebase|token|sql|stack|internal/i.test(error.message)
      ) {
        return {
          kind: 'unknown',
          message: error.message,
        };
      }
      return {
        kind: 'unknown',
        message: 'Authentication could not be completed. Please try again.',
        recoveryAction: 'If the issue continues, verify your connection and credentials.',
      };
  }
}
