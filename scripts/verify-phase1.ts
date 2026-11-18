import 'dotenv/config';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { users } from '../src/db/schema.ts';
import {
  getOrCreateUserByFirebaseUid,
  UserAccountConflictError,
} from '../src/db/repositories/users.repository.ts';
import {
  buildFormattedPhone,
  isValidEmailFormat,
  mapFirebaseAuthError,
  validatePasswordRules,
} from '../src/lib/auth-helpers.ts';
import {
  buildPgPoolConfig,
  resolveDatabaseConfig,
} from '../src/db/connection.ts';
import { createApiApp } from '../src/server/app.ts';
import { TRANSLATIONS } from '../src/shared/i18n/translations.ts';
import {
  createOrganisationSchema,
  registerProfileSyncSchema,
  selfActivateRoleSchema,
  updateProfileSchema,
} from '../src/shared/validation/schemas.ts';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}

async function runTests() {
  let passed = 0;

  // 1. Validate self-activation schema strictly blocks 'admin'
  const adminAttempt = selfActivateRoleSchema.safeParse({ role: 'admin' });
  assert.equal(adminAttempt.success, false, 'selfActivateRoleSchema must reject admin');
  const farmerAttempt = selfActivateRoleSchema.safeParse({ role: 'farmer' });
  assert.equal(farmerAttempt.success, true, 'selfActivateRoleSchema must allow farmer');
  passed += 1;
  console.log('✓ Test 1: Role self-activation schema blocks admin escalation');

  // 2. Validate onboarding, registration & organisation Zod schemas
  const badProfile = updateProfileSchema.safeParse({
    fullName: 'A',
    district: 'Kampala',
    preferredLanguage: 'en',
    preferredAreaUnit: 'acres',
  });
  assert.equal(badProfile.success, false, 'Short fullName must fail validation');

  const goodProfile = updateProfileSchema.safeParse({
    fullName: 'Sarah Namukasa',
    phone: '+256 772 123456',
    district: 'Lira',
    country: 'UG',
    currency: 'UGX',
    preferredLanguage: 'lg',
    preferredAreaUnit: 'hectares',
    timezone: 'Africa/Kampala',
    onboardingCompleted: true,
    researchOptIn: false,
  });
  assert.equal(goodProfile.success, true, 'Valid Uganda profile must pass validation');

  const regWithoutTerms = registerProfileSyncSchema.safeParse({
    fullName: 'Sarah Namukasa',
    phone: '+256772123456',
    termsAccepted: false,
  });
  assert.equal(regWithoutTerms.success, false, 'Registration sync must require Terms acceptance');

  const regValid = registerProfileSyncSchema.safeParse({
    fullName: 'Sarah Namukasa',
    phone: '+256772123456',
    termsAccepted: true,
  });
  assert.equal(regValid.success, true, 'Valid registration sync must pass');

  const goodOrg = createOrganisationSchema.safeParse({
    name: 'Lira Maize Cooperative',
    orgType: 'cooperative',
    district: 'Lira',
    country: 'UG',
  });
  assert.equal(goodOrg.success, true, 'Valid cooperative payload must pass');
  passed += 1;
  console.log('✓ Test 2: Shared Zod validation schemas pass');

  // 3. Validate i18n dictionary key parity across en, lg, sw
  const enKeys = flattenKeys(TRANSLATIONS.en);
  const lgKeys = flattenKeys(TRANSLATIONS.lg);
  const swKeys = flattenKeys(TRANSLATIONS.sw);
  assert.deepEqual(lgKeys, enKeys, 'Luganda dictionary keys must match English');
  assert.deepEqual(swKeys, enKeys, 'Swahili dictionary keys must match English');
  passed += 1;
  console.log(`✓ Test 3: i18n parity verified (${enKeys.length} keys across en, lg, sw)`);

  // 4. Verify live Express API prototype endpoints (health + 401 auth guards + 404 handling)
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { data: { phase: number; intendedTarget: string } };
    assert.ok(healthJson.data.phase >= 1, 'Health phase must be >= 1');
    assert.equal(healthJson.data.intendedTarget, 'nestjs');

    const unauthEndpoints = [
      { method: 'GET', path: '/api/v1/auth/me' },
      { method: 'POST', path: '/api/v1/auth/register-profile' },
      { method: 'PATCH', path: '/api/v1/users/me' },
      { method: 'POST', path: '/api/v1/users/me/roles' },
      { method: 'GET', path: '/api/v1/organisations' },
      { method: 'POST', path: '/api/v1/organisations' },
      { method: 'GET', path: '/api/v1/audit-logs' },
      { method: 'GET', path: '/api/v1/ai/status' },
    ];

    for (const ep of unauthEndpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.method === 'GET' ? undefined : JSON.stringify({ role: 'admin' }),
      });
      assert.equal(res.status, 401, `${ep.method} ${ep.path} must return 401 when unauthenticated`);
    }

    const badTokenRes = await fetch(`${baseUrl}/api/v1/users/me/roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.mock.token',
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(badTokenRes.status, 401, 'Invalid Bearer token must return 401');

    const notFoundRes = await fetch(`${baseUrl}/api/v1/nonexistent`);
    assert.equal(notFoundRes.status, 404, 'Unknown /api route must return 404');

    passed += 1;
    console.log('✓ Test 4: Express API routes enforce 401 auth guards, 404 routing, and 200 health');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }

  // 5. Auth UI helper validation, safe error mapping & one-person-one-account linking check
  assert.equal(isValidEmailFormat('farmer@uganda.org'), true);
  assert.equal(isValidEmailFormat('invalid-email'), false);
  assert.equal(validatePasswordRules('short1').valid, false);
  assert.equal(validatePasswordRules('LettersOnly').valid, false);
  assert.equal(validatePasswordRules('FarmPass2026').valid, true);
  assert.equal(buildFormattedPhone('+256', '0772 123456'), '+256772123456');

  const mappedInvalidEmail = mapFirebaseAuthError({ code: 'auth/invalid-email' });
  assert.equal(mappedInvalidEmail.kind, 'invalid_email');
  assert.ok(!/firebase|token|stack/i.test(mappedInvalidEmail.message));
  assert.equal(mapFirebaseAuthError({ code: 'auth/wrong-password' }).kind, 'incorrect_password');
  assert.equal(mapFirebaseAuthError({ code: 'auth/user-not-found' }).kind, 'account_not_found');
  assert.equal(mapFirebaseAuthError({ code: 'auth/email-already-in-use' }).kind, 'email_already_registered');
  assert.equal(mapFirebaseAuthError({ code: 'auth/weak-password' }).kind, 'weak_password');
  assert.equal(mapFirebaseAuthError({ code: 'auth/network-request-failed' }).kind, 'network_error');
  assert.equal(mapFirebaseAuthError({ code: 'auth/popup-closed-by-user' }).kind, 'google_cancelled');

  const suffix = crypto.randomUUID().slice(0, 8);
  const testEmail = `authlink_${suffix}@example.test`;
  const uidA = `verify_uid_a_${suffix}`;
  const uidB = `verify_uid_b_${suffix}`;
  let createdUserId: string | null = null;
  try {
    const first = await getOrCreateUserByFirebaseUid({
      firebaseUid: uidA,
      email: testEmail,
      displayName: 'Grace Atim',
      emailVerified: true,
    });
    createdUserId = first.id;

    // Unverified second UID with same email MUST be blocked (no auto-merge without verification)
    await assert.rejects(
      () =>
        getOrCreateUserByFirebaseUid({
          firebaseUid: uidB,
          email: testEmail.toUpperCase(),
          displayName: 'Unverified Attempt',
          emailVerified: false,
        }),
      (err: unknown) =>
        err instanceof UserAccountConflictError &&
        err.code === 'ACCOUNT_LINK_VERIFICATION_REQUIRED'
    );

    // Verified second UID with same email links safely to the single existing profile
    const linked = await getOrCreateUserByFirebaseUid({
      firebaseUid: uidB,
      email: testEmail.toUpperCase(),
      displayName: 'Grace Atim',
      emailVerified: true,
    });
    assert.equal(linked.id, first.id, 'Verified email must map to single user profile without duplication');
  } finally {
    if (createdUserId) {
      await db.delete(users).where(eq(users.id, createdUserId));
    }
  }

  passed += 1;
  console.log('✓ Test 5: Auth validation helpers, safe Firebase error mapping, and one-person-one-account linking pass');

  // 6. PostgreSQL DATABASE_URL / SQL_PORT / strict TLS resolution tests (no external connections made)
  const remoteRenderCfg = resolveDatabaseConfig({
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app_user:secret@dpg-example.oregon-postgres.render.com:5432/field_fussion?sslmode=require',
    },
  });
  assert.equal(remoteRenderCfg.mode, 'database_url');
  assert.equal(remoteRenderCfg.port, 5432);
  assert.equal(remoteRenderCfg.isUnixSocket, false);
  assert.deepEqual(remoteRenderCfg.ssl, { rejectUnauthorized: true });
  assert.equal(remoteRenderCfg.connectionString?.includes('sslmode='), false);

  const renderPoolCfg = buildPgPoolConfig({
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app_user:secret@dpg-example.oregon-postgres.render.com/field_fussion',
    },
  });
  assert.deepEqual(renderPoolCfg.ssl, { rejectUnauthorized: true });

  const localCfg = resolveDatabaseConfig({
    env: {
      NODE_ENV: 'development',
      SQL_HOST: 'localhost',
      SQL_PORT: '5433',
      SQL_USER: 'postgres',
      SQL_PASSWORD: 'local-dev-password',
      SQL_DB_NAME: 'field_fussion',
    },
  });
  assert.equal(localCfg.port, 5433);
  assert.equal(localCfg.ssl, false);

  const socketCfg = resolveDatabaseConfig({
    env: {
      NODE_ENV: 'production',
      SQL_HOST: '/app/cloudsql/example:europe-west2:instance',
      SQL_USER: 'app_user',
      SQL_PASSWORD: 'pw',
      SQL_DB_NAME: 'field_fussion',
    },
  });
  assert.equal(socketCfg.isUnixSocket, true);
  assert.equal(socketCfg.ssl, false);

  assert.throws(
    () =>
      resolveDatabaseConfig({
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://u:p@db.render.com/app?sslmode=no-verify',
        },
      }),
    /Certificate verification/i
  );
  assert.throws(
    () =>
      resolveDatabaseConfig({
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://u:p@db.render.com/app',
          SQL_SSL_REJECT_UNAUTHORIZED: 'false',
        },
      }),
    /prohibited/i
  );
  passed += 1;
  console.log('✓ Test 6: PostgreSQL DATABASE_URL, SQL_PORT, Unix socket & strict TLS policy verified');

  // 7. Express trust proxy, security headers & API rate limiter checks
  const secApp = createApiApp();
  assert.equal(secApp.get('trust proxy'), 1);
  assert.equal(secApp.get('x-powered-by'), false);

  const secServer = http.createServer(secApp);
  await new Promise<void>((resolve) => secServer.listen(0, '127.0.0.1', resolve));
  const secAddr = secServer.address();
  assert.ok(secAddr && typeof secAddr === 'object');
  const secBase = `http://127.0.0.1:${secAddr.port}`;

  try {
    const healthSecRes = await fetch(`${secBase}/api/v1/health`);
    assert.equal(healthSecRes.status, 200);
    assert.equal(healthSecRes.headers.get('x-powered-by'), null);
    assert.equal(healthSecRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthSecRes.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    const csp = healthSecRes.headers.get('content-security-policy') || '';
    assert.ok(csp.includes('https://tile.openstreetmap.org'));
    assert.ok(csp.includes('https://identitytoolkit.googleapis.com'));

    let got429 = false;
    for (let i = 0; i < 35; i += 1) {
      const r = await fetch(`${secBase}/api/v1/locations/search?q=Lira`);
      if (r.status === 429) {
        got429 = true;
        break;
      }
    }
    assert.equal(got429, true, 'Sensitive API limiter must return 429 after burst threshold');

    // Health endpoint must remain exempt from API rate limiting
    const healthAfterBurst = await fetch(`${secBase}/api/v1/health`);
    assert.equal(healthAfterBurst.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      secServer.close((err) => (err ? reject(err) : resolve()))
    );
  }
  passed += 1;
  console.log('✓ Test 7: Express trust proxy, CSP/COOP security headers & API rate limiting verified');

  console.log(`\nAll ${passed} Phase 1 verification suites passed.`);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
