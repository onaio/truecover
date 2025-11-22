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

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  role?: string;
  joined_at?: string;
}

export interface OrganizationMember {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  role: string;
  joined_at: string;
}

export interface Project {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  odk_api_key: string | null;
  odk_host_url: string | null;
  ona_project_id: number | null;
  ona_project_name: string | null;
  ona_entity_list_id: number | null;
  ona_entity_list_name: string | null;
}

export interface OnaProject {
  url: string;
  owner: string;
  name: string;
  date_created: string;
  date_modified: string;
  projectid?: number;
}

export interface OnaEntityList {
  url: string;
  id: number;
  name: string;
  project: string;
  public: boolean;
  datecreated: string;
  datemodified: string;
  numregistrationforms: number;
  numfollowupforms: number;
  numentities: number;
}

export interface Area {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}