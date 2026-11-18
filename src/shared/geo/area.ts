import type {
  FarmGeoJsonBoundary,
  GeoJsonPolygon,
  GeoJsonPosition,
} from '../types/domain.ts';

export const SQ_METERS_PER_ACRE = 4046.8564224;
export const SQ_METERS_PER_HECTARE = 10000;
const WGS84_EARTH_RADIUS_METERS = 6371007.181;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Spherical excess ring area on WGS84 ellipsoid radius (Chamberlain & Duquette, 2007).
 * Produces positive area in square meters regardless of winding order.
 */
function calculateRingAreaSqMeters(ring: readonly GeoJsonPosition[]): number {
  if (ring.length < 4) return 0;

  let total = 0;
  const len = ring.length;
  for (let i = 0; i < len - 1; i += 1) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    const p3 = ring[(i + 2) % (len - 1)];
    if (!p1 || !p2 || !p3) continue;

    // Standard spherical polygon excess using consecutive edges
    total +=
      (toRadians(p2[0]) - toRadians(p1[0])) *
      (2 + Math.sin(toRadians(p1[1])) + Math.sin(toRadians(p2[1])));
  }

  return Math.abs((total * WGS84_EARTH_RADIUS_METERS * WGS84_EARTH_RADIUS_METERS) / 2);
}

function calculatePolygonAreaSqMeters(coordinates: GeoJsonPosition[][]): number {
  if (coordinates.length === 0) return 0;
  const outer = calculateRingAreaSqMeters(coordinates[0] ?? []);
  let holes = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    holes += calculateRingAreaSqMeters(coordinates[i] ?? []);
  }
  return Math.max(0, outer - holes);
}

export function sqMetersToAcres(sqMeters: number): number {
  return sqMeters / SQ_METERS_PER_ACRE;
}

export function sqMetersToHectares(sqMeters: number): number {
  return sqMeters / SQ_METERS_PER_HECTARE;
}

export function calculateGeoJsonArea(boundary: FarmGeoJsonBoundary): {
  areaSqMeters: number;
  areaAcres: number;
  areaHectares: number;
} {
  let areaSqMeters = 0;
  if (boundary.type === 'Polygon') {
    areaSqMeters = calculatePolygonAreaSqMeters(boundary.coordinates);
  } else {
    for (const poly of boundary.coordinates) {
      areaSqMeters += calculatePolygonAreaSqMeters(poly);
    }
  }

  return {
    areaSqMeters: Math.round(areaSqMeters * 100) / 100,
    areaAcres: Math.round(sqMetersToAcres(areaSqMeters) * 1000) / 1000,
    areaHectares: Math.round(sqMetersToHectares(areaSqMeters) * 1000) / 1000,
  };
}

export function computeGeoJsonCentroid(boundary: FarmGeoJsonBoundary): {
  lat: number;
  lng: number;
} | null {
  const ring =
    boundary.type === 'Polygon'
      ? boundary.coordinates[0]
      : boundary.coordinates[0]?.[0];

  if (!ring || ring.length < 4) return null;

  let sumLng = 0;
  let sumLat = 0;
  const count = ring.length - 1;
  for (let i = 0; i < count; i += 1) {
    sumLng += ring[i]![0];
    sumLat += ring[i]![1];
  }
  return {
    lat: Math.round((sumLat / count) * 1_000_000) / 1_000_000,
    lng: Math.round((sumLng / count) * 1_000_000) / 1_000_000,
  };
}

function orientation(
  p: GeoJsonPosition,
  q: GeoJsonPosition,
  r: GeoJsonPosition
): number {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-12) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(
  p: GeoJsonPosition,
  q: GeoJsonPosition,
  r: GeoJsonPosition
): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) + 1e-12 &&
    q[0] >= Math.min(p[0], r[0]) - 1e-12 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-12 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-12
  );
}

function segmentsIntersect(
  p1: GeoJsonPosition,
  q1: GeoJsonPosition,
  p2: GeoJsonPosition,
  q2: GeoJsonPosition
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function validateRing(ring: GeoJsonPosition[]): string | null {
  if (!Array.isArray(ring) || ring.length < 4) {
    return 'A polygon boundary requires at least 3 distinct corner points (closed ring of 4+ coordinates).';
  }

  for (const pt of ring) {
    if (
      !Array.isArray(pt) ||
      pt.length !== 2 ||
      !Number.isFinite(pt[0]) ||
      !Number.isFinite(pt[1]) ||
      pt[0] < -180 ||
      pt[0] > 180 ||
      pt[1] < -90 ||
      pt[1] > 90
    ) {
      return 'Boundary coordinates must be valid [longitude, latitude] pairs.';
    }
  }

  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) {
    return 'Polygon ring must be closed (first and last coordinate must match).';
  }

  // Distinct vertices check
  const uniqueKeys = new Set(
    ring.slice(0, -1).map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`)
  );
  if (uniqueKeys.size < 3) {
    return 'A polygon boundary must contain at least 3 distinct corner points.';
  }

  // Self-intersection check across non-adjacent edges
  const edgeCount = ring.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const a1 = ring[i]!;
    const a2 = ring[i + 1]!;
    for (let j = i + 2; j < edgeCount; j += 1) {
      // First and last edges share vertex 0
      if (i === 0 && j === edgeCount - 1) continue;
      const b1 = ring[j]!;
      const b2 = ring[j + 1]!;
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return 'Boundary edges cannot cross or self-intersect.';
      }
    }
  }

  return null;
}

export function validateGeoJsonBoundaryTopology(
  boundary: FarmGeoJsonBoundary
): { valid: true } | { valid: false; reason: string } {
  const polygons =
    boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates;

  if (!Array.isArray(polygons) || polygons.length === 0) {
    return { valid: false, reason: 'Boundary must contain at least one polygon.' };
  }

  for (const poly of polygons) {
    if (!Array.isArray(poly) || poly.length === 0) {
      return { valid: false, reason: 'Polygon cannot be empty.' };
    }
    for (const ring of poly) {
      const err = validateRing(ring);
      if (err) {
        return { valid: false, reason: err };
      }
    }
  }

  const { areaSqMeters } = calculateGeoJsonArea(boundary);
  if (areaSqMeters < 1) {
    return { valid: false, reason: 'Boundary area must be at least 1 square meter.' };
  }

  return { valid: true };
}

export function latLngPointsToGeoJsonPolygon(
  points: readonly { lat: number; lng: number }[]
): GeoJsonPolygon | null {
  if (points.length < 3) return null;
  const ring: GeoJsonPosition[] = points.map((p) => [
    Math.round(p.lng * 1_000_000) / 1_000_000,
    Math.round(p.lat * 1_000_000) / 1_000_000,
  ]);
  ring.push([ring[0]![0], ring[0]![1]]);
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

export function geoJsonBoundaryToLatLngPoints(
  boundary: FarmGeoJsonBoundary | null | undefined
): { lat: number; lng: number }[] {
  if (!boundary) return [];
  const ring =
    boundary.type === 'Polygon'
      ? boundary.coordinates[0]
      : boundary.coordinates[0]?.[0];
  if (!ring || ring.length < 2) return [];
  return ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
}
