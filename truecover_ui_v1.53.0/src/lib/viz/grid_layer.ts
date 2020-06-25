import hex_grid from '@turf/hex-grid';
import { isNumber, sum, mean } from 'lodash';
import bbox from '@turf/bbox';
import bbox_polygon from '@turf/bbox-polygon';
import buffer from '@turf/buffer';
import points_within_polygon from '@turf/points-within-polygon';
import { Point, Polygon, FeatureCollection, Feature, Geometry } from '@turf/helpers';

import {
  NumericAggregationFunction,
  NumericAggregationFunctionOptions,
  VisualisationDefinition,
} from '@/types';
import config from '@/config/config';
import { check_has_poly, polys_to_points } from '@/lib/data/poly_to_point';


/**
 * Simple aggregation of points to grids.
 */
export function aggregate_onto(
  grids: FeatureCollection,
  geodata: FeatureCollection,
  viz_def: VisualisationDefinition,
): FeatureCollection {
  let attribute_field: string;
  let aggregation_function: NumericAggregationFunction;

  if (viz_def.modes.aggregation === undefined) {
    const msg = 'Trying to create aggregate layer without an aggregation definition';
    console.error(msg, viz_def);

    throw new Error(msg);
    // no aggregation - what are we doing here?
  }

  // Simple count aggregation doesn't require attribute field to be defined, but we need one
  // to make sure the aggregations are accessible on the grids
  if (viz_def.attribute) {
    attribute_field = viz_def.attribute.field;
  } else {
    attribute_field = config.map.defaults.dummy_attribute_field;
  }

  // Convert string to actual function: e.g. 'sum'
  aggregation_function = function_from_aggregation_def(viz_def.modes.aggregation.function);

  let points: FeatureCollection<Point>;

  if (check_has_poly(geodata)) {
    // TODO: Re-use the geodata_carrier in here? But makes faking the state harder.
    points = polys_to_points(geodata) as FeatureCollection<Point>;

  } else {

    points = geodata as FeatureCollection<Point>;

  }

  // TODO: Swap out reduce === faster?
  const features = grids.features.reduce((acc: Feature[], grid) => {
    const points_in_poly = points_within_polygon(points, grid as Feature<Polygon>) as FeatureCollection;
    if (points_in_poly.features.length > 0) {
      if (!grid.properties) {
        grid.properties = {};
      }
      grid.properties[attribute_field] = aggregation_function(points_in_poly, attribute_field);
      acc.push(grid);
    }
    return acc;
  }, []);

  // TODO: Need to handle zero aggregation features better: e.g. when districts and points don't overlap
  // if (features.length === 0) {
  //   const msg = 'Points do not lie in polygons';
  //   throw new Error(msg);
  // }

  return {
    type: 'FeatureCollection',
    features,
  };
}

export function function_from_aggregation_def(fn_def: NumericAggregationFunctionOptions): NumericAggregationFunction {
  const count_fn: NumericAggregationFunction = (fc) => fc.features.length;

  switch (fn_def) {
    case NumericAggregationFunctionOptions.count:
      return count_fn;
    case NumericAggregationFunctionOptions.sum:
      return (fc, attribute_field) => {
        const values = attribute_values(fc, attribute_field);
        return sum(values);
      };
    case NumericAggregationFunctionOptions.mean:
      return (fc, attribute_field) => {
        const values = attribute_values(fc, attribute_field);
        return mean(values);
      };
    case NumericAggregationFunctionOptions.max:
      return (fc, attribute_field) => {
        const values = attribute_values(fc, attribute_field);
        return Math.max(...values);
      };
    case NumericAggregationFunctionOptions.min:
      return (fc, attribute_field) => {
        const values = attribute_values(fc, attribute_field);
        return Math.min(...values);
      };
    default:
      return count_fn;
  }
}


/**
 * Extract attribute value from properties,
 * dropping any non-number
 */
export function attribute_values(fc: FeatureCollection, attribute_field: string): any {
  return fc.features
    .map((f) => {
      if (!f.properties) {
        return;
      }
      return f.properties[attribute_field];
    })
    .filter((i) => {
      return isNumber(i);
    });
}

export function make_hex_grids(geodata: FeatureCollection, cell_size_km: number): FeatureCollection {
  // Create a bbox that is buffered by twice the cell-size, to avoid missing points
  const buff_box = bbox(buffer(bbox_polygon(bbox(geodata)), cell_size_km * 2));

  // TODO: Check for bbox that crosses 180 deg in either direction
  // const box_area = area(bbox_polygon(buff_box)) / 1000000;
  // console.log('box_area', box_area);

  // Prepare empty hex_grids
  const hex_grids = hex_grid(buff_box, cell_size_km);

  return hex_grids;
}
