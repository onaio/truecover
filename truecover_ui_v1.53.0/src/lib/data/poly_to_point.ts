import { FeatureCollection, Feature, Properties, Geometry, featureCollection } from '@turf/helpers';
import centroid from '@turf/centroid';
import {propEach} from '@turf/meta';
import { GeometryTypeEnum } from '@/types';
import config from '@/config/config';
import { cloneDeep, intersection, omit, isUndefined } from 'lodash';

/**
 * (**Mutates**)
 * Add an internal ID field
 *
 * @param {FeatureCollection} geodata
 * @returns {FeatureCollection}
 */
function add_internal_id_to_geodata(geodata: FeatureCollection): void {
  propEach(geodata, (current_properties: Properties, feature_index) => {
    if (current_properties) {
      current_properties[config.processing.poly_to_point_id_field] = feature_index;
    } else {
      console.error('Missing properties for Feature', feature_index);
    }
  });
}

/**
 * (**Mutates**)
 * Remove the internal ID field
 *
 * @param {FeatureCollection} geodata
 * @returns {FeatureCollection}
 */
function remove_internal_id_from_geodata(geodata: FeatureCollection): void {
  propEach(geodata, (current_properties: Properties, feature_index) => {
    if (current_properties) {
      delete current_properties[config.processing.poly_to_point_id_field];
    } else {
      console.error('Missing properties for Feature', feature_index);
    }
  });
}

/**
 * Return new FeatureCollection of points with properties matching
 * this incoming polys
 *
 * @param {FeatureCollection} geodata
 * @returns {FeatureCollection}
 */
function polys_to_points(geodata: FeatureCollection): FeatureCollection {
  const cloned_geodata = cloneDeep(geodata);
  const point_features = cloned_geodata.features.map((feature) => {
    const c = centroid(feature);
    c.properties = feature.properties;
    return c;
  });
  return featureCollection(point_features);
}


/**
 * (**Mutates**)
 * Updates original with incoming
 *
 * @param {FeatureCollection} original_fc
 * @param {FeatureCollection} result_fc
 * @returns {void}
 */
function copy_point_attributes_to_polys(
  original_fc: FeatureCollection,
  result_fc: FeatureCollection,
): void {
  original_fc.features.forEach((original_feature) => {
    const found_result_point = result_fc.features.find((result_feature) => {
      if (result_feature.properties && original_feature.properties) {
        const result_feature_internal_id = result_feature.properties[config.processing.poly_to_point_id_field];
        const original_feature_internal_id = original_feature.properties[config.processing.poly_to_point_id_field];
        if (isUndefined(result_feature_internal_id) || isUndefined(original_feature_internal_id)) {
          console.error('Missing internal ID from features - cannot find a match without it');
          return false;
        }
        return result_feature_internal_id ===  original_feature_internal_id;
      }
      return false;
    });

    if (found_result_point) {
      original_feature.properties = found_result_point.properties;
    } else {
      console.error(`Missing poly_feature for point_feature: ${original_feature}`);
    }
  });

}


/**
 * Returns true if one Feature in the collection has Polygon or MultiPolygon type
 *
 * @param {FeatureCollection} geodata
 * @returns {boolean}
 */
function check_has_poly(geodata: FeatureCollection): boolean {
  const all_geom_types = geodata.features.reduce((acc, feature) => {
    if (feature.geometry) {
      acc.push(feature.geometry.type);
    }
    return acc;
  }, [] as string[]); // e.g. ['Point']

  // Check overlap between polygon types and what we get
  const poly_types = [GeometryTypeEnum.Polygon, GeometryTypeEnum.MultiPolygon];
  const result = intersection(poly_types, all_geom_types);
  return result.length > 0;
}

export {
  add_internal_id_to_geodata,
  remove_internal_id_from_geodata,
  polys_to_points,
  copy_point_attributes_to_polys,
  check_has_poly,
};
