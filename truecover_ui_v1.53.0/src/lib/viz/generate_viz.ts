import { Layer, Expression } from 'mapbox-gl';
import { FeatureCollection } from '@turf/helpers';
import { FeatureCollection as GFeatureCollection } from 'geojson';

import { LayerRequestOptions, VisualisationMode, VisualisationLayer, VisualisationLayerMetadata } from '@/types';
import config from '@/config/config';
import { make_hex_grids, aggregate_onto } from '@/lib/viz/grid_layer';
import { create_viz_meta } from '@/lib/viz/create_viz_meta';
import { check_has_poly } from '@/lib/data/poly_to_point';


//
// Expect this to be run in the context of a Worker, not the browser
//

export function generate_viz(options: LayerRequestOptions): null | VisualisationLayer {
  // Make some space
  let geodata: FeatureCollection;




  // Need to create hexgrids for aggregation type
  if (options.viz_mode === VisualisationMode.aggregation) {
    // Make base grids
    // TODO: Don't check against config here - handle another way
    const hex_grid_size_km = options.grid_size_km || config.map.grid_size_km;

    const aggregate_on = options.aggregate_by === 'hexgrids'
      ? make_hex_grids(options.geodata, hex_grid_size_km)
      : (options as any).bin_geodata;

    // Aggregate required values onto each hex_grid
    geodata = aggregate_onto(
      aggregate_on,
      options.geodata,
      options.viz_def,
    );

  } else {
    // Got a target VisualisationMode
    geodata = options.geodata;
  }

  // VizMeta includes the expression for Mapbox, as well as an array of
  // palette colours and values, to simplify the legend creation
  let viz_meta: VisualisationLayerMetadata;
  if (options.viz_mode === VisualisationMode.aggregation && options.existing_viz_meta !== undefined) {
    viz_meta = options.existing_viz_meta;
  }

  viz_meta = create_viz_meta(options, geodata);

  const layer = populate_layer_for_type(options, geodata, viz_meta);

  const result = {
    layer_id: options.layer_id,
    layer,
    options,
    meta: viz_meta,
    visible: true,
  };

  return result;
}

function populate_layer_for_type(
  options: LayerRequestOptions,
  geodata: FeatureCollection,
  viz_meta: VisualisationLayerMetadata): Layer {

  const layer_base = {
    id: options.layer_id,
  };

  switch (options.viz_mode) {
    case VisualisationMode.aggregation:
      return {
        ...layer_base,
        source: {
          type: 'geojson',
          data: geodata as GFeatureCollection,
        },
        type: 'fill',
        paint: {
          'fill-outline-color': 'black',
          'fill-opacity': 0.8,
          'fill-color': viz_meta.colour_expression,
        },
      };
    case VisualisationMode.target:
      const paint = paint_for_fc_type(geodata, viz_meta.colour_expression);
      return {
        ...layer_base,
        source: {
          type: 'geojson',
          data: geodata as GFeatureCollection,
        },
        ...paint,
      };
    default:
      throw new Error(`Invalid VisualisationMode given: ${options.viz_mode}`);
  }
}

function paint_for_fc_type(geodata: FeatureCollection, colour_expression: Expression | string): any {
  if (check_has_poly(geodata)) {
    return {
      type: 'fill',
      paint: {
        'fill-outline-color': 'black',
        'fill-opacity': 0.8,
        'fill-color': colour_expression,
      },
    };
  } else {
    return {
      type: 'circle',
      paint: {
        'circle-radius': {
          stops: [[5, 1], [10, 2]],
        },
        'circle-color': colour_expression,
        'circle-opacity': 0.8,
        'circle-stroke-width': 0.5,
        'circle-stroke-color': 'black',
      },
    };
  }
}
