import React, { useMemo, useState } from 'react';
import Map, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { GeoJSONFeatureCollection } from '../types';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapViewProps {
  data: GeoJSONFeatureCollection;
  selectedData?: GeoJSONFeatureCollection | null;
}

const MapView: React.FC<MapViewProps> = ({ data, selectedData }) => {
  const [popupInfo, setPopupInfo] = useState<any>(null);
  const mapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;

  // Calculate bounds from all points - BEFORE the early return
  const bounds = useMemo(() => {
    if (!data.features.length) return undefined;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    data.features.forEach(feature => {
      if (feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    });

    // Add padding
    const lngPadding = (maxLng - minLng) * 0.1;
    const latPadding = (maxLat - minLat) * 0.1;

    return [
      [minLng - lngPadding, minLat - latPadding],
      [maxLng + lngPadding, maxLat + latPadding]
    ] as [[number, number], [number, number]];
  }, [data]);

  // Extract selected features - BEFORE the early return
  const selectedFeatures = useMemo(() => {
    if (selectedData) {
      return selectedData.features.filter(
        f => f.properties?.adaptively_selected === 1 || f.properties?.adaptively_selected === true
      );
    }
    return data.features.filter(
      f => f.properties?.adaptively_selected === 1 || f.properties?.adaptively_selected === true
    );
  }, [data, selectedData]);

  // Check if we have prediction data (predicted_prevalence field)
  const isPredictionData = useMemo(() => {
    const checkData = selectedData || data;
    return checkData.features.some(f => 'predicted_prevalence' in (f.properties || {}));
  }, [data, selectedData]);

  // Early return AFTER all hooks
  if (!mapboxToken) {
    return (
      <div style={{
        padding: '20px',
        backgroundColor: '#f8d7da',
        border: '1px solid #f5c6cb',
        borderRadius: '4px',
        color: '#721c24',
        marginBottom: '20px'
      }}>
        <strong>Error:</strong> Mapbox token not found. Please create a .env file with REACT_APP_MAPBOX_TOKEN
      </div>
    );
  }

  const selectedGeoJSON: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: selectedFeatures
  };

  // Use prediction data if available, otherwise use input data
  const displayData = selectedData || data;

  // Layer styles for predictions - color by prevalence
  const predictionLayer: LayerProps = {
    id: 'prediction-points',
    type: 'circle',
    paint: {
      'circle-radius': 4,
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'predicted_prevalence'],
        -1, '#2166ac',    // Low (blue)
        0, '#4393c3',
        0.3, '#92c5de',
        0.5, '#fddbc7',
        0.7, '#f4a582',
        1, '#d6604d',     // Medium (orange)
        2, '#b2182b'      // High (red)
      ],
      'circle-opacity': 0.8,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff'
    }
  };

  // Layer styles for sampling
  const allPointsLayer: LayerProps = {
    id: 'all-points',
    type: 'circle',
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
    paint: {
      'circle-radius': 3,
      'circle-color': '#28a745',
      'circle-opacity': 1,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#1e7e34'
    }
  };

  const handleMapClick = (event: any) => {
    const feature = event.features && event.features[0];
    if (feature) {
      setPopupInfo({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        properties: feature.properties
      });
    }
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <h3>Map Visualization</h3>
      <div style={{
        height: '500px',
        width: '100%',
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <Map
          mapboxAccessToken={mapboxToken}
          initialViewState={{
            bounds: bounds,
            fitBoundsOptions: { padding: 40 }
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          interactiveLayerIds={isPredictionData ? ['prediction-points'] : ['all-points', 'selected-points']}
          onClick={handleMapClick}
        >
          <NavigationControl position="top-right" />

          {isPredictionData ? (
            /* Prediction visualization */
            <Source id="prediction-source" type="geojson" data={displayData as any}>
              <Layer {...predictionLayer} />
            </Source>
          ) : (
            <>
              {/* All points layer */}
              <Source id="all-points-source" type="geojson" data={data as any}>
                <Layer {...allPointsLayer} />
              </Source>

              {/* Selected points layer */}
              {selectedFeatures.length > 0 && (
                <Source id="selected-points-source" type="geojson" data={selectedGeoJSON as any}>
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

        {/* Legend */}
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          backgroundColor: 'white',
          padding: '10px',
          borderRadius: '4px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          fontSize: '12px',
          zIndex: 1
        }}>
          <div style={{ marginBottom: '5px', fontWeight: 'bold' }}>Legend</div>

          {isPredictionData ? (
            /* Prediction legend */
            <div>
              <div style={{ marginBottom: '5px', fontSize: '11px', color: '#666' }}>
                Predicted Prevalence
              </div>
              <div style={{
                height: '100px',
                width: '20px',
                background: 'linear-gradient(to top, #2166ac, #4393c3, #92c5de, #fddbc7, #f4a582, #d6604d, #b2182b)',
                border: '1px solid #ccc',
                marginBottom: '5px'
              }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span>Low</span>
                <span>High</span>
              </div>
              <div style={{ marginTop: '5px', fontSize: '11px' }}>
                {displayData.features.length} prediction points
              </div>
            </div>
          ) : (
            /* Sampling legend */
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: '#999',
                  border: '1px solid #666',
                  marginRight: '8px'
                }}></div>
                <span>All Points ({data.features.length})</span>
              </div>
              {selectedFeatures.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: '#28a745',
                    border: '2px solid #1e7e34',
                    marginRight: '8px'
                  }}></div>
                  <span>Adaptively Selected ({selectedFeatures.length})</span>
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
