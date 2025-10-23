import React, { useMemo, useState, useRef } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { GeoJSONFeatureCollection } from '../types';
import { createJenksColorExpression, PREVALENCE_COLORS, UNCERTAINTY_COLORS } from '../utils/jenksBreaks';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapViewProps {
  data: GeoJSONFeatureCollection;
  selectedData?: GeoJSONFeatureCollection | null;
  locations?: any | null;
  mode?: 'sampling' | 'prediction' | 'locations';
  highlightRounds?: number[];
  showVisitLocations?: boolean;
  interpolationMode?: 'none' | 'coverage' | 'uncertainty';
  showPixels?: boolean;
  onTogglePixels?: () => void;
  pixelsBounds?: [number, number, number, number] | null;
  onBoundsChange?: (bounds: [number, number, number, number]) => void;
  areaId?: string;
  pixelVersion?: string | null;
  pixelCount?: number;
  onGeneratePixels?: () => void;
}

// Helper function to extract all coordinates from any geometry type
const extractCoordinates = (geometry: any): [number, number][] => {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates as [number, number]];
    case 'Polygon':
      // Flatten the polygon rings
      return geometry.coordinates.flat();
    case 'MultiPolygon':
      // Flatten all polygon rings
      return geometry.coordinates.flat(2);
    case 'LineString':
      return geometry.coordinates;
    case 'MultiLineString':
      return geometry.coordinates.flat();
    default:
      return [];
  }
};

// Helper function to get centroid for popup
const getCentroid = (geometry: any): [number, number] => {
  const coords = extractCoordinates(geometry);
  if (coords.length === 0) return [0, 0];

  const sum = coords.reduce((acc, [lng, lat]) => {
    return [acc[0] + lng, acc[1] + lat];
  }, [0, 0]);

  return [sum[0] / coords.length, sum[1] / coords.length];
};

const MapView: React.FC<MapViewProps> = ({ data, selectedData, locations, mode = 'sampling', highlightRounds = [], showVisitLocations = true, interpolationMode = 'none', showPixels = false, onTogglePixels, pixelsBounds, onBoundsChange, areaId, pixelVersion, pixelCount = 0, onGeneratePixels }) => {
  const [popupInfo, setPopupInfo] = useState<any>(null);
  const [mapStyle, setMapStyle] = useState<string>('mapbox://styles/mapbox/dark-v11');
  const [viewportBounds, setViewportBounds] = useState<[[number, number], [number, number]] | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

  // Use locations data if in locations mode, otherwise use regular data
  const primaryData = mode === 'locations' && locations ? locations : data;

  // Calculate bounds from all features - BEFORE the early return
  // Use ref to store initial bounds so map doesn't recalculate on every render
  const initialBoundsRef = useRef<[[number, number], [number, number]] | undefined>(undefined);

  // Reset bounds when area changes or pixel bounds/count changes to trigger recalculation
  React.useEffect(() => {
    initialBoundsRef.current = undefined;
  }, [areaId, pixelsBounds, pixelCount]);

  const bounds = useMemo(() => {
    // Check if we already calculated bounds (prevents unnecessary recalculations)
    if (initialBoundsRef.current) {
      return initialBoundsRef.current;
    }

    let calculatedBounds: [[number, number], [number, number]] | undefined = undefined;

    // Prioritize pixels bounds when pixels exist
    if (pixelsBounds && pixelsBounds.length === 4 && pixelCount && pixelCount > 0) {
      const [minLng, minLat, maxLng, maxLat] = pixelsBounds;
      const lngPadding = (maxLng - minLng) * 0.1;
      const latPadding = (maxLat - minLat) * 0.1;

      calculatedBounds = [
        [minLng - lngPadding, minLat - latPadding],
        [maxLng + lngPadding, maxLat + latPadding]
      ] as [[number, number], [number, number]];
    }
    // Fall back to calculating bounds from locations
    else if (primaryData && primaryData.features && primaryData.features.length > 0) {
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;

      primaryData.features.forEach((feature: any) => {
        const coords = extractCoordinates(feature.geometry);
        coords.forEach(([lng, lat]) => {
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        });
      });

      // Add padding
      const lngPadding = (maxLng - minLng) * 0.1;
      const latPadding = (maxLat - minLat) * 0.1;

      calculatedBounds = [
        [minLng - lngPadding, minLat - latPadding],
        [maxLng + lngPadding, maxLat + latPadding]
      ] as [[number, number], [number, number]];
    }

    // Store the initial bounds for caching
    if (calculatedBounds) {
      initialBoundsRef.current = calculatedBounds;
    }

    return calculatedBounds;
  }, [primaryData, pixelsBounds, pixelCount]);

  // Extract selected features - BEFORE the early return
  const selectedFeatures = useMemo(() => {
    if (mode === 'locations' && locations && locations.features) {
      // If toggle is off, don't show any selected features
      if (!showVisitLocations) {
        return [];
      }
      // If highlightRounds is specified and has values, only highlight those rounds
      if (highlightRounds && highlightRounds.length > 0) {
        return locations.features.filter(f => {
          const rounds = f.properties?.rounds || [];
          return Array.isArray(rounds) && rounds.some((r: number) => highlightRounds.includes(r));
        });
      }
      // Otherwise, show all points with rounds as selected (green)
      return locations.features.filter(
        f => f.properties?.rounds && Array.isArray(f.properties.rounds) && f.properties.rounds.length > 0
      );
    }
    if (selectedData && selectedData.features) {
      return selectedData.features.filter(
        f => f.properties?.adaptively_selected === 1 || f.properties?.adaptively_selected === true
      );
    }
    if (data && data.features) {
      return data.features.filter(
        f => f.properties?.adaptively_selected === 1 || f.properties?.adaptively_selected === true
      );
    }
    return [];
  }, [data, selectedData, mode, locations, highlightRounds, showVisitLocations]);

  // Use mode prop to determine visualization type
  const isPredictionData = mode === 'prediction';

  // Use prediction data if available, otherwise use input data
  const displayData = selectedData || data;

  // Calculate min and max prevalence values dynamically - BEFORE early return
  const prevalenceRange = useMemo(() => {
    if (!displayData || !displayData.features || !displayData.features.length) return { min: 0, max: 1 };

    let min = Infinity;
    let max = -Infinity;

    displayData.features.forEach(feature => {
      const prevalence = feature.properties?.prevalence_prediction;
      if (typeof prevalence === 'number' && !isNaN(prevalence)) {
        min = Math.min(min, prevalence);
        max = Math.max(max, prevalence);
      }
    });

    // If no valid values found, use defaults
    if (min === Infinity || max === -Infinity) {
      return { min: 0, max: 1 };
    }

    return { min, max };
  }, [displayData]);

  // Calculate coverage range for interpolation
  const coverageRange = useMemo(() => {
    const dataSource = mode === 'locations' && locations ? locations : data;
    if (!dataSource || !dataSource.features || !dataSource.features.length) return { min: 0, max: 1 };

    let min = Infinity;
    let max = -Infinity;

    dataSource.features.forEach(feature => {
      const coverage = feature.properties?.prevalence_prediction;
      if (typeof coverage === 'number' && !isNaN(coverage)) {
        min = Math.min(min, coverage);
        max = Math.max(max, coverage);
      }
    });

    if (min === Infinity || max === -Infinity) {
      return { min: 0, max: 1 };
    }

    return { min, max };
  }, [data, locations, mode]);

  // Calculate uncertainty range for interpolation
  const uncertaintyRange = useMemo(() => {
    const dataSource = mode === 'locations' && locations ? locations : data;
    if (!dataSource || !dataSource.features || !dataSource.features.length) return { min: 0, max: 1 };

    let min = Infinity;
    let max = -Infinity;

    dataSource.features.forEach(feature => {
      const uncertainty = feature.properties?.prevalence_bci_width;
      if (typeof uncertainty === 'number' && !isNaN(uncertainty)) {
        min = Math.min(min, uncertainty);
        max = Math.max(max, uncertainty);
      }
    });

    if (min === Infinity || max === -Infinity) {
      return { min: 0, max: 1 };
    }

    return { min, max };
  }, [data, locations, mode]);

  // Calculate Jenks breaks color expressions for coverage
  const coverageJenksExpression = useMemo(() => {
    const dataSource = mode === 'locations' && locations ? locations : data;
    if (!dataSource || !dataSource.features || !dataSource.features.length) return null;

    const values: number[] = [];
    dataSource.features.forEach(feature => {
      const coverage = feature.properties?.prevalence_prediction;
      if (typeof coverage === 'number' && !isNaN(coverage)) {
        values.push(coverage);
      }
    });

    if (values.length === 0) return null;

    return createJenksColorExpression(values, PREVALENCE_COLORS.length, PREVALENCE_COLORS, 'prevalence_prediction');
  }, [data, locations, mode]);

  // Calculate Jenks breaks color expressions for uncertainty
  const uncertaintyJenksExpression = useMemo(() => {
    const dataSource = mode === 'locations' && locations ? locations : data;
    if (!dataSource || !dataSource.features || !dataSource.features.length) return null;

    const values: number[] = [];
    dataSource.features.forEach(feature => {
      const uncertainty = feature.properties?.prevalence_bci_width;
      if (typeof uncertainty === 'number' && !isNaN(uncertainty)) {
        values.push(uncertainty);
      }
    });

    if (values.length === 0) return null;

    return createJenksColorExpression(values, UNCERTAINTY_COLORS.length, UNCERTAINTY_COLORS, 'prevalence_bci_width');
  }, [data, locations, mode]);

  // Early return AFTER all hooks
  if (!mapboxToken) {
    return (
      <div className="p-4 mb-5 border border-tactical-accent-red bg-tactical-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-tactical-accent-red uppercase">Error:</span>
          <span className="text-xs font-mono text-tactical-accent-red">
            Mapbox token not found. Please create a .env file with VITE_MAPBOX_TOKEN
          </span>
        </div>
      </div>
    );
  }

  const selectedGeoJSON: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: selectedFeatures
  };

  // Heatmap layer for smooth interpolation (used in prediction mode)
  const heatmapLayer: LayerProps = {
    id: 'prediction-heatmap',
    type: 'heatmap',
    paint: {
      // Weight points by their prevalence value
      'heatmap-weight': [
        'interpolate',
        ['linear'],
        ['number', ['coalesce', ['get', 'prevalence_prediction'], 0.5]],
        prevalenceRange.min, 0,
        prevalenceRange.max, 1
      ],
      // Intensity increases with zoom
      'heatmap-intensity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0, 1,
        9, 3
      ],
      // Color ramp for heatmap - matches our point colors
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0, 'rgba(33, 102, 172, 0)',
        0.2, '#2166ac',
        0.35, '#4393c3',
        0.5, '#92c5de',
        0.65, '#fddbc7',
        0.8, '#f4a582',
        0.9, '#d6604d',
        1, '#b2182b'
      ],
      // Radius increases with zoom
      'heatmap-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        0, 15,
        9, 40
      ],
      // Fade out heatmap at higher zooms to show points
      'heatmap-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7, 0.8,
        9, 0
      ]
    }
  };

  // Polygon fill layer for predictions
  const predictionPolygonFillLayer: LayerProps = {
    id: 'prediction-polygons-fill',
    type: 'fill',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['number', ['coalesce', ['get', 'prevalence_prediction'], (prevalenceRange.min + prevalenceRange.max) / 2]],
        prevalenceRange.min, '#2166ac',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.2, '#4393c3',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.35, '#92c5de',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.5, '#fddbc7',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.65, '#f4a582',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.8, '#d6604d',
        prevalenceRange.max, '#b2182b'
      ],
      'fill-opacity': 0.9
    }
  };

  // Polygon outline layer for predictions
  const predictionPolygonOutlineLayer: LayerProps = {
    id: 'prediction-polygons-outline',
    type: 'line',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      'line-color': [
        'interpolate',
        ['linear'],
        ['number', ['coalesce', ['get', 'prevalence_prediction'], (prevalenceRange.min + prevalenceRange.max) / 2]],
        prevalenceRange.min, '#2166ac',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.2, '#4393c3',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.35, '#92c5de',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.5, '#fddbc7',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.65, '#f4a582',
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.8, '#d6604d',
        prevalenceRange.max, '#b2182b'
      ],
      'line-width': 1,
      'line-opacity': 0.9
    }
  };

  // Layer styles for predictions - color by prevalence (for Points)
  // Dynamically adjusted scale based on actual data range
  const predictionLayer: LayerProps = {
    id: 'prediction-points',
    type: 'circle',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7, 1,
        9, 4
      ],
      'circle-color': [
        'interpolate',
        ['linear'],
        ['number', ['coalesce', ['get', 'prevalence_prediction'], (prevalenceRange.min + prevalenceRange.max) / 2]],
        prevalenceRange.min, '#2166ac',    // Low (dark blue)
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.2, '#4393c3',   // Blue
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.35, '#92c5de',  // Light blue
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.5, '#fddbc7',    // Tan/neutral
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.65, '#f4a582',  // Light orange
        prevalenceRange.min + (prevalenceRange.max - prevalenceRange.min) * 0.8, '#d6604d',   // Orange
        prevalenceRange.max, '#b2182b'     // High (red)
      ],
      // Fade in points as heatmap fades out
      'circle-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7, 0,
        9, 0.8
      ],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff'
    }
  };

  // Layer styles for sampling - Polygons
  const allPolygonsFillLayer: LayerProps = {
    id: 'all-polygons-fill',
    type: 'fill',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      'fill-color': interpolationMode === 'coverage' && coverageJenksExpression
        ? coverageJenksExpression
        : interpolationMode === 'uncertainty' && uncertaintyJenksExpression
          ? uncertaintyJenksExpression
          : '#999',
      'fill-opacity': interpolationMode !== 'none' ? 0.9 : 0
    }
  };

  const allPolygonsOutlineLayer: LayerProps = {
    id: 'all-polygons-outline',
    type: 'line',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      'line-color': '#cccccc',
      'line-width': 1,
      'line-opacity': 0.8
    }
  };

  const selectedPolygonsFillLayer: LayerProps = {
    id: 'selected-polygons-fill',
    type: 'fill',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      // When both visit locations AND interpolation are active, make fill transparent
      'fill-color': (showVisitLocations && interpolationMode !== 'none') ? 'rgba(40, 167, 69, 0)' : '#28a745',
      'fill-opacity': (showVisitLocations && interpolationMode !== 'none') ? 0 : 0.95
    }
  };

  const selectedPolygonsOutlineLayer: LayerProps = {
    id: 'selected-polygons-outline',
    type: 'line',
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: {
      'line-color': '#28a745',
      'line-width': 2,
      'line-opacity': 1
    }
  };

  // Layer styles for sampling - Points
  const allPointsLayer: LayerProps = {
    id: 'all-points',
    type: 'circle',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 3,
      // When interpolation is active, make fill transparent to see heatmap underneath
      'circle-color': interpolationMode !== 'none' ? 'rgba(153, 153, 153, 0)' : '#999',
      'circle-opacity': interpolationMode !== 'none' ? 1 : 0.2,
      'circle-stroke-width': interpolationMode !== 'none' ? 1 : 1,
      'circle-stroke-color': interpolationMode !== 'none' ? 'rgba(255, 255, 255, 0.5)' : '#666'
    }
  };

  const selectedPointsLayer: LayerProps = {
    id: 'selected-points',
    type: 'circle',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 3,
      // When both visit locations AND interpolation are active, make fill transparent
      'circle-color': (showVisitLocations && interpolationMode !== 'none') ? 'rgba(40, 167, 69, 0)' : '#28a745',
      'circle-opacity': 1,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#28a745'
    }
  };

  const handleMapClick = (event: any) => {
    const feature = event.features && event.features[0];
    if (feature) {
      const [lng, lat] = getCentroid(feature.geometry);
      setPopupInfo({
        longitude: lng,
        latitude: lat,
        properties: feature.properties
      });
    }
  };

  const handleMapMove = (event: any) => {
    const map = event.target;
    const bounds = map.getBounds();
    if (bounds) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const boundsArray: [[number, number], [number, number]] = [
        [sw.lng, sw.lat],
        [ne.lng, ne.lat]
      ];
      setViewportBounds(boundsArray);

      // Call onBoundsChange if provided (for parent component to track bounds)
      if (onBoundsChange) {
        onBoundsChange([sw.lng, sw.lat, ne.lng, ne.lat]);
      }
    }
  };

  // Create a stable key that changes when bounds significantly change
  // This forces map remount to apply new initialViewState
  const mapKey = bounds ? `map-${bounds[0][0]}-${bounds[0][1]}-${bounds[1][0]}-${bounds[1][1]}` : 'map-globe';

  return (
    <div>
      <div className="relative h-[500px] w-full border-t-0 border-tactical-border-medium bg-tactical-bg-secondary overflow-hidden">
        <Map
          key={mapKey}
          mapboxAccessToken={mapboxToken}
          initialViewState={bounds ? {
            bounds: bounds,
            fitBoundsOptions: { padding: 40 }
          } : {
            longitude: 20,
            latitude: 20,
            zoom: 1.5
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyle}
          projection="globe"
          interactiveLayerIds={isPredictionData
            ? ['prediction-heatmap', 'prediction-points', 'prediction-polygons-fill', 'prediction-polygons-outline']
            : ['all-points', 'selected-points', 'all-polygons-fill', 'selected-polygons-fill']}
          onClick={handleMapClick}
          onMove={handleMapMove}
        >
          <NavigationControl position="bottom-right" showCompass={false} style={{ marginBottom: '32px' }} />

          {isPredictionData && displayData?.features?.length > 0 ? (
            /* Prediction visualization with heatmap interpolation */
            <Source id="prediction-source" type="geojson" data={displayData as any}>
              <Layer {...heatmapLayer} />
              <Layer {...predictionPolygonFillLayer} />
              <Layer {...predictionPolygonOutlineLayer} />
              <Layer {...predictionLayer} />
            </Source>
          ) : !isPredictionData && primaryData?.features?.length > 0 ? (
            <>
              {/* All features layer - colored by coverage or uncertainty when active */}
              <Source id="all-source" type="geojson" data={primaryData as any}>
                <Layer {...allPolygonsFillLayer} />
                <Layer {...allPolygonsOutlineLayer} />
                <Layer {...allPointsLayer} />
              </Source>

              {/* Selected features layer */}
              {selectedFeatures.length > 0 && (
                <Source id="selected-source" type="geojson" data={selectedGeoJSON as any}>
                  <Layer {...selectedPolygonsFillLayer} />
                  <Layer {...selectedPolygonsOutlineLayer} />
                  <Layer {...selectedPointsLayer} />
                </Source>
              )}
            </>
          ) : null}

          {/* Pixels layer from Martin */}
          {showPixels && areaId && (
            <Source
              id="pixels-source"
              type="vector"
              tiles={[`http://localhost:3051/pixels_by_area/{z}/{x}/{y}?area_id=${areaId}&v=${pixelVersion || '0'}`]}
              minzoom={0}
              maxzoom={24}
            >
              <Layer
                id="pixels-fill-layer"
                type="fill"
                source-layer="pixels"
                paint={{
                  'fill-color': 'rgba(40, 167, 69, 0.1)',
                  'fill-opacity': 0.5
                }}
              />
              <Layer
                id="pixels-line-layer"
                type="line"
                source-layer="pixels"
                paint={{
                  'line-color': '#28a745',
                  'line-width': 1,
                  'line-opacity': 0.6
                }}
              />
            </Source>
          )}

          {/* Popup */}
          {popupInfo && (
            <Popup
              longitude={popupInfo.longitude}
              latitude={popupInfo.latitude}
              anchor="bottom"
              onClose={() => setPopupInfo(null)}
              closeButton={true}
              closeOnClick={false}
              className="tactical-popup"
            >
              <div className="bg-tactical-bg-primary border border-tactical-border-medium p-4" style={{ minWidth: '400px', maxWidth: '500px' }}>
                <div className="text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                  Location Properties
                </div>
                <div className="overflow-auto tactical-scrollbar" style={{ maxHeight: '400px' }}>
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(popupInfo.properties || {})
                        .filter(([key]) => key !== 'bbox')
                        .map(([key, value]) => (
                          <tr key={key} className="border-b border-tactical-border-medium">
                            <td className="py-2 pr-4 font-mono font-bold text-tactical-text-muted align-top" style={{ minWidth: '150px' }}>
                              {key}
                            </td>
                            <td className="py-2 font-mono text-tactical-text-secondary break-all">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Popup>
          )}
        </Map>

        {/* Pixels Toggle/Generate Button */}
        {mode === 'locations' && (onTogglePixels || onGeneratePixels) && (
          <div className="absolute top-3 left-3 z-10">
            <button
              onClick={pixelCount > 0 ? onTogglePixels : onGeneratePixels}
              className={`px-3 py-2 font-mono text-xs uppercase tracking-wider border transition-colors ${
                showPixels && pixelCount > 0
                  ? 'bg-tactical-accent-green border-tactical-accent-green text-black'
                  : 'bg-tactical-bg-tertiary border-tactical-border-medium text-tactical-text-primary hover:border-tactical-accent-green'
              }`}
            >
              {pixelCount > 0 ? 'Pixels' : 'Generate Pixels'}
            </button>
          </div>
        )}

        {/* Map Style Selector */}
        <div className="absolute top-3 right-3 bg-tactical-bg-tertiary border border-tactical-border-medium p-2 z-10">
          <div className="mb-1 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
            Map Style
          </div>
          <select
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value)}
            className="w-full px-2 py-1 font-mono text-xs bg-tactical-bg-primary border border-tactical-border-medium text-tactical-text-primary cursor-pointer focus:outline-none focus:border-orange-500"
          >
            <option value="mapbox://styles/mapbox/dark-v11">Dark</option>
            <option value="mapbox://styles/mapbox/light-v11">Light</option>
            <option value="mapbox://styles/mapbox/satellite-streets-v12">Satellite</option>
            <option value="mapbox://styles/mapbox/streets-v12">Streets</option>
          </select>
        </div>

        {/* Legend */}
        <div className="absolute bottom-5 left-5 bg-tactical-bg-tertiary border border-tactical-border-medium p-3 z-10">
          <div className="mb-2 font-mono font-bold text-xs text-tactical-text-primary uppercase tracking-wider">
            Legend
          </div>

          {isPredictionData ? (
            /* Prediction legend */
            <div>
              <div className="mb-2 font-mono text-xs text-tactical-text-muted">
                Predicted Prevalence
              </div>
              <div className="flex flex-col mb-2">
                <span className="font-mono text-xs text-tactical-text-dim mb-1">High</span>
                <div className="h-24 w-5 border border-tactical-border-dark"
                  style={{
                    background: 'linear-gradient(to bottom, #b2182b, #d6604d, #f4a582, #fddbc7, #92c5de, #4393c3, #2166ac)'
                  }}
                ></div>
                <span className="font-mono text-xs text-tactical-text-dim mt-1">Low</span>
              </div>
              <div className="mt-2 font-mono text-xs text-tactical-text-muted">
                {displayData?.features?.length || 0} prediction points
              </div>
            </div>
          ) : interpolationMode === 'coverage' ? (
            /* Coverage interpolation legend */
            <div>
              <div className="mb-2 font-mono text-xs text-tactical-text-muted">
                Coverage (Prevalence)
              </div>
              <div className="flex flex-col mb-2">
                <span className="font-mono text-xs text-tactical-text-dim mb-1">High</span>
                <div className="flex flex-col w-24 border border-tactical-border-dark">
                  {[...PREVALENCE_COLORS].reverse().map((color, idx) => (
                    <div
                      key={idx}
                      className="h-3"
                      style={{ backgroundColor: color }}
                    ></div>
                  ))}
                </div>
                <span className="font-mono text-xs text-tactical-text-dim mt-1">Low</span>
              </div>
              <div className="mt-3 pt-3 border-t border-tactical-border-medium">
                <div className="flex items-center mb-2">
                  <div className="w-3 h-3 rounded-full bg-tactical-text-dim border border-tactical-border-light mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Locations ({primaryData?.features?.length || 0})
                  </span>
                </div>
                {selectedFeatures.length > 0 && (
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full border-2 border-tactical-accent-green mr-2" style={{ backgroundColor: 'transparent' }}></div>
                    <span className="font-mono text-xs text-tactical-text-muted">
                      To visit ({selectedFeatures.length})
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : interpolationMode === 'uncertainty' ? (
            /* Uncertainty interpolation legend */
            <div>
              <div className="mb-2 font-mono text-xs text-tactical-text-muted">
                Uncertainty (BCI Width)
              </div>
              <div className="flex flex-col mb-2">
                <span className="font-mono text-xs text-tactical-text-dim mb-1">Low (High Confidence)</span>
                <div className="flex flex-col w-24 border border-tactical-border-dark">
                  {UNCERTAINTY_COLORS.map((color, idx) => (
                    <div
                      key={idx}
                      className="h-3"
                      style={{ backgroundColor: color }}
                    ></div>
                  ))}
                </div>
                <span className="font-mono text-xs text-tactical-text-dim mt-1">High (Low Confidence)</span>
              </div>
              <div className="mt-3 pt-3 border-t border-tactical-border-medium">
                <div className="flex items-center mb-2">
                  <div className="w-3 h-3 rounded-full bg-tactical-text-dim border border-tactical-border-light mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Locations ({primaryData?.features?.length || 0})
                  </span>
                </div>
                {selectedFeatures.length > 0 && (
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full border-2 border-tactical-accent-green mr-2" style={{ backgroundColor: 'transparent' }}></div>
                    <span className="font-mono text-xs text-tactical-text-muted">
                      To visit ({selectedFeatures.length})
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Sampling legend */
            <>
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full bg-tactical-text-dim border border-tactical-border-light mr-2"></div>
                <span className="font-mono text-xs text-tactical-text-muted">
                  {mode === 'locations' ? 'Locations' : 'All Points'} ({primaryData?.features?.length || 0})
                </span>
              </div>
              {selectedFeatures.length > 0 && (
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-tactical-accent-green border-2 border-tactical-accent-green mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    {mode === 'locations' ? 'Locations to visit' : 'Adaptively Selected'} ({selectedFeatures.length})
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bounding Box Display */}
        {viewportBounds && (
          <div className="absolute bottom-2 right-16 bg-tactical-bg-tertiary border border-tactical-border-medium px-2 py-0.5 z-10">
            <div className="font-mono text-[9px] text-tactical-text-muted select-all cursor-text">
              [{viewportBounds[0][0].toFixed(6)}, {viewportBounds[0][1].toFixed(6)}, {viewportBounds[1][0].toFixed(6)}, {viewportBounds[1][1].toFixed(6)}]
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapView;
