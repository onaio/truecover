export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, any>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface SamplingRequest {
  point_data: GeoJSONFeatureCollection;
  uncertainty_fieldname: string;
  batch_size: number;
}

export interface FileData {
  type: 'geojson' | 'csv';
  data: GeoJSONFeatureCollection;
  fields: string[];
}

export interface PredictionRequest {
  point_data: GeoJSONFeatureCollection;
  exceedance_threshold: number;
  layer_names: string[];
}

export interface MergeStats {
  sampleFrameCount: number;
  surveyDataCount: number;
  matchedCount: number;
  addedFromSurvey: number;
  totalInMerged: number;
}