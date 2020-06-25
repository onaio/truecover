import geojsonhint from '@mapbox/geojsonhint';

import { FeatureProperties } from '@/types';
import { FeatureCollection, Feature } from '@turf/helpers';

export function validate_geojson(geodata: FeatureCollection): string[] {
  return geojsonhint.hint(geodata).map((i: any) => i.message);
}

export function feature_properties(geodata: FeatureCollection): FeatureProperties[] {
  if (!geodata || !geodata.features) {
    return [];
  }
  return geodata.features.map((feature: Feature) => feature.properties);
}
