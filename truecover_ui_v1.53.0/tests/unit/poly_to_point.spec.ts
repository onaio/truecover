import { featureCollection, point, polygon } from '@turf/helpers';

import { copy_point_attributes_to_polys } from '@/lib/data/poly_to_point';
import config from '@/config/config';

describe('copy_point_attributes_to_polys', () => {
  it('works with a poly to a point', () => {
    const input_poly_fc = featureCollection([polygon([[[1, 1], [1, 2], [2, 2], [1, 1]]],
      { [config.processing.poly_to_point_id_field]: 0, original: 1 })]);
    const result_point_fc = featureCollection([point([1.5, 1.5],
      { [config.processing.poly_to_point_id_field]: 0, original: 1, updated: 2 })]);

    copy_point_attributes_to_polys(input_poly_fc, result_point_fc);

    const actual = input_poly_fc.features[0];
    expect(actual.properties!.updated).toEqual(2);
    expect(actual.geometry!.type).toEqual('Polygon');
  });

  it('works with a poly to a point', () => {
    const input_poly_fc = featureCollection([point([1.5, 1.5],
      { [config.processing.poly_to_point_id_field]: 0, original: 1})]);
    const result_point_fc = featureCollection([point([1.5, 1.5],
      { [config.processing.poly_to_point_id_field]: 0, original: 1, updated: 2 })]);

    copy_point_attributes_to_polys(input_poly_fc, result_point_fc);

    const actual = input_poly_fc.features[0];
    expect(actual.properties!.updated).toEqual(2);
    expect(actual.geometry!.type).toEqual('Point');
  });
});
