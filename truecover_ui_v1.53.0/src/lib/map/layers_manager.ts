import { LayersCache, LayerRequestOptions, VisualisationMode, VisualisationLayer } from '@/types';

import LayerWorker from 'worker-loader!@/workers/LayerWorker';
const layer_worker = new LayerWorker();

class LayersManager {
  private layers_cache: LayersCache = {};

  public async create_or_get(
    options: LayerRequestOptions,
  ): Promise<null | VisualisationLayer> {
    try {
      const found = this.get_from_cache(options);
      if (options.force_create || !found) {
        return await this.create_and_cache(options);
      } else {
        return found;
      }
    } catch (e) {
      throw e;
    }
  }

  public reset_cache() {
    this.layers_cache = {};
  }

  public get_all_layers(): VisualisationLayer[] {
    return Object.values(this.layers_cache);
  }

  public to_id(viz_def_id: string, viz_mode: VisualisationMode) {
    const cache_id = `${viz_def_id}:${viz_mode}`;
    return cache_id;
  }

  private async create_and_cache(options: LayerRequestOptions):
    Promise<null | VisualisationLayer> {
    try {
      const cache_id = this.to_id(options.viz_def.id, options.viz_mode);

      const new_layer = await this.create_new_layer(options);
      if (new_layer) {
        return this.layers_cache[cache_id] = new_layer;
      }
      return null;
    } catch (e) {
      throw e;
    }
  }

  private get_from_cache(options: LayerRequestOptions) {
    const cache_id = this.to_id(options.viz_def.id, options.viz_mode);
    return this.layers_cache[cache_id];
  }

  private async create_new_layer(
    options: LayerRequestOptions):
    Promise<null | VisualisationLayer> {
    return new Promise((resolve, reject) => {
      // The code is in `generate_viz.ts`, and runs in a background Worker context
      layer_worker.addEventListener('message', (event) => {
        resolve(event.data);
      });
      layer_worker.postMessage({ ...options });
      layer_worker.onerror = (e) => {
        reject(e);
      };
    });
  }
}

const layers_manager = new LayersManager();

export {
  layers_manager,
};
