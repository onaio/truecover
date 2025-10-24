import React, { useMemo, useState, useRef } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { GeoJSONFeatureCollection } from '../types';
import { createJenksColorExpression, PREVALENCE_COLORS, UNCERTAINTY_COLORS } from '../utils/jenksBreaks';
import { Geocoder } from '@mapbox/search-js-react';
import mapboxgl from 'mapbox-gl';
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
  indicatorId?: string;
  pixelVersion?: string | null;
  pixelCount?: number;
  onGeneratePixels?: () => void;
  histogramBrushRanges?: [number, number][] | null;
  locationsToVisitCount?: number;
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

const MapView: React.FC<MapViewProps> = ({ data, selectedData, locations, mode = 'sampling', highlightRounds = [], showVisitLocations = true, interpolationMode = 'none', showPixels = false, onTogglePixels, pixelsBounds, onBoundsChange, areaId, indicatorId, pixelVersion, pixelCount = 0, onGeneratePixels, histogramBrushRanges = null, locationsToVisitCount = 0 }) => {
  const [popupInfo, setPopupInfo] = useState<any>(null);
  const [mapStyle, setMapStyle] = useState<string>('mapbox://styles/mapbox/dark-v11');
  const [viewportBounds, setViewportBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [showGeocoderModal, setShowGeocoderModal] = useState<boolean>(false);
  const [tileVersion, setTileVersion] = useState<number>(Date.now());
  const geocoderInputRef = useRef<HTMLDivElement>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

  // Update tile version when filter states change to bust cache
  React.useEffect(() => {
    setTileVersion(Date.now());
  }, [showVisitLocations, interpolationMode, highlightRounds]);

  // Use locations data if in locations mode, otherwise use regular data
  const primaryData = mode === 'locations' && locations ? locations : data;

  // Get location count - handle both lightweight and GeoJSON formats
  const locationCount = useMemo(() => {
    if (mode === 'locations' && locations) {
      return locations.locations?.length || 0;
    }
    return primaryData?.features?.length || 0;
  }, [mode, locations, primaryData]);

  // Calculate bounds from all features - BEFORE the early return
  // Use ref to store initial bounds so map doesn't recalculate on every render
  const initialBoundsRef = useRef<[[number, number], [number, number]] | undefined>(undefined);

  // Reset bounds when area changes or pixel bounds/count changes to trigger recalculation
  React.useEffect(() => {
    initialBoundsRef.current = undefined;
  }, [areaId, pixelsBounds, pixelCount]);

  // Keyboard shortcut for geocoder modal (Cmd+K or Ctrl+K)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowGeocoderModal(prev => !prev);
      }
      if (e.key === 'Escape') {
        setShowGeocoderModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-focus geocoder input when modal opens
  React.useEffect(() => {
    if (showGeocoderModal && geocoderInputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        const input = geocoderInputRef.current?.querySelector('input');
        if (input) {
          input.focus();
        }
      }, 100);
    }
  }, [showGeocoderModal]);

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
    else if (mode === 'locations' && locations && locations.locations && locations.locations.length > 0) {
      // Handle lightweight locations format { locations: [...] }
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;

      locations.locations.forEach((location: any) => {
        if (location.latitude && location.longitude) {
          const lat = location.latitude;
          const lng = location.longitude;
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        }
      });

      // Add padding
      const lngPadding = (maxLng - minLng) * 0.1 || 0.01;
      const latPadding = (maxLat - minLat) * 0.1 || 0.01;

      calculatedBounds = [
        [minLng - lngPadding, minLat - latPadding],
        [maxLng + lngPadding, maxLat + latPadding]
      ] as [[number, number], [number, number]];
    }
    else if (primaryData && primaryData.features && primaryData.features.length > 0) {
      // Handle GeoJSON FeatureCollection format
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
  }, [primaryData, pixelsBounds, pixelCount, locations, mode]);

  // Update map viewport when bounds change (e.g., new area selected or pixels generated)
  React.useEffect(() => {
    if (mapInstance && bounds) {
      mapInstance.fitBounds(bounds, { padding: 40, duration: 1000 });
    }
  }, [mapInstance, bounds, areaId]);

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

  // Use stable map key - let the map update bounds naturally via onMove
  const mapKey = 'main-map';

  // Build histogram filter expression for vector tiles
  const buildHistogramFilter = (geometryFilter: any): any => {
    if (!histogramBrushRanges || histogramBrushRanges.length === 0) {
      return geometryFilter;
    }

    const property = interpolationMode === 'coverage' ? 'prevalence_prediction' : 'prevalence_bci_width';

    // Convert string values to numbers for comparison
    const rangeFilter = ['any', ...histogramBrushRanges.map(([min, max]) =>
      ['all',
        ['>=', ['to-number', ['get', property]], min],
        ['<=', ['to-number', ['get', property]], max]
      ]
    )];

    return ['all', geometryFilter, rangeFilter];
  };

  // Helper to check if a location should be shown based on rounds filter
  // highlightRounds: [] = show all with any rounds, [1,2] = show only locations with round 1 or 2
  const shouldShowLocation = () => {
    if (!showVisitLocations) {
      return true; // Not filtering by rounds
    }

    // No rounds = empty string "{}"
    const hasAnyRounds = ['!=', ['get', 'rounds'], '{}'];

    // If no specific rounds selected, show all locations with any rounds
    if (!highlightRounds || highlightRounds.length === 0) {
      return hasAnyRounds;
    }

    // Check if rounds string contains any of the selected round numbers
    // rounds comes as "{1}" or "{1,2}" string from MVT
    // We need to check if the string contains the round number
    const roundChecks = highlightRounds.map(roundNum =>
      ['in', String(roundNum), ['get', 'rounds']]
    );

    // Return true if rounds contains any of the selected numbers
    if (roundChecks.length === 1) {
      return roundChecks[0];
    }

    return ['any', ...roundChecks];
  };

  // Compute vector tile paint properties
  const getPolygonFillColor = () => {
    if (interpolationMode === 'coverage') {
      const coverageExpression = [
        'interpolate',
        ['linear'],
        ['to-number', ['coalesce', ['get', 'prevalence_prediction'], 0]],
        0, PREVALENCE_COLORS[0],
        0.2, PREVALENCE_COLORS[1],
        0.35, PREVALENCE_COLORS[2],
        0.5, PREVALENCE_COLORS[3],
        0.65, PREVALENCE_COLORS[4],
        0.8, PREVALENCE_COLORS[5],
        1, PREVALENCE_COLORS[6]
      ];

      // When visit locations is toggled, only show coverage for locations with rounds
      // NOTE: rounds comes from MVT as a string like "{}" or "{1,2}", not an array
      if (showVisitLocations) {
        return [
          'case',
          shouldShowLocation(),
          coverageExpression,
          'rgba(153, 153, 153, 0)'
        ];
      }
      return coverageExpression;
    }
    if (interpolationMode === 'uncertainty') {
      const uncertaintyExpression = [
        'interpolate',
        ['linear'],
        ['to-number', ['coalesce', ['get', 'prevalence_bci_width'], 0]],
        0, UNCERTAINTY_COLORS[0],
        0.2, UNCERTAINTY_COLORS[1],
        0.35, UNCERTAINTY_COLORS[2],
        0.5, UNCERTAINTY_COLORS[3],
        0.65, UNCERTAINTY_COLORS[4],
        0.8, UNCERTAINTY_COLORS[5],
        1, UNCERTAINTY_COLORS[6]
      ];

      // When visit locations is toggled, only show uncertainty for locations with rounds
      if (showVisitLocations) {
        return [
          'case',
          shouldShowLocation(),
          uncertaintyExpression,
          'rgba(153, 153, 153, 0)'
        ];
      }
      return uncertaintyExpression;
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        '#28a745',
        'rgba(153, 153, 153, 0)'
      ];
    }
    return 'rgba(153, 153, 153, 0)';
  };

  const getPolygonFillOpacity = () => {
    if (interpolationMode !== 'none') {
      // When visit locations is toggled, only show opacity for locations with rounds
      if (showVisitLocations) {
        return [
          'case',
          shouldShowLocation(),
          0.9,
          0
        ];
      }
      return 0.9;
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        0.95,
        0
      ];
    }
    return 0;
  };

  const getPolygonLineColor = () => {
    if (interpolationMode !== 'none') {
      return '#ffffff';
    }
    // When show visits is off, all borders are white
    if (!showVisitLocations) {
      return '#ffffff';
    }
    // When show visits is on, locations with rounds get green borders
    return [
      'case',
      shouldShowLocation(),
      '#28a745',
      '#ffffff'
    ];
  };

  const getPolygonLineWidth = () => {
    if (interpolationMode !== 'none') {
      return 1;
    }
    return [
      'case',
      shouldShowLocation(),
      2,
      1
    ];
  };

  const getPolygonLineOpacity = () => {
    if (interpolationMode !== 'none') {
      return 0.3;
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        1,
        0.8
      ];
    }
    return 0.8;
  };

  const getPointColor = () => {
    if (interpolationMode === 'coverage') {
      const coverageExpression = [
        'interpolate',
        ['linear'],
        ['to-number', ['coalesce', ['get', 'prevalence_prediction'], 0]],
        0, PREVALENCE_COLORS[0],
        0.2, PREVALENCE_COLORS[1],
        0.35, PREVALENCE_COLORS[2],
        0.5, PREVALENCE_COLORS[3],
        0.65, PREVALENCE_COLORS[4],
        0.8, PREVALENCE_COLORS[5],
        1, PREVALENCE_COLORS[6]
      ];

      // When visit locations is toggled, only show coverage for locations with rounds
      if (showVisitLocations) {
        return [
          'case',
          shouldShowLocation(),
          coverageExpression,
          '#ffffff'
        ];
      }
      return coverageExpression;
    }
    if (interpolationMode === 'uncertainty') {
      const uncertaintyExpression = [
        'interpolate',
        ['linear'],
        ['to-number', ['coalesce', ['get', 'prevalence_bci_width'], 0]],
        0, UNCERTAINTY_COLORS[0],
        0.2, UNCERTAINTY_COLORS[1],
        0.35, UNCERTAINTY_COLORS[2],
        0.5, UNCERTAINTY_COLORS[3],
        0.65, UNCERTAINTY_COLORS[4],
        0.8, UNCERTAINTY_COLORS[5],
        1, UNCERTAINTY_COLORS[6]
      ];

      // When visit locations is toggled, only show uncertainty for locations with rounds
      if (showVisitLocations) {
        return [
          'case',
          shouldShowLocation(),
          uncertaintyExpression,
          '#ffffff'
        ];
      }
      return uncertaintyExpression;
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        '#28a745',
        '#ffffff'
      ];
    }
    return '#ffffff';
  };

  const getPointStrokeWidth = () => {
    if (interpolationMode !== 'none') {
      return 1;
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        2,
        0
      ];
    }
    return 1;
  };

  const getPointStrokeColor = () => {
    if (interpolationMode !== 'none') {
      return 'rgba(255, 255, 255, 0.5)';
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        '#28a745',
        'rgba(0, 0, 0, 0)'
      ];
    }
    return '#ffffff';
  };

  const getPointOpacity = () => {
    if (interpolationMode !== 'none') {
      return 0.8;
    }
    if (showVisitLocations) {
      return [
        'case',
        shouldShowLocation(),
        1,
        0
      ];
    }
    return 0.8;
  };

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
            : mode === 'locations' && areaId && indicatorId
              ? ['locations-points', 'locations-polygons-fill', 'locations-polygons-outline']
              : ['all-points', 'selected-points', 'all-polygons-fill', 'selected-polygons-fill']}
          onClick={handleMapClick}
          onMove={handleMapMove}
          onLoad={(e) => setMapInstance(e.target)}
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
          ) : !isPredictionData && mode === 'locations' && areaId && indicatorId ? (
            <>
              {/* Vector tiles for locations - use when we have IDs and no GeoJSON override */}
              <Source
                key={`locations-source-${tileVersion}`}
                id="locations-source"
                type="vector"
                tiles={[`http://localhost:3051/locations_by_area/{z}/{x}/{y}?area_id=${areaId}&indicator_id=${indicatorId}`]}
                minzoom={0}
                maxzoom={24}
              >
                {/* Polygon fill layer with conditional styling */}
                <Layer
                  key={`locations-polygons-fill-${tileVersion}`}
                  id="locations-polygons-fill"
                  type="fill"
                  source-layer="locations"
                  filter={buildHistogramFilter(['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]])}
                  paint={{
                    'fill-color': getPolygonFillColor(),
                    'fill-opacity': getPolygonFillOpacity()
                  }}
                />

                {/* Polygon outline layer */}
                <Layer
                  key={`locations-polygons-outline-${tileVersion}`}
                  id="locations-polygons-outline"
                  type="line"
                  source-layer="locations"
                  filter={buildHistogramFilter(['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]])}
                  paint={{
                    'line-color': getPolygonLineColor(),
                    'line-width': getPolygonLineWidth(),
                    'line-opacity': getPolygonLineOpacity()
                  }}
                />

                {/* Point layer with conditional styling */}
                <Layer
                  key={`locations-points-${tileVersion}`}
                  id="locations-points"
                  type="circle"
                  source-layer="locations"
                  filter={buildHistogramFilter(['==', ['geometry-type'], 'Point'])}
                  paint={{
                    'circle-radius': 3,
                    'circle-color': getPointColor(),
                    'circle-opacity': getPointOpacity(),
                    'circle-stroke-width': getPointStrokeWidth(),
                    'circle-stroke-color': getPointStrokeColor()
                  }}
                />
              </Source>
            </>
          ) : !isPredictionData && primaryData?.features?.length > 0 ? (
            <>
              {/* GeoJSON fallback - used for histogram filtering or when vector tiles not available */}
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
                  'fill-color': mapStyle === 'mapbox://styles/mapbox/satellite-streets-v12'
                    ? 'rgba(255, 255, 255, 0.1)'
                    : 'rgba(40, 167, 69, 0.1)',
                  'fill-opacity': 0.5
                }}
              />
              <Layer
                id="pixels-line-layer"
                type="line"
                source-layer="pixels"
                paint={{
                  'line-color': mapStyle === 'mapbox://styles/mapbox/satellite-streets-v12'
                    ? '#ffffff'
                    : '#28a745',
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
                  <div className="w-3 h-3 rounded-full bg-white border border-tactical-border-light mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Locations ({locationCount})
                  </span>
                </div>
                {mode === 'locations' && locationsToVisitCount > 0 && (
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full border-2 border-tactical-accent-green mr-2" style={{ backgroundColor: 'transparent' }}></div>
                    <span className="font-mono text-xs text-tactical-text-muted">
                      To visit ({locationsToVisitCount})
                    </span>
                  </div>
                )}
                {mode !== 'locations' && selectedFeatures.length > 0 && (
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
                  <div className="w-3 h-3 rounded-full bg-white border border-tactical-border-light mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Locations ({locationCount})
                  </span>
                </div>
                {mode === 'locations' && locationsToVisitCount > 0 && (
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full border-2 border-tactical-accent-green mr-2" style={{ backgroundColor: 'transparent' }}></div>
                    <span className="font-mono text-xs text-tactical-text-muted">
                      To visit ({locationsToVisitCount})
                    </span>
                  </div>
                )}
                {mode !== 'locations' && selectedFeatures.length > 0 && (
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
                <div className="w-3 h-3 rounded-full bg-white border border-tactical-border-light mr-2"></div>
                <span className="font-mono text-xs text-tactical-text-muted">
                  {mode === 'locations' ? 'Locations' : 'All Points'} ({locationCount})
                </span>
              </div>
              {mode === 'locations' && locationsToVisitCount > 0 && (
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-tactical-accent-green border-2 border-tactical-accent-green mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Locations to visit ({locationsToVisitCount})
                  </span>
                </div>
              )}
              {mode !== 'locations' && selectedFeatures.length > 0 && (
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-tactical-accent-green border-2 border-tactical-accent-green mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Adaptively Selected ({selectedFeatures.length})
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

        {/* Geocoder Modal */}
        {showGeocoderModal && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black bg-opacity-75"
            onClick={() => setShowGeocoderModal(false)}
          >
            <div
              className="bg-black border border-tactical-border-medium p-4 shadow-2xl"
              style={{ width: '600px', maxWidth: '90vw' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="font-mono font-bold text-sm text-tactical-text-primary uppercase tracking-wider">
                  Search Location
                </div>
                <div className="font-mono text-xs text-tactical-text-muted">
                  Press ESC to close
                </div>
              </div>
              <div className="geocoder-tactical-wrapper" ref={geocoderInputRef}>
                <Geocoder
                  accessToken={mapboxToken}
                  map={mapInstance}
                  mapboxgl={mapboxgl}
                  marker={true}
                  placeholder="Search for a place..."
                  onRetrieve={() => setShowGeocoderModal(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Geocoder Custom Styling */}
        <style>{`
          /* Hide the search icon */
          .geocoder-tactical-wrapper svg,
          .geocoder-tactical-wrapper [class*="Icon"],
          .geocoder-tactical-wrapper [class*="icon"] {
            display: none !important;
          }
          .geocoder-tactical-wrapper input {
            font-family: ui-monospace, monospace !important;
            font-size: 16px !important;
            padding: 12px 16px !important;
            background-color: #000000 !important;
            border: 1px solid #404040 !important;
            color: #ffffff !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
          .geocoder-tactical-wrapper input:focus {
            outline: none !important;
            border-color: #ff6b35 !important;
          }
          .geocoder-tactical-wrapper input::placeholder {
            color: #808080 !important;
            font-family: ui-monospace, monospace !important;
          }
          /* Dropdown container */
          .geocoder-tactical-wrapper [role="listbox"],
          .geocoder-tactical-wrapper ul,
          .geocoder-tactical-wrapper div[class*="Suggestion"],
          .geocoder-tactical-wrapper div[class*="suggestion"] {
            background-color: #000000 !important;
            border: 1px solid #404040 !important;
            font-family: ui-monospace, monospace !important;
            font-size: 14px !important;
            margin-top: 8px !important;
            max-height: 400px !important;
            overflow-y: auto !important;
            padding: 8px !important;
          }

          /* Dropdown items */
          .geocoder-tactical-wrapper [role="option"],
          .geocoder-tactical-wrapper li,
          .geocoder-tactical-wrapper div[class*="Result"],
          .geocoder-tactical-wrapper div[class*="result"],
          .geocoder-tactical-wrapper [role="listbox"] > div,
          .geocoder-tactical-wrapper ul > li {
            padding: 10px 12px !important;
            color: #ffffff !important;
            border: none !important;
            border-top: none !important;
            border-left: none !important;
            border-right: none !important;
            border-bottom: none !important;
            font-family: ui-monospace, monospace !important;
            background-color: #000000 !important;
            box-shadow: none !important;
            margin-bottom: 10px !important;
            outline: none !important;
          }

          /* Force remove borders from ALL child elements within results */
          .geocoder-tactical-wrapper [role="option"] > *,
          .geocoder-tactical-wrapper li > * {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
          }

          /* All text within dropdown items - default white */
          .geocoder-tactical-wrapper [role="option"]:not(:hover):not([aria-selected="true"]) *,
          .geocoder-tactical-wrapper li:not(:hover):not([aria-selected="true"]) *,
          .geocoder-tactical-wrapper div[class*="Result"] *,
          .geocoder-tactical-wrapper div[class*="result"] *,
          .geocoder-tactical-wrapper [class*="name"],
          .geocoder-tactical-wrapper [class*="address"],
          .geocoder-tactical-wrapper strong,
          .geocoder-tactical-wrapper span,
          .geocoder-tactical-wrapper div {
            color: #ffffff !important;
            font-family: ui-monospace, monospace !important;
            background-color: transparent !important;
            border: none !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* Hover and keyboard selected states - orange text */
          .geocoder-tactical-wrapper [role="option"]:hover,
          .geocoder-tactical-wrapper [role="option"][aria-selected="true"],
          .geocoder-tactical-wrapper li:hover,
          .geocoder-tactical-wrapper li[aria-selected="true"] {
            background-color: #000000 !important;
            border: none !important;
            color: #ff6b35 !important;
          }

          /* Make ALL child elements orange on hover/selected */
          .geocoder-tactical-wrapper [role="option"]:hover *,
          .geocoder-tactical-wrapper [role="option"][aria-selected="true"] *,
          .geocoder-tactical-wrapper li:hover *,
          .geocoder-tactical-wrapper li[aria-selected="true"] * {
            color: #ff6b35 !important;
          }

          .geocoder-tactical-wrapper li:last-child,
          .geocoder-tactical-wrapper [role="option"]:last-child {
            margin-bottom: 0 !important;
          }

          /* Remove all default styling from nested elements */
          .geocoder-tactical-wrapper * {
            box-sizing: border-box !important;
          }

          .geocoder-tactical-wrapper [role="listbox"] > *,
          .geocoder-tactical-wrapper ul > * {
            list-style: none !important;
          }

          /* Footer attribution */
          .geocoder-tactical-wrapper [class*="Attribution"],
          .geocoder-tactical-wrapper [class*="attribution"],
          .geocoder-tactical-wrapper [class*="powered"] {
            background-color: #000000 !important;
            color: #808080 !important;
            border-top: 1px solid #404040 !important;
            padding: 8px 16px !important;
            font-family: ui-monospace, monospace !important;
            font-size: 10px !important;
          }
        `}</style>
      </div>
    </div>
  );
};

export default MapView;
