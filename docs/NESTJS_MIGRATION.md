# FIELD FUSSION — Express Prototype to NestJS Migration Guide

## Why Express Exists in This Workspace

Google AI Studio's preview sandbox executes a single Node.js + Vite full-stack server on port `3000`. To keep every API endpoint, authentication guard, and PostgreSQL/Drizzle query real and testable inside AI Studio, `server.ts` + `src/server/` acts as an **Express Prototype Backend Adapter** that mirrors NestJS module boundaries.

## Clean Architectural Separation

1. **Framework-Agnostic Domain Core (`src/shared/`)**
   - `src/shared/types/domain.ts`: Shared DTOs, roles, organisation models, and API envelopes.
   - `src/shared/validation/schemas.ts`: Zod validation schemas reusable inside NestJS `ValidationPipe` / custom Zod pipes.
   - `src/shared/i18n/translations.ts`: Localisation dictionaries (`en`, `lg`, `sw`).

2. **Persistence Layer (`src/db/`)**
   - `src/db/schema.ts`, `src/db/index.ts`, and `src/db/repositories/*.ts` depend **only** on `drizzle-orm` and `pg`—zero Express imports.
   - In NestJS, export `db` via a `@Global()` `DatabaseModule` provider (`DRIZZLE_DB`) and inject repositories directly into `@Injectable()` services.

3. **1:1 Module Mapping (`src/server/` → NestJS `src/modules/`)**

| Prototype Express File | NestJS Target Component | Notes |
| :--- | :--- | :--- |
| `src/server/middleware/auth.guard.ts` | `AuthGuard implements CanActivate` | Verifies Firebase Bearer token via `adminAuth.verifyIdToken()`, syncs `users`, loads PostgreSQL `userRoles` & `organisationMemberships` onto `request.authContext`. |
| `src/server/middleware/rbac.guard.ts` | `RolesGuard` & `OrganisationRoleGuard` + `@RequireRoles()` / `@RequireOrgRoles()` | Reads NestJS `Reflector` metadata and checks PostgreSQL-owned roles/memberships. |
| `src/server/modules/auth/auth.router.ts` | `AuthModule` + `AuthController` | `GET /api/v1/auth/me` |
| `src/server/modules/users/users.router.ts` | `UsersModule` + `UsersController` + `UsersService` | Enforces `PRIVILEGED_ROLE_RESTRICTED` (blocks self-activation of `admin`). |
| `src/server/modules/organisations/organisations.router.ts` | `OrganisationsModule` + `OrganisationsController` + `OrganisationsService` | Cooperative/business creation, invitations, member role updates. |
| `src/server/modules/audit/audit.router.ts` | `AuditModule` + `AuditService` + `AuditController` | Append-only audit repository + read-only scoped query endpoint. |
| `src/server/modules/ai-gateway/*` | `AiGatewayModule` + `AiGatewayService` + `AiProvider` strategy tokens | Multi-provider registry (`GeminiFreeProvider`, `OllamaLocalProvider`, `MockAiProvider`, `GeminiPaidProvider`), PII sanitizer, and confirmation-gated draft store. |
| `src/server/modules/farms/farms.router.ts` + `src/db/repositories/farms.repository.ts` | `FarmsModule` + `FarmsController` + `FarmsService` | PostGIS `ST_IsValid`/`ST_Area(::geography)`, multi-source ownership & revocable `farm_access_grants`, revision history, and `409 FARM_VERSION_CONFLICT` optimistic locking. |
| `src/server/modules/locations/locations.router.ts` | `LocationsModule` + `LocationsController` + `LocationsService` | GPS-independent Uganda gazetteer + cached OpenStreetMap Nominatim proxy. |

## Production Database Hardening on Migration

Apply `src/db/sql/audit_immutability.sql` with a DBA/admin role to enforce PostgreSQL-level `BEFORE UPDATE OR DELETE` trigger rejection and `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs` from the runtime application role. Also ensure `CREATE EXTENSION IF NOT EXISTS postgis;` is enabled on the target PostgreSQL database before running Drizzle migrations.
