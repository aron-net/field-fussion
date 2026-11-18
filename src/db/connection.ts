import fs from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type { PoolConfig } from 'pg';

export interface ResolvedDatabaseConfig {
  mode: 'database_url' | 'discrete';
  connectionString?: string;
  host: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  isUnixSocket: boolean;
  isLocalHost: boolean;
  ssl: false | ConnectionOptions;
}

export interface ResolveDatabaseOptions {
  admin?: boolean;
  env?: NodeJS.ProcessEnv;
}

function parseBooleanFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['true', '1', 'yes', 'require', 'verify-full', 'verify-ca'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'disable'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid SQL_SSL value "${raw}". Use "true", "false", or omit for auto-detection.`);
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('SQL_PORT must be a valid TCP port number between 1 and 65535.');
  }
  return parsed;
}

function loadCustomCa(env: NodeJS.ProcessEnv): string | undefined {
  const inlineCa = env.SQL_SSL_CA?.trim();
  if (inlineCa) {
    return inlineCa.replace(/\\n/g, '\n');
  }
  const caFile = env.SQL_SSL_CA_FILE?.trim();
  if (caFile) {
    return fs.readFileSync(caFile, 'utf8');
  }
  return undefined;
}

function resolveSslOptions(params: {
  isUnixSocket: boolean;
  isLocalHost: boolean;
  hasDatabaseUrl: boolean;
  urlSslMode: string | null;
  env: NodeJS.ProcessEnv;
}): false | ConnectionOptions {
  const { isUnixSocket, isLocalHost, hasDatabaseUrl, urlSslMode, env } = params;
  const isProduction = env.NODE_ENV === 'production';

  if (env.SQL_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === 'false') {
    throw new Error(
      'Disabling PostgreSQL TLS certificate verification (SQL_SSL_REJECT_UNAUTHORIZED=false) is prohibited.'
    );
  }

  if (urlSslMode && ['no-verify', 'allow'].includes(urlSslMode)) {
    throw new Error(
      `Unsupported insecure PostgreSQL sslmode="${urlSslMode}". Certificate verification must remain enabled.`
    );
  }

  // Unix domain sockets (e.g. Cloud SQL proxy sockets) do not use TCP/TLS.
  if (isUnixSocket) {
    return false;
  }

  const explicitFlag = parseBooleanFlag(env.SQL_SSL);

  let shouldUseSsl: boolean;
  if (explicitFlag !== undefined) {
    shouldUseSsl = explicitFlag;
  } else if (urlSslMode === 'disable') {
    if (isProduction && !isLocalHost) {
      throw new Error(
        'Insecure sslmode=disable in DATABASE_URL is not permitted for remote production connections.'
      );
    }
    shouldUseSsl = false;
  } else if (urlSslMode && ['require', 'verify-ca', 'verify-full', 'prefer'].includes(urlSslMode)) {
    shouldUseSsl = true;
  } else if (hasDatabaseUrl) {
    // Remote DATABASE_URL (e.g. Render PostgreSQL) defaults to verified TLS; localhost stays non-TLS unless SQL_SSL=true.
    shouldUseSsl = !isLocalHost;
  } else {
    // Discrete SQL_HOST: remote hosts in production default to verified TLS; local dev stays non-TLS unless SQL_SSL=true.
    shouldUseSsl = isProduction && !isLocalHost;
  }

  if (!shouldUseSsl) {
    return false;
  }

  const ca = loadCustomCa(env);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

export function resolveDatabaseConfig(options: ResolveDatabaseOptions = {}): ResolvedDatabaseConfig {
  const env = options.env ?? process.env;
  const admin = options.admin ?? false;

  const rawUrl = (admin ? env.DATABASE_ADMIN_URL || env.DATABASE_URL : env.DATABASE_URL)?.trim();

  if (rawUrl) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
    }

    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('DATABASE_URL must use the postgres:// or postgresql:// scheme.');
    }

    const socketHostParam = parsed.searchParams.get('host')?.trim();
    const host = socketHostParam || parsed.hostname;
    if (!host) {
      throw new Error('DATABASE_URL must include a database host or Unix socket path.');
    }

    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    if (!database) {
      throw new Error('DATABASE_URL must include a database name.');
    }

    const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    const isUnixSocket = host.startsWith('/');
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const port = isUnixSocket ? undefined : parsed.port ? parsePort(parsed.port) : 5432;
    const urlSslMode = parsed.searchParams.get('sslmode')?.trim().toLowerCase() ?? null;

    const ssl = resolveSslOptions({
      isUnixSocket,
      isLocalHost,
      hasDatabaseUrl: true,
      urlSslMode,
      env,
    });

    // Strip sslmode/sslrootcert from connectionString so pg does not override our explicit strict TLS config.
    const normalizedUrl = new URL(parsed.toString());
    normalizedUrl.searchParams.delete('sslmode');
    normalizedUrl.searchParams.delete('sslrootcert');
    normalizedUrl.searchParams.delete('sslcert');
    normalizedUrl.searchParams.delete('sslkey');

    return {
      mode: 'database_url',
      connectionString: normalizedUrl.toString(),
      host,
      port,
      user,
      password,
      database,
      isUnixSocket,
      isLocalHost,
      ssl,
    };
  }

  const host = env.SQL_HOST?.trim();
  const database = env.SQL_DB_NAME?.trim();
  const user = (admin ? env.SQL_ADMIN_USER || env.SQL_USER : env.SQL_USER)?.trim();
  const password = admin
    ? env.SQL_ADMIN_PASSWORD ?? env.SQL_PASSWORD
    : env.SQL_PASSWORD;

  if (!host) {
    throw new Error('Either DATABASE_URL or SQL_HOST must be set in environment variables.');
  }
  if (!database) {
    throw new Error('Either DATABASE_URL or SQL_DB_NAME must be set in environment variables.');
  }
  if (!user) {
    throw new Error(
      admin
        ? 'Either DATABASE_URL, SQL_ADMIN_USER, or SQL_USER must be set in environment variables.'
        : 'Either DATABASE_URL or SQL_USER must be set in environment variables.'
    );
  }
  if (!password) {
    throw new Error(
      admin
        ? 'Either DATABASE_URL, SQL_ADMIN_PASSWORD, or SQL_PASSWORD must be set in environment variables.'
        : 'Either DATABASE_URL or SQL_PASSWORD must be set in environment variables.'
    );
  }

  const isUnixSocket = host.startsWith('/');
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const port = isUnixSocket ? undefined : parsePort(env.SQL_PORT) ?? 5432;

  const ssl = resolveSslOptions({
    isUnixSocket,
    isLocalHost,
    hasDatabaseUrl: false,
    urlSslMode: null,
    env,
  });

  return {
    mode: 'discrete',
    host,
    port,
    user,
    password,
    database,
    isUnixSocket,
    isLocalHost,
    ssl,
  };
}

export function buildPgPoolConfig(options: ResolveDatabaseOptions = {}): PoolConfig {
  const cfg = resolveDatabaseConfig(options);

  if (cfg.mode === 'database_url' && cfg.connectionString) {
    return {
      connectionString: cfg.connectionString,
      ssl: cfg.ssl,
      max: 10,
      connectionTimeoutMillis: 15000,
    };
  }

  return {
    host: cfg.host,
    ...(cfg.port ? { port: cfg.port } : {}),
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl,
    max: 10,
    connectionTimeoutMillis: 15000,
  };
}
