import { FeatureCollection } from '@turf/helpers';
import {
  check_has_poly,
  remove_internal_id_from_geodata,
  copy_point_attributes_to_polys,
  polys_to_points,
  add_internal_id_to_geodata,
} from '@/lib/data/poly_to_point';
import { isNull, cloneDeep } from 'lodash';

class GeodataCarrier {
  public points: null | FeatureCollection = null;
  private polys: null | FeatureCollection = null;
  private did_upload_polys: boolean = false;
  private aggregation_polys: null | FeatureCollection = null;

  public set(geodata: FeatureCollection) {
    this.did_upload_polys = check_has_poly(geodata);

    if (this.did_upload_polys) {
      this.polys = geodata;
      add_internal_id_to_geodata(this.polys);
      this.points = polys_to_points(geodata);
    } else {
      this.points = geodata;
    }
  }

  public update(geodata: FeatureCollection) {
    if (this.did_upload_polys) {
      if (!this.polys) {
        return console.error('Missing polys on GeodataCarrier');
      }
      // copy properties from points to polys
      this.points = geodata;
      copy_point_attributes_to_polys(this.polys, this.points);
    } else {
      this.points = geodata;
    }
  }

  public for_download(): null | FeatureCollection {
    const original = this.get_original();
    if (isNull(original)) {
      return null;
    }
    const cloned = cloneDeep(original);
    remove_internal_id_from_geodata(cloned);
    return cloned;
  }

  public get_original(): null | FeatureCollection {
    if (this.did_upload_polys) {
      return this.polys;
    } else {
      return this.points;
    }
  }

  public features_count_or_zero(): number {
    const original = this.get_original();
    if (original) {
      return original.features.length;
    }
    return 0;
  }
}

export const geodata_carrier = new GeodataCarrier();
