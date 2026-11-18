import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Crosshair,
  Eraser,
  Layers,
  LocateFixed,
  RotateCcw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { FarmGeoJsonBoundary, MappingRuntimeConfig } from '../../shared/types/domain.ts';
import {
  calculateGeoJsonArea,
  geoJsonBoundaryToLatLngPoints,
  latLngPointsToGeoJsonPolygon,
} from '../../shared/geo/area.ts';

export type BasemapMode = 'street' | 'satellite' | 'offline_grid';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

interface InteractiveFarmMapProps {
  center: LatLngPoint;
  points: LatLngPoint[];
  onChangePoints?: (points: LatLngPoint[]) => void;
  onSelectPin?: (lat: number, lng: number) => void;
  mode: 'view' | 'pin' | 'draw_boundary';
  editable?: boolean;
  secondaryBoundary?: FarmGeoJsonBoundary | null;
  secondaryLabel?: string;
  primaryLabel?: string;
  isOnline: boolean;
  mappingConfig?: MappingRuntimeConfig | null;
  heightClass?: string;
}

function createVertexIcon(index: number, editable: boolean, removeMode: boolean) {
  const bg = removeMode ? '#B91C1C' : editable ? '#163D31' : '#2D8A51';
  const cursor = removeMode ? 'pointer' : editable ? 'grab' : 'default';
  return L.divIcon({
    className: 'ff-vertex-icon',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:${bg};border:2px solid #FFFFFF;color:#FFFFFF;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.35);cursor:${cursor};">${
      removeMode ? '×' : index + 1
    }</div>`,
  });
}

function createMidpointIcon() {
  return L.divIcon({
    className: 'ff-midpoint-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div title="Insert corner point" style="width:20px;height:20px;border-radius:9999px;background:#FFFFFF;border:2px solid #2D8A51;color:#163D31;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.25);cursor:pointer;">+</div>`,
  });
}

function createPinIcon() {
  return L.divIcon({
    className: 'ff-pin-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:#2D8A51;border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
  });
}

export function InteractiveFarmMap({
  center,
  points,
  onChangePoints,
  onSelectPin,
  mode,
  editable = false,
  secondaryBoundary = null,
  secondaryLabel = 'Server Boundary',
  primaryLabel = 'Farm Boundary',
  isOnline,
  mappingConfig = null,
  heightClass = 'h-[360px] sm:h-[420px]',
}: InteractiveFarmMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayGroupRef = useRef<L.LayerGroup | null>(null);

  const satelliteAllowed = mappingConfig?.basemaps.satelliteEnabled ?? false;

  const [basemap, setBasemap] = useState<BasemapMode>(() =>
    isOnline ? 'street' : 'offline_grid'
  );
  const [tileWarning, setTileWarning] = useState(false);
  const [removeMode, setRemoveMode] = useState(false);

  const pointsRef = useRef(points);
  pointsRef.current = points;
  const onChangeRef = useRef(onChangePoints);
  onChangeRef.current = onChangePoints;
  const onSelectPinRef = useRef(onSelectPin);
  onSelectPinRef.current = onSelectPin;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const removeModeRef = useRef(removeMode);
  removeModeRef.current = removeMode;

  useEffect(() => {
    if (!isOnline && basemap !== 'offline_grid') {
      setBasemap('offline_grid');
    }
  }, [isOnline, basemap]);

  useEffect(() => {
    if (!satelliteAllowed && basemap === 'satellite') {
      setBasemap(isOnline ? 'street' : 'offline_grid');
    }
  }, [satelliteAllowed, basemap, isOnline]);

  useEffect(() => {
    if (!editable || mode !== 'draw_boundary') {
      setRemoveMode(false);
    }
  }, [editable, mode]);

  // Initialize Leaflet map instance
  useEffect(() => {
    if (basemap === 'offline_grid' || !containerRef.current) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        overlayGroupRef.current = null;
      }
      return;
    }

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        center: [center.lat, center.lng],
        zoom: pointsRef.current.length >= 3 ? 15 : 13,
        zoomControl: true,
      });

      const group = L.layerGroup().addTo(map);
      mapRef.current = map;
      overlayGroupRef.current = group;

      map.on('click', (e: L.LeafletMouseEvent) => {
        if (removeModeRef.current) return;
        const lat = Math.round(e.latlng.lat * 1_000_000) / 1_000_000;
        const lng = Math.round(e.latlng.lng * 1_000_000) / 1_000_000;

        if (modeRef.current === 'pin' && onSelectPinRef.current) {
          onSelectPinRef.current(lat, lng);
          return;
        }

        if (modeRef.current === 'draw_boundary' && editableRef.current && onChangeRef.current) {
          onChangeRef.current([...pointsRef.current, { lat, lng }]);
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        overlayGroupRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap === 'offline_grid']);

  // Update tile layer when street vs satellite switches
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemap === 'offline_grid') return;

    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
      tileLayerRef.current = null;
    }
    setTileWarning(false);

    const streetUrl =
      mappingConfig?.basemaps.streetTileUrl ||
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const satelliteUrl =
      satelliteAllowed && mappingConfig?.basemaps.satelliteTileUrl
        ? mappingConfig.basemaps.satelliteTileUrl
        : satelliteAllowed
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : '';

    const useSatellite = basemap === 'satellite' && satelliteAllowed && Boolean(satelliteUrl);
    const url = useSatellite ? satelliteUrl : streetUrl;
    const attribution = useSatellite
      ? mappingConfig?.basemaps.satelliteAttribution ||
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
      : mappingConfig?.basemaps.streetAttribution || '&copy; OpenStreetMap contributors';

    const layer = L.tileLayer(url, {
      attribution,
      maxZoom: 19,
    });

    let errorCount = 0;
    layer.on('tileerror', () => {
      errorCount += 1;
      if (errorCount >= 3) {
        setTileWarning(true);
      }
    });

    layer.addTo(map);
    tileLayerRef.current = layer;
  }, [basemap, mappingConfig]);

  // Pan map when center changes externally
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemap === 'offline_grid') return;
    if (points.length >= 3) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
        return;
      }
    }
    map.setView([center.lat, center.lng], Math.max(map.getZoom(), 13));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, basemap]);

  // Render polygons, vertices, midpoints, pin, and secondary conflict boundary
  useEffect(() => {
    const map = mapRef.current;
    const group = overlayGroupRef.current;
    if (!map || !group || basemap === 'offline_grid') return;

    group.clearLayers();

    if (secondaryBoundary) {
      const secPoints = geoJsonBoundaryToLatLngPoints(secondaryBoundary);
      if (secPoints.length >= 3) {
        L.polygon(
          secPoints.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: '#B45309',
            weight: 2.5,
            dashArray: '6 4',
            fillColor: '#F59E0B',
            fillOpacity: 0.14,
          }
        )
          .bindTooltip(secondaryLabel)
          .addTo(group);
      }
    }

    if (points.length === 0) {
      L.marker([center.lat, center.lng], { icon: createPinIcon(), interactive: false }).addTo(
        group
      );
      return;
    }

    if (points.length >= 3) {
      L.polygon(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: '#163D31',
          weight: 2.5,
          fillColor: '#2D8A51',
          fillOpacity: 0.24,
        }
      )
        .bindTooltip(primaryLabel)
        .addTo(group);
    } else if (points.length === 2) {
      L.polyline(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#163D31', weight: 2.5, dashArray: '4 4' }
      ).addTo(group);
    }

    if (mode === 'draw_boundary' || points.length > 0) {
      points.forEach((pt, idx) => {
        const canEdit = Boolean(editable && mode === 'draw_boundary');
        const marker = L.marker([pt.lat, pt.lng], {
          icon: createVertexIcon(idx, canEdit, removeMode),
          draggable: canEdit && !removeMode,
        });

        if (canEdit && onChangePoints) {
          marker.on('click', (ev) => {
            if (removeModeRef.current) {
              L.DomEvent.stopPropagation(ev);
              onChangePoints(pointsRef.current.filter((_, i) => i !== idx));
            }
          });

          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            const next = pointsRef.current.map((item, i) =>
              i === idx
                ? {
                    lat: Math.round(pos.lat * 1_000_000) / 1_000_000,
                    lng: Math.round(pos.lng * 1_000_000) / 1_000_000,
                  }
                : item
            );
            onChangePoints(next);
          });

          marker.on('contextmenu', () => {
            if (pointsRef.current.length > 0) {
              onChangePoints(pointsRef.current.filter((_, i) => i !== idx));
            }
          });
        }

        marker.addTo(group);

        if (canEdit && !removeMode && onChangePoints && points.length >= 3) {
          const nextPt = points[(idx + 1) % points.length]!;
          const midLat = Math.round(((pt.lat + nextPt.lat) / 2) * 1_000_000) / 1_000_000;
          const midLng = Math.round(((pt.lng + nextPt.lng) / 2) * 1_000_000) / 1_000_000;
          const midMarker = L.marker([midLat, midLng], {
            icon: createMidpointIcon(),
          });
          midMarker.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            const updated = [...pointsRef.current];
            updated.splice(idx + 1, 0, { lat: midLat, lng: midLng });
            onChangePoints(updated);
          });
          midMarker.addTo(group);
        }
      });
    }
  }, [
    points,
    center.lat,
    center.lng,
    mode,
    editable,
    removeMode,
    secondaryBoundary,
    secondaryLabel,
    primaryLabel,
    basemap,
    onChangePoints,
  ]);

  const liveArea = useMemo(() => {
    const poly = latLngPointsToGeoJsonPolygon(points);
    return poly ? calculateGeoJsonArea(poly) : null;
  }, [points]);

  // Offline SVG coordinate grid projection
  const offlineGridModel = useMemo(() => {
    const secPoints = secondaryBoundary
      ? geoJsonBoundaryToLatLngPoints(secondaryBoundary)
      : [];
    const allPts = [...points, ...secPoints, center];
    const lats = allPts.map((p) => p.lat);
    const lngs = allPts.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.004);
    const spanLng = Math.max(maxLng - minLng, 0.004);
    const padLat = spanLat * 0.28;
    const padLng = spanLng * 0.28;
    const viewMinLat = minLat - padLat;
    const viewMaxLat = maxLat + padLat;
    const viewMinLng = minLng - padLng;
    const viewMaxLng = maxLng + padLng;

    const project = (p: LatLngPoint) => ({
      x: ((p.lng - viewMinLng) / (viewMaxLng - viewMinLng)) * 600,
      y: 360 - ((p.lat - viewMinLat) / (viewMaxLat - viewMinLat)) * 360,
    });

    const unproject = (xPct: number, yPct: number): LatLngPoint => ({
      lng: Math.round((viewMinLng + xPct * (viewMaxLng - viewMinLng)) * 1_000_000) / 1_000_000,
      lat: Math.round((viewMaxLat - yPct * (viewMaxLat - viewMinLat)) * 1_000_000) / 1_000_000,
    });

    return { project, unproject, secPoints };
  }, [points, secondaryBoundary, center]);

  const handleFitBoundary = () => {
    const map = mapRef.current;
    if (!map) return;
    if (points.length >= 2) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
        return;
      }
    }
    map.setView([center.lat, center.lng], 14);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 p-1 bg-canvas rounded-lg border border-border-hairline">
          <button
            type="button"
            onClick={() => setBasemap('street')}
            disabled={!isOnline}
            className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-45 ${
              basemap === 'street' ? 'bg-forest-900 text-white' : 'text-ink-muted'
            }`}
          >
            {mappingConfig?.basemaps.streetTileUrl &&
            !mappingConfig.basemaps.streetTileUrl.includes('openstreetmap.org')
              ? 'Street Map'
              : 'Street (OSM)'}
          </button>
          {satelliteAllowed && (
            <button
              type="button"
              onClick={() => setBasemap('satellite')}
              disabled={!isOnline}
              className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-45 ${
                basemap === 'satellite' ? 'bg-forest-900 text-white' : 'text-ink-muted'
              }`}
            >
              Satellite (Esri)
            </button>
          )}
          <button
            type="button"
            onClick={() => setBasemap('offline_grid')}
            className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
              basemap === 'offline_grid' ? 'bg-forest-900 text-white' : 'text-ink-muted'
            }`}
          >
            Offline Grid
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {basemap !== 'offline_grid' && (
            <button
              type="button"
              onClick={handleFitBoundary}
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-lg border border-border-hairline bg-white text-xs font-medium text-ink hover:bg-canvas whitespace-nowrap cursor-pointer"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              Fit
            </button>
          )}
          {editable && mode === 'draw_boundary' && onChangePoints && (
            <>
              <button
                type="button"
                disabled={points.length === 0}
                onClick={() => setRemoveMode((v) => !v)}
                className={`inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-lg border text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                  removeMode
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-border-hairline bg-white text-ink hover:bg-canvas'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                {removeMode ? 'Tap Corner to Delete' : 'Remove Corner'}
              </button>
              <button
                type="button"
                disabled={points.length === 0}
                onClick={() => onChangePoints(points.slice(0, -1))}
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-lg border border-border-hairline bg-white text-xs font-medium text-ink hover:bg-canvas disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Undo Point
              </button>
              <button
                type="button"
                disabled={points.length === 0}
                onClick={() => {
                  setRemoveMode(false);
                  onChangePoints([]);
                }}
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 py-1 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {tileWarning && basemap !== 'offline_grid' && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-950">
          <span className="flex items-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            Map tiles could not load cleanly. Switch to Offline Grid to inspect or edit coordinates offline.
          </span>
          <button
            type="button"
            onClick={() => setBasemap('offline_grid')}
            className="font-semibold underline whitespace-nowrap cursor-pointer"
          >
            Use Offline Grid
          </button>
        </div>
      )}

      {basemap === 'offline_grid' ? (
        <div
          className={`relative w-full ${heightClass} rounded-xl border border-border-hairline bg-canvas overflow-hidden select-none`}
        >
          <svg
            viewBox="0 0 600 360"
            className="w-full h-full cursor-crosshair"
            onClick={(e) => {
              if (removeMode) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const xPct = (e.clientX - rect.left) / rect.width;
              const yPct = (e.clientY - rect.top) / rect.height;
              const coord = offlineGridModel.unproject(xPct, yPct);
              if (mode === 'pin' && onSelectPin) {
                onSelectPin(coord.lat, coord.lng);
              } else if (mode === 'draw_boundary' && editable && onChangePoints) {
                onChangePoints([...points, coord]);
              }
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <line
                key={`v-${n}`}
                x1={n * 100}
                y1={0}
                x2={n * 100}
                y2={360}
                stroke="#DCE2D5"
                strokeWidth="1"
              />
            ))}
            {[1, 2, 3].map((n) => (
              <line
                key={`h-${n}`}
                x1={0}
                y1={n * 90}
                x2={600}
                y2={n * 90}
                stroke="#DCE2D5"
                strokeWidth="1"
              />
            ))}

            {offlineGridModel.secPoints.length >= 3 && (
              <polygon
                points={offlineGridModel.secPoints
                  .map((p) => {
                    const pt = offlineGridModel.project(p);
                    return `${pt.x},${pt.y}`;
                  })
                  .join(' ')}
                fill="#F59E0B"
                fillOpacity="0.15"
                stroke="#B45309"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            )}

            {points.length >= 3 && (
              <polygon
                points={points
                  .map((p) => {
                    const pt = offlineGridModel.project(p);
                    return `${pt.x},${pt.y}`;
                  })
                  .join(' ')}
                fill="#2D8A51"
                fillOpacity="0.22"
                stroke="#163D31"
                strokeWidth="2.5"
              />
            )}

            {points.length === 2 && (
              <polyline
                points={points
                  .map((p) => {
                    const pt = offlineGridModel.project(p);
                    return `${pt.x},${pt.y}`;
                  })
                  .join(' ')}
                fill="none"
                stroke="#163D31"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
            )}

            {points.map((p, idx) => {
              const pt = offlineGridModel.project(p);
              return (
                <g
                  key={`${p.lat}-${p.lng}-${idx}`}
                  onClick={(ev) => {
                    if (removeMode && editable && mode === 'draw_boundary' && onChangePoints) {
                      ev.stopPropagation();
                      onChangePoints(points.filter((_, i) => i !== idx));
                    }
                  }}
                  style={{ cursor: removeMode ? 'pointer' : 'default' }}
                >
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="11"
                    fill={removeMode ? '#B91C1C' : '#163D31'}
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                  <text
                    x={pt.x}
                    y={pt.y + 3.5}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="10"
                    fontWeight="700"
                  >
                    {removeMode ? '×' : idx + 1}
                  </text>
                </g>
              );
            })}

            {points.length === 0 && (
              <circle
                cx={offlineGridModel.project(center).x}
                cy={offlineGridModel.project(center).y}
                r="8"
                fill="#2D8A51"
                stroke="#FFFFFF"
                strokeWidth="2.5"
              />
            )}
          </svg>

          <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded bg-white/95 border border-border-hairline text-[11px] font-medium text-ink flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-forest-900" />
            Offline WGS84 Grid (No map imagery cached offline) · {center.lat.toFixed(4)},{' '}
            {center.lng.toFixed(4)}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={`w-full ${heightClass} rounded-xl border border-border-hairline overflow-hidden`}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <Crosshair className="w-3.5 h-3.5 text-leaf-600 shrink-0" />
          {mode === 'pin'
            ? 'Click anywhere on the map to set the farm location pin.'
            : removeMode
              ? 'Tap any numbered corner vertex to delete it, or click Remove Corner again to finish.'
              : mode === 'draw_boundary' && editable
                ? 'Click map to add corners, drag numbered corners to adjust, click + to insert midpoints, or use Remove Corner.'
                : 'Interactive boundary preview'}
        </span>
        {liveArea && (
          <span className="font-mono tabular-nums text-ink font-medium">
            Preview: {liveArea.areaAcres.toFixed(2)} ac ({liveArea.areaHectares.toFixed(2)} ha)
          </span>
        )}
      </div>

      <p className="text-[11px] text-ink-muted leading-relaxed">
        {basemap === 'satellite' && satelliteAllowed
          ? 'Satellite tiles: © Esri, Maxar, Earthstar Geographics (prototype evaluation only; commercial ArcGIS terms apply, not guaranteed free/unlimited). Map tiles are not available offline.'
          : basemap === 'street'
            ? mappingConfig?.basemaps.streetTileUrl &&
              !mappingConfig.basemaps.streetTileUrl.includes('openstreetmap.org')
              ? 'Street map tiles: Configured custom street tile provider (see map attribution). Map tiles are not cached offline.'
              : 'Street map tiles: © OpenStreetMap contributors (subject to OSM Tile Usage Policy; not guaranteed free/unlimited). Map tiles are not cached offline.'
            : 'Offline Grid uses cached WGS84 coordinates locally; public OSM/Esri basemap imagery requires network access.'}
      </p>
    </div>
  );
}
