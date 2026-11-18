import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth.guard.ts';
import { searchUgandaGazetteer } from '../../../shared/geo/ugandaLocations.ts';
import type {
  LocationSearchProviderId,
  LocationSearchResult,
  MappingRuntimeConfig,
} from '../../../shared/types/domain.ts';

export const locationsRouter = Router();

interface CacheEntry {
  results: LocationSearchResult[];
  expiresAt: number;
}

const nominatimCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

let lastOutboundNominatimAt = 0;

interface NominatimHit {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
  address?: {
    county?: string;
    state_district?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

export function getMappingRuntimeConfig(): MappingRuntimeConfig {
  const rawProvider = (process.env.LOCATION_SEARCH_PROVIDER || 'osm_nominatim').trim();
  const locationProvider: LocationSearchProviderId =
    rawProvider === 'gazetteer_only' || rawProvider === 'custom_http'
      ? rawProvider
      : 'osm_nominatim';

  const satelliteEnabled = process.env.MAP_SATELLITE_ENABLED === 'true';
  const streetTileUrl =
    process.env.MAP_STREET_TILE_URL?.trim() ||
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const streetAttribution =
    process.env.MAP_STREET_ATTRIBUTION?.trim() || '&copy; OpenStreetMap contributors';
  const satelliteTileUrl = satelliteEnabled
    ? process.env.MAP_SATELLITE_TILE_URL?.trim() ||
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    : '';

  return {
    locationProvider,
    locationProviderLabel:
      locationProvider === 'gazetteer_only'
        ? 'Offline Uganda District Gazetteer Only'
        : locationProvider === 'custom_http'
          ? 'Custom Configured Geocoder + Uganda Gazetteer'
          : 'Uganda Gazetteer + OSM Nominatim (Rate-Limited Proxy)',
    autocompleteProhibited: true,
    rateLimitNote:
      'Location search is strictly user-triggered (no keystroke autocomplete). Public OSM Nominatim and OSM tiles enforce strict usage & rate limits and are not guaranteed free or unlimited for high-volume production.',
    basemaps: {
      streetEnabled: true,
      streetTileUrl,
      streetAttribution,
      satelliteEnabled,
      satelliteTileUrl,
      satelliteAttribution: satelliteEnabled
        ? 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
        : '',
      satelliteLicenseNote: satelliteEnabled
        ? 'Esri World Imagery is provided for evaluation only; commercial production or boundary digitization at scale requires reviewing Esri ArcGIS Master License Agreement terms.'
        : 'Satellite basemap is disabled by server configuration (MAP_SATELLITE_ENABLED=false).',
    },
    offlinePolicyNote:
      'Public OSM/Esri map imagery tiles are not bulk-downloaded or cached offline. Offline mode supports synced farms, boundaries, area calculation, Uganda gazetteer search, and an interactive WGS84 SVG coordinate grid.',
  };
}

async function queryGeocoderWithCache(
  query: string,
  country: string,
  provider: LocationSearchProviderId
): Promise<{ results: LocationSearchResult[]; rateLimited: boolean }> {
  if (provider === 'gazetteer_only') {
    return { results: [], rateLimited: false };
  }

  const key = `${provider}:${country.toUpperCase()}:${query.trim().toLowerCase()}`;
  const cached = nominatimCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { results: cached.results, rateLimited: false };
  }

  // Enforce >= 1.1s spacing between outbound Nominatim calls per OSM Nominatim Usage Policy
  const now = Date.now();
  const elapsed = now - lastOutboundNominatimAt;
  if (provider === 'osm_nominatim' && elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    return { results: [], rateLimited: true };
  }

  const endpointBase =
    provider === 'custom_http' && process.env.CUSTOM_GEOCODER_URL
      ? process.env.CUSTOM_GEOCODER_URL.trim()
      : 'https://nominatim.openstreetmap.org/search';

  try {
    if (provider === 'osm_nominatim') {
      lastOutboundNominatimAt = Date.now();
    }

    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
      countrycodes: country.toLowerCase(),
      q: query.trim(),
    });

    const response = await fetch(`${endpointBase}?${params.toString()}`, {
      headers: {
        'User-Agent': 'FIELD-FUSSION-AgriPlatform/2.0 (remote-farm-mapping)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return { results: [], rateLimited: response.status === 429 };
    }

    const hits = (await response.json()) as NominatimHit[];
    const mapped: LocationSearchResult[] = hits
      .map((hit): LocationSearchResult | null => {
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const district =
          hit.address?.state_district ||
          hit.address?.county ||
          hit.address?.city ||
          hit.address?.town ||
          hit.address?.state ||
          'Uganda';
        const bbox =
          hit.boundingbox && hit.boundingbox.length === 4
            ? ([
                Number(hit.boundingbox[0]),
                Number(hit.boundingbox[1]),
                Number(hit.boundingbox[2]),
                Number(hit.boundingbox[3]),
              ] as [number, number, number, number])
            : undefined;

        return {
          id: `${provider === 'custom_http' ? 'geo' : 'osm'}-${hit.place_id}`,
          label: hit.display_name,
          district,
          country: country.toUpperCase(),
          lat: Math.round(lat * 1_000_000) / 1_000_000,
          lng: Math.round(lng * 1_000_000) / 1_000_000,
          source: provider === 'custom_http' ? 'custom_geocoder' : 'osm_nominatim',
          boundingBox: bbox,
        };
      })
      .filter((item): item is LocationSearchResult => item !== null);

    if (nominatimCache.size > 200) {
      const oldestKey = nominatimCache.keys().next().value;
      if (oldestKey) nominatimCache.delete(oldestKey);
    }
    nominatimCache.set(key, { results: mapped, expiresAt: Date.now() + CACHE_TTL_MS });
    return { results: mapped, rateLimited: false };
  } catch {
    return { results: [], rateLimited: false };
  }
}

locationsRouter.get('/config', requireAuth, (_req: AuthenticatedRequest, res) => {
  res.json({ data: getMappingRuntimeConfig() });
});

locationsRouter.get('/search', requireAuth, async (req: AuthenticatedRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const country =
    typeof req.query.country === 'string' && req.query.country.trim().length === 2
      ? req.query.country.trim().toUpperCase()
      : 'UG';

  const config = getMappingRuntimeConfig();
  const gazetteerHits = country === 'UG' ? searchUgandaGazetteer(q) : [];

  let remoteHits: LocationSearchResult[] = [];
  let rateLimited = false;
  if (q.length >= 3 && gazetteerHits.length < 5 && config.locationProvider !== 'gazetteer_only') {
    const lookup = await queryGeocoderWithCache(q, country, config.locationProvider);
    remoteHits = lookup.results;
    rateLimited = lookup.rateLimited;
  }

  const seenLabels = new Set(gazetteerHits.map((g) => g.district.toLowerCase()));
  const merged = [...gazetteerHits];
  for (const hit of remoteHits) {
    const key = hit.label.toLowerCase();
    if (!seenLabels.has(hit.district.toLowerCase()) || merged.length < 8) {
      if (!merged.some((m) => m.label.toLowerCase() === key)) {
        merged.push(hit);
      }
    }
  }

  res.json({
    data: merged.slice(0, 10),
    meta: {
      total: merged.length,
      locationProvider: config.locationProvider,
      rateLimitedFallback: rateLimited,
    },
  });
});
