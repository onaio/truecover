import React, { useCallback } from 'react';
import Papa from 'papaparse';
import { GeoJSONFeatureCollection, FileData } from '../types';

interface FileUploadProps {
  onFileLoaded: (data: FileData) => void;
  label?: string;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileLoaded, label = 'Upload File' }) => {
  const handleFileRead = useCallback((event: ProgressEvent<FileReader>) => {
    const content = event.target?.result as string;
    if (!content) return;

    try {
      // Try parsing as JSON first
      const parsed = JSON.parse(content);

      // Check if it's a GeoJSON FeatureCollection directly
      if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
        const fields = extractFieldsFromGeoJSON(parsed);
        onFileLoaded({
          type: 'geojson',
          data: parsed,
          fields
        });
        return;
      }

      // Check if it has a point_data wrapper (like survey files)
      if (parsed.point_data && parsed.point_data.type === 'FeatureCollection' && Array.isArray(parsed.point_data.features)) {
        const fields = extractFieldsFromGeoJSON(parsed.point_data);
        onFileLoaded({
          type: 'geojson',
          data: parsed.point_data,
          fields
        });
        return;
      }

      // If neither format matches, throw error to try CSV parsing
      throw new Error('Not a valid GeoJSON FeatureCollection');
    } catch {
      // Try parsing as CSV
      Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const csvData = results.data as Record<string, any>[];
          const fields = results.meta.fields || [];
          
          // Convert CSV to GeoJSON
          const geojson = csvToGeoJSON(csvData, fields);
          
          onFileLoaded({
            type: 'csv',
            data: geojson,
            fields
          });
        },
        error: (error: any) => {
          alert(`Failed to parse file: ${error.message}`);
        }
      });
    }
  }, [onFileLoaded]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = handleFileRead;
    reader.readAsText(file);
  }, [handleFileRead]);

  const extractFieldsFromGeoJSON = (geojson: GeoJSONFeatureCollection): string[] => {
    const fieldsSet = new Set<string>();
    
    geojson.features.forEach(feature => {
      if (feature.properties) {
        Object.keys(feature.properties).forEach(key => {
          fieldsSet.add(key);
        });
      }
    });
    
    return Array.from(fieldsSet);
  };

  const csvToGeoJSON = (data: Record<string, any>[], fields: string[]): GeoJSONFeatureCollection => {
    // Look for common coordinate field names
    const latFields = ['lat', 'latitude', 'y', 'Latitude', 'LAT'];
    const lonFields = ['lon', 'longitude', 'lng', 'x', 'Longitude', 'LON', 'LONG'];
    
    let latField = fields.find(f => latFields.includes(f));
    let lonField = fields.find(f => lonFields.includes(f));
    
    if (!latField || !lonField) {
      throw new Error('Could not find latitude/longitude fields in CSV');
    }
    
    const features = data.map(row => {
      const lat = parseFloat(row[latField!]);
      const lon = parseFloat(row[lonField!]);
      
      if (isNaN(lat) || isNaN(lon)) {
        return null;
      }
      
      // Copy all properties except coordinates
      const properties: Record<string, any> = {};
      Object.keys(row).forEach(key => {
        if (key !== latField && key !== lonField) {
          properties[key] = row[key];
        }
      });
      
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        },
        properties
      };
    }).filter(f => f !== null);
    
    return {
      type: 'FeatureCollection',
      features: features as any
    };
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <h3>{label}</h3>
      <input
        type="file"
        accept=".geojson,.json,.csv"
        onChange={handleFileUpload}
        style={{ 
          padding: '10px',
          border: '2px dashed #ccc',
          borderRadius: '4px',
          width: '100%',
          cursor: 'pointer'
        }}
      />
      <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
        Supported formats: GeoJSON (.geojson, .json) or CSV with latitude/longitude columns
      </p>
    </div>
  );
};

export default FileUpload;