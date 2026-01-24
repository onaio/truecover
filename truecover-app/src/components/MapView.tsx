import React, { useMemo, useState, useRef, useEffect } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { GeoJSONFeatureCollection } from '../types';
import { createJenksColorExpression, PREVALENCE_COLORS, UNCERTAINTY_COLORS, METADATA_COLORS } from '../utils/jenksBreaks';
import { Geocoder } from '@mapbox/search-js-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
// @ts-ignore
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { useAuth } from '@clerk/clerk-react';
import { adminBoundariesApi, pixelsApi } from '../services/api';
import { useGeneratePixels } from '../hooks/usePixels';
import { tacticalToast } from '../tactical-ui';

interface CampaignArea {
  id: string;
  name: string | null;
  admin_boundary_name: string | null;
  geometry: any | null;
}

interface MapViewProps {
  data: GeoJSONFeatureCollection;
  selectedData?: GeoJSONFeatureCollection | null;
  locations?: any | null;
  mode?: 'sampling' | 'prediction' | 'locations';
  highlightRounds?: number[];
  showSampled?: boolean;
  onToggleSampled?: () => void;
  interpolationMode?: 'none' | 'coverage' | 'uncertainty' | 'metadata';
  selectedMetadataField?: string;
  metadataVisualizationMode?: 'fill' | 'circle';
  showPixels?: boolean;
  onTogglePixels?: () => void;
  pixelsBounds?: [number, number, number, number] | null;
  onBoundsChange?: (bounds: [number, number, number, number]) => void;
  campaignId?: string;
  indicatorId?: string;
  pixelVersion?: string | null;
  pixelCount?: number;
  onGeneratePixels?: () => void;
  histogramBrushRanges?: [number, number][] | null;
  histogramDataType?: 'locations' | 'pixels';
  sampledItemsCount?: number;
  planningMode?: boolean;
  campaignAreas?: CampaignArea[];
  showCampaignAreas?: boolean;
  onToggleCampaignAreas?: () => void;
  onAddAdminBoundaryToCampaign?: (id: string, pcode: string, name: string, geometry?: any) => void;
  selectedAreaBounds?: [[number, number], [number, number]] | null;
  className?: string;
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

const MARTIN_URL = import.meta.env.VITE_MARTIN_URL || 'http://localhost:3052';

const MapView: React.FC<MapViewProps> = ({ data, selectedData, locations, mode = 'sampling', highlightRounds = [], showSampled = true, onToggleSampled, interpolationMode = 'none', selectedMetadataField = '', metadataVisualizationMode = 'fill', showPixels = false, onTogglePixels, pixelsBounds, onBoundsChange, campaignId, indicatorId, pixelVersion, pixelCount = 0, onGeneratePixels, histogramBrushRanges = null, histogramDataType = 'locations', sampledItemsCount = 0, planningMode = false, campaignAreas = [], showCampaignAreas = true, onToggleCampaignAreas, onAddAdminBoundaryToCampaign, selectedAreaBounds, className }) => {
  const [popupInfo, setPopupInfo] = useState<any>(null);
  const [mapStyle, setMapStyle] = useState<string>('mapbox://styles/mapbox/dark-v11');
  const [viewportBounds, setViewportBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [showGeocoderModal, setShowGeocoderModal] = useState<boolean>(false);
  const [tileVersion, setTileVersion] = useState<number>(Date.now());
  const [currentZoom, setCurrentZoom] = useState<number>(1.5);
  const [visibleAdminLevels, setVisibleAdminLevels] = useState<number[]>([0, 1, 2, 3, 4]);
  const [hoveredAdminId, setHoveredAdminId] = useState<string | null>(null);
  const [showBuildings, setShowBuildings] = useState<boolean>(true);
  const [adminBoundariesCollapsed, setAdminBoundariesCollapsed] = useState<boolean>(true);
  const [showPixelGenerateModal, setShowPixelGenerateModal] = useState<boolean>(false);
  const [pendingAdminPixelGen, setPendingAdminPixelGen] = useState<{
    pcode: string;
    name: string;
    bbox: [number, number, number, number];
    geometry?: any;
  } | null>(null);
  const [populationSummary, setPopulationSummary] = useState<{
    pixel_count: number;
    total_population: number;
    avg_population: number;
    pixels_with_data: number;
  } | null>(null);
  const [loadingPopulation, setLoadingPopulation] = useState<boolean>(false);
  const [drawnFeature, setDrawnFeature] = useState<any>(null);
  const drawControlRef = useRef<MapboxDraw | null>(null);
  const geocoderInputRef = useRef<HTMLDivElement>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;

  const { getToken } = useAuth();
  const generatePixelsMutation = useGeneratePixels();

  // Update tile version when filter states change to bust cache
  React.useEffect(() => {
    setTileVersion(Date.now());
  }, [showSampled, interpolationMode, highlightRounds, selectedMetadataField, metadataVisualizationMode, visibleAdminLevels]);

  // Use locations data if in locations mode, otherwise use regular data
  const primaryData = mode === 'locations' && locations ? locations : data;

  // Get location count - handle both lightweight and GeoJSON formats
  const locationCount = useMemo(() => {
    if (mode === 'locations' && locations) {
      return locations.locations?.length || 0;
    }
    return primaryData?.features?.length || 0;
  }, [mode, locations, primaryData]);

  // Convert campaign areas to GeoJSON for map display
  const campaignAreasGeoJSON = useMemo(() => {
    if (!campaignAreas || campaignAreas.length === 0) {
      return { type: 'FeatureCollection' as const, features: [] };
    }

    const features = campaignAreas
      .filter(area => area.geometry)
      .map(area => ({
        type: 'Feature' as const,
        id: area.id,
        properties: {
          id: area.id,
          name: area.name || area.admin_boundary_name || 'Unnamed Area',
        },
        geometry: area.geometry,
      }));

    return { type: 'FeatureCollection' as const, features };
  }, [campaignAreas]);

  // Calculate bounds from all features - BEFORE the early return
  // Use ref to store initial bounds so map doesn't recalculate on every render
  const initialBoundsRef = useRef<[[number, number], [number, number]] | undefined>(undefined);

  // Reset bounds when area changes or pixel bounds/count changes to trigger recalculation
  React.useEffect(() => {
    initialBoundsRef.current = undefined;
  }, [campaignId, pixelsBounds, pixelCount]);

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

  // Setup draw controls when in planning mode
  useEffect(() => {
    if (!mapInstance) return;

    if (planningMode) {
      // Initialize draw control if not already created
      if (!drawControlRef.current) {
        const draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: {
            polygon: true,
            trash: true
          },
          defaultMode: 'simple_select'
        });

        drawControlRef.current = draw;
        mapInstance.addControl(draw, 'top-right');

        // Handle draw.create event
        const handleDrawCreate = (e: any) => {
          const feature = e.features[0];
          setDrawnFeature(feature);
        };

        // Handle draw.delete event
        const handleDrawDelete = () => {
          setDrawnFeature(null);
          setPopupInfo(null);
        };

        // Handle draw.update event
        const handleDrawUpdate = (e: any) => {
          const feature = e.features[0];
          setDrawnFeature(feature);
        };

        // Handle draw.selectionchange event - show popup when drawn feature is selected
        const handleDrawSelectionChange = (e: any) => {
          if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            const [lng, lat] = getCentroid(feature.geometry);
            setPopupInfo({
              longitude: lng,
              latitude: lat,
              properties: {
                isDrawnFeature: true,
                name: 'Drawn Area'
              }
            });
            setPopulationSummary(null);
            setLoadingPopulation(false);
          }
        };

        mapInstance.on('draw.create', handleDrawCreate);
        mapInstance.on('draw.delete', handleDrawDelete);
        mapInstance.on('draw.update', handleDrawUpdate);
        mapInstance.on('draw.selectionchange', handleDrawSelectionChange);
      }
    } else {
      // Remove draw control when exiting planning mode
      if (drawControlRef.current) {
        mapInstance.removeControl(drawControlRef.current);
        drawControlRef.current = null;
        setDrawnFeature(null);
      }
    }

    return () => {
      if (drawControlRef.current && mapInstance) {
        try {
          mapInstance.removeControl(drawControlRef.current);
        } catch (e) {
          // Control may already be removed
        }
        drawControlRef.current = null;
      }
    };
  }, [mapInstance, planningMode]);

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
  }, [mapInstance, bounds, campaignId]);

  // Zoom to selected area bounds when area filter changes
  React.useEffect(() => {
    if (mapInstance && selectedAreaBounds) {
      mapInstance.fitBounds(selectedAreaBounds, { padding: 40, duration: 1000 });
    }
  }, [mapInstance, selectedAreaBounds]);

  // Extract selected features - BEFORE the early return
  const selectedFeatures = useMemo(() => {
    if (mode === 'locations' && locations && locations.features) {
      // If toggle is off, don't show any selected features
      if (!showSampled) {
        return [];
      }
      // If highlightRounds is specified and has values, only highlight those rounds
      if (highlightRounds && highlightRounds.length > 0) {
        return locations.features.filter((f: any) => {
          const rounds = f.properties?.rounds || [];
          return Array.isArray(rounds) && rounds.some((r: number) => highlightRounds.includes(r));
        });
      }
      // Otherwise, show all points with rounds as selected (green)
      return locations.features.filter(
        (f: any) => f.properties?.rounds && Array.isArray(f.properties.rounds) && f.properties.rounds.length > 0
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
  }, [data, selectedData, mode, locations, highlightRounds, showSampled]);

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

  // Calculate Jenks breaks color expressions for coverage
  const coverageJenksExpression = useMemo(() => {
    const dataSource = mode === 'locations' && locations ? locations : data;
    if (!dataSource || !dataSource.features || !dataSource.features.length) return null;

    const values: number[] = [];
    dataSource.features.forEach((feature: any) => {
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
    dataSource.features.forEach((feature: any) => {
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
      'fill-color': (showSampled && interpolationMode !== 'none') ? 'rgba(40, 167, 69, 0)' : '#28a745',
      'fill-opacity': (showSampled && interpolationMode !== 'none') ? 0 : 0.95
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
    minzoom: 10,
    maxzoom: 22,
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
    minzoom: 10,
    maxzoom: 22,
    paint: {
      'circle-radius': 3,
      // When both visit locations AND interpolation are active, make fill transparent
      'circle-color': (showSampled && interpolationMode !== 'none') ? 'rgba(40, 167, 69, 0)' : '#28a745',
      'circle-opacity': 1,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#28a745'
    }
  };

  const handleMapClick = (event: any) => {
    const features = event.features || [];

    // Check if draw control is in drawing mode - if so, skip all click handling
    if (drawControlRef.current) {
      const mode = drawControlRef.current.getMode();
      if (mode === 'draw_polygon') {
        return; // Don't handle clicks while actively drawing
      }
    }

    // Check if clicked on drawn feature first
    const drawnFeatures = features.filter((f: any) =>
      f.source && (f.source.includes('mapbox-gl-draw') || f.layer?.id?.includes('gl-draw'))
    );

    if (drawnFeatures.length > 0 && drawnFeature && planningMode) {
      // Clicked on drawn feature - show popup with options
      const [lng, lat] = getCentroid(drawnFeature.geometry);
      setPopupInfo({
        longitude: lng,
        latitude: lat,
        properties: {
          isDrawnFeature: true,
          name: 'Drawn Area'
        }
      });
      setPopulationSummary(null);
      setLoadingPopulation(false);
      return;
    }

    // Prioritize admin boundaries - find the one with the highest level (most detailed)
    const adminBoundaries = features.filter((f: any) => {
      if (f.sourceLayer?.startsWith('admin_boundaries_adm') || f.sourceLayer === 'admin_boundaries') {
        // Extract level from source layer name if not in properties (for pmtiles)
        if (f.properties?.level === undefined && f.sourceLayer?.startsWith('admin_boundaries_adm')) {
          const levelMatch = f.sourceLayer.match(/adm(\d+)$/);
          if (levelMatch) {
            f.properties.level = parseInt(levelMatch[1], 10);
          }
        }
        return f.properties?.level !== undefined;
      }
      return false;
    });

    let selectedFeature;
    if (adminBoundaries.length > 0) {
      // Sort by level descending (highest level = most detailed)
      adminBoundaries.sort((a: any, b: any) => b.properties.level - a.properties.level);
      selectedFeature = adminBoundaries[0];
    } else {
      // Fall back to first feature
      selectedFeature = features[0];
    }

    if (selectedFeature) {
      const [lng, lat] = getCentroid(selectedFeature.geometry);
      setPopupInfo({
        longitude: lng,
        latitude: lat,
        properties: selectedFeature.properties
      });

      // Fetch population summary if this is an admin boundary
      if (selectedFeature.properties?.level !== undefined) {
        const level = selectedFeature.properties.level;
        const pcode = selectedFeature.properties[`ADM${level}_PCODE`];

        if (pcode) {
          setLoadingPopulation(true);
          setPopulationSummary(null);

          getToken().then(token => {
            if (token) {
              adminBoundariesApi.getPixelSummary(pcode, token)
                .then(summary => {
                  setPopulationSummary(summary);
                  setLoadingPopulation(false);
                })
                .catch(error => {
                  console.error('Error fetching population summary:', error);
                  setLoadingPopulation(false);
                });
            }
          });
        }
      } else {
        setPopulationSummary(null);
        setLoadingPopulation(false);
      }
    }
  };

  const handleMapMove = (event: any) => {
    const map = event.target;
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    setCurrentZoom(zoom);

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

  const handleConfirmPixelGeneration = async () => {
    if (!pendingAdminPixelGen || !campaignId) return;

    try {
      const token = await getToken();
      if (!token) {
        tacticalToast.error('Authentication Required', 'Please sign in to generate pixels');
        return;
      }

      // Start the workflow
      const response = await pixelsApi.generate(
        campaignId,
        pendingAdminPixelGen.bbox,
        18,
        token,
        true, // append
        pendingAdminPixelGen.pcode,
        pendingAdminPixelGen.geometry
      );

      // Close modal immediately
      setShowPixelGenerateModal(false);
      setPendingAdminPixelGen(null);
      setPopupInfo(null);

      // Show info toast that generation started
      tacticalToast.info(
        'Pixel Generation Started',
        `Generating pixels for ${pendingAdminPixelGen.name}...`
      );

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const status = await pixelsApi.getGenerationStatus(response.workflow_id, token);

          if (status.status === 'completed' && status.result) {
            clearInterval(pollInterval);
            tacticalToast.success(
              'Pixels Generated',
              `Created ${status.result.count.toLocaleString()} pixels for ${pendingAdminPixelGen.name}`
            );
            // Trigger parent refresh
            if (onGeneratePixels) {
              onGeneratePixels();
            }
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            tacticalToast.error(
              'Generation Failed',
              status.error || 'Pixel generation failed'
            );
          }
        } catch (err) {
          console.error('Failed to check workflow status:', err);
        }
      }, 2000);

      // Clean up interval after 10 minutes (failsafe)
      setTimeout(() => clearInterval(pollInterval), 600000);

    } catch (error: any) {
      console.error('Failed to start pixel generation:', error);
      tacticalToast.error(
        'Generation Failed',
        error.response?.data?.error || 'Failed to start pixel generation'
      );
    }
  };

  // Use stable map key - let the map update bounds naturally via onMove
  const mapKey = 'main-map';

  // Build histogram filter expression for vector tiles (locations)
  const buildHistogramFilter = (geometryFilter: any): any => {
    // Only apply histogram filter to locations when histogramDataType is 'locations'
    if (!histogramBrushRanges || histogramBrushRanges.length === 0 || histogramDataType !== 'locations') {
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

  // Build histogram filter expression for pixels
  const buildPixelHistogramFilter = (): any => {
    // Only apply histogram filter to pixels when histogramDataType is 'pixels'
    if (!histogramBrushRanges || histogramBrushRanges.length === 0 || histogramDataType !== 'pixels') {
      return true; // No filter
    }

    const property = interpolationMode === 'coverage' ? 'prevalence_prediction' : 'prevalence_bci_width';

    // Convert string values to numbers for comparison
    const rangeFilter = ['any', ...histogramBrushRanges.map(([min, max]) =>
      ['all',
        ['>=', ['to-number', ['get', property]], min],
        ['<=', ['to-number', ['get', property]], max]
      ]
    )];

    return rangeFilter;
  };

  // Helper to check if a location should be shown based on rounds filter
  // highlightRounds: [] = show all with any rounds, [1,2] = show only locations with round 1 or 2
  const shouldShowLocation = () => {
    if (!showSampled) {
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
      if (showSampled) {
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
      if (showSampled) {
        return [
          'case',
          shouldShowLocation(),
          uncertaintyExpression,
          'rgba(153, 153, 153, 0)'
        ];
      }
      return uncertaintyExpression;
    }
    if (showSampled) {
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
      if (showSampled) {
        return [
          'case',
          shouldShowLocation(),
          0.9,
          0
        ];
      }
      return 0.9;
    }
    if (showSampled) {
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
    if (!showSampled) {
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
    // Always use consistent border width
    return 1;
  };

  const getPolygonLineOpacity = () => {
    if (interpolationMode !== 'none') {
      return 0.3;
    }
    if (showSampled) {
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
      if (showSampled) {
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
      if (showSampled) {
        return [
          'case',
          shouldShowLocation(),
          uncertaintyExpression,
          '#ffffff'
        ];
      }
      return uncertaintyExpression;
    }
    if (showSampled) {
      return [
        'case',
        shouldShowLocation(),
        '#28a745',
        'rgba(255, 255, 255, 0)'
      ];
    }
    return 'rgba(255, 255, 255, 0)';
  };

  const getPointStrokeWidth = () => {
    // Always use consistent stroke width
    return 1;
  };

  const getPointStrokeColor = () => {
    if (interpolationMode !== 'none') {
      return 'rgba(255, 255, 255, 0.5)';
    }
    // When show visits is off, all borders are white
    if (!showSampled) {
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

  const getPointOpacity = () => {
    if (interpolationMode !== 'none') {
      return 0.8;
    }
    if (showSampled) {
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
    <div className={className}>
      <div className={`relative w-full border-t-0 border-tactical-border-medium bg-tactical-bg-secondary overflow-hidden ${className ? 'h-full' : 'h-[500px]'}`}>
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
            ? ['prediction-heatmap', 'prediction-points', 'prediction-polygons-fill', 'prediction-polygons-outline', 'admin-boundaries-adm0-fill', 'admin-boundaries-adm1-fill', 'admin-boundaries-adm2-fill', 'admin-boundaries-adm3-fill', 'admin-boundaries-adm4-fill', 'admin-boundaries-adm0', 'admin-boundaries-adm1', 'admin-boundaries-adm2', 'admin-boundaries-adm3', 'admin-boundaries-adm4', 'gl-draw-polygon-fill-inactive.cold', 'gl-draw-polygon-stroke-inactive.cold', 'gl-draw-polygon-fill-active.cold', 'gl-draw-polygon-stroke-active.cold']
            : mode === 'locations' && campaignId && indicatorId
              ? showPixels
                ? ['pixels-fill-layer', 'pixels-line-layer', 'locations-points', 'locations-polygons-fill', 'locations-polygons-outline', 'admin-boundaries-adm0-fill', 'admin-boundaries-adm1-fill', 'admin-boundaries-adm2-fill', 'admin-boundaries-adm3-fill', 'admin-boundaries-adm4-fill', 'admin-boundaries-adm0', 'admin-boundaries-adm1', 'admin-boundaries-adm2', 'admin-boundaries-adm3', 'admin-boundaries-adm4', 'gl-draw-polygon-fill-inactive.cold', 'gl-draw-polygon-stroke-inactive.cold', 'gl-draw-polygon-fill-active.cold', 'gl-draw-polygon-stroke-active.cold']
                : ['locations-points', 'locations-polygons-fill', 'locations-polygons-outline', 'admin-boundaries-adm0-fill', 'admin-boundaries-adm1-fill', 'admin-boundaries-adm2-fill', 'admin-boundaries-adm3-fill', 'admin-boundaries-adm4-fill', 'admin-boundaries-adm0', 'admin-boundaries-adm1', 'admin-boundaries-adm2', 'admin-boundaries-adm3', 'admin-boundaries-adm4', 'gl-draw-polygon-fill-inactive.cold', 'gl-draw-polygon-stroke-inactive.cold', 'gl-draw-polygon-fill-active.cold', 'gl-draw-polygon-stroke-active.cold']
              : ['all-points', 'selected-points', 'all-polygons-fill', 'selected-polygons-fill', 'admin-boundaries-adm0-fill', 'admin-boundaries-adm1-fill', 'admin-boundaries-adm2-fill', 'admin-boundaries-adm3-fill', 'admin-boundaries-adm4-fill', 'admin-boundaries-adm0', 'admin-boundaries-adm1', 'admin-boundaries-adm2', 'admin-boundaries-adm3', 'admin-boundaries-adm4', 'gl-draw-polygon-fill-inactive.cold', 'gl-draw-polygon-stroke-inactive.cold', 'gl-draw-polygon-fill-active.cold', 'gl-draw-polygon-stroke-active.cold']}
          onClick={handleMapClick}
          onMove={handleMapMove}
          onLoad={(e) => setMapInstance(e.target)}
          onMouseMove={(e) => {
            const map = e.target;
            const features = map.queryRenderedFeatures(e.point);

            // Find admin boundary features
            const adminFeature = features.find((f: any) =>
              f.sourceLayer?.startsWith('admin_boundaries_adm')
            );

            if (adminFeature) {
              // Set cursor to pointer
              map.getCanvas().style.cursor = 'pointer';

              // Set hover state
              const featureId = adminFeature.id;
              const sourceLayer = adminFeature.sourceLayer;

              // Only set hover state if feature has an ID and source layer
              if (featureId != null && sourceLayer) {
                const hoveredKey = `${sourceLayer}::${featureId}`;

                if (hoveredAdminId !== hoveredKey) {
                  // Remove previous hover
                  if (hoveredAdminId) {
                    const [prevLayer, prevId] = hoveredAdminId.split('::');
                    const sourceId = prevLayer.replace('admin_boundaries_', 'admin-boundaries-') + '-source';
                    try {
                      map.setFeatureState(
                        { source: sourceId, sourceLayer: prevLayer, id: prevId },
                        { hover: false }
                      );
                    } catch (e) {
                      // Ignore errors
                    }
                  }

                  // Add new hover
                  const sourceId = sourceLayer.replace('admin_boundaries_', 'admin-boundaries-') + '-source';
                  try {
                    map.setFeatureState(
                      { source: sourceId, sourceLayer: sourceLayer, id: featureId },
                      { hover: true }
                    );
                  } catch (e) {
                    // Ignore errors
                  }

                  setHoveredAdminId(hoveredKey);
                }
              }
            } else {
              // Reset cursor and remove hover
              map.getCanvas().style.cursor = '';

              if (hoveredAdminId) {
                const [prevLayer, prevId] = hoveredAdminId.split('::');
                const sourceId = prevLayer.replace('admin_boundaries_', 'admin-boundaries-') + '-source';
                try {
                  map.setFeatureState(
                    { source: sourceId, sourceLayer: prevLayer, id: prevId },
                    { hover: false }
                  );
                } catch (e) {
                  // Ignore errors
                }
                setHoveredAdminId(null);
              }
            }
          }}
        >
          <NavigationControl position="bottom-right" showCompass={false} style={{ marginBottom: '32px' }} />

          {/* Buildings Layer from Overture Maps via Martin - render first so locations appear on top */}
          {showBuildings && (
            <Source
              id="buildings-source"
              type="vector"
              tiles={[`${MARTIN_URL}/buildings/{z}/{x}/{y}`]}
              minzoom={3}
              maxzoom={14}
            >
              <Layer
                id="buildings-fill"
                type="fill"
                source-layer="building"
                minzoom={12}
                paint={{
                  'fill-color': '#4393c3',
                  'fill-opacity': 0.2
                }}
              />
              <Layer
                id="buildings-outline"
                type="line"
                source-layer="building"
                minzoom={12}
                paint={{
                  'line-color': '#2166ac',
                  'line-width': 1
                }}
              />
            </Source>
          )}

          {isPredictionData && displayData?.features?.length > 0 ? (
            /* Prediction visualization with heatmap interpolation */
            <Source id="prediction-source" type="geojson" data={displayData as any}>
              <Layer {...heatmapLayer} />
              <Layer {...predictionPolygonFillLayer} />
              <Layer {...predictionPolygonOutlineLayer} />
              <Layer {...predictionLayer} />
            </Source>
          ) : !isPredictionData && mode === 'locations' && campaignId && indicatorId ? (
            <>
              {/* Vector tiles for locations - use when we have IDs and no GeoJSON override */}
              <Source
                key={`locations-source-${tileVersion}`}
                id="locations-source"
                type="vector"
                tiles={[`${MARTIN_URL}/locations_by_campaign/{z}/{x}/{y}?campaign_id=${campaignId}&indicator_id=${indicatorId}`]}
                minzoom={0}
                maxzoom={24}
              >
                {/* Polygon fill layer with conditional styling */}
                <Layer
                  key={`locations-polygons-fill-${tileVersion}`}
                  id="locations-polygons-fill"
                  type="fill"
                  source-layer="locations"
                  minzoom={0}
                  filter={buildHistogramFilter(['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]])}
                  paint={{
                    'fill-color': getPolygonFillColor() as any,
                    'fill-opacity': getPolygonFillOpacity() as any
                  }}
                />

                {/* Polygon outline layer */}
                <Layer
                  key={`locations-polygons-outline-${tileVersion}`}
                  id="locations-polygons-outline"
                  type="line"
                  source-layer="locations"
                  minzoom={0}
                  filter={buildHistogramFilter(['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]])}
                  paint={{
                    'line-color': getPolygonLineColor() as any,
                    'line-width': getPolygonLineWidth() as any,
                    'line-opacity': getPolygonLineOpacity() as any
                  }}
                />

                {/* Point layer with conditional styling */}
                <Layer
                  key={`locations-points-${tileVersion}`}
                  id="locations-points"
                  type="circle"
                  source-layer="locations"
                  minzoom={10}
                  filter={buildHistogramFilter(['==', ['geometry-type'], 'Point'])}
                  paint={{
                    'circle-radius': 3,
                    'circle-color': getPointColor() as any,
                    'circle-opacity': getPointOpacity() as any,
                    'circle-stroke-width': getPointStrokeWidth() as any,
                    'circle-stroke-color': getPointStrokeColor() as any
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

          {/* Campaign Areas layer */}
          {showCampaignAreas && campaignAreasGeoJSON.features.length > 0 && (
            <Source id="campaign-areas-source" type="geojson" data={campaignAreasGeoJSON as any}>
              <Layer
                id="campaign-areas-fill"
                type="fill"
                paint={{
                  'fill-color': '#f59e0b',
                  'fill-opacity': 0.1,
                }}
              />
              <Layer
                id="campaign-areas-line"
                type="line"
                paint={{
                  'line-color': '#f59e0b',
                  'line-width': 2,
                  'line-opacity': 0.8,
                }}
              />
            </Source>
          )}

          {/* Pixels layer from Martin */}
          {showPixels && campaignId && (
            <Source
              id="pixels-source"
              type="vector"
              tiles={[`${MARTIN_URL}/pixels_by_campaign/{z}/{x}/{y}?campaign_id=${campaignId}&indicator_id=${indicatorId || ''}&metadata_field=${selectedMetadataField || ''}&v=${pixelVersion || '0'}&t=${tileVersion}`]}
              minzoom={0}
              maxzoom={24}
            >
              <Layer
                id="pixels-fill-layer"
                type="fill"
                source-layer="pixels"
                filter={buildPixelHistogramFilter()}
                paint={{
                  'fill-color': interpolationMode === 'coverage'
                    ? [
                        'case',
                        ['!=', ['get', 'prevalence_prediction'], null],
                        [
                          'interpolate',
                          ['linear'],
                          ['to-number', ['get', 'prevalence_prediction']],
                          0, PREVALENCE_COLORS[0],
                          0.2, PREVALENCE_COLORS[1],
                          0.35, PREVALENCE_COLORS[2],
                          0.5, PREVALENCE_COLORS[3],
                          0.65, PREVALENCE_COLORS[4],
                          0.8, PREVALENCE_COLORS[5],
                          1, PREVALENCE_COLORS[6]
                        ],
                        'rgba(0, 0, 0, 0)' // transparent if no prediction
                      ]
                    : interpolationMode === 'uncertainty'
                      ? [
                          'case',
                          ['!=', ['get', 'prevalence_bci_width'], null],
                          [
                            'interpolate',
                            ['linear'],
                            ['to-number', ['get', 'prevalence_bci_width']],
                            0, UNCERTAINTY_COLORS[0],
                            0.2, UNCERTAINTY_COLORS[1],
                            0.35, UNCERTAINTY_COLORS[2],
                            0.5, UNCERTAINTY_COLORS[3],
                            0.65, UNCERTAINTY_COLORS[4],
                            0.8, UNCERTAINTY_COLORS[5],
                            1, UNCERTAINTY_COLORS[6]
                          ],
                          'rgba(0, 0, 0, 0)' // transparent if no uncertainty
                        ]
                      : interpolationMode === 'metadata' && metadataVisualizationMode === 'fill' && selectedMetadataField
                        ? [
                            'case',
                            ['!=', ['get', 'metadata_value'], null],
                            [
                              'interpolate',
                              ['linear'],
                              ['to-number', ['get', 'metadata_value']],
                              // Dynamic range - will be replaced by actual breaks
                              0, METADATA_COLORS[0],
                              1, METADATA_COLORS[1],
                              10, METADATA_COLORS[2],
                              50, METADATA_COLORS[3],
                              100, METADATA_COLORS[4],
                              500, METADATA_COLORS[5],
                              1000, METADATA_COLORS[6],
                              5000, METADATA_COLORS[7],
                              10000, METADATA_COLORS[8]
                            ],
                            'rgba(0, 0, 0, 0)' // transparent if no metadata
                          ]
                        : showSampled
                          ? [
                              'case',
                              shouldShowLocation(),
                              '#28a745',
                              '#1a1a2e'
                            ]
                          : '#1a1a2e',
                  'fill-opacity': interpolationMode === 'coverage'
                    ? [
                        'case',
                        ['!=', ['get', 'prevalence_prediction'], null],
                        0.9,
                        0
                      ]
                    : interpolationMode === 'uncertainty'
                      ? [
                          'case',
                          ['!=', ['get', 'prevalence_bci_width'], null],
                          0.9,
                          0
                        ]
                      : interpolationMode === 'metadata' && selectedMetadataField
                        ? metadataVisualizationMode === 'circle'
                          ? 0
                          : [
                              'case',
                              ['!=', ['get', 'metadata_value'], null],
                              0.9,
                              0
                            ]
                        : 0.6
                }}
              />
              <Layer
                id="pixels-line-layer"
                type="line"
                source-layer="pixels"
                filter={buildPixelHistogramFilter()}
                paint={{
                  'line-color': interpolationMode !== 'none'
                    ? '#ffffff'
                    : mapStyle === 'mapbox://styles/mapbox/satellite-streets-v12'
                      ? '#ffffff'
                      : '#28a745',
                  'line-width': 1,
                  'line-opacity': interpolationMode === 'coverage'
                    ? [
                        'case',
                        showSampled
                          ? ['all', ['!=', ['get', 'prevalence_prediction'], null], shouldShowLocation()]
                          : ['!=', ['get', 'prevalence_prediction'], null],
                        0.3,
                        0
                      ]
                    : interpolationMode === 'uncertainty'
                      ? [
                          'case',
                          showSampled
                            ? ['all', ['!=', ['get', 'prevalence_bci_width'], null], shouldShowLocation()]
                            : ['!=', ['get', 'prevalence_bci_width'], null],
                          0.3,
                          0
                        ]
                      : interpolationMode === 'metadata' && selectedMetadataField
                        ? metadataVisualizationMode === 'circle'
                          ? 0
                          : [
                              'case',
                              showSampled
                                ? ['all', ['!=', ['get', 'metadata_value'], null], shouldShowLocation()]
                                : ['!=', ['get', 'metadata_value'], null],
                              0.3,
                              0
                            ]
                        : 0.6
                }}
              />

              {/* Metadata Circle Layer - shown when metadata field is selected and mode is 'circle' */}
              {selectedMetadataField && metadataVisualizationMode === 'circle' && (
                <Layer
                  id="pixels-metadata-circles"
                  type="circle"
                  source-layer="pixels_centroids"
                  filter={['!=', ['get', 'metadata_value'], null]}
                  paint={{
                    'circle-radius': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      10, [
                        'interpolate',
                        ['linear'],
                        ['to-number', ['get', 'metadata_value']],
                        0, 0.5,
                        10, 1,
                        50, 1.5,
                        100, 2,
                        500, 2.5,
                        1000, 3,
                        5000, 3.5,
                        10000, 4
                      ],
                      12, [
                        'interpolate',
                        ['linear'],
                        ['to-number', ['get', 'metadata_value']],
                        0, 1,
                        10, 2,
                        50, 3,
                        100, 4,
                        500, 5,
                        1000, 6,
                        5000, 7,
                        10000, 8
                      ],
                      15, [
                        'interpolate',
                        ['linear'],
                        ['to-number', ['get', 'metadata_value']],
                        0, 2,
                        10, 4,
                        50, 6,
                        100, 8,
                        500, 10,
                        1000, 12,
                        5000, 14,
                        10000, 16
                      ]
                    ],
                    'circle-color': METADATA_COLORS[4], // Mid-range blue
                    'circle-opacity': 0.7,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 0.8
                  }}
                />
              )}
            </Source>
          )}

          {/* Admin Boundaries Layers - ordered from lowest to highest so highest level is clickable */}
          {/* ADM0 - Country - visible at all zooms */}
          {visibleAdminLevels.includes(0) && (
            <Source
              id="admin-boundaries-adm0-source"
              type="vector"
              tiles={[`${MARTIN_URL}/bgd_adm0/{z}/{x}/{y}`]}
              minzoom={0}
              maxzoom={12}
              promoteId="ADM0_PCODE"
            >
              <Layer
                id="admin-boundaries-adm0-fill"
                type="fill"
                source-layer="admin_boundaries_adm0"
                paint={{
                  'fill-color': '#ff6b35',
                  'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.15,
                    0.01
                  ]
                }}
              />
              <Layer
                id="admin-boundaries-adm0"
                type="line"
                source-layer="admin_boundaries_adm0"
                paint={{
                  'line-color': '#ff6b35',
                  'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0, 1,
                    6, 2,
                    12, 3
                  ],
                  'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.9
                  ]
                }}
              />
            </Source>
          )}

          {/* ADM1 - Division - visible from zoom 4+ */}
          {visibleAdminLevels.includes(1) && (
            <Source
              id="admin-boundaries-adm1-source"
              type="vector"
              tiles={[`${MARTIN_URL}/bgd_adm1/{z}/{x}/{y}`]}
              minzoom={4}
              maxzoom={12}
              promoteId="ADM1_PCODE"
            >
              <Layer
                id="admin-boundaries-adm1-fill"
                type="fill"
                source-layer="admin_boundaries_adm1"
                minzoom={4}
                paint={{
                  'fill-color': '#ff6b35',
                  'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.15,
                    0.01
                  ]
                }}
              />
              <Layer
                id="admin-boundaries-adm1"
                type="line"
                source-layer="admin_boundaries_adm1"
                minzoom={4}
                paint={{
                  'line-color': '#ff6b35',
                  'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    4, 0.75,
                    8, 1.5,
                    12, 2.5
                  ],
                  'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.85
                  ]
                }}
              />
            </Source>
          )}

          {/* ADM2 - District - visible from zoom 6+ */}
          {visibleAdminLevels.includes(2) && (
            <Source
              id="admin-boundaries-adm2-source"
              type="vector"
              tiles={[`${MARTIN_URL}/bgd_adm2/{z}/{x}/{y}`]}
              minzoom={6}
              maxzoom={14}
              promoteId="ADM2_PCODE"
            >
              <Layer
                id="admin-boundaries-adm2-fill"
                type="fill"
                source-layer="admin_boundaries_adm2"
                minzoom={6}
                paint={{
                  'fill-color': '#ff6b35',
                  'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.15,
                    0.01
                  ]
                }}
              />
              <Layer
                id="admin-boundaries-adm2"
                type="line"
                source-layer="admin_boundaries_adm2"
                minzoom={6}
                paint={{
                  'line-color': '#ff6b35',
                  'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    6, 0.5,
                    10, 1.5,
                    14, 2.5
                  ],
                  'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.8
                  ]
                }}
              />
            </Source>
          )}

          {/* ADM3 - Upazila - visible from zoom 8+ */}
          {visibleAdminLevels.includes(3) && (
            <Source
              id="admin-boundaries-adm3-source"
              type="vector"
              tiles={[`${MARTIN_URL}/bgd_adm3/{z}/{x}/{y}`]}
              minzoom={8}
              maxzoom={16}
              promoteId="ADM3_PCODE"
            >
              <Layer
                id="admin-boundaries-adm3-fill"
                type="fill"
                source-layer="admin_boundaries_adm3"
                minzoom={8}
                paint={{
                  'fill-color': '#ff6b35',
                  'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.15,
                    0.01
                  ]
                }}
              />
              <Layer
                id="admin-boundaries-adm3"
                type="line"
                source-layer="admin_boundaries_adm3"
                minzoom={8}
                paint={{
                  'line-color': '#ff6b35',
                  'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    8, 0.5,
                    12, 1.5,
                    16, 2.5
                  ],
                  'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.75
                  ]
                }}
              />
            </Source>
          )}

          {/* ADM4 - Union - visible from zoom 10+ */}
          {visibleAdminLevels.includes(4) && (
            <Source
              id="admin-boundaries-adm4-source"
              type="vector"
              tiles={[`${MARTIN_URL}/bgd_adm4/{z}/{x}/{y}`]}
              minzoom={10}
              maxzoom={18}
              promoteId="ADM4_PCODE"
            >
              <Layer
                id="admin-boundaries-adm4-fill"
                type="fill"
                source-layer="admin_boundaries_adm4"
                minzoom={10}
                paint={{
                  'fill-color': '#ff6b35',
                  'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.15,
                    0.01
                  ]
                }}
              />
              <Layer
                id="admin-boundaries-adm4"
                type="line"
                source-layer="admin_boundaries_adm4"
                minzoom={10}
                paint={{
                  'line-color': '#ff6b35',
                  'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 0.5,
                    14, 1.5,
                    18, 2.5
                  ],
                  'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.7
                  ]
                }}
              />
            </Source>
          )}

          {/* Popup */}
          {popupInfo && (
            <Popup
              key={`popup-${planningMode}-${popupInfo.longitude}-${popupInfo.latitude}`}
              longitude={popupInfo.longitude}
              latitude={popupInfo.latitude}
              anchor="bottom"
              onClose={() => setPopupInfo(null)}
              closeButton={true}
              closeOnClick={false}
              className="tactical-popup"
              maxWidth="400px"
            >
              {popupInfo.properties?.isDrawnFeature ? (
                /* Drawn feature popup */
                <div className="bg-tactical-bg-primary border border-tactical-border-medium p-3" style={{ minWidth: '250px', maxWidth: '350px' }}>
                  <div className="text-lg font-mono font-bold text-tactical-accent-orange mb-3">
                    Drawn Area
                  </div>

                  {/* Add to Campaign Area button */}
                  {onAddAdminBoundaryToCampaign && drawnFeature && (
                    <button
                      onClick={() => {
                        onAddAdminBoundaryToCampaign('drawn', 'drawn', 'Drawn Area', drawnFeature.geometry);
                        setPopupInfo(null);
                      }}
                      className="w-full px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all bg-tactical-accent-cyan hover:bg-opacity-80 text-black"
                    >
                      Add to Campaign Area
                    </button>
                  )}
                </div>
              ) : popupInfo.properties?.level !== undefined ? (
                /* Compact admin boundary popup */
                <div className="bg-tactical-bg-primary border border-tactical-border-medium p-3" style={{ minWidth: '250px', maxWidth: '350px' }}>
                  {/* Breadcrumb - starts from ADM1 to save space */}
                  <div className="text-xs font-mono text-tactical-text-muted mb-2">
                    {[...Array(popupInfo.properties.level + 1)].map((_, i) => {
                      if (i === 0) return null; // Skip ADM0 (Bangladesh)
                      const levelName = popupInfo.properties[`ADM${i}_EN`];
                      return levelName ? (
                        <span key={i}>
                          {i > 1 && <span className="mx-1">›</span>}
                          <span>{levelName}</span>
                        </span>
                      ) : null;
                    }).filter(Boolean)}
                  </div>

                  {/* Current level name */}
                  <div className="text-lg font-mono font-bold text-tactical-accent-orange mb-2">
                    {popupInfo.properties[`ADM${popupInfo.properties.level}_EN`]}
                  </div>

                  {/* Pcode */}
                  {popupInfo.properties[`ADM${popupInfo.properties.level}_PCODE`] && (
                    <div className="text-xs font-mono text-tactical-text-muted mb-3">
                      <span className="font-bold">PCODE:</span> {popupInfo.properties[`ADM${popupInfo.properties.level}_PCODE`]}
                    </div>
                  )}

                  {/* Population Summary - from global pixels */}
                  <div className="mt-3 pt-3 border-t border-tactical-border-medium">
                      <div className="text-xs font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-2">
                        Population Summary
                      </div>
                      {loadingPopulation ? (
                        <div className="text-xs font-mono text-tactical-text-muted">Loading...</div>
                      ) : populationSummary ? (
                        populationSummary.pixel_count > 0 ? (
                          <div className="space-y-1">
                            <div className="text-xs font-mono text-tactical-text-muted flex justify-between">
                              <span>Total Population:</span>
                              <span className="font-bold text-tactical-text-primary">
                                {Math.round(populationSummary.total_population).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-tactical-text-muted flex justify-between">
                              <span>Pixel Count:</span>
                              <span className="font-bold text-tactical-text-primary">
                                {populationSummary.pixel_count.toLocaleString()}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-tactical-text-muted flex justify-between">
                              <span>Avg Pop/Pixel:</span>
                              <span className="font-bold text-tactical-text-primary">
                                {Math.round(populationSummary.avg_population).toLocaleString()}
                              </span>
                            </div>
                            {populationSummary.pixels_with_data < populationSummary.pixel_count && (
                              <div className="text-xs font-mono text-tactical-text-muted mt-1 pt-1 border-t border-tactical-border-light">
                                {populationSummary.pixels_with_data} of {populationSummary.pixel_count} pixels have population data
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs font-mono text-tactical-text-muted">No pixels in this area yet</div>
                        )
                      ) : (
                        <div className="text-xs font-mono text-tactical-text-muted">Loading...</div>
                      )}
                    </div>

                  {/* Add to Campaign Area button - only in planning mode */}
                  {planningMode && onAddAdminBoundaryToCampaign && popupInfo.properties[`ADM${popupInfo.properties.level}_PCODE`] && (
                    <button
                      onClick={() => {
                        const pcode = popupInfo.properties[`ADM${popupInfo.properties.level}_PCODE`];
                        const name = popupInfo.properties[`ADM${popupInfo.properties.level}_EN`];
                        onAddAdminBoundaryToCampaign(pcode, pcode, name);
                        setPopupInfo(null);
                      }}
                      className="mt-3 w-full px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider transition-all bg-tactical-accent-cyan hover:bg-opacity-80 text-black"
                    >
                      Add to Campaign Area
                    </button>
                  )}
                </div>
              ) : (
                /* Regular popup for pixels/locations */
                <div className="bg-tactical-bg-primary border border-tactical-border-medium p-4" style={{ minWidth: '400px', maxWidth: '500px' }}>
                  <div className="text-sm font-mono font-bold text-tactical-text-primary uppercase tracking-wider mb-3">
                    {popupInfo.properties?.quadkey
                      ? 'Pixel Properties'
                      : 'Location Properties'}
                  </div>
                  <div className="overflow-auto tactical-scrollbar" style={{ maxHeight: '400px' }}>
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(popupInfo.properties || {})
                          .filter(([key]) => !['bbox', 'external_id', 'version', 'has_parts', 'is_underground'].includes(key))
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
              )}
            </Popup>
          )}
        </Map>

        {/* Map Control Buttons */}
        {mode === 'locations' && (
          <div className="absolute top-3 left-3 z-10 flex gap-2">
            {/* Pixels Toggle/Generate Button */}
            {(onTogglePixels || onGeneratePixels) && (
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
            )}

            {/* Sample Toggle Button */}
            {onToggleSampled && sampledItemsCount > 0 && (
              <button
                onClick={onToggleSampled}
                className={`px-3 py-2 font-mono text-xs uppercase tracking-wider border transition-colors ${
                  showSampled
                    ? 'bg-tactical-accent-green border-tactical-accent-green text-black'
                    : 'bg-tactical-bg-tertiary border-tactical-border-medium text-tactical-text-primary hover:border-tactical-accent-green'
                }`}
              >
                Sample
              </button>
            )}

            {/* Campaign Areas Toggle Button */}
            {onToggleCampaignAreas && campaignAreas.length > 0 && (
              <button
                onClick={onToggleCampaignAreas}
                className={`px-3 py-2 font-mono text-xs uppercase tracking-wider border transition-colors ${
                  showCampaignAreas
                    ? 'bg-amber-500 border-amber-500 text-black'
                    : 'bg-tactical-bg-tertiary border-tactical-border-medium text-tactical-text-primary hover:border-amber-500'
                }`}
              >
                Areas
              </button>
            )}
          </div>
        )}

        {/* Map Style Selector and Admin Boundaries Control */}
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

          <div className="mt-3 pt-3 border-t border-tactical-border-medium">
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => setAdminBoundariesCollapsed(!adminBoundariesCollapsed)}
                className="flex items-center gap-1 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider hover:text-tactical-text-primary transition-colors"
              >
                <span>Admin</span>
                <span className="text-tactical-text-dim text-sm -mt-0.5">{adminBoundariesCollapsed ? '▸' : '▾'}</span>
              </button>
              {/* Inline level toggles */}
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((level) => (
                  <button
                    key={level}
                    onClick={() => {
                      if (visibleAdminLevels.includes(level)) {
                        setVisibleAdminLevels(visibleAdminLevels.filter(l => l !== level));
                      } else {
                        setVisibleAdminLevels([...visibleAdminLevels, level].sort());
                      }
                    }}
                    className={`w-4 h-4 flex items-center justify-center font-mono text-xs transition-colors ${
                      visibleAdminLevels.includes(level)
                        ? 'text-tactical-accent-green'
                        : 'text-tactical-text-dim hover:text-tactical-text-muted'
                    }`}
                    title={['Country', 'Division', 'District', 'Upazila', 'Union'][level]}
                  >
                    {visibleAdminLevels.includes(level) ? level : '×'}
                  </button>
                ))}
              </div>
            </div>
            {!adminBoundariesCollapsed && (
              <>
                <button
                  onClick={() => {
                    if (visibleAdminLevels.length === 5) {
                      setVisibleAdminLevels([]);
                    } else {
                      setVisibleAdminLevels([0, 1, 2, 3, 4]);
                    }
                  }}
                  className="mb-2 font-mono text-xs text-tactical-text-dim hover:text-tactical-text-primary transition-colors"
                >
                  {visibleAdminLevels.length === 5 ? 'Deselect all' : 'Select all'}
                </button>
                {[
                  { level: 0, label: 'Country' },
                  { level: 1, label: 'Division' },
                  { level: 2, label: 'District' },
                  { level: 3, label: 'Upazila' },
                  { level: 4, label: 'Union' }
                ].map(({ level, label }) => (
                  <button
                    key={level}
                    onClick={() => {
                      if (visibleAdminLevels.includes(level)) {
                        setVisibleAdminLevels(visibleAdminLevels.filter(l => l !== level));
                      } else {
                        setVisibleAdminLevels([...visibleAdminLevels, level].sort());
                      }
                    }}
                    className="flex items-center justify-between w-full mb-1 group"
                  >
                    <span className={`font-mono text-xs transition-colors ${
                      visibleAdminLevels.includes(level)
                        ? 'text-tactical-text-primary'
                        : 'text-tactical-text-dim'
                    }`}>
                      {label} (L{level})
                    </span>
                    <span className={`font-mono text-xs transition-colors ${
                      visibleAdminLevels.includes(level)
                        ? 'text-tactical-accent-green'
                        : 'text-tactical-text-dim group-hover:text-tactical-text-muted'
                    }`}>
                      {visibleAdminLevels.includes(level) ? '✓' : '×'}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-tactical-border-medium">
            <div className="mb-2 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
              Layers
            </div>
            <label className="flex items-center mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showBuildings}
                onChange={(e) => setShowBuildings(e.target.checked)}
                className="mr-2"
              />
              <span className="font-mono text-xs text-tactical-text-primary">
                Buildings
              </span>
            </label>
          </div>

          <div className="mt-3 pt-3 border-t border-tactical-border-medium">
            <div className="font-mono text-xs text-tactical-text-muted">
              Zoom: {currentZoom.toFixed(2)}
            </div>
          </div>
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
                {mode === 'locations' && sampledItemsCount > 0 && (
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full border-2 border-tactical-accent-green mr-2" style={{ backgroundColor: 'transparent' }}></div>
                    <span className="font-mono text-xs text-tactical-text-muted">
                      To visit ({sampledItemsCount})
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
                {mode === 'locations' && sampledItemsCount > 0 && (
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full border-2 border-tactical-accent-green mr-2" style={{ backgroundColor: 'transparent' }}></div>
                    <span className="font-mono text-xs text-tactical-text-muted">
                      To visit ({sampledItemsCount})
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
              {mode === 'locations' && sampledItemsCount > 0 && (
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-tactical-accent-green border-2 border-tactical-accent-green mr-2"></div>
                  <span className="font-mono text-xs text-tactical-text-muted">
                    Locations to visit ({sampledItemsCount})
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

        {/* Pixel Generation Confirmation Modal */}
        {showPixelGenerateModal && pendingAdminPixelGen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
            onClick={() => setShowPixelGenerateModal(false)}
          >
            <div
              className="bg-black border border-tactical-border-medium p-6 shadow-2xl"
              style={{ width: '500px', maxWidth: '90vw' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="font-mono font-bold text-lg text-tactical-accent-orange uppercase tracking-wider mb-4">
                Generate Pixels
              </div>

              <div className="font-mono text-sm text-tactical-text-primary mb-6">
                <p className="mb-3">
                  Generate pixels for <span className="font-bold text-tactical-accent-orange">{pendingAdminPixelGen.name}</span>?
                </p>
                <div className="text-tactical-text-muted space-y-1">
                  <p>• Level: 18</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleConfirmPixelGeneration}
                  disabled={generatePixelsMutation.isPending}
                  className="flex-1 px-4 py-3 bg-tactical-accent-orange hover:bg-opacity-80 text-black font-mono text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatePixelsMutation.isPending ? 'Generating...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setShowPixelGenerateModal(false)}
                  disabled={generatePixelsMutation.isPending}
                  className="flex-1 px-4 py-3 bg-tactical-bg-secondary border border-tactical-border-medium hover:bg-tactical-bg-tertiary text-tactical-text-primary font-mono text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
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
