import { Layer, Expression } from 'mapbox-gl';
import { FeatureCollection } from '@turf/helpers';



export type FeatureProperties = {
  [key: string]: any;
  n_trials?: number;
  n_positive?: number;
} | null;

export interface Algo {
  fn_name: string;
  title: string;
  intent: string;
  description?: string;
  fields?: null | AlgoField[];
  params?: null | AlgoRunParam[];
  return_fields: AlgoField[];
  remote: boolean;
  visualisations: VisualisationDefinition[];
}

export interface AlgoRunParam {
  name: string;
  required?: boolean; // Only required to set as true
  type: 'number' | 'string' | 'boolean' | 'array';
  default?: any;
}

export interface AlgoField {
  field_name: string;
  required?: boolean;
  type: 'string' | 'number' | 'date' | 'boolean';
}

export interface RunResponse {
  function_status: 'success' | 'error' | 'unknown';
  result?: any;
  finished_at: Date;
  headers?: Headers;
}

export interface RunRequest {
  algo: Algo;
  params: RunRequestParams;
  started_at: null | Date;
  finished_at: null | Date;
}

export interface RunRequestParams {
  point_data: FeatureCollection;
  [name: string]: any;
}

export enum RunInvocationStatus {
  NotStarted = 'Not started',
  Running = 'Running',
  Finished = 'Finished',
}

export interface ParseResult {
  messages: null | string[];
  geodata: null | FeatureCollection;
}

export type EndStop = number | boolean | string | null; // e.g. for 'min' and 'max' properties

export enum GeometryTypeEnum {
  Point = 'Point',
  MultiPoint = 'MultiPoint',
  LineString = 'LineString',
  MultiLineString = 'MultiLineString',
  Polygon = 'Polygon',
  MultiPolygon = 'MultiPolygon',
  GeometryCollection = 'GeometryCollection',
}

export interface GeoJSONHintError {
  message: string;
  line: number;
}

export interface BaseLayer {
  name: string;
  ref: string;
}

export interface ResultConfig {
  viz_def: VisualisationDefinition;
  aggregate_by: AggregateBy;
  grid_size_km?: number;
}

export enum AggregateBy {
  HEXGRIDS = 'hexgrids',
  DISTRICTS = 'districts',
  NONE = 'none',
}



// VISUALISATIONS

export enum VisualisationMode {
  target = 'target',
  aggregation = 'aggregation',
}

export interface VisualisationDefinition { // DEFINE THE VIS IN CONFIG
  id: string;
  title: string;
  palette: string[];
  attribute?: AttributeDef; // No attribute --> just draw points/polys
  // Modes
  modes: {
    [VisualisationMode.target]?: TargetDef;
    [VisualisationMode.aggregation]?: AggregationDef;
  };
}

interface AttributeDef {
  field: string;
  type: AttributeType;
}

interface TargetDef {
  measure: string;
}

export interface AggregationDef {
  measure: string;
  function: NumericAggregationFunctionOptions;
}

export interface LayerRequestOptions extends ResultConfig { // REQUEST BUILDING OF LAYER
  // Essential
  layer_id: string; // Store against this ID in our cache and also Mapbox's
  viz_mode: VisualisationMode; // e.g. 'target' or 'aggregation'
  geodata: FeatureCollection;
  existing_viz_meta?: VisualisationLayerMetadata;
  bin_geodata?: FeatureCollection;
  // Cache strategy
  force_create?: boolean;
}

export interface VisualisationLayer { // BUILT LAYER TO STORE IN CACHE
  layer_id: string; // How the layer is referred to in Mapbox's cache
  layer: Layer; // Mapbox layer (includes source)
  options: LayerRequestOptions; // Request that generated it. Storing why?
  meta: VisualisationLayerMetadata;
  visible: boolean; // Vue-side info on layer visibility
}

export interface LayersCache { // PLACE THAT WE STORE THE LAYERS
  [name: string]: VisualisationLayer;
}

export interface VisualisationLayerMetadata {
  colour_expression: Expression | string; // Mapbox data-driven styling Expression
  colour_mapping: ColourMapping[];
}

export interface ColourMapping {
  value: number | string | boolean;
  colour: string;
}

export type NumericAggregationFunction =
  (data: FeatureCollection, attribute_field: string) => null | number;

export enum AttributeType {
  boolean = 'boolean',
  category = 'category',
  continuous = 'continuous',
}

export enum NumericAggregationFunctionOptions {
  sum = 'sum',
  count = 'count',
  mean = 'mean',
  max = 'max',
  min = 'min',
}

export interface LayerName {
  id: string;
  label: string;
  value: string;
}
