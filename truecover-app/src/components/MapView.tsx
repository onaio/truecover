import React, { useMemo, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { GeoJSONFeatureCollection } from '../types';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapViewProps {
  data: GeoJSONFeatureCollection;
  selectedData?: GeoJSONFeatureCollection | null;
  locations?: any | null;
  mode?: 'sampling' | 'prediction' | 'locations';
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

const MapView: React.FC<MapViewProps> = ({ data, selectedData, locations, mode = 'sampling' }) => {
  const [popupInfo, setPopupInfo] = useState<any>(null);
  const [mapStyle, setMapStyle] = useState<string>('mapbox://styles/mapbox/dark-v11');
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

  // Use locations data if in locations mode, otherwise use regular data
  const primaryData = mode === 'locations' && locations ? locations : data;

  // Calculate bounds from all features - BEFORE the early return
  const bounds = useMemo(() => {
    if (!primaryData || !primaryData.features || !primaryData.features.length) return undefined;

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

    return [
      [minLng - lngPadding, minLat - latPadding],
      [maxLng + lngPadding, maxLat + latPadding]
    ] as [[number, number], [number, number]];
  }, [primaryData]);

  // Extract selected features - BEFORE the early return
  const selectedFeatures = useMemo(() => {
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
  }, [data, selectedData]);

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

  if (!data || !data.features) {
    return (
      <div className="p-4 mb-5 border border-tactical-accent-red bg-tactical-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-tactical-accent-red uppercase">Error:</span>
          <span className="text-xs font-mono text-tactical-accent-red">
            No data provided to MapView component
          </span>
        </div>
      </div>
    );
  }

  const selectedGeoJSON: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: selectedFeatures
  };

  // Heatmap layer for smooth interpolation
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
      'fill-color': '#999',
      'fill-opacity': 0
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
      'fill-color': '#28a745',
      'fill-opacity': 0.95
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
      'circle-color': '#999',
      'circle-opacity': 0.2,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#666'
    }
  };

  const selectedPointsLayer: LayerProps = {
    id: 'selected-points',
    type: 'circle',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 3,
      'circle-color': '#28a745',
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

  return (
    <div className="mb-6">
      <h3 className="font-mono text-sm font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
        Map Visualization
      </h3>
      <div className="relative h-[500px] w-full border border-tactical-border-medium bg-tactical-bg-secondary overflow-hidden">
        <Map
          mapboxAccessToken={mapboxToken}
          initialViewState={{
            bounds: bounds,
            fitBoundsOptions: { padding: 40 }
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyle}
          interactiveLayerIds={isPredictionData
            ? ['prediction-heatmap', 'prediction-points', 'prediction-polygons-fill', 'prediction-polygons-outline']
            : ['all-points', 'selected-points', 'all-polygons-fill', 'selected-polygons-fill']}
          onClick={handleMapClick}
        >
          <NavigationControl position="bottom-right" />

          {isPredictionData ? (
            /* Prediction visualization with heatmap interpolation */
            <Source id="prediction-source" type="geojson" data={displayData as any}>
              <Layer {...heatmapLayer} />
              <Layer {...predictionPolygonFillLayer} />
              <Layer {...predictionPolygonOutlineLayer} />
              <Layer {...predictionLayer} />
            </Source>
          ) : (
            <>
              {/* All features layer */}
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
            >
              <div style={{ maxWidth: '200px', fontSize: '12px' }}>
                <strong>Properties:</strong>
                <pre style={{
                  marginTop: '5px',
                  fontSize: '11px',
                  maxHeight: '150px',
                  overflow: 'auto',
                  backgroundColor: '#f5f5f5',
                  padding: '5px',
                  borderRadius: '3px'
                }}>
                  {JSON.stringify(popupInfo.properties, null, 2)}
                </pre>
              </div>
            </Popup>
          )}
        </Map>

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
              <div className="h-24 w-5 mb-2 border border-tactical-border-dark"
                style={{
                  background: 'linear-gradient(to top, #2166ac, #4393c3, #92c5de, #fddbc7, #f4a582, #d6604d, #b2182b)'
                }}
              ></div>
              <div className="flex justify-between font-mono text-xs text-tactical-text-dim">
                <span>Low</span>
                <span>High</span>
              </div>
              <div className="mt-2 font-mono text-xs text-tactical-text-muted">
                {displayData.features.length} prediction points
              </div>
            </div>
          ) : (
            /* Sampling legend */
            <>
              <div className="flex items-center mb-2">
                <div className="w-3 h-3 rounded-full bg-tactical-text-dim border border-tactical-border-light mr-2"></div>
                <span className="font-mono text-xs text-tactical-text-muted">
                  All Points ({data.features.length})
                </span>
              </div>
              {selectedFeatures.length > 0 && (
                <div className="flex items-center">
                  <div className="w-4 h-4 rounded-full bg-tactical-accent-green border-2 border-tactical-accent-green mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Adaptively Selected ({selectedFeatures.length})
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MapView;
