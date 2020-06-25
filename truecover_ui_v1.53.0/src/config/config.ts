import chroma from 'chroma-js';
import { BaseLayer } from '@/types';

const DEFAULT_MAX_FEATURES = 10000;

// @ts-ignore
const context = CONTEXT;
// Set by Netlify (see https://docs.netlify.com/site-deploys/overview/#deploy-contexts)

const config: Config = {
  api: {
    url: context === 'production' ?
    'https://node-streaming-server-prod-mk5i33k6ua-uc.a.run.app/' :
    'https://node-streaming-server-stage-mk5i33k6ua-uc.a.run.app/',
    key: context === 'production' ? 'F6545581-2F87-424B-9830-81FEFDA2AE25' : 'stage_key',
    localStorage_key: 'api_key',
  },
  extended_version: false,
  loading: {
    ignored_geojsonhint_rules: [
      'old-style crs member',
      'Polygons and MultiPolygons should follow the right-hand rule',
    ],
  },
  display: {
    defaults: {
      bin_count: 7,
      numeric_precision: 3,
    },
  },
  map: {
    max_features: DEFAULT_MAX_FEATURES,
    grid_size_km: 1,
    defaults: {
      point_layer: 'targets',
      grid_layer: 'targets',
      centre: [1.3, 12.4],
      zoom: 1.5,
      palette: chroma.brewer.YlOrRd,
      point_colour: 'blue',
      dummy_attribute_field: '__aggregate_attribute_field',
      lat_field_name: 'lat',
      lng_field_name: 'lng',
    },
    mapbox: {
      accessToken: 'pk.eyJ1Ijoib25seWpzbWl0aCIsImEiOiI3R0ZLVGtvIn0.jBTrIysdeJpFhe8s1M_JgA',
    },
    baselayer_styles: [
      { name: 'Roads', ref: 'mapbox/streets-v9' },
      { name: 'Satellite', ref: 'mapbox/satellite-v9' },
      { name: 'Custom vector', ref: 'onlyjsmith/cj5hrrba54fr22robk699tmt7' },
    ],
  },
  processing: {
    poly_to_point_id_field: 'INTERNAL__poly_point_id_field',
  },
  table: {
    max_features: 20000,
  },
};

interface Config {
  api: {
    url: string;
    key: null | string;
    localStorage_key: string;
  };
  extended_version: boolean;
  loading: {
    ignored_geojsonhint_rules: string[];
  };
  display: {
    defaults: {
      bin_count: number;
      numeric_precision: number;
    };
  };
  map: {
    max_features: number;
    grid_size_km: number;
    defaults: {
      point_layer: string;
      grid_layer: string;
      centre: [number, number];
      zoom: number;
      palette: string[],
      point_colour: string,
      dummy_attribute_field: string;
      lat_field_name: string;
      lng_field_name: string;
    },
    mapbox: {
      accessToken: string;
    },
    baselayer_styles: BaseLayer[];
  };
  processing: {
    poly_to_point_id_field: string;
  };
  table: {
    max_features: number;
  };
}

export default config;

