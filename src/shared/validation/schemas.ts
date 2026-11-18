import { z } from 'zod';
import {
  BUSINESS_ROLES,
  ORG_ROLES,
  ORGANISATION_TYPES,
  SELF_ACTIVATABLE_ROLES,
} from '../types/domain.ts';

export const supportedLanguageSchema = z.enum(['en', 'lg', 'sw']);
export const areaUnitSchema = z.enum(['acres', 'hectares']);
export const currencySchema = z.enum(['UGX', 'KES', 'TZS', 'USD']);

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number (e.g. +256 772 000000)')
    .optional()
    .or(z.literal('')),
  district: z.string().trim().min(2, 'Select or enter your district').max(80),
  country: z.string().trim().min(2).max(2).default('UG'),
  currency: currencySchema.default('UGX'),
  preferredLanguage: supportedLanguageSchema,
  preferredAreaUnit: areaUnitSchema,
  timezone: z.string().trim().min(3).max(64).default('Africa/Kampala'),
  onboardingCompleted: z.boolean().optional(),
  researchOptIn: z.boolean().optional(),
});

export const activateRoleSchema = z.object({
  role: z.enum(BUSINESS_ROLES),
});

export const selfActivateRoleSchema = z.object({
  role: z.enum(
    SELF_ACTIVATABLE_ROLES as unknown as [
      'farmer',
      'coop_manager',
      'buyer',
      'supplier',
      'logistics',
      'expert',
    ]
  ),
});

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(3, 'Organisation name must be at least 3 characters').max(140),
  orgType: z.enum(ORGANISATION_TYPES),
  district: z.string().trim().min(2, 'District is required').max(80),
  country: z.string().trim().min(2).max(2).default('UG'),
  registrationNumber: z.string().trim().max(64).optional().or(z.literal('')),
});

export const inviteMemberSchema = z.object({
  inviteeEmail: z.string().trim().email('Enter a valid email address').toLowerCase(),
  intendedOrgRole: z.enum(ORG_ROLES),
});

export const updateMemberSchema = z.object({
  orgRole: z.enum(ORG_ROLES).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const aiAdvisoryRequestSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, 'Enter at least 3 characters for your agricultural question.')
    .max(1500, 'Prompt cannot exceed 1500 characters.'),
  organisationId: z.string().uuid().optional(),
  includeDraftSuggestion: z.boolean().optional(),
});

export const switchAiProviderSchema = z.object({
  providerId: z.enum(['gemini_free', 'ollama_local', 'mock', 'gemini_paid']),
});

export const aiConfirmationSchema = z.object({
  decision: z.enum(['confirm', 'dismiss']),
});

export const geoJsonPositionSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

export const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(geoJsonPositionSchema).min(4)).min(1),
});

export const geoJsonMultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(geoJsonPositionSchema).min(4)).min(1)).min(1),
});

export const farmBoundaryGeoJsonSchema = z.discriminatedUnion('type', [
  geoJsonPolygonSchema,
  geoJsonMultiPolygonSchema,
]);

export const createFarmSchema = z
  .object({
    name: z.string().trim().min(2, 'Farm name must be at least 2 characters').max(140),
    farmCode: z.string().trim().max(40).optional().or(z.literal('')),
    ownershipType: z.enum(['individual', 'organisation']),
    ownerOrganisationId: z.string().uuid().optional(),
    country: z.string().trim().min(2).max(2).default('UG'),
    district: z.string().trim().min(2, 'District is required').max(80),
    subcounty: z.string().trim().max(120).optional().or(z.literal('')),
    locationSource: z
      .enum(['search', 'map_pin', 'manual_coords', 'gps_opt_in'])
      .default('search'),
    centroidLat: z.number().finite().min(-90).max(90).nullable().optional(),
    centroidLng: z.number().finite().min(-180).max(180).nullable().optional(),
    boundaryGeojson: farmBoundaryGeoJsonSchema.nullable().optional(),
    declaredAreaValue: z.number().positive().max(1_000_000).optional(),
    declaredAreaUnit: areaUnitSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.ownershipType === 'organisation' && !val.ownerOrganisationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ownerOrganisationId'],
        message: 'Select the owning organisation for an organisation-owned farm.',
      });
    }
  });

export const updateFarmSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(2).max(140).optional(),
  farmCode: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().min(2).max(2).optional(),
  district: z.string().trim().min(2).max(80).optional(),
  subcounty: z.string().trim().max(120).nullable().optional(),
  locationSource: z.enum(['search', 'map_pin', 'manual_coords', 'gps_opt_in']).optional(),
  centroidLat: z.number().finite().min(-90).max(90).nullable().optional(),
  centroidLng: z.number().finite().min(-180).max(180).nullable().optional(),
  resolutionStrategy: z.enum(['strict', 'overwrite_with_server_backup']).optional(),
});

export const updateFarmBoundarySchema = z.object({
  expectedVersion: z.number().int().positive(),
  boundaryGeojson: farmBoundaryGeoJsonSchema,
  editSource: z
    .enum(['web', 'pwa_online', 'pwa_offline_sync', 'conflict_resolution'])
    .default('web'),
  resolutionStrategy: z.enum(['strict', 'overwrite_with_server_backup']).optional(),
});

export const createFarmPermissionSchema = z
  .object({
    granteeType: z.enum(['user', 'organisation']),
    granteeEmail: z.string().trim().email('Enter a valid user email').toLowerCase().optional(),
    granteeOrganisationId: z.string().uuid().optional(),
    accessRole: z.enum(['manager', 'agronomist', 'viewer']),
    canEditBoundary: z.boolean().default(false),
    canManageOperations: z.boolean().default(true),
    canManagePermissions: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.granteeType === 'user' && !val.granteeEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['granteeEmail'],
        message: 'Enter the manager or expert email address.',
      });
    }
    if (val.granteeType === 'organisation' && !val.granteeOrganisationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['granteeOrganisationId'],
        message: 'Select the cooperative or organisation to grant access to.',
      });
    }
  });

export const registerProfileSyncSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number (e.g. +256 772 000000)')
    .optional()
    .or(z.literal('')),
  termsAccepted: z.literal(true, {
    message: 'Accept the Terms of Service and Privacy Policy to continue.',
  }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type RegisterProfileSyncInput = z.infer<typeof registerProfileSyncSchema>;
export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type AiAdvisoryRequestInput = z.infer<typeof aiAdvisoryRequestSchema>;
export type SwitchAiProviderInput = z.infer<typeof switchAiProviderSchema>;
export type AiConfirmationInput = z.infer<typeof aiConfirmationSchema>;
export type CreateFarmInput = z.infer<typeof createFarmSchema>;
export type UpdateFarmInput = z.infer<typeof updateFarmSchema>;
export type UpdateFarmBoundaryInput = z.infer<typeof updateFarmBoundarySchema>;
export type CreateFarmPermissionInput = z.infer<typeof createFarmPermissionSchema>;
