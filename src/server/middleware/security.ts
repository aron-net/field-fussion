import type { NextFunction, Request, Response } from 'express';
import firebaseConfig from '../../../firebase-applet-config.json' with { type: 'json' };

function extractOrigin(rawUrl: string | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  try {
    const cleaned = rawUrl.replace(/\{[^}]+\}/g, '0');
    const url = new URL(cleaned);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function buildContentSecurityPolicy(isProduction: boolean): string {
  const tileImgOrigins = new Set<string>([
    'https://tile.openstreetmap.org',
    'https://*.tile.openstreetmap.org',
    'https://server.arcgisonline.com',
    'https://*.googleusercontent.com',
  ]);
  const streetTileOrigin = extractOrigin(process.env.MAP_STREET_TILE_URL);
  const satelliteTileOrigin = extractOrigin(process.env.MAP_SATELLITE_TILE_URL);
  if (streetTileOrigin) tileImgOrigins.add(streetTileOrigin);
  if (satelliteTileOrigin) tileImgOrigins.add(satelliteTileOrigin);

  const connectOrigins = new Set<string>([
    "'self'",
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.googleapis.com',
    'https://*.firebaseio.com',
    'https://apis.google.com',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://tile.openstreetmap.org',
    'https://*.tile.openstreetmap.org',
    'https://server.arcgisonline.com',
  ]);
  if (streetTileOrigin) connectOrigins.add(streetTileOrigin);
  if (satelliteTileOrigin) connectOrigins.add(satelliteTileOrigin);

  const frameOrigins = new Set<string>([
    "'self'",
    'https://accounts.google.com',
  ]);
  if (firebaseConfig?.authDomain) {
    frameOrigins.add(`https://${firebaseConfig.authDomain}`);
  }

  const scriptSrc = isProduction
    ? ["'self'", 'https://apis.google.com', 'https://www.gstatic.com']
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://apis.google.com', 'https://www.gstatic.com'];

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProduction ? ["frame-ancestors 'self'"] : []),
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${Array.from(tileImgOrigins).join(' ')}`,
    `connect-src ${Array.from(connectOrigins).join(' ')}`,
    `frame-src ${Array.from(frameOrigins).join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  return directives.join('; ');
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  const isProduction = process.env.NODE_ENV === 'production';

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Preserve Google Sign-In popup communication while isolating cross-origin openers
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(isProduction));

  if (isProduction) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isHttps =
      req.secure ||
      (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https');
    if (isHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  }

  next();
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export interface ApiRateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  skip?: (req: Request) => boolean;
}

export function createApiRateLimiter(options: ApiRateLimiterOptions) {
  const buckets = new Map<string, RateBucket>();
  const maxEntries = 10_000;

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, Math.max(options.windowMs, 30_000));
  cleanupTimer.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    if (options.skip?.(req)) {
      return next();
    }

    const now = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.keyPrefix}:${clientIp}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && buckets.size >= maxEntries) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey) buckets.delete(oldestKey);
      }
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, options.maxRequests - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader('RateLimit-Limit', String(options.maxRequests));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > options.maxRequests) {
      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait briefly and try again.',
        },
      });
    }

    return next();
  };
}
