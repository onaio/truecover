import mapboxgl, { Map } from 'mapbox-gl';
import bbox from '@turf/bbox';
import { BBox2d, FeatureCollection } from '@turf/helpers/lib/geojson';

import {
  VisualisationMode,
  LayerRequestOptions,
  BaseLayer,
  ResultConfig,
  AggregateBy,
} from '@/types';
import config from '@/config/config';
import { layers_manager } from '@/lib/map/layers_manager';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import store from '@/store';

export class MapSupport {
  public mapbox_cache: null | Map = null; // This is 'map' in the Mapbox examples

  public draw_map(base_layer: BaseLayer, bin_geodata: FeatureCollection): Promise<null | Map> {
    return new Promise((resolve, reject) => {

      try {
        const centre_coords: [number, number] = config.map.defaults.centre;

        // Configure map object

        mapboxgl.accessToken = config.map.mapbox.accessToken;
        this.mapbox_cache = new mapboxgl.Map({
          container: 'map',
          style: this.string_to_style_url(base_layer),
          center: centre_coords,
          zoom: config.map.defaults.zoom,
        });

        // Map controls
        this.mapbox_cache.addControl(new mapboxgl.FullscreenControl());

        // Resolve on 'load' event, so view can respond if needed

        this.mapbox_cache.on('load', async () => {
          try {
            // TODO: Refactor the million try...catches below
            await this.prepare_layers_from_result_config(bin_geodata);
            resolve(this.mapbox_cache!); // This ! is ok: is in an event-handler on mapbox_cache
          } catch (e) {
            reject(e);
          }
        });

        this.mapbox_cache.on('error', (e) => {
          reject(e);
        });
      } catch (e) {
        throw e;
      }

    });
  }

  public remove_map(): void {
    this.reset_layer_cache();
    if (this.mapbox_cache) { this.mapbox_cache.remove(); }
    this.mapbox_cache = null;
  }

  public async prepare_layers_from_result_config(bin_geodata: FeatureCollection) {
    try {
      const rc = store.state.result_config;
      if (!rc) {
        throw new Error('Cannot find result_config');
      }
      const layer_req_targets = this.create_layer_request(rc, VisualisationMode.target);
      await this.add_layer(layer_req_targets);

      if (rc.viz_def.modes.aggregation && rc.aggregate_by !== AggregateBy.NONE) {
        const layer_req_aggregation = this.create_layer_request(rc, VisualisationMode.aggregation);
        await this.add_layer({ ...layer_req_aggregation, bin_geodata });
      }

      this.zoom_to_geodata();
    } catch (e) {
      throw e;
    }

  }

  public redraw_visible_layers(): void {
    // console.log('redraw_visible_layers');
  }

  public set_baselayer(layer: BaseLayer) {
    if (!this.mapbox_cache) {
      return;
    }

    this.mapbox_cache.once('styledata', this.redraw_visible_layers);
    this.mapbox_cache.setStyle(this.string_to_style_url(layer), { diff: false });
  }

  public zoom_to_geodata(): void {
    if (!this.mapbox_cache) {
      return;
    }

    const geodata = geodata_carrier.get_original();

    if (!geodata) {
      this.mapbox_cache.setCenter(config.map.defaults.centre);
      this.mapbox_cache.setZoom(config.map.defaults.zoom);
      return;
    }

    const layer_bbox = bbox(geodata as any) as BBox2d;
    this.mapbox_cache.fitBounds(layer_bbox, { padding: 100 });
  }

  private create_layer_request(
    result_config: ResultConfig,
    viz_mode: VisualisationMode,
    force_create?: boolean,
  ): LayerRequestOptions {
    const geodata = geodata_carrier.get_original();
    if (!geodata) {
      throw new Error('Cannot find geodata');
    }
    const options: LayerRequestOptions = {
      ...result_config,
      layer_id: layers_manager.to_id(result_config.viz_def.id, viz_mode),
      viz_mode,
      geodata,
      force_create,
    };
    return options;
  }

  private async add_layer(
    options: LayerRequestOptions,
  ): Promise<void> {
    // TODO: Need to remove or can hide?
    try {
      this.remove_layer_and_source(options);

      if (!this.mapbox_cache) {
        throw new Error('Missing mapbox_cache');
      }

      const viz = await layers_manager.create_or_get(options);

      if (viz === null) {
        throw new Error(`No viz found or created for ${options}`);
      }

      // Set initial layer visibility
      if (viz.layer.layout) {
        viz.layer.layout.visibility = 'visible';
      } else {
        viz.layer.layout = {
          visibility: 'visible',
        };
      }

      const before_this_layer_id = layers_manager.to_id(options.viz_def.id, VisualisationMode.target);
      if (options.viz_mode === VisualisationMode.aggregation && this.mapbox_cache.getLayer(before_this_layer_id)) {
        this.mapbox_cache.addLayer(viz.layer, before_this_layer_id);
      } else {
        this.mapbox_cache.addLayer(viz.layer);
      }

    } catch (e) {
      throw e;
    }
  }

  private reset_layer_cache(): void {

    // TODO: Reset layer cache dynamically - currently fixed to target and aggregation layer
    // this.remove_layer_and_source(VisualisationMode.target);
    // this.remove_layer_and_source(VisualisationMode.aggregation);
    layers_manager.reset_cache();
  }

  private string_to_style_url(layer: BaseLayer): string {
    return `mapbox://styles/${layer.ref}`;
  }

  private remove_layer_and_source(options: LayerRequestOptions) {
    if (!this.mapbox_cache) {
      return;
    }
    if (this.mapbox_cache.getLayer(options.layer_id)) {
      this.mapbox_cache.removeLayer(options.layer_id);
    }
    if (this.mapbox_cache.getSource(options.layer_id)) {
      this.mapbox_cache.removeSource(options.layer_id);
    }
  }
}

export const map_support = new MapSupport();

// @ts-ignore
window.junk = {
  c: config,
  ms: map_support,
  mc: map_support.mapbox_cache,
  lcm: layers_manager,
  gd: geodata_carrier,
};
