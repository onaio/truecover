import React from 'react';
import { GeoJSONFeatureCollection } from '../types';

interface ResultDisplayProps {
  result: GeoJSONFeatureCollection | null;
  onDownload: () => void;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result, onDownload }) => {
  if (!result || !result.features) {
    return null;
  }

  const selectedCount = result.features.filter(
    f => f.properties?.adaptively_selected === true
  ).length;
  
  const totalCount = result.features.length;

  return (
    <div style={{ 
      marginTop: '20px', 
      padding: '20px',
      backgroundColor: '#f8f9fa',
      borderRadius: '8px',
      border: '1px solid #dee2e6'
    }}>
      <h3>Sampling Results</h3>
      
      <div style={{ marginBottom: '15px' }}>
        <p><strong>Total Features:</strong> {totalCount}</p>
        <p><strong>Selected for Sampling:</strong> {selectedCount}</p>
      </div>
      
      <div style={{ 
        marginBottom: '15px',
        maxHeight: '300px',
        overflowY: 'auto',
        backgroundColor: 'white',
        padding: '10px',
        borderRadius: '4px',
        border: '1px solid #ccc'
      }}>
        <h4>Selected Features:</h4>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {result.features
            .filter(f => f.properties?.adaptively_selected === true)
            .map((feature, index) => (
              <li key={index} style={{ 
                padding: '8px',
                borderBottom: '1px solid #eee',
                fontSize: '14px'
              }}>
                <strong>Feature {index + 1}:</strong>
                <div style={{ marginLeft: '20px', marginTop: '5px' }}>
                  {feature.geometry.type === 'Point' && (
                    <div>
                      Coordinates: [{feature.geometry.coordinates[0].toFixed(6)}, {feature.geometry.coordinates[1].toFixed(6)}]
                    </div>
                  )}
                  <div style={{ marginTop: '5px' }}>
                    Properties: 
                    <pre style={{ 
                      fontSize: '12px',
                      backgroundColor: '#f5f5f5',
                      padding: '5px',
                      borderRadius: '3px',
                      marginTop: '5px'
                    }}>
                      {JSON.stringify(
                        Object.entries(feature.properties)
                          .filter(([key]) => key !== 'adaptively_selected')
                          .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {}),
                        null, 
                        2
                      )}
                    </pre>
                  </div>
                </div>
              </li>
            ))}
        </ul>
      </div>
      
      <button
        onClick={onDownload}
        style={{
          padding: '10px 20px',
          backgroundColor: '#28a745',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          cursor: 'pointer',
          width: '100%'
        }}
      >
        Download Result as GeoJSON
      </button>
    </div>
  );
};

export default ResultDisplay;